# 05 — Admin Server / BFF Architecture (`admin.hosrocket.com/src/server`)

The portal's Express app. It is a **backend-for-frontend**: it serves the SPA shell, owns the
browser session/JWT/CSRF, enforces per-site permissions, and proxies everything else to
`core.hosrocketapi.com` through the Core SDK. **It has no database of its own.**

## 1. Bootstrap sequence

[src/server/bin/server.ts](../reference/admin.hosrocket.com/src/server/bin/server.ts) runs
bootstrap tasks in order:

| Task | Does |
|---|---|
| `init_sdk` | Constructs the Core SDK client with endpoint + master API key |
| `init_redis` | Opens four Redis connections: `session`, `cache`, `rcu_state`, `rcu_event` |
| `init_shared_manager` | Stores singletons (SDK, redis clients, express app, server, CSRF middleware) |
| `init_app` | Builds the Express app and starts listening |
| `init_cache_invalidator` | **Cloud mode only** — subscribes to cache-invalidation events |

The same "array of named async tasks, logged one by one" pattern is used in every HosRocket
process. Follow it when adding a new startup concern.

`SharedManager` ([lib/shared_manager.ts](../reference/admin.hosrocket.com/src/server/lib/shared_manager.ts))
is the service-locator singleton: `SharedManager.getSdk()`, `.getRedis(RedisKey.Cache)`,
`.getCsrfMiddlware()`, `.getApp()`, `.getServer()`. No DI container.

## 2. Express setup — middleware order matters

[app/setup/express.ts](../reference/admin.hosrocket.com/src/server/app/setup/express.ts), in order:

1. `app.set('query parser', 'extended')`
2. **manifest helper** — reads `public/js/manifest{_development}.json` so Pug can emit hashed
   asset URLs via `js()` / `css()`
3. `compression` (threshold 512 B) — before `express.static`
4. `morgan('dev')` in development only
5. `express.static(public/)`
6. **access log** middleware (winston, with an `include` path allow-list)
7. views: `app/views`, engine `pug`
8. `body-parser` json (5000 kb) / text (5000 kb) / urlencoded
9. `cookie-parser` (signed)
10. `request-ip` → `req.clientIp`
11. `response-time` (3 digits)
12. `i18n.configure` + `i18n.init` + custom `languageMiddleware`
13. `app.disable('x-powered-by')`; `app.locals.pretty` in non-production
14. **Redis-backed session** (`connect-redis`, prefix `admin.hosrocket.com:session:`)
15. `connect-flash`
16. CSRF middleware **registered into `SharedManager`** (not mounted globally) so individual
    routes can opt in
17. `injectLocal` — view locals
18. `app.use('/', getRouter())`
19. `ErrorHandling` — final error middleware

## 3. Route table

[app/setup/route.ts](../reference/admin.hosrocket.com/src/server/app/setup/route.ts):

```ts
router.use('/api', apiRouter());
router.get('/whoami', whoami);                                        // health-ish
router.get('/csrf',  SharedManager.getCsrfMiddlware(), getCsrfToken); // CSRF token issue
router.all('*splat', SharedManager.getCsrfMiddlware(), index);        // SPA shell catch-all
```

The catch-all renders [app/views/app/index.pug](../reference/admin.hosrocket.com/src/server/app/views/app/index.pug),
which injects runtime values as hidden inputs:

```pug
input#socket_io_endpoint(type="hidden" name="socket_io_endpoint" value=socket_io_endpoint)
if (on_prem)
    input#on_prem(type="hidden" name="on_prem" value="1")
#app_main
!= js('fontawesome.js')
!= js('vendor.js')
!= js('app.js')
```

If you need a new runtime value in the SPA that can't live in client config, add it here as a
hidden input and read it in the client — that is the established mechanism.

## 4. API router registration

[app/setup/router/api.ts](../reference/admin.hosrocket.com/src/server/app/setup/router/api.ts)
mounts one router per resource, each wrapped in `requireLogin`:

```ts
router.use('/memberships',            requireLogin, membershipRouter());
router.use('/rooms',                  requireLogin, roomRouter());
router.use('/incidents',              requireLogin, incidentRouter());
…
router.use('/users',                  userRouter());                  // login etc. — public
router.use('/public/baggage-claim',   publicBaggageClaimRouter());    // public
router.use('/versions',               versionRouter());               // public
```

Current resources: `reports, device-healths, notices, housekeeping-logs, service-requests,
check-ins, rooms, floors, sites, organizations, notification-channels, alert-policies,
incidents, stats, towers, memberships, roles, secure-users, rcu-controls, vrv-statuses,
hvac-control-settings, daily-report-settings, audit-logs, defects, lost-items, site-locations,
luggage-views, users, public/baggage-claim, versions`.

Paths are **kebab-case plurals**. Query/body fields are **snake_case**.

### Per-resource router

[app/setup/router/api/membership.ts](../reference/admin.hosrocket.com/src/server/app/setup/router/api/membership.ts):

```ts
function membershipRouter(): Router {
    const router = Router({mergeParams: true});

    router.get('/',                 asyncHandler(getMemberships));
    router.get('/user',             asyncHandler(getUserAllMemberships));
    router.post('/',                asyncHandler(createMembership));
    router.patch('/:membership_id', asyncHandler(updateMembership));
    router.delete('/:membership_id',asyncHandler(removeMembership));

    return router;
}
```

Always `Router({mergeParams: true})` and always wrap handlers in `express-async-handler`.

## 5. The three layers

```
router (app/setup/router/api/<resource>.ts)
   └─ controller (app/controller/api/<resource>.ts)
         ├─ permission check  → APISite.getRolePermissions(site_id, req.user.id)
         ├─ validation        → required fields, existence checks
         ├─ api_model calls   → app/api_model/<resource>.ts
         ├─ hydration/joins   → merge related entities into a Hydrated* shape
         └─ ResponseManager.output({res, error, data})
```

### 5.1 Controller

Canonical example:
[app/controller/api/membership.ts](../reference/admin.hosrocket.com/src/server/app/controller/api/membership.ts).

```ts
export async function getMemberships(req: Request<{}, {}, {}, {
    site_id: string; role_system_type: RoleSystemType; page?: string;
}>, res: Response) {
    const {site_id, role_system_type, page} = req.query;

    // 1. permissions, always first
    const rolePermissions = await APISite.getRolePermissions(site_id, req.user.id);
    if (!rolePermissions.includes(RolePermission.ViewSite) ||
        !rolePermissions.includes(RolePermission.ViewTeammate)) {
        ResponseManager.output({res, error: ErrorCode.Forbidden});
        return;
    }

    // 2. existence checks
    const site = await APISite.findById(site_id);
    if (!site) {
        ResponseManager.output({res, error: ErrorCode.BadRequest, errorMessage: 'site not found'});
        return;
    }

    // 3. business logic + data access
    const {memberships, pagination} = await APIMembership.getMembershipsByRoleIdsAndSiteId({role_ids, site_id, page});

    // 4. hydrate for the UI
    const hydratedMemberships: HydratedMembership[] = _.cloneDeep(memberships);
    for (const membership of hydratedMemberships) {
        membership.role = roles.find((role) => role.id === membership.role_id);
    }

    // 5. respond
    ResponseManager.output({
        res, error: ErrorCode.Ok,
        data: {page: pagination.page, count: pagination.count,
               page_count: pagination.page_count, memberships: hydratedMemberships}
    });
}
```

House style, all visible above:
- **Early return after every `ResponseManager.output(...)`** — no `else` chains, no thrown
  HTTP errors.
- `Request<Params, ResBody, ReqBody, Query>` fully typed inline.
- Error *messages* are **machine-readable snake_case codes** (`'user_not_found'`,
  `'teammate_membership_exists'`, `'role_not_allowed'`) because the client switches on them.
- Permission checks are fine-grained and can differ per operation (view / create / update /
  delete are separate `RolePermission` values).
- Response fields for a list are exactly `{page, count, page_count, <resource>s}` — matching
  what `createTableStore` expects on the client.

### 5.2 `api_model` — the Core SDK boundary

[app/api_model/membership.ts](../reference/admin.hosrocket.com/src/server/app/api_model/membership.ts):

```ts
export async function createMembership(
    data: APITypes.Request.PostMembershipsBody,
    user_id: string
): Promise<APITypes.Model.Membership | null> {
    const coreSdk = SharedManager.getSdk();
    try {
        return await coreSdk.membership.createMembership({
            data,
            headers: {'on-behalf-of-user-id': user_id}   // audit attribution
        });
    } catch (e) {
        return null;
    }
}
```

Rules:
- One file per resource, plain exported functions (no classes).
- **Swallow SDK errors and return `null` / an empty result**; the controller decides the HTTP
  outcome. This keeps controllers free of try/catch noise.
- Mutations pass `headers: {'on-behalf-of-user-id': req.user.id}` so the core audit log
  attributes the change to the real user rather than to the master API key.
- Cross-entity joins that the core doesn't do (e.g. fetching users for a page of memberships)
  happen here, not in the controller.
- Existing api_models: `alert_policy, audit_log, check_in, check_in_usage, defect, device,
  floor, housekeeping_log, incident, location_district, lost_item, luggage_claim, membership,
  notice, notification_channel, organization, permission, power_usage_log, rcu, rcu_control,
  rcu_raw_log, rcu_status, report_schedule, role, room, site, site_location, tower, user,
  water_usage_log`.

### 5.3 `ResponseManager` — the response envelope

[lib/response_manager.ts](../reference/admin.hosrocket.com/src/server/lib/response_manager.ts).
**Every JSON response in the system uses this envelope**:

```json
{
  "meta": {"code": 20000, "message": "OK"},
  "data": { }
}
```

```ts
ResponseManager.output({res, error: ErrorCode.Ok, data: {...}});
ResponseManager.output({res, error: ErrorCode.Forbidden});
ResponseManager.output({res, error: ErrorCode.BadRequest, errorMessage: 'site_not_found'});
ResponseManager.notFound(res);
```

`ErrorCode` (from `@enum/error_code`, i.e. `src/shared/enum/error_code.ts`) carries
`{code, statusCode, message}`. `output()` also deep-trims every string in `data`.

The client reads `response.data.<field>` because `callApi()` returns the whole envelope, and
reads the error code from `error.response.data.meta.message`.

## 6. Authentication & authorisation

### 6.1 `requireLogin`

[app/middleware/authorization_jwt.ts](../reference/admin.hosrocket.com/src/server/app/middleware/authorization_jwt.ts):

1. Reads the JWT from the **`jwt-token` request header** (not `Authorization: Bearer`).
2. `jwt.verify(token, config.jwt.secret)` — a failure (including expiry) returns
   `Unauthorized` with `'Invalid JWT Token'`.
3. Looks up a cached user at `middleware:authorization_jwt:cached_user:{id}` in Redis.
   On a miss, fetches from core, rejects inactive users, and caches
   `{id, username, email, admin}` for **900 s**.
4. Sets `req.user`.
5. If the token expires in under **86400 s**, sets the response header `expire-soon: true`,
   which triggers the client's silent re-sign.

### 6.2 Permission model

There is no role middleware. **Each controller resolves permissions itself:**

```ts
const rolePermissions = await APISite.getRolePermissions(site_id, req.user.id);
if (!rolePermissions.includes(RolePermission.UpdateTeammate)) {
    ResponseManager.output({res, error: ErrorCode.Forbidden});
    return;
}
```

Some operations restrict *which roles may be assigned* on top of the permission check, via
[`filterAssignableRoles(allRoles, rolePermissions)`](../reference/admin.hosrocket.com/src/server/lib/teammate.ts)
— e.g. an Operator-level admin cannot grant Owner. Mirror this idea for any new
privilege-granting feature.

The SPA fetches the same permission list (`siteRolePermissionsRequest`) purely to hide UI.

### 6.3 CSRF

- `GET /csrf` issues `{csrf_token, expire_at}`; the client caches it in `localStorage`.
- The middleware is stored on `SharedManager` and attached per route, not globally, with
  `excludedUrls: [/\/assets\/*/]`.
- `callApi({csrf: true})` puts `_csrf` in the body for `POST/PUT/PATCH` and in the query
  string for `DELETE`.

## 7. Configuration

Env-var prefix: **`ADMIN_HOSROCKET_COM_`**.
[config/index.ts](../reference/admin.hosrocket.com/src/server/config/index.ts) merges
`env/development` with `env/testing` or `env/production` by `NODE_ENV`, then `verify_env`
hard-fails startup if any required variable is missing:

```
ADMIN_HOSROCKET_COM_SERVER_URL / SERVER_PORT
ADMIN_HOSROCKET_COM_REDIS_{SESSION,CACHE,RCU_STATE,RCU_EVENT}_{HOST,PORT}
ADMIN_HOSROCKET_COM_SOCKET_IO_ENDPOINT
ADMIN_HOSROCKET_COM_CORE_API_ENDPOINT
ADMIN_HOSROCKET_COM_CORE_API_MASTER_API_KEY
GOOGLE_APPLICATION_CREDENTIALS            (cloud mode only)
```

`IConfig` ([config/common.ts](../reference/admin.hosrocket.com/src/server/config/common.ts))
also covers: `cache.{default_cache_time, common_cache}`, `access_log.include`, `sendgrid`,
`default_from_email`, `bigquery.rcu_log`, `cloud_storage.{project,bucket,folders}`, `timezone`,
`socket_io.url`, `device_rcu_action` (a `DeviceType → RcuAction[]` map),
`pagination.default_limit`, `jwt.{secret, ttl, local_storage_key}`, `email_subject.*`
(localised strings per alert preset), plus Gemini and Apple Wallet settings.

Env files live in `src/server/`: `.env_cloud`, `.env_cloud.sample`, `.env_onprem`,
`.env_onprem.sample`.

Local defaults: client dev server **4000**, server **4001**, socket.io **5003**, core API **3001**.

## 8. Server libraries

[src/server/lib/](../reference/admin.hosrocket.com/src/server/lib/):
`bigquery.ts`, `cache.ts` (`getRedisCacheObject` / `setRedisCacheObject`),
`cache_invalidator.ts`, `logger.ts`, `mailer.ts` (SendGrid + Pug templates),
`pubsub.ts`, `redis.ts`, `response_manager.ts`, `shared_manager.ts`, `teammate.ts`,
`utility.ts`.

Middleware ([app/middleware/](../reference/admin.hosrocket.com/src/server/app/middleware/)):
`authorization_jwt.ts`, `access_log/` (+ `log_filter_processor/`), `csrf/`,
`error_handling.ts`, `language.ts`, `manifest_helpers.ts`, `view.ts`.

Other server assets: `email_templates/`, `locale/` (server-side i18n),
`apple_wallet/` (pass assets & config copied into the build).

## 9. Build & run

| Command (from `src/server`) | Effect |
|---|---|
| `yarn dev` | `DOTENV_CONFIG_PATH=.env_cloud NODE_ENV=development ttsx ./bin/server.ts` |
| `yarn dev-op` | Same with `.env_onprem` |
| `yarn build` | `ttsc -p tsconfig.build.json` → `dist/server`, then copies `tsconfig.json`, `yarn.lock`, `locale`, `email_templates`, `app/views`, `apple_wallet` |
| `yarn build:dev` | Same but with the non-build tsconfig |

Note the build **copies** `app/views` and `locale` — anything non-TypeScript your feature needs
at runtime must be added to that copy step or it will be missing in the image.

### Path aliases (server)

`@app/*`, `@api_model/*`, `@controller/*`, `@middleware/*`, `@lib/*`, `@config/*`,
`@enum/*` → `src/shared/enum/*`, `@shared_type/*` → `src/shared/type/*`, `@root/*`.

## 10. Generated / infra paths — do not hand-edit

`public/js/*` (webpack output), `dist/*` (build output),
`public/usercontent-on-prem/*` (on-prem asset host),
`kubernetes/*`, `nginx/*`, `scripts/docker/*`, `scripts/kubernetes/*`.
Change the TypeScript/SCSS/Pug sources instead.
