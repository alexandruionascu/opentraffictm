# Traffic Validation

Private validation inputs and derived outputs live here.

## Contract
- `providers/`: provider configs and request templates.
- `raw/`: temporary raw responses only when caching is allowed.
- `snapshots/`: normalized provider snapshots.
- `derived/`: validation metrics and summaries.
- `runs/`: links between snapshots, scenarios, and model runs.

## Rule
- Keep raw provider payloads private.
- Expose only derived validation results in public views.
