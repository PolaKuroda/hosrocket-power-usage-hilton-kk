# 06 — Core API Architecture (`core.hosrocketapi.com`)

The backbone service. It owns MongoDB, the Redis state/cache layer, Pub/Sub publishing, Cloud
Storage, BigQuery and all outbound integrations. **Every other HosRocket service reaches
persistent data through this API, never directly.**

## 1. Bootstrap

[src/bin/server.ts](../reference/core.hosrocketapi.com/src/bin/server.ts) registers
`tsconfig-paths` at runtime, then runs bootstrap tasks in order:

```
initSharedManager → initPubSub → initBeanstalkd → initDb → initRedis
                  → initSchemaMiddleware → initApp
```

Then logs `log_level`, `on_prem`, `NODE_ENV` and sends the pm2 `ready` signal.
`@godaddy/terminus` graceful shutdown is wired up but currently gated off
(`process.env.NODE_ENV === 'production' && false`).

## 2. Layers

```
router      src/app/setup/router/<resource>.ts
   ├─ requireMasterApiKey            (authentication)
   ├─ RateLimit                      (per-key limiting)
   ├─ schemaValidator.validate()     (AJV JSON-Schema request validation)
   └─ controller  src/app/controller/<resource>.ts
         ├─ Mongoose model    src/app/model/<resource>.ts
         ├─ screener          src/app/screener/<resource>/{get,gets}.ts   (output shaping)
         └─ ResponseManager.output({req, res, error, data})
```

### 2.1 Router

[src/app/setup/router/membership.ts](../reference/core.hosrocketapi.com/src/app/setup/router/membership.ts):

```ts
export default function membershipRouter() {
    const schemaValidator = SharedManager.getSchemaValidator();
    const router = Router({mergeParams: true});

    router.use(requireMasterApiKey);
    router.use(RateLimit);

    router.get('/',                  schemaValidator.validate(), asyncHandler(getMemberships));
    router.get('/:membership_id',    schemaValidator.validate(), asyncHandler(getMembershipById));
    router.post('/',                 schemaValidator.validate(), asyncHandler(createMembership));
    router.patch('/:membership_id',  schemaValidator.validate(), asyncHandler(updateMembership));
    router.delete('/:membership_id', schemaValidator.validate(), asyncHandler(deleteMembership));
    return router;
}
```

Registered in [src/app/setup/route.ts](../reference/core.hosrocketapi.com/src/app/setup/route.ts).
Resource list: `users, api-keys, user-acls, organizations, sites, towers, location-districts,
site-servers, rcus, rooms, devices, check-ins, floors, notification-channels, rcu-controls,
housekeeping-logs, housekeeping-stats, notices, alert-policies, incidents, roles, memberships,
webhooks, prometheus, permissions, power-usage-logs, water-usage-logs, check-in-usages,
notifications, heartbeats, rcu-statuses, audit-logs, site-webhooks, device-heartbeats,
site-location-types, site-locations, defects, lost-items, report-schedules, rcu-raw-logs,
luggage-claims`.

### 2.2 Request validation — AJV JSON Schema

`schemaValidator.validate()` resolves the schema for the current method + path from
[src/json_schema/schema.json](../reference/core.hosrocketapi.com/src/json_schema/schema.json)
and rejects non-conforming requests before the controller runs. Adding an endpoint means
**adding its schema entry**; the build copies `src/json_schema` into `dist`.

### 2.3 Models — Mongoose 9

[src/app/model/membership.ts](../reference/core.hosrocketapi.com/src/app/model/membership.ts)
shows the house style:

```ts
export interface IMembership {
    id: Types.ObjectId;
    created_at: Date;
    updated_at: Date;
    organization_id: Types.ObjectId;
    site_id: Types.ObjectId;
    role_id: Types.ObjectId;
    user_id: Types.ObjectId | null;
}

const MembershipSchema = new Schema<IMembership>({
    organization_id: {type: Schema.Types.ObjectId, ref: 'Organization'},
    site_id:         {type: Schema.Types.ObjectId, ref: 'Site'},
    role_id:         {type: Schema.Types.ObjectId, ref: 'Role'},
    user_id:         {type: Schema.Types.ObjectId, ref: 'User', default: null}
});

MembershipSchema.plugin(createdModified);

// each index is commented with the query it serves
MembershipSchema.index({organization_id: 1, user_id: 1, created_at: -1});
MembershipSchema.index({site_id: 1, user_id: 1, created_at: -1});
MembershipSchema.index({role_id: 1, site_id: 1, created_at: -1});
MembershipSchema.index({organization_id: 1, site_id: 1, role_id: 1, user_id: 1}, {unique: true});

const CompiledModel = model<IMembership>('Membership', MembershipSchema, 'memberships');
export default CompiledModel;
export type TMembership = ReturnType<(typeof CompiledModel)['hydrate']>;
```

Conventions:
- `I<Name>` interface, `<Name>Schema`, explicit collection name (snake_case plural).
- Export both the compiled model (default) and `T<Name>` for hydrated documents.
- **Two shared plugins** in [model/plugin/](../reference/core.hosrocketapi.com/src/app/model/plugin/):
  - `created_modified` — adds/maintains `created_at` / `updated_at`
  - `paginate` — adds `Model.paginate({query, sortOrder, page, limit})` returning
    `{results, pagination: {count, page, page_count, limit}}`
- Reusable sub-schemas live in [model/schema/](../reference/core.hosrocketapi.com/src/app/model/schema/):
  `locale_string.ts` (the `{en, zh-HK, zh-CN, ja}` shape), `ticket_comment.ts`.
- **Every new index gets a comment naming the query it exists for.**

Model list: `alert_policy, api_key, audit_log, check_in, check_in_usage, defect, device, floor,
housekeeping_log, incident, location_district, lost_item, luggage_claim, membership, notice,
notification, notification_channel, organization, power_usage_log, rcu, report_schedule, role,
room, site, site_location, site_location_type, site_server, site_webhook, tower, user, user_acl,
water_usage_log`.

### 2.4 Controllers

[src/app/controller/membership.ts](../reference/core.hosrocketapi.com/src/app/controller/membership.ts):

```ts
export async function getMemberships(req: Request<{}, {}, {}, {...}>, res: Response) {
    const {page, limit} = getPagination(req.query);

    let query = {...};   // built defensively from optional filters

    const memberships = await DBMembership.paginate({
        query, sortOrder: {created_at: -1}, page, limit
    });

    ResponseManager.output({
        req, res, error: ErrorCode.Ok,
        data: {
            memberships: memberships.results,
            pagination:  memberships.pagination
        }
    });
}
```

Note the difference from the BFF: core returns a nested **`pagination` object**, while the BFF
flattens it into `{page, count, page_count}` for the table store. Keep that translation in the
BFF's `api_model`/controller.

`ResponseManager` here takes `req` as well, and the response envelope is the same
`{meta: {code, message}, data}` shape used everywhere.

### 2.5 Screeners — output shaping

[src/app/screener/](../reference/core.hosrocketapi.com/src/app/screener/) is a whitelist layer
that decides which fields leave the API and how they are formatted. One folder per resource
with `get.ts` (single entity) and `gets.ts` (collection):

```ts
// screener/membership/get.ts
import {screen} from '@lib/screener';
import {formatDateTime} from '@screener/utility';

export default {
    id: true,
    created_at: screen.and(true, formatDateTime(true)),
    updated_at: screen.and(true, formatDateTime(true)),
    organization_id: true,
    site_id: true,
    role_id: true,
    user_id: true
};
```

```ts
// screener/membership/gets.ts
import get from './get';
import pagination from '../common/pagination';
export default {memberships: [get], pagination};
```

**A field that isn't in the screener is not exposed.** Adding a field to a model without
adding it to the screener is the most common "why isn't my data showing up" bug.

There are ~40 screener folders, plus `screener/common/` for shared fragments like `pagination`.

## 3. Authentication

- **`requireMasterApiKey`** — all internal traffic (BFF, worker, other services) presents the
  master API key. There is no per-user auth at this layer.
- **`api_key` model + `user_acl`** support scoped keys and ACLs for the cases where an external
  system integrates directly.
- **`on-behalf-of-user-id` header** — mutations accept this so the `audit_log` records the real
  human actor rather than the service.
- **`RateLimit`** middleware, backed by Redis; bootstrap task
  `bin/bootstrap_task/rate_limiter/` seeds its configuration (and the build copies that folder
  into `dist`).

## 4. Infrastructure libraries

[src/lib/](../reference/core.hosrocketapi.com/src/lib/):

| File | Purpose |
|---|---|
| `shared_manager.ts` | Singleton locator (db, redis, pubsub, beanstalkd, schema validator, app, server) |
| `screener.ts` | The screening engine (`screen.and`, etc.) |
| `response_manager.ts` | Response envelope |
| `pubsub.ts` / `beanstalkd.ts` | Queue publishing — swapped by `on_prem` |
| `redis.ts` / `cache.ts` / `request_cache.ts` | Caching layers, including whole-request caching |
| `rate_limiter.ts` | Redis rate limiting |
| `rcu_control.ts` | Builds RCU command frames and publishes them to `hosrocket-payload-to-rcu-v1` |
| `bigquery.ts` | RCU raw-log analytics (`rcu_log` dataset, table prefix per config) |
| `cloud_task.ts` | Google Cloud Tasks scheduling |
| `mailer.ts` | SendGrid + Pug email templates |
| `image.ts` | Image handling for uploads |
| `logger.ts`, `utility.ts` | winston logger, `getPagination`, misc |

## 5. Email templates

[src/email_templates/](../reference/core.hosrocketapi.com/src/email_templates/) is organised as
`common/` (+ `common/includes/`) and one folder per locale (`en/`, `ja/`, …), rendered with Pug.
The build copies `src/email_templates` into `dist/src/`.

## 6. Maintenance scripts

[src/scripts/maintenance/](../reference/core.hosrocketapi.com/src/scripts/maintenance/) holds
~30 one-off/ops scripts: bulk import pipelines (`import_1_new_org_site` → `import_2_tower` →
`import_3_floor` → `import_4_room_rcu_device`), `init_device_status`, `init_site_heartbeat`,
`language`, `role`, `vrv_error_code`, `mongodb`, `gcs`, `gcp`, `github`, `test_schema`, …

This is the established place for data migrations and backfills. Put new ones here rather than
inventing an ad-hoc runner.

## 7. Configuration

Env-var prefix and merge strategy mirror the BFF: `config/index.ts` merges
`env/development` ← `env/testing` / `env/production`, `verify_env` fails fast on missing vars,
and `on_prem` toggles Pub/Sub ↔ Beanstalkd and GCS ↔ local storage.

Env files: `.env_cloud.sample`, `.env_onprem.sample`.

Scripts:

| Command | Effect |
|---|---|
| `yarn dev` / `yarn dev-op` | `ttsx ./src/bin/server.ts` with the cloud / on-prem env |
| `yarn build` | `ttsc -p tsconfig.build.json` + `post-build` copy of `json_schema`, `email_templates`, `tsconfig.json`, rate-limiter bootstrap |
| `yarn b` / `bp` / `bpd` | Build image / build+push / build+push+deploy (Kubernetes) |

`javascript-obfuscator` and `uglify-js` are dev dependencies used when producing on-prem
artifacts.

## 8. Checklist: adding a new entity to core

1. **Model** — `src/app/model/<entity>.ts` with `I<Entity>`, schema, `createdModified` plugin,
   commented indexes, explicit collection name, `T<Entity>` export.
2. **JSON schema** — add request definitions to `src/json_schema/schema.json`.
3. **Screener** — `src/app/screener/<entity>/get.ts` and `gets.ts`.
4. **Controller** — `src/app/controller/<entity>.ts` using `paginate`, `getPagination`,
   `ResponseManager`, and the screeners.
5. **Router** — `src/app/setup/router/<entity>.ts` with `requireMasterApiKey`, `RateLimit`,
   `schemaValidator.validate()`, `asyncHandler`.
6. **Register** — add to `src/app/setup/route.ts` as a kebab-case plural path.
7. **Audit** — write an `audit_log` entry for mutations, honouring `on-behalf-of-user-id`.
8. **SDK + types** — the `@bossagroove/core.hosrocketapi.com_sdk` and `_type` packages must be
   regenerated/published so the BFF and worker can consume the new resource.
9. **Migration** — if existing documents need backfilling, add a script under
   `src/scripts/maintenance/`.

> Step 8 is the one most often forgotten in a PoC. If a design requires a new core entity, say
> so explicitly — it implies an SDK release, which is a cross-repo dependency and affects the
> delivery plan.
