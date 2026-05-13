# Traffic Lights

Store real signal intervals, phase programs, offsets, and future model-vs-real comparison outputs.

## Analysis Artifacts

- `signals.json` contains inferred phase programs.
- `analysis/export-manifest.json` lists compact CSV slices exported from `data/stpt.db`.
- `analysis/intersection-analysis.json` contains the ranked intersection-confidence candidates.
- `analysis/raw/` contains the partitioned CSV slices for the probe window.
