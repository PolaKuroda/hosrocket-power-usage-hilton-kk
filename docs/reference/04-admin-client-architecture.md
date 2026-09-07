# 04 — Admin Client Architecture (`admin.hosrocket.com/src/client`)

How the React SPA is wired. Read together with [03 — UI Design System](03-admin-ui-design-system.md).

## 1. Bootstrapping

[src/client/index.tsx](../reference/admin.hosrocket.com/src/client/index.tsx):

```tsx
import 'bootstrap/scss/bootstrap.scss';   // stock Bootstrap, no variable overrides
import '@styles/style.scss';              // HosRocket global styles
import '@lib/i18n';                       // side-effect: initialise i18next

const root = createRoot(document.getElementById('app_main')!);

root.render(
    <QueryClientProvider client={queryClient}>
        <Provider store={store}>
            <HistoryRouter history={history}>
                <Root />
            </HistoryRouter>
        </Provider>
    </QueryClientProvider>
);
```

Also here: webpack HMR (`module.hot.accept('./root.tsx')`) and service-worker registration
that force-reloads the page when a new worker takes control.

`HistoryRouter` is a **local wrapper**
([views/components/HistoryRouter.tsx](../reference/admin.hosrocket.com/src/client/views/components/HistoryRouter.tsx))
replacing `redux-first-history/rr6`, which is not React Router 7 compatible.

The mount point `#app_main` is rendered by the server's Pug shell — the SPA cannot be served
from a static file host as-is.

## 2. Routing

[src/client/root.tsx](../reference/admin.hosrocket.com/src/client/root.tsx) defines three
route groups:

```tsx
<Routes>
    <Route path="/" element={<Navigate to="/organizations" />} />

    <Route element={<User />}>          {/* public, centred card layout */}
        <Route path="/login" …/>
        <Route path="/forgot-password" …/>
        <Route path="/reset-password" …/>
    </Route>

    <Route element={<Portal />}>        {/* private, sidebar shell */}
        <Route path="/organizations" …/>
        <Route path="/organizations/:organizationSlug" …/>
        <Route path="/organizations/:organizationSlug/sites" …/>
        <Route path="/organizations/:organizationSlug/sites/:siteSlug/*" element={<SiteDetail />} />
        <Route path="/users/account" …/>
        <Route path="/users/change-password" …/>
        <Route path="/users/admin-audit-log" …/>
    </Route>

    <Route path="/baggage-claim" element={<PublicBaggageClaim />} />  {/* public, no layout */}

    <Route path="*" element={<Navigate to="/" />} />
</Routes>
```

`<ReduxToast />` and `<VersionControl />` are mounted above the router so they are always live.

### 2.1 URL shape — slugs, not IDs

Routes are keyed on **slugs**: `/organizations/:organizationSlug/sites/:siteSlug/<subpage>`.
IDs are resolved from Redux (`userInfo.organizations`, `userInfo.sites`) and used for API
calls. Keep this convention — deep links must be human-readable and stable.

### 2.2 Nested site-detail routing

[SiteDetail.tsx](../reference/admin.hosrocket.com/src/client/views/pages/site/SiteDetail.tsx)
owns a second `<Routes>` block with ~30 sub-routes (`dashboard`, `room-management/:floorSlug/:roomSlug`,
`check-in-history`, `lost-and-found/:ticketNumber`, `luggage-view/baggage-drop`, …).

Before rendering any of them it runs a **staged prefetch** in one `useEffect`: organizations →
sites → site → floors → towers → site role permissions. Only when everything has landed does it
dispatch `siteDetailSuccess()`; until then it renders `<PortalPreloader />`. On unmount it
dispatches `siteDetailDismiss()`.

`Top.tsx` is the site landing route: it redirects to `dashboard`, or to `maintenance-request` /
`luggage-view` if the user lacks `ViewDashboard` — **the landing page depends on permissions.**

`FloorSlugRedirection.tsx` fills in a default floor slug for floor-scoped routes.

## 3. State management

> **The portal does NOT use Redux Toolkit slices.** `@reduxjs/toolkit` is present only for
> `configureStore` and its `PayloadAction` / `ThunkAction` types. State is written in the
> classic Redux style. Match it.

### 3.1 Store

[setup/store.ts](../reference/admin.hosrocket.com/src/client/setup/store.ts):

```ts
const {createReduxHistory, routerMiddleware, routerReducer} =
    createReduxHistoryContext({history: createBrowserHistory()});

export const store = configureStore({
    reducer: createRootReducer(routerReducer),
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(routerMiddleware),
    devTools: (process.env.NODE_ENV === 'development')
});

export const history = createReduxHistory(store);

export type RootState      = ReturnType<typeof store.getState>;
export type AppDispatch    = typeof store.dispatch;
export type AppThunk<R = void>      = ThunkAction<R, RootState, unknown, Action>;
export type AppThunkAsync<R = Promise<void>> = ThunkAction<R, RootState, unknown, Action>;
```

Typed hooks, always used instead of the raw react-redux ones
([setup/hook.ts](../reference/admin.hosrocket.com/src/client/setup/hook.ts)):

```ts
export const useAppDispatch: DispatchFunc = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
```

### 3.2 The four-file pattern per feature

Every feature contributes the same four things:

```
state/action_type/<feature>.ts   → enum of action type strings
state/action/<feature>.ts        → thunks + plain action creators
state/reducer/reducers/<feature>.ts → switch reducer for UI/modal state
state/reducer/index.ts           → register the reducer (+ a table store if paginated)
```

**Action types** — a TypeScript `enum`, string values identical to the key, grouped by
operation with the `REQUEST / SUCCESS / FAIL / DISMISS` quartet:

```ts
enum TeammateActionType {
    TEAMMATE_LIST_REQUEST  = 'TEAMMATE_LIST_REQUEST',
    TEAMMATE_LIST_SUCCESS  = 'TEAMMATE_LIST_SUCCESS',
    TEAMMATE_LIST_FAIL     = 'TEAMMATE_LIST_FAIL',
    TEAMMATE_LIST_DISMISS  = 'TEAMMATE_LIST_DISMISS',

    TEAMMATE_SHOW_ADD_MODAL = 'TEAMMATE_SHOW_ADD_MODAL',
    TEAMMATE_HIDE_ADD_MODAL = 'TEAMMATE_HIDE_ADD_MODAL',
    TEAMMATE_ADD_REQUEST    = 'TEAMMATE_ADD_REQUEST',
    …
}
export default TeammateActionType;
```

**Thunks** — dispatch `REQUEST`, call the API, dispatch `SUCCESS`/`FAIL`, then side effects:

```ts
export const teammateListRequest = ({site_id, page}: {site_id: string; page: number}): AppThunkAsync => {
    return async (dispatch) => {
        dispatch({type: TeammateActionType.TEAMMATE_LIST_REQUEST, payload: {page}});

        let response;
        try {
            response = await callApi({
                method: 'GET',
                path: '/api/memberships',
                params: {site_id, page, role_system_type: RoleSystemType.System},
                dispatch
            });
        } catch (e) {
            dispatch({type: TeammateActionType.TEAMMATE_LIST_FAIL});
            return;
        }

        dispatch({
            type: TeammateActionType.TEAMMATE_LIST_SUCCESS,
            payload: {
                data_rows:  response.data.memberships,
                page:       response.data.page,
                count:      response.data.count,
                page_count: response.data.page_count
            }
        });
    };
};
```

For mutations, the thunk additionally **re-fetches the list** and **fires a toast**:

```ts
dispatch({type: TeammateActionType.TEAMMATE_ADD_SUCCESS});
const state = getState();
dispatch(teammateListRequest({site_id, page: state.teammateTableStore.page || 1}));
toaster.success(i18n.t('teammate.msg_teammate_created'));
```

Error codes are extracted from the axios error and normalised to a string that the modal maps
to a translated message:

```ts
function getApiErrorMessage(error: unknown): string | null {
    if (!(error instanceof AxiosError)) return null;
    return error.response?.data?.meta?.message || null;
}
…
dispatch({type: …_FAIL, payload: {errorCode: getApiErrorMessage(error) || 'request_failed'}});
```

**Reducers** — plain functions, `switch` on `action.type`, `Object.assign({}, state, {...})`
(no Immer, no mutation). Every field is initialised explicitly with a `Stage`:

```ts
export default function teammate(state: TeammateState = {
    showAddTeammateModal: false,
    addTeammateStep: 'email',
    addTeammateLookupStage: Stage.NOT_START,
    addTeammateLookupErrorCode: null,
    …
}, action: PayloadAction<any, TeammateActionType>) {
    switch (action.type) {
        case TeammateActionType.TEAMMATE_SHOW_ADD_MODAL:
            return Object.assign({}, state, {showAddTeammateModal: true, /* full reset */});
        default:
            return state;
    }
}
```

### 3.3 `Stage` — the universal async status enum

[state/enum/stage.ts](../reference/admin.hosrocket.com/src/client/state/enum/stage.ts):

```ts
enum Stage { SUCCESS, FAIL, ERROR, PENDING, BUSY, NOT_START }   // string values
```

Used as `xxxStage: Stage` on every async slice of state. Components branch on it:

```tsx
{[Stage.NOT_START, Stage.PENDING].includes(siteDetailStage) ? <PortalPreloader /> : ''}
{siteDetailStage === Stage.SUCCESS ? <Routes>…</Routes> : ''}
```

### 3.4 `createTableStore` — the paginated-list factory

[state/reducer/reducers/table_store.ts](../reference/admin.hosrocket.com/src/client/state/reducer/reducers/table_store.ts)
generates an identical reducer for every paginated list. **Never hand-write list state.**

```ts
interface TableStoreState<T> {
    data_rows: T[];
    data_stage: Stage;
    page: number;
    count: number | null;
    page_count: number | null;
    initialized: boolean;
}
```

Register it in [state/reducer/index.ts](../reference/admin.hosrocket.com/src/client/state/reducer/index.ts):

```ts
teammateTableStore: createTableStore<MembershipType.HydratedMembership>({
    requestStateKey: TeammateActionType.TEAMMATE_LIST_REQUEST,
    successStateKey: TeammateActionType.TEAMMATE_LIST_SUCCESS,
    failStateKey:    TeammateActionType.TEAMMATE_LIST_FAIL,
    dismissKey:      TeammateActionType.TEAMMATE_LIST_DISMISS
}),
```

Naming convention: `<feature>TableStore`. There are currently 12 of them
(check-in history, housekeeping, notice board, notification channel, alert policy, incident,
teammate, service request, audit log, admin audit log, maintenance request, lost and found).

Semantics worth knowing:
- `initialized` flips to `true` on the first success and drives skeleton visibility.
- `DISMISS` resets everything — dispatch it in the page's unmount cleanup.
- The success payload must supply `data_rows`, `page`, `count`, `page_count`, which is exactly
  the shape the BFF returns.

### 3.5 Global cross-cutting state

| Slice | Purpose |
|---|---|
| `uiBusy` (boolean) | Toggled automatically by `callApi()`. Every control reads it via `disabled={uiBusy}` |
| `toaster` | Queue of active toasts |
| `user` | Logged-in user + login error/stage |
| `userInfo` | `organizations`, `organization`, `sites`, `site`, `floors`, `towers`, `siteRolePermissions` — the ambient context every site page reads |
| `global` | `onPrem`, `version`, mobile-sidebar visibility, token-resign stage |
| `notificationBanner` | Plan trial/overdue banner visibility |
| `siteDetail` | Prefetch stage for the site-detail subtree |
| `router` | From `redux-first-history` |

## 4. Data fetching

### 4.1 `callApi()` — the single HTTP entry point

[lib/api.ts](../reference/admin.hosrocket.com/src/client/lib/api.ts).
**All API traffic goes through it.** Never call `axios` or `fetch` directly from a component.

```ts
await callApi({
    method: 'PATCH',
    path: `/api/memberships/${membership_id}`,
    params?: {...},          // query string
    data?:   {...},          // body
    dispatch,                // enables busy tracking + 401 redirect
    noBusy?: true,           // don't toggle the global uiBusy flag
    csrf?: true,             // fetch/attach a CSRF token for mutations
    noRedirect?: true,       // don't bounce to /login on 401
    noAutoSign?: true        // don't auto-resign a near-expiry token
});
```

What it does for you:

1. Sets `Content-Type: application/json`.
2. Reads the JWT from `localStorage.siteJwt` and sends it as the **`jwt-token` header**.
3. If `csrf: true`, fetches `GET /csrf` (cached in `localStorage.csrfToken` with an expiry)
   and injects `_csrf` into the **body** for `POST/PUT/PATCH` or into the **query string**
   for `DELETE`.
4. Dispatches `isBusy()` / `notBusy()` around the call unless `noBusy`.
5. On **401**: clears the JWT, records the current path in `localStorage.redirectTo`,
   dispatches `USER_LOGIN_FAIL` with `login_expired`, and pushes `/login`.
6. If the response carries `expire-soon: true`, dispatches `resignToken()` to silently
   refresh the JWT.
7. Returns `response.data` — i.e. the **whole envelope**, so callers read `response.data.<field>`
   (envelope is `{meta: {code, message}, data: {...}}`).

### 4.2 `react-query` — narrow usage only

Only [Login.tsx](../reference/admin.hosrocket.com/src/client/views/pages/users/Login.tsx)
(`needCaptcha`) and `MyAccount.tsx` use `useQuery`. Everything else is Redux thunks.
**Do not introduce react-query into a new feature** unless you are extending one of those two
screens.

### 4.3 Filters live in the URL

This is a strong, consistent convention (see
[Incident.tsx](../reference/admin.hosrocket.com/src/client/views/pages/site/site_detail/Incident.tsx)):

- Page number and every filter are query-string parameters.
- A local `useQuery()` helper wraps `new URLSearchParams(useLocation().search)`.
- An `updateFilter({...})` function builds the new URL and calls `navigate(newUrl)`.
- A `useEffect` keyed on the parsed query values dispatches the list request.
- Changing a filter resets `page` to 1.
- `goToPageCallback` re-issues `updateFilter` with the new page.

Benefits the team relies on: deep links, browser back/forward, and shareable filtered views.
**Do not hold filter state in `useState`.**

### 4.4 Lifecycle discipline

```tsx
useEffect(() => {
    if (site) dispatch(xListRequest({site_id: site.id, page}));
}, [page, …filters]);

useEffect(() => {
    return function cleanup() {
        dispatch(xListDismiss());
    };
}, []);
```

Every page that loads data dismisses it on unmount. Skipping this leaks stale rows into the
next visit.

## 5. Real-time updates

Three modules own socket.io connections, all under the room views:

- [room_list/room_list_data_update.ts](../reference/admin.hosrocket.com/src/client/views/pages/site/site_detail/room_list/room_list_data_update.ts)
- `room_management/map_modules/data_update/map_data_update.ts`
- `room_management/map_modules/data_update/room_data_update.ts`

Pattern:

```ts
this.url = (<HTMLInputElement>document.getElementById('socket_io_endpoint')).value;
const url = `${this.url}?site_id=${siteId}&floor_id=${floorId}&id=${uuid()}&user_id=${userId}&secure_hash=${secureHash}`;
this.socket = io(url);
this.socket.on('web-update', (data) => { /* parse {payload, room_id} → renderUpdate */ });
…
cleanUp() { this.socket?.disconnect(); this.socket = null; }
```

Notes:
- The endpoint comes from a **hidden input in the Pug shell**, not from client config.
- On `web-update` the class re-fetches the affected room via `callApi` with
  `noBusy: true, noAutoSign: true` (so background refreshes don't flicker the UI or churn the
  token) and dispatches `dispatchRoomsDataUpdate`.
- These are plain classes with `listen()` / `cleanUp()`, instantiated and torn down by the
  page's `useEffect`.

## 6. Auth on the client

[lib/auth_helper.ts](../reference/admin.hosrocket.com/src/client/lib/auth_helper.ts):

- `localStorage.siteJwt` holds `{token, id, username, expire_at, admin, …}` as JSON.
- `isAuthenticated()` parses it, strips `token`, and checks `expire_at` against `dayjs().unix()`.
- `getToken()` returns the raw JWT.
- `getCsrfToken()` / `updateCsrfToken()` manage `localStorage.csrfToken` with its own expiry.
- `PrivateRoute` calls `isAuthenticated()`; if there's no user it stores the attempted path in
  `localStorage.redirectTo` and renders `<Navigate to="/login" />`. If a token exists but Redux
  has no user (direct deep-link load), it hydrates Redux with `setUser(...)`.

Token refresh is server-driven: the BFF sets `expire-soon: true` when the JWT is within a day
of expiry, and `callApi` reacts by dispatching `resignToken()` → `POST /api/users/resign`.

## 7. Permission gating in the UI

`userInfo.siteRolePermissions: RolePermission[]` is fetched once per site and checked inline:

```tsx
import RolePermission from '@enum/role_permission';

{siteRolePermissions.includes(RolePermission.CreateTeammate) ? (
    <Button onClick={addTeammate}>…</Button>
) : ''}
```

This appears in the sidebar, page headers, table columns (a whole `<th>`/`<td>` pair can be
conditional — remember to adjust `colSpan` on the empty-state row), and route landing logic.

**The client check is UX only.** The BFF re-checks the same permission server-side; both are
required.

## 8. Path aliases

From [src/client/tsconfig.json](../reference/admin.hosrocket.com/src/client/tsconfig.json):

| Alias | Resolves to |
|---|---|
| `@root/*` | `src/client/*` |
| `@views/*` | `src/client/views/*` |
| `@styles/*`, `@css/*` | `src/client/styles/*` |
| `@state/*` | `src/client/state/*` |
| `@action/*` | `src/client/state/action/*` |
| `@action_type/*` | `src/client/state/action_type/*` |
| `@reducer/*` | `src/client/state/reducer/*` |
| `@lib/*` | `src/client/lib/*` |
| `@config` | `src/client/config` |
| `@local_enum/*` | `src/client/local_enum/*` |
| `@enum/*` | **`src/shared/enum/*`** |
| `@shared_type/*` | **`src/shared/type/*`** |

TS target `es2025`, module `es2022`, `moduleResolution: bundler`, `jsx: react`, `strict: true`.

## 9. Client config

[src/client/config/index.ts](../reference/admin.hosrocket.com/src/client/config/index.ts)
is a plain object merged with `env/{development,testing,production}.ts` based on
`process.env.NODE_ENV` (injected by webpack's `EnvironmentPlugin`). It holds:

```ts
{
    jwt:      {local_storage_key: 'siteJwt'},
    redirect: {local_storage_key: 'redirectTo'},
    min_password_length: 8,
    recaptcha: {site_key: '…'},
    user_content_host: 'https://usercontent.hosrocket.com',
    user_content_host_on_prem: '/usercontent-on-prem',
    maintenance_request: {max_photos: 5},
    lost_and_found:      {max_photos: 5},
    site_public_host: '…',
    luggage_claim_pass_host: '…'
}
```

Pick the host with the on-prem flag:

```tsx
const {onPrem} = useAppSelector(store => store.global);
const host = onPrem ? config.user_content_host_on_prem : config.user_content_host;
```

## 10. Build & dev

| Command (from `src/client`) | Effect |
|---|---|
| `yarn dev` | webpack-dev-server on **:4000**, HMR, proxies everything to the BFF on **:4001** |
| `yarn build:production` | Production bundle → `public/js` with `[name]-[chunkhash].js` |
| `yarn build` | `clean` + production build |

- TS/TSX is transformed by **`esbuild-loader`** (target `es2022`) — not `ts-loader`, which is
  disabled pending a TypeScript 7 fix. There is therefore **no type-checking during bundling**;
  rely on the IDE and `ttsc`.
- Dev CSS goes through `style-loader`; production extracts with `mini-css-extract-plugin`.
- `webpack-manifest-plugin` writes `manifest_development.json` / `manifest.json`, which the
  Express `manifestHelper` middleware reads to emit hashed `js()` / `css()` tags in Pug.
- Chunks: `vendor`, `fontawesome`, `ol`, `chart`, `app` (+ named lazy chunks such as
  `status_chart`).
- Lazy-load heavy views with
  `lazy(() => import(/* webpackChunkName: "x" */ './X'))` wrapped in `<Suspense>` —
  as done for `StatusChart`.

## 11. Folder map

```
src/client/
  index.tsx  root.tsx
  setup/            store.ts  hook.ts
  config/           index.ts  env/{development,testing,production}.ts
  lib/              api.ts  auth_helper.ts  i18n.ts  page_info.ts
                    image.ts  math.ts  time_duration.ts  toaster/{index,config}.ts
  state/
    action/         <feature>.ts  (+ user/ subfolder)
    action_type/    <feature>.ts
    reducer/        index.ts  reducers/<feature>.ts  reducers/table_store.ts
    enum/           stage.ts
  local_enum/       client-only enums
  locale/           en.json ja.json zh-HK.json zh-CN.json th.json vi.json ms.json id.json
  locale_vrv_error/ VRV error-code dictionaries
  styles/           see 03 §8.3
  views/
    layout/         Portal.tsx  portal/{HeaderBar,SideBar,SidebarContent,SidebarMobile,
                                       NotificationBanner}.tsx  portal/header_bar/*
    components/     shared components (see 03 §5)
    pages/
      users/        Login  ForgotPassword  ResetPassword  MyAccount  ChangePassword
                    AdminAuditLog  User(layout)
      organization/ OrganizationList  OrganizationDetail
      site/         SiteList  SiteDetail
        site_detail/  ~27 feature pages + one subfolder of parts per feature
      baggage_claim/ PublicBaggageClaim
  types/  assets/  scripts/  webpack.config.*.ts
```

**Convention:** a feature page `site_detail/Foo.tsx` keeps its modals and sub-components in
`site_detail/foo/`. Do not create a parallel top-level structure for a new site feature.
