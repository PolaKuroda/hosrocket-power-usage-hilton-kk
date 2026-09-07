# hosrocket-power-usage-hilton-kk

## Prepare power usage data

The transformer reads the first CSV file in `data/` and writes chart-ready data to
`output/power_usage_preview.csv`:

```sh
npm run prepare-data
```

An input CSV and output path can also be supplied explicitly:

```sh
npm run prepare-data -- ./data/input.csv ./output/preview.csv
```

The output preserves the source identifiers and timestamps and adds:

- `device_group`: payload byte 7, converted from `01`-based wire values to group `0`-based values
- `channel`: payload byte 10
- `voltage`, `current`, `active_power`, `reactive_power`: the documented payload byte pairs converted from hexadecimal and divided by 100
- `total_energy`: payload bytes 21, 22, 19, 20 converted from hexadecimal and divided by 100
- `power_factor`: `active_power / reactive_power`, clamped to the range `0` to `1`; a zero reactive power produces `1`