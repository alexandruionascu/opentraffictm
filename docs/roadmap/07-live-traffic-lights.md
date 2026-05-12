# Live Traffic-Light Intervals

## Goal
Import real traffic-light intervals and compare model behavior against real timing.

## Required Input
- Intersection id and coordinates.
- Phase list.
- Cycle time.
- Offsets.
- Pedestrian phases.
- Time validity window.

## Comparison Outputs
- Phase mismatch.
- Queue delta.
- Throughput delta.
- Bus delay delta.
- Pedestrian wait delta.
- Recommended timing changes.

## Next Work
- Treat live STPT vehicle positions as the first probe feed for corridor-delay feedback.
- Attach queue and delay outputs to intersection-level timing comparisons, not just phase mismatch.
