# hosrocket-power-usage-hilton-kk

## Documentation

- [Power Usage Dashboard guide](docs/power-usage-dashboard.md)
- [Release notes](RELEASE_NOTES.md)

## Prepare power usage data

The transformer reads a named CSV file from `data/` and writes chart-ready data to `output/`.
The output name includes the room and the dataset's `SITE_TIME` date range:

```sh
npm run prepare-data -- bq-results-20260907-002921-1788740981799.csv
```

If the file name is omitted or does not exist, the command prints the available CSV files.
The generated file follows this format:

```text
output/Room 731 - Power Usage - 20260902 to 20260907.csv
```

The output preserves the source identifiers and timestamps and adds:

- `device_group`: payload byte 7, converted from `01`-based wire values to group `0`-based values
- `channel`: payload byte 10
- `voltage`, `current`, `active_power`, `reactive_power`: the documented payload byte pairs converted from hexadecimal and divided by 100
- `total_energy`: payload bytes 21, 22, 19, 20 converted from hexadecimal and divided by 100
- `power_factor`: `active_power / reactive_power`, clamped to the range `0` to `1`; a zero reactive power produces `1`

## Power usage UI

Install dependencies and start the BMS preview at `http://localhost:3000`:

```sh
yarn install --production=false
yarn dev
```

The screen supports filtering by time period, room, device group, and channel; selecting
Voltage, Current, Active Power, Reactive Power, Current Total Energy, or Power Factor; and
exporting the visible chart as PNG or PDF.

The data source selector reads the generated CSV dataset list from `output/datasets.json`.
Chart points are sorted by ascending `SITE_TIME`, with local-time labels rendered vertically
on the x-axis for readability.

Power usage chart defaults are configured in [src/config/power_usage.json](src/config/power_usage.json).
This file controls the default metrics and the display labels for each device group/channel
combination. It also controls the Peak and Off-Peak site settings. The default chart metric is
Active Power only, the chart starts at 06:00, and x-axis labels use `YYYY-MM-DD HH:mm` in 24-hour time.