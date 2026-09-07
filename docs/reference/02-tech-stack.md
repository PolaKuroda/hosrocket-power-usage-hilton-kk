# 02 — Technology Stack

This is the authoritative list of what is **already in the codebase**. When designing a new
feature, prefer these libraries. Adding a new dependency that duplicates something here is a
review blocker.

## 0. Cross-cutting conventions (all repos)

| Concern | Convention |
|---|---|
| Language | TypeScript **7.x**, `strict: true` |
| Compiler binaries | `ttsc` (build) and `ttsx` (dev run) — the TypeScript 7 native toolchain. Scripts use `ttsc -p tsconfig.build.json`, `ttsx ./src/index.ts` |
| Module resolution | Path aliases in `tsconfig.json`, resolved at runtime by `tsconfig-paths/register` (Node) or `TsconfigPathsPlugin` (webpack). **Always use aliases, never `../../../..`** |
| Package manager | **yarn** (every repo ships `yarn.lock`) |
| Indentation | **Tabs** |
| Quotes | Single quotes |
| Naming | `snake_case` for files, folders, API fields, DB fields, config keys; `PascalCase` for React components and their files; `camelCase` for local TS variables/functions |
| Dates | **dayjs** with the `utc` plugin (`dayjs.extend(utc)`), never native `Date` maths, never moment |
| Utility | **lodash** (`_.cloneDeep`, `_.merge`, `_.isNumber`, `_.omit`, …) |
| IDs | Mongo ObjectId strings; `uuid` v14 for transient client-side IDs |
| Config | `src/config/index.ts` merges `env/development` ← `env/testing` / `env/production`, with an env-var prefix per service and a `verify_env` startup check |
| Logging | winston; `@google-cloud/logging-winston` in cloud |
| Lint | ESLint with `eslint-config-aftership` |
| Env loading | `dotenv`, selected by `DOTENV_CONFIG_PATH=.env_cloud` / `.env_onprem` |

### Node version — a live inconsistency

| Source | Says |
|---|---|
| [readme.md](../readme.md) | `nodejs >= 26` |
| `core.hosrocketapi.com/package.json` | `"engines": {"node": ">=24"}` |
| `admin.hosrocket.com/src/{client,server}/package.json` | `"engines": {"node": ">=14"}` (stale) |
| `admin.hosrocket.com/Dockerfile` | `FROM node:20-alpine` (stale) |

**Guidance for new work:** target the version stated in the readme (`>= 26`) and treat the
`>=14` engines fields and the `node:20-alpine` base image as unmaintained leftovers. Do not
introduce code that *depends* on a Node feature newer than what the Dockerfile can build until
the Dockerfile is bumped.

---

## 1. `admin.hosrocket.com` — the portal

No root `package.json`. Three independent packages:

```
src/client   → admin.hosrocket.com_client   (React SPA, webpack build → public/js)
src/server   → admin.hosrocket.com          (Express BFF, ttsc build → dist/server)
src/shared   → shared enums + types, consumed by both
```

Commands are run **from the package directory**, not the repo root.

### 1.1 Client (`src/client`)

| Area | Library | Version |
|---|---|---|
| UI runtime | `react`, `react-dom` | ^19.2 |
| Routing | `react-router-dom` | ^7.18 |
| History bridge | `redux-first-history` + `history` | ^5.2 / 5.3 |
| State | `redux` + `@reduxjs/toolkit` + `react-redux` | ^5.0 / ^2.12 / ^9.3 |
| Server state (limited) | `react-query` | ^3.39 |
| **Component library** | **`react-bootstrap`** | **^2.10** |
| **CSS framework** | **`bootstrap`** (SCSS, stock theme) | **^5.3.8** |
| **Icons** | **`@fortawesome/*` (free solid / regular / brands) + `@fortawesome/react-fontawesome`** | **^7.3 / ^3.5** |
| Styling | `sass` 1.102, CSS Modules, `postcss` + `autoprefixer`, `postcss-100vh-fix` | |
| Forms | `react-hook-form` | ^7.83 |
| Validation | `validator`, `phone` | |
| HTTP | `axios` | 1.19.0 (pinned) |
| i18n | `i18next` ^26 + `react-i18next` ^17 | |
| Charts | `chart.js` ^4.5 + `react-chartjs-2` ^5.3 (+ `chartjs-plugin-datalabels`, currently commented out) | |
| Maps / floor plans | `ol` (OpenLayers) ^10.10 | |
| Date input | `react-datepicker` ^9.1 | |
| Rich text | `react-quill-new` ^3.8 | |
| Tag input | `react-tagsinput` ^3.20 | |
| Image upload | `react-images-uploading` ^3.1 | |
| QR | `@yudiel/react-qr-scanner` ^2.6 (scan), `qrcode.react` ^4.2 (render) | |
| Realtime | `socket.io-client` ^4.8 | |
| Push / analytics | `firebase` ^12 | |
| CSV | `papaparse` | |
| Animation | `react-fade-in` ^2.0 | |
| Responsive helpers | `react-responsive` ^10 | |
| Events | `eventemitter3` (toaster bus) | |
| Captcha | `react-google-recaptcha` ^3.1 | |
| Build | `webpack` ^5.109 + `webpack-cli` ^7 + `webpack-dev-server` ^6 | |
| TS transform | **`esbuild-loader`** targeting `es2022` (ts-loader is disabled pending TypeStrong/ts-loader#1702) | |
| CSS pipeline | `style-loader` (dev) / `mini-css-extract-plugin` (prod) → `css-loader` → `postcss-loader` → `sass-loader` | |
| Asset manifest | `webpack-manifest-plugin` → `manifest_development.json` / `manifest.json` | |

Scripts: `yarn dev` (dev server on **:4000**, proxying `/` to **:4001**), `yarn build:production`,
`yarn build` (clean + production). Output goes to `public/js`.

Bundle splitting is explicit — separate chunks for `vendor`, `fontawesome`, `ol`, `chart`.

### 1.2 Server / BFF (`src/server`)

| Area | Library | Version |
|---|---|---|
| HTTP | `express` | ^5.2 |
| Async routes | `express-async-handler` | |
| Views | `pug` ^3.0 (single SPA shell, plus 404/500) | |
| Session | `express-session` + `connect-redis` ^10 + `redis` ^6 | |
| Auth | `jsonwebtoken` ^9 | |
| CSRF | custom middleware at `app/middleware/csrf` | |
| i18n | `i18n` ^0.15 | |
| Core access | **`@bossagroove/core.hosrocketapi.com_sdk`** ^1.0.180 | |
| Middleware | `compression`, `morgan`, `response-time`, `request-ip`, `cookie-parser`, `body-parser`, `connect-flash` | |
| Logging | `winston`, `bunyan`, `@google-cloud/logging-winston`, `newrelic` | |
| GCP | `@google-cloud/{storage,pubsub,bigquery}` | |
| Email | `@sendgrid/mail` | |
| Images | `sharp` ^0.35 | |
| Apple Wallet | `passkit-generator` ^3.5 | |
| AI | `@google/generative-ai` ^0.24 (Gemini) | |
| Captcha | `recaptcha2` | |

Scripts: `yarn dev` (cloud env), `yarn dev-op` (on-prem env), `yarn build`, `yarn build:dev`.
Output goes to `dist/server`.

### 1.3 Shared (`src/shared`)

Plain TypeScript, no runtime deps. Two folders:
- `enum/` — 50+ enums (roles, permissions, alerts, incidents, devices, RCU actions/values, HVAC, luggage, notices, …)
- `type/` — hydrated view types (`HydratedMembership`, `HydratedIncident`, `HydratedLostItem`, …)

Aliased as `@enum/*` and `@shared_type/*` from **both** client and server.

---

## 2. `core.hosrocketapi.com` — the backbone API

| Area | Library | Version |
|---|---|---|
| HTTP | `express` | ^5.2 |
| ODM | **`mongoose`** | **9.9.0** (pinned) |
| Request validation | `ajv` ^8.20 against `src/json_schema/schema.json` | |
| Cache / state | `redis` ^6 | |
| Queues | `@google-cloud/pubsub` ^5.3 (cloud) / `beanstalkd` ^2.2 (on-prem) | |
| Scheduled work | `@google-cloud/tasks` ^6.3 | |
| Storage | `@google-cloud/storage` ^7.21 | |
| Analytics | `@google-cloud/bigquery` ^8.3 | |
| Push | `firebase-admin` ^14 | |
| Email | `@sendgrid/mail`, `pug` templates in `src/email_templates/{en,ja,…}` | |
| PDF / QR | `pdfkit` ^0.19, `qrcode` ^1.5, `pdf-to-printer` ^5.8 | |
| CSV | `papaparse` | |
| Graceful shutdown | `@godaddy/terminus` | |
| Obfuscation | `javascript-obfuscator`, `uglify-js` (build-time, for on-prem artifacts) | |
| Logging / APM | `winston`, `@google-cloud/logging-winston`, `newrelic` | |
| Misc | `change-case`, `image-type`, `phone`, `qs`, `validator`, `uuid`, `require-all` | |

---

## 3. Site-server & worker processes

All three are plain long-running Node processes — **no HTTP server** except the raw TCP
listener in `rcu-to-pubsub`.

| | `rcu-to-pubsub` | `worker.pubsub-rcu-payload-processor` | `pubsub-to-rcu` |
|---|---|---|---|
| Runs on | hotel bare metal | HosRocket cloud (GKE) | hotel bare metal |
| Ingress | Node `net` TCP server | Pub/Sub pull / Beanstalkd reserve | Pub/Sub pull / Beanstalkd reserve |
| Egress | Pub/Sub · Beanstalkd · **SQS** | Pub/Sub topics + Core SDK + Redis | Node `net` TCP client |
| Notable deps | `@aws-sdk/client-sqs`, `@aws-sdk/client-cloudwatch-logs`, `winston-cloudwatch`, `retry`, `chalk` | `@bossagroove/core.hosrocketapi.com_sdk`, `@bossagroove/core.hosrocketapi.com_type`, `redis` ^6 | `retry`, `chalk` |
| Tests | — | **jest + ts-jest**, `ioredis-mock`, `mockdate`, `__mocks__`/`__test__` folders | — |

The worker is the only one of the three with a real test suite; follow its
`src/**/__test__/*.ts` + `src/lib/__mocks__` layout when adding tests there.

---

## 4. Private npm packages

Two internal packages are published to a private registry and consumed via `.npmrc`:

| Package | Consumed by | Purpose |
|---|---|---|
| `@bossagroove/core.hosrocketapi.com_sdk` | admin BFF, worker | Typed client for every Core API resource — `coreSdk.membership.getMemberships({params})`, `coreSdk.user.getUsers({params})`, … Supports `headers: {'on-behalf-of-user-id': userId}` for audit attribution |
| `@bossagroove/core.hosrocketapi.com_type` | admin client, worker | Shared model & request/response types — `APITypes.Model.Site`, `APITypes.Common.Pagination`, `APITypes.Request.PostMembershipsBody`, … |

**Rule:** never hand-roll an HTTP call to the Core API from the BFF or the worker. Always go
through the SDK, and always through an `api_model` wrapper (see [05](05-admin-server-architecture.md)).

---

## 5. What is deliberately *not* used

Do not introduce these into a HosRocket PoC — they will not match production:

| Not used | Use instead |
|---|---|
| Tailwind CSS, shadcn/ui, Radix, MUI, Ant Design, Chakra | **react-bootstrap + Bootstrap 5.3 SCSS** |
| Next.js, Vite, Remix | webpack 5 SPA served by an Express/Pug shell |
| Redux Toolkit `createSlice` / `createAsyncThunk` | Hand-written action-type enums + switch reducers + thunks (see [04](04-admin-client-architecture.md)) |
| SWR, TanStack Query v5 | `react-query` v3 (and only for a couple of screens) |
| `fetch` | `axios` via `callApi()` |
| styled-components / emotion / CSS-in-JS | SCSS modules under `src/client/styles` |
| moment.js, date-fns | `dayjs` + `utc` plugin |
| Lucide / Heroicons / Material Icons | FontAwesome 7 free |
| Prisma, TypeORM, raw MongoDB driver in the portal | Mongoose **in core only**; portal uses the Core SDK |
| Zod / Yup | `react-hook-form` validators on the client, `ajv` JSON Schema in core |
| Zustand, Jotai, MobX | Redux |
