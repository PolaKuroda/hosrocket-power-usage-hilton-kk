# Power Usage Dashboard

## Overview

The power usage dashboard is a browser-based BMS view for hotel operators and engineering
teams. It reads prepared CSV datasets from `output/` and displays room power telemetry in a
Chart.js line chart.

Start the local UI with:

```sh
yarn install --production=false
yarn dev
```

Open `http://localhost:3000`.

## Prepare A Dataset

Select a source CSV by filename:

```sh
npm run prepare-data -- bq-results-20260907-002921-1788740981799.csv
```

The command reads from `data/`, validates and decodes the RCU payload, then writes a CSV into
`output/` using this naming format:

```text
Room <room or All Rooms> - Power Usage - <YYYYMMDD> to <YYYYMMDD>.csv
```

It also updates `output/datasets.json`, which is the dataset index used by the UI. If the
filename is missing or invalid, the command lists the available CSV files and exits with an
error.

## Dashboard Controls

- **Data source** loads a prepared CSV listed in `output/datasets.json`.
- **Time period** filters all available data, the last 24 hours, or the last 7 days.
- **Room** is a checkbox menu and supports comparing multiple rooms.
- **Device group / channel** is a checkbox menu. Each selected room and group/channel pair is
  rendered as an independent trend and color.
- **Data to chart** supports Voltage, Current, Active Power, Reactive Power, Current Total
  Energy, Power Factor, and Peak/Off-Peak shading.

The default metric is Active Power only.

## Time And Site Settings

Chart timestamps use local site time in `YYYY-MM-DD HH:mm` format and 24-hour notation. The
x-axis starts at 06:00 on the first dataset day and includes four-hour grid intervals.

Peak and Off-Peak settings are configured in
[`src/config/power_usage.json`](../src/config/power_usage.json):

```json
"site_settings": {
	"peak_start": "08:00",
	"peak_end": "22:00",
	"off_peak_start": "22:00",
	"off_peak_end": "07:00"
}
```

The same configuration file controls the default metrics, group/channel display labels, and
chart colors.

## Export

- **PNG** downloads the visible chart image.
- **PDF** downloads an A3 landscape PDF and fits the chart image to the available page area
  while preserving its aspect ratio.

## Release Validation

For a release build, run:

```sh
yarn build
git diff --check
```

Also verify the dashboard with at least one single-room dataset and one multi-room dataset,
including room selection, group/channel selection, Peak/Off-Peak shading, PNG export, and A3
PDF export.
