# 07 — Edge & Worker Processes

Three long-running Node processes carry the RCU traffic. They share a strong family
resemblance: no HTTP framework, a bootstrap-task array, a `do…while(true)` consume loop,
structured winston logging, and **`process.exit(1)` on any fatal error** so pm2/Kubernetes
restarts them clean.

## 0. Shared skeleton

Every one of the three starts like this:

```ts
import appRoot from 'app-root-path';
import 'dotenv/config';

const tsConfig = require(`${appRoot}/tsconfig.json`);
import {register} from 'tsconfig-paths';
register({baseUrl: `${appRoot}`, paths: tsConfig.compilerOptions.paths});

// … then imports that rely on @lib/@config aliases
```

and bootstraps like this:

```ts
const tasks = [initSharedManager, initBeanstalkd, initRedis, initSdk];
for (let i = 0; i < tasks.length; i++) {
    logExtend.info(`${tasks[i].name} Starting ...`, {module: 'process_bootstrap'});
    await tasks[i]();
    logExtend.info(`${tasks[i].name} completed`, {module: 'process_bootstrap'});
}
```

and fails like this:

```ts
catch (e) {
    logExtend.error(e);
    setTimeout(() => { process.exit(1); }, 2000);   // 2s grace so logs flush to GCP
}
```

The 2-second delay is deliberate — it works around
[googleapis/nodejs-logging-winston#751](https://github.com/googleapis/nodejs-logging-winston/issues/751)
where log entries are lost on an immediate exit.

`logExtend` is a wrapper that attaches structured fields (`module`, `rcu_slug`, `rcu_id`,
`rcu_host`, `rcu_port`, `payloads`, `site_id`, …) to each entry. Use it, not bare `console.log`.

---

## 1. `hosrocket.site-server.rcu-to-pubsub`

**Where it runs:** hotel bare metal, next to the RCU network.
**Job:** accept raw TCP frames from RCUs, ACK instantly, forward to the cloud.

### Flow

[src/index.ts](../reference/hosrocket.site-server.rcu-to-pubsub/src/index.ts) starts a plain
Node TCP server:

```ts
const server = net.createServer(connectionListener);
server.listen(config.socket_server.port, () => { … });
```

[src/processor/connection.ts](../reference/hosrocket.site-server.rcu-to-pubsub/src/processor/connection.ts)
handles each chunk:

1. Resolve the controller IP: `extractControllerIpFromPayload(chunk)` wins over the socket's
   `remoteAddress` (RCUs behind NAT embed their real IP in the frame).
2. **ACK first**: `connection.write(Buffer.from('0000', 'hex'))`.
   The RCU is never made to wait on cloud I/O.
   *(A `TODO` in the code notes that Kaba locks may expect `FF 10 01 01 01 01 FF FF` instead.)*
3. Forward the buffer with `targetIp` and `siteServerIp`, choosing the transport by mode:

```ts
if (config.on_prem)       await sendToQueue(buffer, targetIp, siteServerIp);   // Beanstalkd
else if (config.aws_mode) await sendToSqs(buffer, targetIp, siteServerIp);     // SQS
else                      await sendToPubSub(buffer, targetIp, siteServerIp);  // Pub/Sub
```

4. Any forwarding failure → log → `process.exit(1)` after 2 s.

Socket `error` events are deliberately swallowed (RCUs drop connections constantly);
`end` is logged at debug level only.

### Heartbeat

`prepareHeartbeatReporter()` builds a `HeartbeatReporter` with whichever client matches the
mode (SQS / Beanstalkd / Pub/Sub), typed `HeartbeatType.Process`, tagged with
`packageJson.name` and `config.site_id`, publishing every `config.heartbeat.report_interval`.
An `onError` handler exits the process.

### Config

Prefix `HOSROCKET_SITE_SERVER_RCU_TO_PUBSUB_`. Notable keys:
`socket_server.port`, `organization_id`, `site_server_id`, `site_id`,
`reserved_payload_word`, `heartbeat.report_interval`, `on_prem`, `aws_mode`,
`aws.{region, sqs.*, cloud_watch.log_group_name}`, `beanstalkd[BeanstalkdKey]`.

Topics: `hosrocket-rcu-payload-v1`, `hosrocket-device-heartbeat-v1`.
Tubes: `rcu_to_queue`, `device_heartbeat`.

Env files: `.env_cloud.sample`, `.env_onprem.sample`, `.env_aws.sample`
(`yarn dev` / `dev-op` / `dev-aws`).

---

## 2. `hosrocket.worker.pubsub-rcu-payload-processor`

**Where it runs:** HosRocket cloud (GKE).
**Job:** turn raw RCU frames into room state, logs, alerts and downstream events.
This is the most logic-dense of the three and the only one with a test suite.

### Consume loop

[src/index.ts](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/index.ts) picks a
listener based on mode. Both are infinite `do…while(true)` loops:

```ts
// Pub/Sub
messages = await reserveMessage({subClient, formattedSubscription});
for (const message of messages) {
    const payload: IRcuPayload = JSON.parse(message.message.data.toString());
    await processRcuPayload(payload);
    await ackMessage({subClient, formattedSubscription, ackId: message.ackId});
}

// Beanstalkd
const job = await reserve<IRcuPayload>({beanstalkdKey: BeanstalkdKey.RcuPayload});
try   { await processRcuPayload(job.payload); await destroy({…, jobId: job.jobId}); }
catch { await bury({…, jobId: job.jobId}); }
```

A `DEADLINE_EXCEEDED` error from Pub/Sub is expected on an idle subscription and is skipped
rather than treated as a failure. Failed messages are **not** acked (Pub/Sub) or are **buried**
(Beanstalkd) for inspection.

Subscription: `sub-hosrocket-worker-pubsub-rcu-to-redis`.

### What `processRcuPayload` does

[src/processor.ts](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/processor.ts):

1. **Resolve context** via the Core SDK ([src/lib/api.ts](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/lib/api.ts)):
   `getRcuByHostSiteServerId`, `getRoom`/`getRoomById`, `getFloorById`, `getFloorsBySiteId`,
   `getSiteById`, `getDevices`.
2. **Decode** the frame into `RcuEvent[]` with `getEvents(...)`, `hasDateTime(...)`,
   `getDeviceHeartbeatEntry(...)` ([src/lib/rcu.ts](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/lib/rcu.ts)).
3. **Filter** events against the room's registered devices — `filterEventByDevice(events, devices)`
   keeps ungrouped events, keeps all codes except `8` and `255`, and for those two only keeps
   events whose `(group, deviceTypeId)` matches a real device.
4. **Enrich** — `injectDewPoint(...)` computes dew point from temperature + humidity.
5. **Persist state** to Redis ([src/processor/redis.ts](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/processor/redis.ts)):
   - key shape
     `hosrocket:rcu_event:site:{site_id}:room:{room_id}:action:{action}[:device_type_id:{n}][:group:{n}]`
   - `getRcuEventValue` / `setRcuEventValue`, `updateLastPayloadTimestamp`,
     `isRealtimeUpdateRegistered`
   - two Redis databases: `rcu_state` (current values) and `rcu_event` (event records), plus `cache`
6. **Derive business records** via the Core SDK: `housekeepingLogStart`, `housekeepingLogEnd`,
   `housekeepingLogInspectionComplete`; also handles `room_collection` floors by resolving all
   floors that contain the room.
7. **Log usage** — [power_usage_log.ts](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/processor/power_usage_log.ts),
   [water_usage_log.ts](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/processor/water_usage_log.ts).
8. **Device health** — [device_health_stat.ts](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/processor/device_health_stat.ts):
   `logStat`, `logAggregatedStat`.
9. **Fan out** — [external_process.ts](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/processor/external_process.ts):
   `sendToSocketIo` → `hosrocket-worker-to-socket-io-v1`,
   `sendToAlertHandler` → `hosrocket-alert-event-v1`,
   `sendToDeviceHeartbeat` → `hosrocket-device-heartbeat-v1`,
   plus `hosrocket-spawn-notification-v1`.
10. **Webhooks** — [webhook.ts](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/processor/webhook.ts):
    `getSiteWebhookTriggers`, `spawnWebhook`, gated by `config.webhook_whitelist[siteId]`.

`sendToSocketIo` is what makes the portal's room grid update live — see
[04 §5](04-admin-client-architecture.md#5-real-time-updates).

### Config

Prefix `HOSROCKET_WORKER_PUBSUB_RCU_PAYLOAD_PROCESSOR_`. Keys include
`redis[RedisKey]` (`rcu_state`, `rcu_event`, `cache`), `gcp.project_id`,
`pubsub.topic.*`, `pubsub.subscriber.rcu_to_redis`, `core_api.{host, master_api_key}`,
`beanstalkd[BeanstalkdKey]`, `on_prem`, `webhook_whitelist`.

Local enums under `src/enum/` mirror a subset of the shared enums
(`rcu_action`, `rcu_value`, `device_type`, `device_type_id`, `check_in_status`,
`heartbeat_type`, `notification_usage_type`) — this repo does not import `src/shared` from the
admin repo, it depends on `@bossagroove/core.hosrocketapi.com_type` instead.

### Tests

`jest` + `ts-jest`, with `src/lib/__mocks__`, `src/lib/__test__`, `src/processor/__test__`,
`ioredis-mock` for Redis and `mockdate` for time. **New processor logic should come with tests
here** — this is the only one of the three repos where that is the established norm.

Run: `yarn test` (which sets `DOTENV_CONFIG_PATH=.env_cloud`).

---

## 3. `hosrocket.site-server.pubsub-to-rcu`

**Where it runs:** hotel bare metal.
**Job:** take command payloads from the cloud and write them to the RCU over TCP.

### Flow

[src/index.ts](../reference/hosrocket.site-server.pubsub-to-rcu/src/index.ts) runs the same
dual listener (Pub/Sub subscription `config.pubsub.subscriber.pubsub_to_rcu`, or the
`queue_to_rcu` Beanstalkd tube), with a **2-second pause after each processed batch** to avoid
hammering the RCU bus.

[src/processor.ts](../reference/hosrocket.site-server.pubsub-to-rcu/src/processor.ts):

```ts
export interface IRcuPayload {
    id: string;
    slug: string;
    host: string;
    port: number;
    payloads: string[];      // hex strings
    module: RcuControlModule;
}

export async function processRcuPayload(payload: IRcuPayload): Promise<void> {
    if (config.blacklist_module.includes(module)) { /* log and skip */ return; }

    for (let i = 0; i < payloads.length; i++) {
        try {
            await sendRequest({host, port, payload: Buffer.from(payloads[i], 'hex'), timeout: 10000});
        } catch (e) {
            logExtend.error('> Send to RCU error', {error: e.message, rcu_slug, rcu_id, …});
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));  // 1s between commands
    }
}
```

Behaviours worth preserving in any change:
- **`config.blacklist_module`** lets ops disable a whole control module (lighting, HVAC, …)
  per site without a deploy.
- **1-second gap** between consecutive commands — RCUs drop commands sent back-to-back.
- **10-second socket timeout** per command.
- A send failure is **logged, not retried and not fatal** — the loop continues to the next
  payload. (Contrast with the upstream process, where a queue failure *is* fatal.)

### Config

Prefix `HOSROCKET_SITE_SERVER_PUBSUB_TO_RCU_`. Keys: `gcp.project_id`,
`pubsub.topic.device_heartbeat`, `pubsub.subscriber.pubsub_to_rcu`, `organization_id`,
`site_server_id`, `site_id`, `heartbeat.report_interval`, `blacklist_module`, `on_prem`,
`beanstalkd[BeanstalkdKey]`.

Enums: `net_error.ts`, `rcu_control_module.ts`.
Dev helpers: `src/scripts/maintenance/fake_rcu.ts` (stands up a fake RCU listener) and
`send_to_rcu.ts` (fires a payload manually). Use these when developing without hardware.

---

## 4. Designing a feature that touches this path

Ask these questions before proposing anything:

1. **Which direction?** Reading room state is cheap — it's already in Redis and exposed
   through the core API. *Commanding* hardware means a new `RcuControlModule`/action, a core
   change to build the frames, and a firmware-level agreement about the payload.
2. **Does the RCU already report it?** If the value isn't in the existing `RcuAction` /
   `RcuValue` enums, it does not exist in the payload and no amount of portal work will
   surface it.
3. **Where does the state live?** New derived state belongs in Redis `rcu_event`/`rcu_state`
   under the established key shape, or as a core entity if it must survive a Redis flush.
4. **Does it need to work on-prem?** Then it must work over Beanstalkd, without GCS, and
   without the cache invalidator.
5. **Is it real-time?** If the portal must react without a refresh, the worker has to publish
   to `hosrocket-worker-to-socket-io-v1` and the client needs a `web-update` handler.
6. **What happens when the site is offline?** The queue buffers upstream traffic; downstream
   commands will fail and be logged. The UI must not present hardware actions as
   instantly-confirmed.
7. **Blast radius.** These processes run on hardware in occupied hotels. Prefer additive,
   feature-flagged changes; the `blacklist_module` and `webhook_whitelist` configs are the
   existing precedent for per-site rollout.
