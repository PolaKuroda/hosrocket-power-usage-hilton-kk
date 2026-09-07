# 03 — Admin UI Design System (`admin.hosrocket.com`)

> **This is the document to read before designing or building any screen.**
> Every rule below is taken from production code. If a mockup or PoC violates these rules,
> it will not match the product and the dev team cannot merge it.

## 1. The one-paragraph summary

`admin.hosrocket.com` is a **stock Bootstrap 5.3 admin portal**. It uses `react-bootstrap`
components almost exclusively, the default Bootstrap theme (no SCSS variable overrides), a
single web font (**Noto Sans**), FontAwesome 7 icons, and a fixed left sidebar + fixed top
navbar shell. Custom CSS is a thin layer of SCSS modules that override Bootstrap only where
needed. It is dense, functional, operations-oriented, light-mode-only, and fully translated
into 8 languages. It is **not** a modern minimalist SaaS dashboard, and it must not be
prototyped as one.

## 2. Foundations

### 2.1 Typography

```scss
body {
    font-family: 'Noto Sans', sans-serif;
    font-size: 16px;
    color: #6d6d6d !important;
}
```
— [src/client/styles/global.scss](../reference/admin.hosrocket.com/src/client/styles/global.scss)

The font is loaded from Google Fonts in the Pug shell, **weights 400 and 700 only**:

```pug
link(href="https://fonts.googleapis.com/css?family=Noto+Sans:400,700" rel="stylesheet" type="text/css")
```
— [src/server/app/views/app/partials/_styles.pug](../reference/admin.hosrocket.com/src/server/app/views/app/partials/_styles.pug)

Noto Sans is chosen because the product ships in English, Japanese, Traditional/Simplified
Chinese, Thai, Vietnamese, Malay and Indonesian — CJK and Thai must render correctly.

| Role | Size | Where |
|---|---|---|
| Body / default | **16px** | `body` |
| Page title (`h1`) | **26px** | `.pageTitle` in [common/portal.scss](../reference/admin.hosrocket.com/src/client/styles/common/portal.scss) |
| Sidebar links & section headers | **14px** | [global/sidebar.scss](../reference/admin.hosrocket.com/src/client/styles/global/sidebar.scss) |
| Card title | Bootstrap `Card.Title` default | `<Card.Title className="mb-3">` |
| Muted helper text | **12px**, colour `$silver` | `.customTextMute` in [common/utility.scss](../reference/admin.hosrocket.com/src/client/styles/common/utility.scss) |
| Navbar username label / value | **10px / 12px** | [common/navBar.scss](../reference/admin.hosrocket.com/src/client/styles/common/navBar.scss) |
| Room card number | **28px, bolder** | [global/roomCard.scss](../reference/admin.hosrocket.com/src/client/styles/global/roomCard.scss) |
| Room card badges | 18px; aux info 20px; defect badge 24px | same |
| Full-page preloader glyph | **48pt** | [global/portalPreloader.scss](../reference/admin.hosrocket.com/src/client/styles/global/portalPreloader.scss) |

Links have `text-decoration: none` by default and underline on hover.

### 2.2 Colour palette

The complete palette lives in one file —
[src/client/styles/common/variable.scss](../reference/admin.hosrocket.com/src/client/styles/common/variable.scss).
**Do not invent colours; use these.**

```scss
// Accent / semantic
$orange:  #ffa647;
$blue:    #2b6bbf;
$pink:    #fc7b7b;
$red:     #fc2d2d;
$green:   #27AE60;
$purple:  #504f78;
$white:   #FFFFFF;
$black:   #000000;

// Neutrals (light → dark)
$light-cloud: #fafafa;   // page background
$cloud:       #ecf0f1;   // hover / active row background
$dark-cloud:  #d9ddde;   // hairline borders (navbar bottom, section header rule)
$border:      #c2c8cc;
$silver:      #aeb4b8;   // muted text, big preloader glyph
$light-grey:  #999999;
$grey:        #555555;   // sidebar link text, navbar text
$dark-grey:   #333333;   // hover text

// Brand
$hosrocket-light: #ACB1FF;
$hosrocket-dark:  #6E60FF;   // active sidebar item / selected filter tag

// Toast / alert tints
$success: #e7ffe7;
$info:    #d5faff;
$warning: #ffffdc;
$error:   #ffeaea;

// Layout metrics
$navbarHeight:             60px;
$notificationBannerHeight: 35px;
```

Additional facts:

- **Default body text is `#6d6d6d`** (set directly in `global.scss`, and repeated on
  `.org-card`, `.room-card`, `.room-detail-card`).
- **Page background is `$light-cloud` (#fafafa)**, cards/tables are white.
- **Bootstrap's own theme is untouched.** There is no `_variables.scss` override; `index.tsx`
  imports `bootstrap/scss/bootstrap.scss` as-is. Therefore
  `<Button variant="primary">` is Bootstrap blue **#0d6efd**, `danger` is **#dc3545**,
  `secondary` is **#6c757d**, etc. The HosRocket purple is an *accent used sparingly*
  (active sidebar link, selected tag), **not** the button colour.
- Notification banner: `#d5d8cb` normally, `#ffa3a3` when the plan is nearly expired/overdue.
- Room alert emphasis is a red glow, not a red fill: `box-shadow: 0 0 9px 4px rgba(255,0,0,0.85)`.

#### Operational status colours (room grid / room card)

These are a deliberate, saturated "control panel" language and are reused across the room
card status cells — see [global/roomCard.scss](../reference/admin.hosrocket.com/src/client/styles/global/roomCard.scss):

| Meaning | Colour |
|---|---|
| Attention / problem — DND active, MUR rejected, out of order | `#ffa4a4` |
| Door ajar | `#ff8282` |
| In progress / requested — MUR in progress, laundry requested, butler call requested | `#ffff00` |
| Complete / OK — MUR pending, MUR checked | `#a4ffa9` |
| Checked in, laundry picked up by guest, butler call completed | `#82ffbe` |
| Presence / cleaned | `#a2a7ff` |
| Hard alert text | `#FF0000` |

Chart palette used on the dashboard occupancy pie:
`['#68c24b', '#6f8768', '#CCCCCC']` (occupied / unoccupied / unknown).

### 2.3 Spacing, radius, elevation

- Spacing is **Bootstrap utility classes only** — `mb-3`, `me-2`, `pt-3`, `pb-2`, `py-5`,
  `px-0`, `ms-auto`, `mx-2`, `g-*`. Do not write bespoke margin CSS in components.
- The recurring page-header rhythm is `pt-3 pb-2 mb-4 border-bottom`.
- Cards use default Bootstrap radius. Custom radii, where they appear, are **5px**
  (`.center-block`, `.borderRadius`, quill container, `.commentContent`, `.tagButton`).
- Elevation is used sparingly:
  - login card: `box-shadow: 0 0 1rem 0 rgba(0,0,0,.2)` + `backdrop-filter: blur(10px)`
  - sidebar: `box-shadow: inset -1px 0 0 rgba(0,0,0,.1)`
  - alerting cards: red glow (above)
  - Otherwise, **hairline borders (`$dark-cloud`) instead of shadows**.

### 2.4 Iconography

- **FontAwesome 7 free** — solid, regular, and brands sets are all installed.
- Icons are imported **one per file, by deep path**, so webpack can tree-shake:

```tsx
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faPlus} from '@fortawesome/free-solid-svg-icons/faPlus';
import {faSpinner} from '@fortawesome/free-solid-svg-icons/faSpinner';
```

- Icon-before-label spacing is always `className="me-2"`.
- The universal busy indicator is `<FontAwesomeIcon icon={faSpinner} spinPulse />`.
- FontAwesome is emitted as its own webpack chunk (`fontawesome.js`) and loaded before the
  vendor and app bundles in the Pug shell.

Common icon vocabulary already in use: `faPlus` (create), `faBars` (mobile menu),
`faGlobeAsia` (language), `faSignOutAlt` (sign out), `faAngleLeft` / `faAngleRight`
(back / breadcrumb separator), `faUser` / `faLock` (login fields), `faCamera` (scan),
`faBell` / `faBellSlash` (workflow / DND), `faBroom` (make-up room), `faDoorOpen` /
`faDoorClosed`, `faTriangleExclamation`, `faCheckCircle` / `faInfoCircle` /
`faExclamationTriangle` / `faTimesCircle` (toasts).

### 2.5 Logo & imagery

- `public/assets/image/logo_dark.png` — used in the navbar (`width: 150px`) and on the login
  card (inside a `Col xs={6}`).
- `public/assets/image/logo_light.png`, `bg.jpg` (login background photo).
- Organisation and site thumbnails are remote:
  `${user_content_host}/assets/image/organizations/{id}/thumb.jpg`, with an on-prem host swap.
- The app is an installable **PWA**: manifest, apple-touch-icon, `theme-color: #ffffff`,
  and a service worker at `/assets/pwa/sw.js` that forces `window.location.reload()` when a
  new worker takes control.

### 2.6 Light mode only

There is no dark mode, no theme switcher, and no `prefers-color-scheme` handling anywhere in
the codebase. Do not design one into a PoC.

---

## 3. Application shell

### 3.1 Anatomy

```
┌──────────────────────────────────────────────────────────────────┐
│ NotificationBanner   (35px, only when plan is trial/overdue)     │
├──────────────────────────────────────────────────────────────────┤
│ HeaderBar  (fixed, 60px, white, 1px #d9ddde bottom border)       │
│  [☰ <lg] [logo 150px] [Org › Site breadcrumb] … [username] [🌐] [⤴] [sign out] │
├───────────────┬──────────────────────────────────────────────────┤
│ Sidebar       │ <Outlet />                                        │
│ Col xs={2}    │ Col xs={12} lg={10} ms-auto                       │
│ fixed, sticky │                                                   │
│ d-none        │ ┌─ page header (pt-3 pb-2 mb-4 border-bottom) ──┐ │
│ d-lg-block    │ │ h1.pageTitle (26px)          [primary action] │ │
│ 14px links    │ └───────────────────────────────────────────────┘ │
│ section       │  filters / cards / table / PageBox                │
│ headers       │                                                   │
└───────────────┴──────────────────────────────────────────────────┘
```

Implemented by [views/layout/Portal.tsx](../reference/admin.hosrocket.com/src/client/views/layout/Portal.tsx):

```tsx
<PrivateRoute>
    <NotificationBanner />
    <HeaderBar />
    <SidebarMobile />
    <Container fluid={fluid} className={`${portalStyle.mainContainer} …`}>
        <Row>
            <Sidebar />
            <Outlet />
        </Row>
    </Container>
</PrivateRoute>
```

Key details:

- Container width is `fluid="xl"` for normal pages, but **`fluid={true}` (full-bleed) for
  `room-management` and `room-list`** — the operational floor views need the width.
- `.mainContainer` has `padding-top: 60px` (navbar height); when the notification banner is
  visible everything shifts down by another 35px via a second class. Any new fixed-position
  element must handle both states.
- Every page body is rendered as `<Col as="main" xs={12} lg={10} className="ms-auto">`.

### 3.2 Sidebar

- Desktop (`≥ lg`): fixed `Col xs={2}`, `d-none d-lg-block`, sticky inner scroll area.
- Mobile (`< lg`): `SidebarMobile` — an off-canvas panel at `left: -60%` sliding to `left: 0`
  with a 0.25s transition and a 30 %-opacity black overlay. Every nav link dispatches
  `hideMobileSidebar()` on click.
- Contents are **contextual to the current route**, computed by
  [`getPageInfo(location)`](../reference/admin.hosrocket.com/src/client/lib/page_info.ts):
  organisations → sites → site-detail. Each level ends with a `‹ Back to …` link and a
  shared sign-out block separated by `<hr />`.
- Grouped by `<p className="section-header">` — bold, 14px, `$grey`, bottom-ruled in `$dark-cloud`.
  Current groups: *Management · Service order · Alerts · Notification · Luggage management · Settings*.
- Active item styling: `.current-page` → `$hosrocket-dark` text, bold, `$cloud` background.
- **Every item is permission-gated**, e.g.
  `{siteRolePermissions?.includes(RolePermission.ViewDashboard) ? (<Nav.Link …/>) : ''}` —
  and some are additionally feature-flagged on the site record
  (`site.enable_map_view`, `site.enable_vrv_status`, `site.enable_hvac_control_setting`).

### 3.3 Header bar

`<Navbar bg="light" expand="lg" sticky="top">` with a white background override, containing:
mobile hamburger (`d-lg-none`) · logo · `Organization › Site` breadcrumb (`d-lg-block d-none`)
· username label+value (10px/12px) · language `NavDropdown` (8 languages) · a
"to parent" button · sign-out link.

### 3.4 Public / auth layout

[views/pages/users/User.tsx](../reference/admin.hosrocket.com/src/client/views/pages/users/User.tsx)
centres a frosted-glass card over a full-bleed background photo:

```scss
.center-block {
    box-shadow: 0 0 1rem 0 rgba(0,0,0,.2);
    border-radius: 5px;
    background-color: rgba(255,255,255,.6);
    backdrop-filter: blur(10px);
}
```

Card width: `Col sm={8} md={6} lg={5}` with `p-5`. Used for Login, Forgot password, Reset password.

---

## 4. Page patterns

There are exactly **four** page archetypes in the portal. Pick one; don't invent a fifth.

### 4.1 Archetype A — Paginated table page

Canonical examples: [Teammate.tsx](../reference/admin.hosrocket.com/src/client/views/pages/site/site_detail/Teammate.tsx),
[Incident.tsx](../reference/admin.hosrocket.com/src/client/views/pages/site/site_detail/Incident.tsx),
`CheckInHistory`, `AuditLog`, `NotificationChannel`, `AlertPolicy`, `Housekeeping`, `ServiceRequest`.

```tsx
<FadeIn>
    <AddXModal />
    <EditXModal />
    <Row><Col>

        {/* header: title left, primary action right */}
        <Row className="pt-3 pb-2 mb-4 border-bottom">
            <Col xs={6}>
                <h1 className={PortalStyle.pageTitle}>{t('x.x')}</h1>
            </Col>
            <Col xs={6} className="text-end">
                {perms.includes(RolePermission.CreateX) ? (
                    <Button disabled={uiBusy} onClick={…}>
                        <FontAwesomeIcon icon={faPlus} className="me-2" />
                        {t('x.add_new_x')}
                    </Button>
                ) : ''}
            </Col>
        </Row>

        {/* optional filter block, also inside pb-2 mb-4 border-bottom */}

        <Row className="position-relative"><Col>
            <Row><Col>
                <Table responsive>
                    <thead><tr><th>…</th></tr></thead>
                    <tbody>
                        <TablePlaceholder columns={[{type:'text'},…,{type:'button'}]}
                                          show={!store.initialized} />
                        {rows}
                        {store.data_stage === Stage.SUCCESS && rows.length === 0 ? (
                            <tr><td colSpan={n} className="text-center py-5">
                                {t('x.no_x')}
                            </td></tr>
                        ) : null}
                    </tbody>
                </Table>
            </Col></Row>
            <Row><Col>
                <PageBox page={page} count={store.count} pageCount={store.page_count}
                         goToPageCallback={…} />
            </Col></Row>
        </Col></Row>

    </Col></Row>
</FadeIn>
```

Rules:
- Wrap the whole page in `<FadeIn>` (from `react-fade-in`).
- Modals are rendered at the **top of the page component**, not inline in rows.
- `<Table responsive>` — never a custom table or a data-grid library.
- Skeleton rows come from `TablePlaceholder`, driven by `!store.initialized`.
- Explicit translated empty state, `colSpan` across all columns, `text-center py-5`.
- Pagination is always `PageBox` (see §5.6), never Bootstrap `<Pagination>`.
- Action buttons in a row cell are plain `<Button disabled={uiBusy}>`; destructive ones use
  `variant="danger"`.

### 4.2 Archetype B — Card grid page

Canonical examples: [OrganizationList.tsx](../reference/admin.hosrocket.com/src/client/views/pages/organization/OrganizationList.tsx),
`SiteList`, `LostAndFound`, `MaintenanceRequest`, `RoomList`.

- Grid via `<Row>` + `<Col md={3}>` (org/site) or `<Col>` breakpoints tuned per page.
- `<Card className="h-100 org-card">` with `<Card.Img>` (`height: 150px; object-fit: cover`,
  falling back to `contain` below `md`) and a `<Card.Body><Card.Text>`.
- Content cards (lost item, maintenance request) are `min-height: 335px`, flex column,
  `justify-content: space-between`, `cursor: pointer`, image `height: 160px; object-fit: cover`,
  body text clamped to 3 lines with `-webkit-line-clamp: 3`.
- Skeletons come from `CardPlaceholder`.
- Whole-card click opens a **detail modal** (or navigates), not an inline expander.

### 4.3 Archetype C — Modal form (create / edit / detail)

Canonical example:
[teammate/AddTeammateModal.tsx](../reference/admin.hosrocket.com/src/client/views/pages/site/site_detail/teammate/AddTeammateModal.tsx).

```tsx
<Modal backdrop="static" size="lg" show={show} centered={true} onHide={close}>
    <Modal.Header closeButton>
        <Modal.Title>{t('x.add_new_x')}</Modal.Title>
    </Modal.Header>
    <Modal.Body>
        <Form onSubmit={handleSubmit(onSubmit)} noValidate>

            {alertNode /* <Alert variant="warning" className="mb-3"> on API error */}

            <Form.Group as={Row} className="mb-3" controlId="x-field">
                <Form.Label column sm={3}>{t('x.label_field')}</Form.Label>
                <Col sm={9}>
                    <Form.Control type="text" disabled={formBusy}
                                  {...register('field', {required: true})}
                                  isInvalid={Boolean(errors.field)} />
                    <Form.Text className="text-muted">{t('x.txt_hint')}</Form.Text>
                    <Form.Control.Feedback type="invalid" className="text-start">
                        {t('x.validation.field_required')}
                    </Form.Control.Feedback>
                </Col>
            </Form.Group>

            <Modal.Footer className="px-0 pb-0">
                <Button variant="secondary" onClick={close} disabled={formBusy}>
                    {t('x.btn_cancel')}
                </Button>
                <Button type="submit" disabled={formBusy}>
                    {formBusy ? <FontAwesomeIcon icon={faSpinner} spinPulse /> : null}
                    <span className={formBusy ? 'ms-2' : ''}>{t('x.btn_save')}</span>
                </Button>
            </Modal.Footer>

        </Form>
    </Modal.Body>
</Modal>
```

Non-obvious but load-bearing conventions:

- `backdrop="static"` + `centered={true}` + `size="lg"` is the default for form modals.
- **`Modal.Footer` lives *inside* the `<Form>`**, with `className="px-0 pb-0"`, so that
  `type="submit"` works without a form `id` reference.
- Label/control split is **`sm={3}` / `sm={9}`** via `Form.Group as={Row}`.
- Button order is **Cancel (`variant="secondary"`) → [Back (`outline-secondary`)] → Submit (default primary)**.
- The submit button shows a spinner *plus* the label, with `ms-2` inserted only while busy.
- API-level errors render as an `<Alert variant="warning">` at the top of the modal body,
  mapped from an `errorCode` string through a local `getSubmitMessage(t, errorCode)` function.
  Field-level errors are pushed into `react-hook-form` via `setError('field', {type: code})`.
- Multi-step modals (e.g. add-teammate: *email lookup* → *details*) are driven by a
  `step` value in Redux, not by local component state.
- Modal visibility is **Redux state** (`showAddTeammateModal`), toggled by
  `showXModal()` / `hideXModal()` actions — not `useState` in the parent.
- A second-level modal backdrop helper exists at
  [common/secondModal.scss](../reference/admin.hosrocket.com/src/client/styles/common/secondModal.scss) for stacked modals.

### 4.4 Archetype D — Dashboard / operational view

Canonical examples: [Dashboard.tsx](../reference/admin.hosrocket.com/src/client/views/pages/site/site_detail/Dashboard.tsx),
`RoomManagement`, `VrvStatus`, `DeviceHealth`.

- Composed of `<Card className="mb-3">` blocks, each with
  `<Card.Title className="mb-3">` and `<Card.Text as="div">`.
- Status tiles are `<Col xs={6} md={2} className="mb-3 mb-md-0">` with a label `<p>` above a
  `StatusButton` / `OnlineButton`; clicking one opens a drill-down modal.
- Charts are **chart.js pies** via `react-chartjs-2`, lazily loaded
  (`React.lazy` + `<Suspense>`) inside a horizontally scrollable container with gradient
  scroll-shadow (`.chartContainer`), one column per tower.
- Chart widths are breakpoint-stepped: 170 / 220 / 230 / 240 / 250 px.
- Floor plans use **OpenLayers** (`ol`), in its own webpack chunk.
- Real-time updates arrive over socket.io and patch Redux; the UI never assumes a command
  succeeded until the device reports back.

---

## 5. Component inventory

Reusable components live in
[src/client/views/components/](../reference/admin.hosrocket.com/src/client/views/components/).
**Check this list before building anything new.**

| Component | Purpose |
|---|---|
| `PageBox` | The pagination control. `‹` button · editable page number box · `of N` · `›` button · total count · inline spinner while `uiBusy`. Debounced 700 ms on typing, immediate on blur/Enter. Bounds the entered page to `[1, pageCount]` |
| `TablePlaceholder` | Skeleton `<tr>`s from a `columns: {type:'text'\|'button'}[]` spec; default 5 rows; uses Bootstrap `<Placeholder animation="glow">` |
| `CardPlaceholder` | Skeleton card grid, same idea |
| `PortalPreloader` | Full-page spinner: 80vh, `$silver`, 48pt, wrapped in `FadeIn` |
| `InlinePreloader` | Absolutely-positioned translucent overlay spinner (`opacity .4` black by default, `white` variant available), sized `sm`/`md`/`lg`, optional `volumetric` heights. Requires a `position-relative` parent |
| `ReduxToast` / `ReduxToastBox` | Toast container + individual toast |
| `PrivateRoute` / `PublicRoute` | Auth guards |
| `HistoryRouter` | Manual wrapper replacing `redux-first-history/rr6` for React Router 7 compatibility |
| `AutoSubmitTextBox` | Debounced search/filter input exposing `getValue`/`setValue` via `useImperativeHandle` — deliberately **uncontrolled** so debounced submits don't clobber typing |
| `UTCDatePicker` | `react-datepicker` wrapper that converts local ↔ UTC at the boundary |
| `TimeDuration` | Renders an elapsed hour/minute duration |
| `VersionControl` | Polls `/api/versions` every 15 min and hard-reloads the page on change |

Page-scoped helpers that are also worth reusing as patterns:
`FloorSelector`, `TagsInputStyled`, `StatusButton`, `OnlineButton`, `StatusChart`,
`NoticeCard`, `RoomCard`, `CardPaywall`.

### 5.1 Buttons

| Use | Markup |
|---|---|
| Primary / submit | `<Button disabled={uiBusy}>` (default variant is `primary`) |
| Secondary / cancel | `<Button variant="secondary">` |
| Tertiary / back | `<Button variant="outline-secondary">` |
| Destructive | `<Button variant="danger">` |
| Pagination arrows | `<Button variant="outline-dark">` |
| Icon-only / link-ish | `<Button variant="link">` |
| Read-only display | add `className="readonly"` → `pointer-events: none` |

**Every interactive control takes `disabled={uiBusy}`** so the whole UI freezes during a
request. This is the global busy pattern — respect it.

### 5.2 Forms

- `react-hook-form` `useForm<FormValues>()` with `register(...)`, `handleSubmit`, `formState.errors`.
- Bootstrap validation display: `isInvalid={Boolean(errors.field)}` +
  `<Form.Control.Feedback type="invalid" className="text-start">`.
- Selects are `<Form.Select>` with a leading `<option value="">{t('common.label_please_select')}</option>`.
- Hints use `<Form.Text className="text-muted">`.
- Login-style inputs use `<InputGroup>` with a leading `<InputGroup.Text><FontAwesomeIcon/></InputGroup.Text>`.
- Reset the form in a `useEffect` keyed on modal visibility; clear server-side field errors in
  a `useEffect` keyed on the field value.

### 5.3 Feedback & messaging

**Toasts** — global, bus-driven:

```ts
import {toaster} from '@lib/toaster';
import i18n from '@lib/i18n';

toaster.success(i18n.t('teammate.msg_teammate_created'));
// also: toaster.info / toaster.warning / toaster.error
```

Config: position `bottom-end`, auto-close **5000 ms**, newest on top
([lib/toaster/config.ts](../reference/admin.hosrocket.com/src/client/lib/toaster/config.ts)).
Backgrounds use the tint palette (`$success/$info/$warning/$error`) and each type has a
FontAwesome icon. Toasts are fired from **thunks** on success, not from components.

**Inline alerts** — `<Alert variant="warning">` for recoverable errors (login failure, modal
submit failure). Error codes returned by the API are mapped to translated strings in a local
`switch`; unknown codes fall back to a generic message.

**Empty states** — a translated single-row/table-cell message, `text-center py-5`. No
illustrations, no empty-state artwork exists in the product.

**Paywall / plan gating** — `.paywall*` classes in
[common/utility.scss](../reference/admin.hosrocket.com/src/client/styles/common/utility.scss)
overlay a white 90–95 %-opacity layer (with a gradient variant for tables) over gated content.

### 5.4 Loading states — the four-level ladder

1. **Route/page not ready** → `<PortalPreloader />` while `siteDetailStage` or
   `organizationListStage` is `NOT_START | PENDING`.
2. **List not yet loaded** → `TablePlaceholder` / `CardPlaceholder` driven by
   `!store.initialized`.
3. **Any in-flight request** → global `uiBusy` boolean disables buttons/inputs and shows a
   spinner in `PageBox`.
4. **Sub-region refresh** → `<InlinePreloader active volumetric />` over a
   `position-relative` container.

### 5.5 Badges & status pills

`<Badge>` from react-bootstrap, `font-size: 18px`, `display: inline-block`, `me-2`/`margin-right: 7px`.
Custom colours are injected with a CSS variable rather than new classes:

```scss
.badge.custom-color-badge {
    background-color: var(--custom-bg-color) !important;
    border-color:     var(--custom-bg-color) !important;
}
```

### 5.6 Tables

Always `<Table responsive>`. Header cells may carry `className="col-2"` to hint widths.
Global override: `td, th { background-color: transparent !important; }`.

---

## 6. Responsive behaviour

Bootstrap 5 breakpoints (`sm 576 · md 768 · lg 992 · xl 1200 · xxl 1400`) are used directly,
via utility classes in TSX and `@include bootstrap-grid.media-breakpoint-{up,down}(x)` in SCSS.

| Breakpoint | Behaviour |
|---|---|
| `< lg` | Sidebar becomes the off-canvas `SidebarMobile`; hamburger appears; username block, breadcrumb, language dropdown and sign-out link are hidden (`d-none d-lg-block`) |
| `< md` | Card images switch from `object-fit: cover` to `contain`; dashboard status tiles stack |
| `< sm` | Room cards shrink to `min-width: 150px` with taller bodies; room-card aux info left-aligns |
| `≥ xxl` | Room cards fix to 240px |

The app is genuinely used on phones and tablets by housekeeping/front-desk staff — the
luggage, lost-and-found and QR-scan flows are mobile-first. iOS Safari viewport quirks are
handled with `postcss-100vh-fix` and `@supports (-webkit-touch-callout: none)` height
adjustments.

---

## 7. Internationalisation — non-negotiable

**No user-visible string may be hard-coded.** Every label goes through `react-i18next`:

```tsx
const {t} = useTranslation();
…
{t('teammate.add_new_teammate')}
```

- Bundles: [src/client/locale/](../reference/admin.hosrocket.com/src/client/locale/)
  — `en`, `ja`, `zh-HK`, `zh-CN` (**officially supported**) and
  `th`, `vi`, `ms`, `id` (**auxiliary**, admin-portal-only, no database counterpart).
- Language is persisted in `localStorage.language`; `fallbackLng: 'en'`.
- Data coming from the API is a `LocaleString` object (`{en, 'zh-HK', 'zh-CN', ja}`) and must
  be indexed with **`getCurrentLanguageForDisplay()`**, which downgrades auxiliary languages
  to `en`:

```tsx
import {getCurrentLanguageForDisplay} from '@lib/i18n';
{organization.name[getCurrentLanguageForDisplay()]}
```

- Key naming convention, from `en.json` (36 namespaces): namespace = feature
  (`teammate`, `lost_and_found`, `hvac_control_setting`, …), then:
  - plain nouns: `teammate.teammate`, `teammate.email`
  - buttons: `teammate.btn_cancel`, `teammate.btn_next`
  - labels: `teammate.label_role`, `teammate.label_edit`
  - messages: `teammate.msg_membership_exists`
  - free text: `teammate.txt_username_hint`
  - validation: `teammate.validation.username_required`
  - shared vocabulary lives in `common` and `common_label`

**When adding a feature, add keys to all 8 JSON files.** English text may be used as a
placeholder for the non-English files in a PoC, but the keys must exist.

---

## 8. Styling mechanics (how to actually write the CSS)

### 8.1 SCSS modules

All files under [src/client/styles/](../reference/admin.hosrocket.com/src/client/styles/) are
compiled as **CSS Modules** with `localIdentName: '[name]__[local]'`. Import them namespaced:

```tsx
import * as PortalStyle from '@styles/common/portal.scss';
<h1 className={PortalStyle.pageTitle}>…</h1>

// or a named import for a single class
import {inlineCloseButton} from '@styles/common/utility.scss';
```

Anything inside `node_modules` or a path containing `globalStyle` is compiled as plain global
CSS instead.

### 8.2 Overriding Bootstrap / third-party

Wrap the rules in a `:global { … }` block and register the file in
[styles/global.scss](../reference/admin.hosrocket.com/src/client/styles/global.scss):

```scss
@use '../common/variable';

:global {
    .sidebar {
        a.current-page {
            color: variable.$hosrocket-dark;
            font-weight: bold;
            background-color: variable.$cloud;
        }
    }
}
```

### 8.3 Folder layout

```
styles/
  style.scss              → entry, just @use './global.scss'
  global.scss             → @use every global/* file + body/a/td base rules
  common/                 → CSS-module partials imported per component
    variable.scss         → THE palette + layout metrics
    portal.scss  navBar.scss  card.scss  centerLayout.scss
    utility.scss  inlinePreloader.scss  notificationBanner.scss
    secondModal.scss  datePicker.scss  imageUpload.scss
  global/                 → :global overrides, loaded once
    sidebar.scss  sidebarMobile.scss  button.scss  card.scss
    roomCard.scss  roomDetailCard.scss  pageBox.scss  toaster.scss
    datePicker.scss  quill.scss  reactTagsInput.scss  site.scss
    styleOverwrite.scss  portalPreloader.scss
  page/                   → page-specific modules
    dashboard/…  site_detail/…
```

Rules of thumb:
- Reach for a Bootstrap utility class first.
- If you need custom CSS, put it in `styles/page/<area>/<thing>.scss` as a CSS module.
- Only add to `styles/global/` when you must override a Bootstrap or vendor selector.
- **Always** `@use '../common/variable'` rather than typing a hex code.

---

## 9. Accessibility & quality notes (current reality)

Stated honestly so a PoC neither over- nor under-delivers:

- Semantics come mostly from react-bootstrap defaults; `<Col as="main">` marks the content
  region and `eslint-plugin-jsx-a11y` is installed.
- Focus rings are suppressed on a couple of navbar controls (`&:focus { box-shadow: none; }`).
- Status is frequently conveyed by **background colour plus an icon and a tooltip**
  (`OverlayTrigger` + `Tooltip` on room cards) — keep the icon/tooltip when adding statuses,
  colour alone is not sufficient.
- Contrast: the default `#6d6d6d` on `#fafafa` is ~5.1:1 — acceptable for body text. The
  saturated status colours are used as backgrounds behind dark icons.
- There is no formal WCAG conformance target in the codebase today.

---

## 10. Design checklist for a new screen

Before you call a design done, verify:

- [ ] Uses `react-bootstrap` components, not raw `<div>`s with custom classes
- [ ] Noto Sans, 16px body, `#6d6d6d` text, `#fafafa` page background
- [ ] Colours come from `common/variable.scss`; Bootstrap variants are stock
- [ ] Sits inside the Portal shell as `<Col as="main" xs={12} lg={10} className="ms-auto">`
- [ ] Page header is `pt-3 pb-2 mb-4 border-bottom` with a 26px `h1` and a right-aligned action
- [ ] Wrapped in `<FadeIn>`
- [ ] Matches one of the four archetypes (table / card grid / modal form / dashboard)
- [ ] Loading covered at the right level (PortalPreloader / Placeholder / uiBusy / InlinePreloader)
- [ ] Translated empty state
- [ ] Pagination via `PageBox`
- [ ] Every string via `t()`; API `LocaleString` via `getCurrentLanguageForDisplay()`
- [ ] Every control has `disabled={uiBusy}`
- [ ] Success feedback via `toaster.*`; recoverable errors via `<Alert variant="warning">`
- [ ] Every entry point gated on a `RolePermission`
- [ ] Works `< lg` (sidebar collapses) and on a phone if staff would use it there
- [ ] FontAwesome icons imported by deep path, `me-2` before labels
- [ ] No dark mode, no new font, no new component library
