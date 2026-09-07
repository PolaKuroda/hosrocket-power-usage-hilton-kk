# Release Notes

## Power Usage Dashboard

### Added

- Added a BMS power usage dashboard for hotel operations and engineering teams.
- Added CSV dataset selection from `output/datasets.json`.
- Added room, device group/channel, and time-period filtering.
- Added independent colored trends for each selected room and group/channel pair.
- Added chart metrics for Voltage, Current, Active Power, Reactive Power, Total Energy, and Power Factor.
- Added configurable Peak and Off-Peak time shading.
- Added PNG and A3 landscape PDF chart export with preserved image ratio.
- Added JSON configuration for default metrics, channel labels/colors, and site time settings.

### Behavior

- Active Power is selected by default.
- Chart timestamps use local site time in `YYYY-MM-DD HH:mm` 24-hour format.
- Charts begin at 06:00 on the first dataset day.
- Four-hour vertical time grid intervals are displayed.
- Default site settings are Peak `08:00-22:00` and Off-Peak `22:00-07:00`.

### Data Preparation

- `npm run prepare-data -- <file name>` selects a CSV from `data/`.
- Invalid or missing filenames show the available data files.
- Prepared output is named with the room scope and `SITE_TIME` date range.
- The output dataset manifest is regenerated after each successful preparation.

### Validation

- Production webpack build passes.
- TypeScript/editor diagnostics pass.
- Single-room and multi-room datasets were tested in the browser.
- Multi-room room selection and group/channel comparison were tested.
- Peak/Off-Peak shading and chart rendering were tested without browser runtime errors.

### Known Warnings

The build currently reports third-party Bootstrap Sass deprecation warnings and webpack bundle
size recommendations. These warnings do not prevent the production build from completing.
