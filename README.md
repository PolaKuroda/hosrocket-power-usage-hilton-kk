# hosrocket-power-usage-hilton-kk

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