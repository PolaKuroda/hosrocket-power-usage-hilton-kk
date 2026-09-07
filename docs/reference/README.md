# HosRocket Design Reference Docs

These documents describe **how HosRocket is actually built today**, extracted from the five
reference repositories checked out as git submodules under [reference/](../reference/).

## Why these docs exist

When a new feature is prototyped (especially with an AI assistant) without knowing the
existing conventions, the result *looks and works* differently from production:
different UI framework, different component style, different state management, different
API envelope. The dev team then has to rewrite the PoC instead of merging it.

**These docs are the contract.** Any new feature design — PoC, spec, mockup, or code —
must conform to what is written here unless there is an explicit, stated reason to deviate.

> If you are an AI assistant designing a new feature for `admin.hosrocket.com`, read
> [03-admin-ui-design-system.md](03-admin-ui-design-system.md) and
> [08-new-feature-playbook.md](08-new-feature-playbook.md) **before** writing any code or mockup.

## Document index

| # | Document | Read it when |
|---|---|---|
| 01 | [System architecture overview](01-system-architecture.md) | You need the big picture: services, data flow, RCU round trip, deployment topology |
| 02 | [Technology stack](02-tech-stack.md) | You need to pick a library, or check what version of what is already in use |
| 03 | [Admin UI design system](03-admin-ui-design-system.md) | **You are designing/building any screen.** Fonts, colours, layout, components, states |
| 04 | [Admin client architecture](04-admin-client-architecture.md) | You are writing React/Redux code for the portal |
| 05 | [Admin server (BFF) architecture](05-admin-server-architecture.md) | You are adding an API endpoint to the portal's own Express server |
| 06 | [Core API architecture](06-core-api-architecture.md) | Your feature needs a new persisted entity or a new core endpoint |
| 07 | [Edge & worker processes](07-edge-and-worker-processes.md) | Your feature touches RCU hardware, real-time room state, or queue processing |
| 08 | [New feature playbook](08-new-feature-playbook.md) | **You are about to start.** End-to-end, file-by-file checklist with copy-paste templates |
| 09 | [Domain model & glossary](09-domain-model.md) | You need to know what a Site / RCU / MUR / Defect / Incident actually is |
| 10 | [Guest Portal UI](10-guest-portal-ui.md) | You are extending the Fairfield guest-facing mobile portal |

## The five reference repositories

| Repo | Role | Docs |
|---|---|---|
| [`reference/admin.hosrocket.com`](../reference/admin.hosrocket.com) | Customer-facing web portal (React SPA + Express BFF) | 03, 04, 05 |
| [`reference/core.hosrocketapi.com`](../reference/core.hosrocketapi.com) | Main backbone API (MongoDB, Redis, GCP) | 06 |
| [`reference/hosrocket.site-server.rcu-to-pubsub`](../reference/hosrocket.site-server.rcu-to-pubsub) | On-site TCP listener: RCU → queue | 07 |
| [`reference/hosrocket.worker.pubsub-rcu-payload-processor`](../reference/hosrocket.worker.pubsub-rcu-payload-processor) | Cloud worker: queue → state/alerts/logs | 07 |
| [`reference/hosrocket.site-server.pubsub-to-rcu`](../reference/hosrocket.site-server.pubsub-to-rcu) | On-site sender: queue → RCU | 07 |

> There are **40+ more repositories** in the full HosRocket system (socket.io gateway, alert
> handler, notification spawner, report generators, PMS/FIAS bridges, etc.). Those are
> referenced here only where their queue topics or endpoints are visible from the five repos
> above. If a design needs one of them in detail, request that the repo be added as a submodule.

## How to keep these docs honest

- These docs were written from the code, not from memory. When code changes, update the doc.
- Where the code contradicts itself (e.g. `engines` fields vs the Dockerfile base image), the
  doc says so rather than picking a side.
- File references are clickable and relative to the repo root.
