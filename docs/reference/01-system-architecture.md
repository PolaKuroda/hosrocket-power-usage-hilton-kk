# 01 — System Architecture Overview

## 1. What HosRocket is

HosRocket is a **hotel guest-room automation and operations platform**. Physical Room
Controlling Units (RCUs) in each guest room talk to a small on-premise "site server" over raw
TCP. That traffic is normalised into events, pushed into the cloud, turned into room state,
alerts, incidents and usage logs, and finally surfaced to hotel staff through the
`admin.hosrocket.com` web portal. Commands flow back down the same path to control lights,
HVAC, scenes, door locks and service workflows.

The system is deliberately **queue-mediated at every hop**, so that a hotel with unstable
connectivity degrades gracefully, and so that the same code runs in a cloud deployment
(Google Pub/Sub) or fully on-premise (Beanstalkd) with only configuration changes.

## 2. Component map

```
                        ┌───────────────── HOTEL PROPERTY (bare metal) ─────────────────┐
                        │                                                               │
   ┌──────────┐  TCP    │  ┌────────────────────────────────┐                           │
   │   RCU    │────────▶│  │ hosrocket.site-server          │                           │
   │ (room N) │◀────────│  │   .rcu-to-pubsub               │  net.createServer()        │
   └──────────┘  TCP    │  │   - ACKs the RCU immediately   │  port SITE_SERVER_PORT     │
        ▲               │  │   - extracts controller IP     │                           │
        │               │  └───────────────┬────────────────┘                           │
        │               │                  │ publish                                    │
        │               │                  ▼                                            │
        │               │        hosrocket-rcu-payload-v1  (Pub/Sub topic)               │
        │               │        or Beanstalkd tube (on-prem)                            │
        │               │        or SQS queue (aws mode)                                 │
        │               │                  │                                            │
        │               │  ┌───────────────┴────────────────┐                           │
        │  TCP  ◀───────│──│ hosrocket.site-server          │◀── hosrocket-payload-to-  │
        │  (hex payload)│  │   .pubsub-to-rcu               │      rcu-v1 (Pub/Sub)      │
        │               │  │   - 1s gap between commands    │                           │
        │               │  │   - module blacklist           │                           │
        │               │  └────────────────────────────────┘                           │
        │               └───────────────────────────────────────────────────────────────┘
        │
        │                        ┌────────────── HOSROCKET CLOUD (GKE) ──────────────┐
        │                        │                                                    │
        │                        │  ┌──────────────────────────────────────────────┐  │
        └────────────────────────│──│ hosrocket.worker                             │  │
                                 │  │   .pubsub-rcu-payload-processor              │  │
                                 │  │   - decodes RCU events                       │  │
                                 │  │   - writes room state → Redis (rcu_state)    │  │
                                 │  │   - writes events     → Redis (rcu_event)    │  │
                                 │  │   - power/water usage logs                   │  │
                                 │  │   - device health stats                      │  │
                                 │  │   - fans out to socket.io / alert / notif.   │  │
                                 │  │   - site webhooks                            │  │
                                 │  └───────┬──────────────────────────────────────┘  │
                                 │          │ HTTP (master API key)                    │
                                 │          ▼                                          │
                                 │  ┌──────────────────────────────────────────────┐  │
                                 │  │ core.hosrocketapi.com                        │  │
                                 │  │   Express 5 + Mongoose 9                     │  │
                                 │  │   MongoDB · Redis · Pub/Sub · GCS · BigQuery │  │
                                 │  └───────▲──────────────────────────────────────┘  │
                                 │          │ Core SDK (master API key)                │
                                 │          │                                          │
                                 │  ┌───────┴──────────────────────────────────────┐  │
                                 │  │ admin.hosrocket.com                          │  │
                                 │  │   src/server  — Express 5 BFF + Pug shell    │  │
                                 │  │   src/client  — React 19 SPA (webpack)       │  │
                                 │  └───────▲──────────────────────────────────────┘  │
                                 │          │ HTTPS  /api/*  (jwt-token header)        │
                                 └──────────┼─────────────────────────────────────────┘
                                            │
                                    ┌───────┴────────┐        ┌─────────────────────┐
                                    │ Hotel staff    │        │ socket.io gateway   │
                                    │ browser (PWA)  │◀──────▶│ (separate repo)     │
                                    └────────────────┘  WS    └─────────────────────┘
```

## 3. Two deployment modes: `cloud` and `on_prem`

This is **the single most important architectural fact** to remember when designing a feature.
Nearly every repo has a boolean `on_prem` config flag that swaps out the transport and some
integrations:

| Concern | Cloud mode | On-prem mode |
|---|---|---|
| Message transport | Google Cloud Pub/Sub | Beanstalkd tubes |
| Blob storage | Google Cloud Storage (`usercontent.hosrocket.com`) | Local path `/usercontent-on-prem` |
| Cache invalidation listener | Enabled (`init_cache_invalidator`) | **Skipped** |
| Credentials | `GOOGLE_APPLICATION_CREDENTIALS` required | Not required |
| Client asset host | `config.user_content_host` | `config.user_content_host_on_prem` |

There is also an experimental **`aws_mode`** in
[hosrocket.site-server.rcu-to-pubsub](../reference/hosrocket.site-server.rcu-to-pubsub) that
targets SQS + CloudWatch Logs instead of Pub/Sub + Cloud Logging.

The SPA learns the mode from a hidden input injected into the HTML shell:

```pug
if (on_prem)
    input#on_prem(type="hidden" name="on_prem" value="1")
```
— [src/server/app/views/app/index.pug](../reference/admin.hosrocket.com/src/server/app/views/app/index.pug)

and reads it via `updateOnPremStatus()` in
[src/client/state/action/global.ts](../reference/admin.hosrocket.com/src/client/state/action/global.ts).

**Design rule:** before you conclude "this is a bug" or "we can just call GCS here", check
whether the behaviour is mode-dependent. Any new integration must have an on-prem story.

## 4. The RCU round trip in detail

### 4.1 Upstream (room → cloud → screen)

1. An RCU opens a TCP connection to the site server and writes a binary frame.
2. [`connectionListener`](../reference/hosrocket.site-server.rcu-to-pubsub/src/processor/connection.ts)
   receives the chunk, resolves the controller IP (preferring an IP embedded in the payload
   over the socket's `remoteAddress`), and **immediately ACKs** with `Buffer.from('0000','hex')`.
   The ACK happens before any queue work so the RCU is never blocked.
3. The raw buffer plus `targetIp` and `siteServerIp` are published to
   **`hosrocket-rcu-payload-v1`** (or the `rcu_to_queue` Beanstalkd tube, or SQS).
4. Any publish failure calls `process.exit(1)` after 2 s so that pm2/Kubernetes restarts the
   process — this is a deliberate "fail loud, restart clean" pattern used across all the
   long-running processes.
5. [`hosrocket.worker.pubsub-rcu-payload-processor`](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/index.ts)
   pulls messages in a `do…while(true)` loop, parses them into `IRcuPayload`, and calls
   [`processRcuPayload`](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/processor.ts).
6. The processor:
   - resolves RCU → room → floor → site via the Core SDK ([`src/lib/api.ts`](../reference/hosrocket.worker.pubsub-rcu-payload-processor/src/lib/api.ts)),
   - filters events against the room's registered devices (`filterEventByDevice`),
   - writes current values to Redis `rcu_state` and event records to Redis `rcu_event`
     under keys like
     `hosrocket:rcu_event:site:{site_id}:room:{room_id}:action:{action}:device_type_id:{n}:group:{n}`,
   - derives housekeeping log start/end/inspection, power & water usage logs, device health
     stats, dew point injection,
   - fans out to other services via Pub/Sub topics
     `hosrocket-worker-to-socket-io-v1`, `hosrocket-alert-event-v1`,
     `hosrocket-device-heartbeat-v1`, `hosrocket-spawn-notification-v1`,
   - triggers site webhooks for whitelisted sites.
7. The socket.io gateway pushes a `web-update` event to any browser subscribed to that
   site/floor. The SPA re-fetches the affected room and patches Redux — see
   [`room_list_data_update.ts`](../reference/admin.hosrocket.com/src/client/views/pages/site/site_detail/room_list/room_list_data_update.ts).

### 4.2 Downstream (screen → room)

1. Staff clicks a control in the portal (e.g. thermostat setpoint).
2. The SPA calls the BFF `POST /api/rcu-controls/...`.
3. The BFF forwards through the Core SDK to `core.hosrocketapi.com`.
4. Core builds the hex command frames and publishes to **`hosrocket-payload-to-rcu-v1`**
   (or the `queue_to_rcu` tube on-prem).
5. [`hosrocket.site-server.pubsub-to-rcu`](../reference/hosrocket.site-server.pubsub-to-rcu/src/processor.ts)
   pulls the job, checks `config.blacklist_module`, then writes each hex payload to the RCU
   over TCP with a **1-second gap between consecutive commands** and a 10 s socket timeout.
6. The RCU acts, then reports its new state back up the *upstream* path — the UI is
   eventually-consistent, never optimistic about hardware.

### 4.3 Heartbeats

Both site-server processes run a `HeartbeatReporter` that publishes a process-level heartbeat
on `hosrocket-device-heartbeat-v1` at `config.heartbeat.report_interval`. This is what powers
"Site server online / RCU online / Device online" on the portal dashboard.

## 5. Known queue topics

| Topic / tube | Producer | Consumer |
|---|---|---|
| `hosrocket-rcu-payload-v1` / `rcu_to_queue` | `site-server.rcu-to-pubsub` | `worker.pubsub-rcu-payload-processor` |
| `hosrocket-payload-to-rcu-v1` / `queue_to_rcu` | core / control services | `site-server.pubsub-to-rcu` |
| `hosrocket-device-heartbeat-v1` / `device_heartbeat` | both site servers, worker | device-health service |
| `hosrocket-worker-to-socket-io-v1` / `socket_io` | worker | socket.io gateway |
| `hosrocket-alert-event-v1` / `alert_handler` | worker | alert handler |
| `hosrocket-spawn-notification-v1` / `spawn_notification` | worker | notification spawner |

Subscription used by the worker: `sub-hosrocket-worker-pubsub-rcu-to-redis`.

## 6. Data stores

| Store | Owner | Purpose |
|---|---|---|
| MongoDB | `core.hosrocketapi.com` only | System of record for every entity (see [09](09-domain-model.md)) |
| Redis `rcu_state` | worker (write), admin BFF (read) | Latest known value per room/action |
| Redis `rcu_event` | worker (write), admin BFF (read) | Event stream/last-seen per room/action/device |
| Redis `cache` | core, admin BFF | Generic response/entity cache, cache invalidation |
| Redis `session` | admin BFF | Express session store (`connect-redis`) |
| BigQuery | core, admin BFF | RCU raw log analytics (`rcu_log` dataset) |
| Google Cloud Storage | core, admin BFF | User content: photos for maintenance/lost-and-found, org/site images |

**Only `core.hosrocketapi.com` talks to MongoDB.** The admin BFF has no database driver at all
— it reaches everything through `@bossagroove/core.hosrocketapi.com_sdk`. Do not add a
MongoDB dependency to the portal.

## 7. Trust boundaries & auth

| Hop | Credential |
|---|---|
| Browser → admin BFF | JWT in the `jwt-token` **request header** (stored in `localStorage.siteJwt`), plus a CSRF token from `GET /csrf` for mutating calls |
| Admin BFF → Core API | Master API key (`ADMIN_HOSROCKET_COM_CORE_API_MASTER_API_KEY`), plus `on-behalf-of-user-id` header for auditability |
| Worker → Core API | Master API key |
| Site server → cloud | GCP service account / workload identity (or SQS IAM in aws mode) |

Authorisation is **permission-based, evaluated per site**. The BFF resolves
`RolePermission[]` for `(site_id, user_id)` on every request and the SPA mirrors the same list
to hide UI. See [09-domain-model.md](09-domain-model.md#permissions).

## 8. Deployment topology

- **Cloud services** (`core.hosrocketapi.com`, `admin.hosrocket.com`, `worker.*`) ship as
  Docker images to GKE. Each repo carries `kubernetes/web-deployment.yml`,
  `web-service.yml`, `web-ingress.yml` and `scripts/kubernetes/{build,push,deploy}.sh`
  (`yarn bpd` = build + push + deploy).
- The admin image runs under **pm2** (`pm2-runtime start scripts/startup/docker/app.json`).
- `admin.hosrocket.com` also carries an `nginx/` directory with per-host reverse-proxy
  configs and TLS material for `admin`, `grafana` and `prometheus` hosts.
- GKE workload identity is used instead of service-account JSON files — the `kubectl` /
  `gcloud iam` recipe is in [core's README](../reference/core.hosrocketapi.com/README.md), with
  per-service variants in
  [`admin.hosrocket.com/README_kubernetes_service_account.md`](../reference/admin.hosrocket.com/README_kubernetes_service_account.md)
  and
  [`hosrocket.worker.pubsub-rcu-payload-processor/README_kubernetes_service_account.md`](../reference/hosrocket.worker.pubsub-rcu-payload-processor/README_kubernetes_service_account.md).
- **Site-server processes** run on hotel bare metal under pm2, restarted on any fatal error.

## 9. Observability

- **winston** everywhere, with `@google-cloud/logging-winston` transport in cloud mode and
  `winston-cloudwatch` in aws mode. The site servers use a `logExtend` wrapper that attaches
  structured fields (`module`, `rcu_slug`, `rcu_id`, `rcu_host`, `payloads`, …).
- **New Relic** agent in `core.hosrocketapi.com` and `admin.hosrocket.com`.
- **Prometheus** endpoint in core (`/prometheus`), Grafana host config in the admin repo.
- Access logging middleware in both Express apps with an `include` allow-list of paths.
