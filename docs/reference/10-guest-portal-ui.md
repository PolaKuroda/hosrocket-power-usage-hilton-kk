# 10 — Guest Portal UI

This document describes the Fairfield guest-facing portal in this repository. It complements
the broader HosRocket architecture references and should be read when adding or updating
guest-facing pages.

> The rest of `docs/reference/` describes the HosRocket main system (admin portal, core API,
> site servers). Only the cross-cutting conventions in
> [02-tech-stack.md](02-tech-stack.md) apply here — the admin design system in
> [03](03-admin-ui-design-system.md) does **not**, because the guest portal carries the
> Fairfield brand rather than the HosRocket admin one.

## Runtime

There is none. The portal is a **static React SPA** with no server, no BFF and no API. The
build output in `dist/` is uploaded to a Google Cloud Storage bucket and served as files.

| | |
|---|---|
| Package manager | yarn |
| Language | TypeScript 7, `strict: true`, type checked with `ttsc check` |
| UI | React 19 + `react-router-dom` 7 |
| i18n | i18next 26 + react-i18next 17 |
| Build | webpack 5, `esbuild-loader` (`es2022`), global SCSS |
| Dev URL | `http://localhost:3000` (`yarn dev`) |
| Deployment | [DEPLOYMENT.md](../../DEPLOYMENT.md) |

The Express prototype (`server.js`, `GET /api/health`, `GET /api/portal-config`, `public/*.html`)
was removed in the v2 refactor. `GET /api/portal-config` became `src/data/page.json` plus
`locale/*.json`; the per-page HTML files became two React templates.

```bash
yarn install
yarn dev
```

## Content model

Structure and copy are deliberately separate:

- **`src/data/page.json`** — routes, page kind, section and card ordering, image paths, CSS
  modifier classes. No prose. Read by the React app *and* by `webpack.config.js`, which uses
  it to emit one static `index.html` per route.
- **`locale/en.json`, `zh-HK.json`, `zh-CN.json`, `ja.json`** — every user-facing string,
  keyed by the `locale_key` and `id` fields declared in `page.json`.

A page therefore needs no component changes: add it to `page.json`, add its strings to all
four locale files, drop its images under `assets/card-images/<slug>/`, rebuild.

## Shared page language

`Your Room` remains the visual benchmark:

- Mobile-first layout constrained to approximately 430px.
- Fixed `62px` header with the Fairfield logo centered as a home link.
- Globe button on the right with the custom language menu.
- Page content scrolls vertically below the fixed header.
- Hero images are full width and `128px` high.
- Section navigation is sticky below the header when a page has multiple sections.
- Vertical cards use rounded corners, soft shadows, and a `150px` height on Your Room
  (`190px` on Eat and Drink, Facility and Attraction via the page's `card_class`).
- Cards use the same image in the card and its detail modal.
- Modal content supports multiline text and closes with the close button, backdrop, or Escape.

## Page templates

There are exactly two, selected by the `kind` field in `page.json`.

### `kind: "section"` — [`src/views/pages/SectionPage.tsx`](../../src/views/pages/SectionPage.tsx)

Used by Your Room, Eat and Drink, Facility and Attraction in Bali.

1. Shared fixed header
2. Full-width hero image
3. Page introduction (eyebrow, title, intro)
4. Sticky section navigation, one tab per section
5. Section heading
6. Full-width vertical cards
7. Full-screen detail modal for card content

Declared as:

```json
{
	"slug": "facility",
	"kind": "section",
	"locale_key": "facility",
	"body_class": "room-page-body facility-page-body",
	"shell_class": "room-shell facility-shell",
	"card_class": "facility-card",
	"hero": "/assets/card-images/facility/fitness-center.jpeg",
	"sections": [
		{
			"id": "facilities",
			"anchor": "facilities",
			"cards": [{"id": "fitness_center", "image": "/assets/card-images/facility/fitness-center.jpeg"}]
		}
	]
}
```

`id` values are `snake_case` locale keys. `anchor` is the kebab-case DOM id used for in-page
scrolling, and `slug` is the kebab-case URL segment.

### `kind: "text"` — [`src/views/pages/TextPage.tsx`](../../src/views/pages/TextPage.tsx)

Used by Transportation, Safety & Security, Sustainable and About Fairfield.

1. Shared fixed header
2. Full-width page hero
3. Scrollable prose

`blocks` lists ordered locale keys. Each block renders whichever of `heading`, `text` and
`list` the locale file defines, so one block can be a lone paragraph and the next a heading
with bullets.

```json
{
	"slug": "safety-and-security",
	"kind": "text",
	"locale_key": "safety_and_security",
	"body_class": "text-page-body",
	"shell_class": "text-shell",
	"hero": "/assets/card-images/index/safety-and-security.jpeg",
	"blocks": ["privacy", "safety", "questions"]
}
```

### Fallback

An unrecognised `/pages/:slug` renders
[`BlankPage`](../../src/views/pages/BlankPage.tsx). Any other unrecognised path redirects to
the dashboard.

## Styles

Global SCSS under [`src/styles/`](../../src/styles), imported once from `src/index.tsx`. No CSS
modules and no CSS-in-JS: the class names are shared across templates and are part of the
documented visual language above.

| Partial | Covers |
|---|---|
| `_base.scss` | Custom properties, reset, `.app-shell` |
| `_top_bar.scss` | Header, logo, language switcher |
| `_dashboard.scss` | Dashboard grid and cards |
| `_detail_page.scss` | Hero, sticky tabs, vertical cards, detail modal, per-page modifiers |
| `_text_page.scss` | Text-only page typography |
| `_blank_page.scss` | Fallback shell |

Reuse the existing classes and add a page modifier (`card_class` / `body_class`) only for a
genuine difference.

## Assets

Store images by page or feature. `assets/` is copied verbatim to `dist/assets/`, so the paths
in `page.json` are the paths the browser requests.

```text
assets/
  hotel-logo/logo.avif
  card-images/
    index/
    your-room/
    eat-and-drink/
    facility/
    attraction/
```

Use the actual file extension in URLs — the current set mixes `.jpg`, `.jpeg` and `.png`.

## Adding a page

1. Add the entry to [`src/data/page.json`](../../src/data/page.json).
2. Add the strings to **all four** files in [`locale/`](../../locale).
3. Add page images under the matching `assets/card-images/` folder.
4. Run `yarn build` — routing and the static HTML entry follow automatically.
5. Verify the route, the assets, the type check, and at least one primary interaction.

## Internationalization

Supported language keys:

- `en`
- `zh-HK`
- `zh-CN`
- `ja`

All four bundles ship inside the JS bundle; there is no runtime fetch. Language is resolved
from `?lang=`, then `localStorage` (`guest_portal_language`), then `navigator.language`, and
normalised by `normalizeLanguage` in [`src/data/language.ts`](../../src/data/language.ts) so
that `zh-TW` / `zh-Hant` reach `zh-HK` and `zh-Hans` / bare `zh` reach `zh-CN`.

New user-facing content must be added to every locale file. Locale strings use `\n\n` for a
paragraph break and `\n` for a line break.
