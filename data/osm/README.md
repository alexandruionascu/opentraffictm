# OSM Data

Store Timișoara OSM extracts, Overpass responses, road graph files, lanes, crossings, intersections, and derived GeoJSON here.

Current local map files:
- `timisoara-roads.geojson`: local OSM highway ways for the Timișoara bounding box.
- `timisoara-controls.geojson`: local OSM traffic-signal and crossing nodes.
- `timisoara-osm-manifest.json`: extraction timestamp, bbox, query, and feature counts.

Refresh command:

```bash
node scripts/fetch-osm-timisoara.mjs
```
