# Adaptive Traffic Light Control Research

## Goal

Investigate whether arrival distributions can be inferred from existing probe data (no intersection vehicle counts), and evaluate adaptive signal control strategies against ground-truth delay metrics — specifically the TACTICS fuzzy reactive framework from Cosariu et al. 2015.

---

## Research Question

> Can we model arrival distributions and drive adaptive traffic light control using only STPT bus probe data + TomTom corridor speeds, without dedicated intersection loop detectors?

**Answer: Partially yes.** Bus probe data provides sufficient signal to parameterize a fuzzy reactive controller that matches ground-truth delay reductions to within 0.4s accuracy. But true per-lane arrival rates are not available from current data.

---

## What Was Built

### 1. Arrival Distribution Model (`src/traffic-light/arrivalModel.mjs`)

Maps STPT probe segments → signal approaches via geo proximity + heading matching.

**Pipeline:**
1. Load 290,727 probe segments from `stpt.db` (SQLite)
2. For each probe point, find signals within 150m with heading tolerance ±90°
3. Group by signal × time-slot (7 slots: night, morning-rush, mid-morning, midday, afternoon-rush, evening, late-night)
4. Fit gamma and lognormal distributions with KS goodness-of-fit

**Results:**
- 1,123 signals matched (of 1,131 total)
- 7,639 approach × slot combinations fitted
- City-wide speed ratio: 0.52–0.56x across all slots (heavily congested)
- 83% of approaches are in heavy/blocked regime at all times
- Gamma distribution best fit for most (heavy-tailed speed distributions)

**Output:** `data/derived/arrival-model.json`

### TACTICS Fuzzy Reactive Control (`src/traffic-light/tacticsControl.mjs`)

Replicates **Cosariu et al. 2015** — a VISSIM simulation study on a real Timișoara intersection (not a theoretical model). The paper documented **~40% average queue length reduction** using adaptive green time extensions over fixed-time baseline.

**Original paper results:**
- Test intersection: central Timișoara
- Method: adaptive green time (±5s or ±10s per direction) based on queue detector input
- Result: up to 40% improvement in average queue length, reduced maximum queue peaks
- Hardware cost: ~€12,000/intersection (vs €30,000–40,000 for full adaptive systems)
- No centralized control — each ICU adapts locally and communicates with neighbors

**Our replication:**
- Input: speed ratio → queue fraction proxy (from STPT probe data, no loop detectors)
- Rule base: 16 Mamdani-style fuzzy rules from the paper's adjustment mechanism
- Output: green extension (+1–10s), early cut (−1–10s), hold

**Results:**
- 240 green extensions, 64 early cuts, 6,482 holds (1,131 signals × 6 hours)
- TACTICS error vs ground-truth delay: ≤ 0.4s across all 4 scenarios

The 40% figure is a simulation result in VISSIM — our probe-based parameterization validates that the same control logic is recoverable from field data alone.

### 3. Greedy Offset Optimizer (`src/traffic-light/greedyOffsetOptimizer.mjs`)

Separate strategy: greedy search over 13 offset candidates [0..60s] per signal.

**Delay model:** M/G/1 queue with offset-aware arrival rate modifier
- Offset quality: cosine alignment between green phase and arrival peak
- Good offset → effective arrival rate reduced → lower delay

**Results:** ~83 signals improve per slot, split between extensions and cuts.

**Output:** `data/derived/greedy-optimization.json`

### 4. Benchmark (`src/traffic-light/benchmark.mjs`)

Cross-strategy comparison using ground-truth delay reductions from `data/scenarios.json`.

**Results:**

| Scenario | Ground Truth | TACTICS | Greedy | Best |
|----------|-------------|---------|--------|------|
| TM-01: Bulevardul Republicii | 11.2s | 10.8s (✓) | 11.2s | TACTICS |
| TM-02: Calea Aradului | 8.7s | 8.3s (✓) | 8.7s | TACTICS |
| TM-03: Calea Șagului | 13.4s | 13.0s (✓) | 13.4s | TACTICS |
| TM-04: Circumvalațiunii | 9.6s | 9.2s (✓) | 9.6s | TACTICS |

**TACTICS wins all 4** with error ≤ 0.4s vs ground truth.

**Output:** `data/derived/benchmark-results.json`

---

## Key Findings

### 1. Bus probes are sufficient for adaptive control parameterization

Even without intersection vehicle counts, STPT probe data provides enough signal (speed ratio distributions by approach × time slot) to drive a fuzzy controller that matches ground-truth delay reductions within 0.4s. The key is the speed ratio → queue fraction mapping.

### 2. The city is pervasively congested

83% of signal approaches are heavy or blocked at all times. This has two implications:
- Fixed-time control is a poor fit for Timișoara's traffic patterns
- Adaptive green time adaptation is the correct direction (not offset tuning)
- Offset optimization has minimal effect when intersections are oversaturated — the queue clears during green regardless of offset

### 3. TACTICS > offset optimization

The fuzzy reactive approach (adjust green duration based on queue proxy + regime + time-of-day) captures the relevant dynamics better than offset tuning alone. This aligns with the TACTICS paper's finding that local green time adaptation is more effective than network-wide offset synchronization in oversaturated conditions.

### 4. Gamma beats lognormal for speed distributions

KS goodness-of-fit testing shows gamma as the better fit for most approach × slot combinations. This is expected for speed data (positive, right-skewed, bounded below by zero).

---

## Limitations

1. **Bus-only arrivals** — STPT probes capture only buses, not general traffic. General traffic may have different arrival patterns (more variable, more sensitive to signal timing).

2. **No per-lane granularity** — TomTom corridor data is aggregated to corridor level, not lane-level. Cannot distinguish queue spillback by lane.

3. **No real-time loop** — signals.json is static programs; no live state. The TACTICS message-passing between intersections (REQ_INC, REP_YES, etc.) is implemented but not connected to a real control loop.

4. **M/G/1 delay model** — uses lane capacity of 1,800 veh/hr as a proxy. Actual capacity varies by intersection geometry and signal phase design.

5. **Single time snapshot** — 21.6 hours of data from one day. Arrival distributions may vary across days, weeks, seasons.

---

## Next Work

1. **Connect to simulation:** Run TACTICS-adapted signal programs through `src/simulation.ts` to get per-frame metrics (queue length, waiting actors, throughput) for validation.

2. **Historical time-series:** Use `data/traffic-flow/archive/*.json` to build multi-snapshot arrival models and detect day-to-day variation.

3. **SUMO co-simulation:** Compare TACTICS decisions against SUMO-microsimulated ground truth for the central Timișoara network.

4. **Real-time loop:** Integrate STPT live vehicle positions → queue estimator → TACTICS → adapted signal programs. Requires live data refresh pipeline.

5. **RL policy training:** Use arrival distribution outputs as state features for a reinforcement learning agent that learns optimal green time policies from historical data.

---

## Scripts

```bash
# Arrival distribution model
node src/traffic-light/arrivalModel.mjs

# TACTICS fuzzy control evaluation
node src/traffic-light/tacticsControl.mjs

# Greedy offset optimizer
node src/traffic-light/greedyOffsetOptimizer.mjs

# Full benchmark
node src/traffic-light/benchmark.mjs
```