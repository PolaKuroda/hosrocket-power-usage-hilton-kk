# 09 — Domain Model & Glossary

`admin.hosrocket.com` is **not a generic admin shell**. It already has deep, opinionated
surfaces for hotel operations. Almost every new feature should attach to one of the domains
below rather than introducing a new top-level concept.

All enums referenced here live in
[src/shared/enum/](../reference/admin.hosrocket.com/src/shared/enum/) and are importable from
both the client and the BFF as `@enum/<name>`.

---

## 1. Entity hierarchy

```
Organization                     hotel group / brand
 └── Site                        one property (hotel)
      ├── Tower                  building / wing (dashboards aggregate per tower)
      ├── Floor                  FloorType.Default | FloorType.RoomCollection
      │    └── Room              guest room
      │         ├── RCU          Room Controlling Unit — the on-site controller
      │         │    └── Device  thermostat, door lock, power meter, VRV interface, …
      │         ├── CheckIn      occupancy record
      │         ├── Defect       maintenance request raised against the room
      │         └── RoomTag      free-form coloured labels
      ├── SiteLocation           non-room locations (lobby, back office, …) + SiteLocationType
      ├── SiteServer             the on-prem box running the two site-server processes
      ├── Membership             (user, role) pair scoped to the site
      ├── NotificationChannel    where alerts go
      ├── AlertPolicy            what triggers a notification
      ├── Incident               an alert or service order occurrence
      ├── Notice                 notice-board post
      ├── LostItem               lost & found record
      ├── LuggageClaim           bell-desk luggage record
      ├── HousekeepingLog        cleaning start/end/inspection
      ├── ReportSchedule         daily report settings
      └── AuditLog               who changed what
```

Key structural facts:

- **`Site` is the primary scope.** Nearly every API call takes `site_id`, every permission is
  evaluated per site, and the URL is `/organizations/:organizationSlug/sites/:siteSlug/...`.
- **A `Floor` can be a "room collection"** (`FloorType.RoomCollection`) — a virtual floor
  holding an arbitrary set of `room_ids` rather than a physical level. The worker resolves
  these explicitly when processing a room event.
- **Slugs in URLs, ObjectIds in APIs.**
- Names are `LocaleString` objects (`{en, 'zh-HK', 'zh-CN', ja}`) — always render with
  `getCurrentLanguageForDisplay()`.

---

## 2. Site feature flags & plans

Several capabilities are toggled per site on the `Site` record, and the sidebar/routing respect
them:

| Flag | Gates |
|---|---|
| `enable_map_view` | Room Management (OpenLayers floor plan). When off, users get the Room List instead, and deep links fall back to `room-list` |
| `enable_vrv_status` | VRV Status page |
| `enable_hvac_control_setting` | HVAC Control Setting page |
| `enable_dashboard_device_alarm_status` | The "Alerts" tile on the dashboard |
| `enable_fias_connection` | The "PMS" tile on the dashboard (FIAS = hotel PMS protocol) |

`SitePlan`: `free_trial` · `basic` · `premium` · `overdue`.
`plan_detail.plan_end_at` drives the top notification banner: a countdown for trials
(turning red inside 30 days) and a permanent warning when `overdue`.
Gated content is covered with the `.paywall*` overlay classes.

---

## 3. Users, roles & permissions

### Roles

`RoleType`: `admin` · `demo` · `si` · `owner` · `operator` · `custom` · `owner-basic` ·
`operator-basic` · `standalone-owner` · `standalone-operator` · `luggage-manager` ·
`luggage-operator`.

`RoleSystemType`: `system` (HosRocket-defined, shared) vs `custom` (organisation-defined).
The Teammate page lists `system` memberships; custom roles are scoped to an organisation.

### Memberships

A `Membership` is `(organization_id, site_id, role_id, user_id)`, unique on that tuple.
A user gets access to a site by having a membership there.

### Permissions

`RolePermission` is a flat list of ~100 kebab-case strings. Representative groups:

| Group | Examples |
|---|---|
| Teammates & users | `view-teammate`, `create-teammate`, `update-teammate`, `delete-teammate`, `view-membership-{admin,demo,si,owner,operator,custom}`, `create-user`, `update-user` |
| Org / site structure | `list-organization`, `view-site`, `update-site-setting`, `create-tower`, `create-floor`, `create-room`, `update-device` |
| Operations | `view-dashboard`, `view-room-management`, `list-room`, `view-room`, `view-room-status`, `view-rcu-info`, `view-device-info`, `view-extended-device-info` |
| Check-in | `view-check-in`, `create-check-in`, `create-check-out`, `create-check-out-delay`, `update-check-in-vip`, `create-room-move`, `create-guest-change`, `create-check-in-without-rcu-payload` |
| Room control | `update-room-thermostat`, `update-room-scene`, `update-room-workflow`, `create-rcu-remote-control`, `update-restart-device`, `update-room-tag` |
| Service | `view-housekeeping`, `view-service-request`, `view-defects-report`, `create-defects-report`, `update-defects-report` |
| Lost & found | `view-lost-and-found`, `create-lost-and-found`, `update-lost-and-found` |
| Luggage | `view-luggage-view`, `view-luggage-dashboard`, `create-luggage-claim`, `update-luggage-claim`, `delete-luggage-claim` |
| Alerts | `view-device-health`, `view-incident`, `view-alert-policy`, `create/update/delete-alert-policy`, `view-notification-channel`, `create/update/delete-notification-channel` |
| Settings & audit | `view-daily-report-setting`, `update-daily-report-setting`, `view-hvac-control-setting`, `update-hvac-control-setting`, `view-audit-log`, `view-audit-log-payload`, `view-audit-log-admin`, `view-rcu-raw-log` |

**Pattern:** one permission per *operation*, not per role — `view-x`, `create-x`, `update-x`,
`delete-x`. Follow it for new features.

Some flows further restrict *which roles a user may grant*, via
[`filterAssignableRoles`](../reference/admin.hosrocket.com/src/server/lib/teammate.ts) — an
operator-level admin cannot create an owner.

---

## 4. Rooms, RCUs and devices

### RCU actions & values

`RcuAction` (~60 members) is the vocabulary of everything an RCU can report or be told.
Highlights:

| Category | Actions |
|---|---|
| Presence & workflow | `user_occupancy`, `workflow`, `exit_interruption` |
| Climate | `actual_temperature`, `setpoint_control`, `fan_speed_control`, `thermo_cycle_*` (setpoint, valve, fan speed, season mode, valve open %, current temperature, fan speed mode), `humidity_cycle`, `temperature_sensor_room_temperature` |
| Openings | `door`, `door_lock_status`, `window_contact` |
| Health | `rcu_heartbeat`, `rcu_restart`, `rcu_online_status`, `device_online_status`, `device_alarm_status`, `device_offline_error_code`, `device_health_door_lock` |
| Alerts (raw) | `alert_water_leakage`, `alert_power_meter`, `alert_water_flow_unexpected` |
| Alerts (processed) | `processed_alert_door_lock_error`, `processed_alert_rcu_error`, `processed_alert_raining_window_open`, `processed_alert_pms_error`, `processed_alert_site_network_error`, `processed_alert_floor_network_error`, `processed_alert_rcu_to_site_server_network_error`, … |
| Metering | `power_usage`, `power_usage_check_in/out`, `water_usage_check_in/out`, `power_meter_usage_channel_{1,2,3}`, `power_meter_fault_channel_{1,2,3}`, `power_meter_reference_power`, `power_meter_fault_power` |
| VRV | `vrv_interface_operation_status`, `vrv_interface_error` |
| Guest services | `laundry_pickup`, `butler_call`, `sos` |

`RcuValue` (namespaced enums in [rcu_value.ts](../reference/admin.hosrocket.com/src/shared/enum/rcu_value.ts))
holds the value sets, e.g.:

- `UserOccupancy`: `presence_first_entry`, `presence_reentry`, `absence`, `exit_interrupt`,
  `presence_first_entry_by_motion`, `presence_reentry_by_motion`
- `Workflow`: `none`, `mur_with_user`, `mur_without_user`, `mur_in_progress`, `mur_cleaned`,
  `mur_checked`, `mur_rejected`, `room_out_of_order`, `dnd`
- `Door`: `close`, `open_ingress`, `open_egress`, `door_ajar`, `open`
- `FanSpeedControl`, `ThermoCycle`, `WindowContact`, `DeviceOnlineStatus`, `DeviceAlarmStatus`, …

There is also `RcuValueUi` for display-oriented groupings used by the dashboard charts.

> **MUR = "Make Up Room"** — the housekeeping request workflow. **DND = "Do Not Disturb".**
> Both are surfaced as colour-coded status cells on the room card.

### Devices

`DeviceType` (~30) covers panels (`corridor_panel`, `glasspanel`, `keycard_slot`),
thermostats (`thermostat`, `thermostat_humidity`, `thermostat_humidity_readonly`,
`modbus_device_thermostat_icasa`), dimming (`phase_dimmer`), expansion modules
(`expansion_module`, `_io`, `_io_iob51`, `_dali`), openings (`door_contact`, `door_lock`,
`window_contact`), metering (`modbus_device_power_meter` v1/v2/v3, `modbus_device_flow_meter`,
`modbus_device_water_leakage`, `modbus_device_temperature_sensor`, `modbus_device_alarm`)
and VRV interfaces (`modbus_device_vrv` plus vendor variants: `mitsubishi_cb10`, `icasa`,
`daikin_ac298`, `intesis_mitsubishi`, `intesis_hitachi`, `intesis_daikin`).

The UI has **one React component per device type** under
[room_detail/cards/devices/](../reference/admin.hosrocket.com/src/client/views/pages/site/site_detail/room_management/room_detail/cards/devices/).
Adding hardware support means adding a component there, a `DeviceType` entry, a
`DeviceTypeId`, and an entry in `config.device_rcu_action`.

Devices are addressed by `bus` + `address`, and grouped by `group` + `type_id`.

`DeviceStatus`: `online` · `offline` · `normal` · `error` · `unknown`.

---

## 5. Operational domains

### Check-in / occupancy

`CheckInStatus`: `check_in` · `check_out`. `CheckInMode`: `cloud` · `local`.
`RoomOccupancy`: `occupied` · `unoccupied`.
Flows include check-in, check-out (with and without RCU payload), delayed check-out, room move,
guest change and VIP mode. Power and water usage are captured at check-in and check-out to bill
or report per stay.

### Housekeeping & service

- `HousekeepingLog` — start / end / inspection-complete, derived automatically from RCU
  workflow transitions by the worker.
- `ServiceRequest` — guest-initiated requests, surfaced as `Incident` with
  `IncidentType.ServiceOrder`.
- `Defect` (UI name: **Maintenance Request**) — `DefectStatus`: `open` · `in_progress` ·
  `to_be_inspected` · `completed` · `wont_do`. Carries photos (max 5), priority, ticket
  number and threaded comments (`ticket_comment` sub-schema in core).

### Alerts & incidents

- `AlertPolicy` binds an `AlertPreset` to `NotificationChannel`s with an `AlertSeverity`
  (`warning` · `critical`).
- `AlertPreset` (16): `door_lock_error`, `door_lock_event_error`, `rcu_error`, `water_leakage`,
  `power_meter`, `door_ajar`, `device_offline`, `mur`, `unexpected_water_flow`,
  `raining_window_open`, `server_database_error`, `pms_error`, `site_network_error`,
  `floor_network_error`, `rcu_to_site_server_network_error`, `vrv_error`.
- `Incident` — `IncidentType`: `alert` · `service_order`; `IncidentStatus`: `open` · `close`.
  Linked to a floor, a room, several rooms, or a tower depending on the preset.
- `NotificationChannel` — `NotificationType`: `email` · `email_cc` · `message` · `webhook` ·
  `telegram` · `team`.
- `AlertStatus`: `normal` · `alert` · `unknown` (dashboard tiles).
- VRV errors have their own per-vendor code dictionaries under
  [src/client/locale_vrv_error/](../reference/admin.hosrocket.com/src/client/locale_vrv_error/).

### Notices

`Notice` with `NoticeType`: `notice` · `warning`. Warning notices render with a red-bordered
card on the dashboard notice board. Body is rich text (Quill).

### Lost & found

`LostItem` — `LostItemStatus`: `open` · `in_transit` · `keep` · `returned_to_guest` ·
`discarded` · `sent_to_police`. Photos (max 5), priority, tag-based filtering, QR label
scanning, ticket numbers in the URL (`lost-and-found/:ticketNumber`).

### Luggage management

`LuggageClaim` — `LuggageClaimStatus`: `keeping` · `guest_claimed` · `discarded`;
`LuggageType`: `suitcase` · `hand_carry` · `sport_equipment` · `coat` · `other`;
plus `LuggageClaimType`.
Flows: **baggage drop** (form → luggage tag barcode scan → QR claim pass) and
**baggage claim** (scan barcode → release). There is a **public, unauthenticated**
`/baggage-claim` page for guests, and Apple Wallet pass generation on the BFF.

### Room list filters

`RoomFilter`: `all` · `error` · `mur` · `occupied` · `unoccupied` · `rented` · `vacant` ·
`butler_call` · `laundry`.

### Audit

`AuditLog` records mutations. Two views: per-site (`audit-log`) and system-wide
(`users/admin-audit-log`, admin only). Payload visibility is itself permission-gated
(`view-audit-log-payload`).

---

## 6. Existing portal surfaces

Everything under
[views/pages/site/site_detail/](../reference/admin.hosrocket.com/src/client/views/pages/site/site_detail/),
grouped as the sidebar groups them:

| Sidebar section | Pages |
|---|---|
| **Management** | Dashboard · Room Management (map) · Room List · Check-in History · Notice Board · VRV Status |
| **Service order** | Housekeeping · Service Request · Maintenance Request · Lost and Found |
| **Alerts** | Device Health · Incidents |
| **Notification** | Alert Policy · Notification Channel |
| **Luggage management** | Luggage View (+ baggage drop / set luggage tag / baggage claim) |
| **Settings** | Site Settings · Daily Report Setting · HVAC Control Setting · Teammate · Audit Log |

Outside the site scope: Organization List/Detail, Site List, My Account, Change Password,
Admin Audit Log, Login / Forgot / Reset Password, and the public Baggage Claim page.

**Before proposing a new page, check whether the capability belongs on one of these.**
Most requests are a new column, filter, card, modal or tab on an existing surface.

---

## 7. Glossary

| Term | Meaning |
|---|---|
| **RCU** | Room Controlling Unit — the in-room controller HosRocket talks to over TCP |
| **Site server** | The on-premise box at the hotel running `rcu-to-pubsub` and `pubsub-to-rcu` |
| **MUR** | Make Up Room — housekeeping cleaning request workflow |
| **DND** | Do Not Disturb |
| **VRV / VRF** | Variable Refrigerant Volume/Flow — the centralised HVAC system; HosRocket integrates via vendor Modbus interfaces (Daikin, Mitsubishi, Hitachi, Intesis, Icasa) |
| **HVAC** | Heating, Ventilation & Air Conditioning |
| **PMS** | Property Management System — the hotel's booking/folio system |
| **FIAS** | The Fidelio/Opera interface protocol used to talk to a PMS |
| **Defect** | Internal name for a Maintenance Request |
| **Incident** | A recorded alert or service-order occurrence with open/close lifecycle |
| **Tower** | A building or wing within a site; dashboards aggregate per tower |
| **Room collection** | A virtual floor containing an arbitrary set of rooms |
| **Screener** | Core API's output-whitelisting layer |
| **Hydrated\*** | A core model enriched by the BFF with related entities for the UI |
| **Table store** | The generated Redux reducer backing every paginated list |
| **Stage** | The `NOT_START / PENDING / SUCCESS / FAIL / ERROR / BUSY` async status enum |
| **`uiBusy`** | Global boolean that disables all controls during any in-flight request |
| **On-prem mode** | Fully self-hosted deployment: Beanstalkd instead of Pub/Sub, local asset host, no GCP |
| **Master API key** | The service-to-service credential for `core.hosrocketapi.com` |
| **`on-behalf-of-user-id`** | Header carrying the real acting user so the core audit log attributes changes correctly |
