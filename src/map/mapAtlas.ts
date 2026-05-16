export type AtlasLayerKind = "line" | "point" | "mixed";
export type AtlasColorMode =
  | "congestion"
  | "closure"
  | "signalConfidence"
  | "transitDelay"
  | "transitSpeed"
  | "sampleDensity"
  | "roadRank"
  | "laneBand"
  | "osmControl"
  | "stpt"
  | "single";

export interface MapAtlasVariant {
  id: string;
  label: string;
  artifactPaths: string[];
  note?: string;
}

export interface MapAtlasView {
  id: string;
  path: string;
  title: string;
  category: string;
  description: string;
  artifactPaths: string[];
  layerKind: AtlasLayerKind;
  colorMode: AtlasColorMode;
  legend: Array<{ label: string; color: string }>;
  examples: Array<{ label: string; target?: string; note?: string }>;
  insight?: string;
  metricLabels?: string[];
  emptyState?: string;
  defaultVariantId?: string;
  featurePriority?: string[];
  variants?: MapAtlasVariant[];
  camera?: {
    center: [number, number];
    zoom: number;
    pitch?: number;
    bearing?: number;
  };
}

const center: [number, number] = [21.2087, 45.7489];
const cityCamera = { center, zoom: 12.2, pitch: 48, bearing: -16 };
const routeCamera = { center: [21.215, 45.748] as [number, number], zoom: 12.8, pitch: 48, bearing: -16 };

const congestionLegend = [
  { label: "low", color: "#22c55e" },
  { label: "light", color: "#facc15" },
  { label: "heavy", color: "#f97316" },
  { label: "severe", color: "#ef4444" },
];
const closureLegend = [
  { label: "active", color: "#ff5c7a" },
  { label: "scheduled", color: "#ffd166" },
  { label: "recent", color: "#38bdf8" },
  { label: "expired", color: "#94a3b8" },
];
const signalLegend = [
  { label: "high confidence", color: "#22c55e" },
  { label: "medium", color: "#facc15" },
  { label: "low/unmapped", color: "#fb7185" },
];
const stptLegend = [
  { label: "vehicle", color: "#65d6ff" },
  { label: "accessible", color: "#7cffb2" },
  { label: "stop", color: "#ffd166" },
];
const roadLegend = [
  { label: "major", color: "#f8fafc" },
  { label: "minor", color: "#9fb5c8" },
  { label: "lanes", color: "#fbbf24" },
];
const laneLegend = [
  { label: "lane 1", color: "#38bdf8" },
  { label: "lane 2", color: "#facc15" },
  { label: "lane 3", color: "#fb7185" },
  { label: "lane 4", color: "#a78bfa" },
];

const timeslotVariants: MapAtlasVariant[] = [
  ["morning-rush", "Morning", "data/map-views/tomtom/timeslot-morning-rush.geojson"],
  ["mid-morning", "Mid-morning", "data/map-views/tomtom/timeslot-mid-morning.geojson"],
  ["midday", "Midday", "data/map-views/tomtom/timeslot-midday.geojson"],
  ["afternoon-rush", "Afternoon", "data/map-views/tomtom/timeslot-afternoon-rush.geojson"],
  ["evening", "Evening", "data/map-views/tomtom/timeslot-evening.geojson"],
  ["night", "Night", "data/map-views/tomtom/timeslot-night.geojson"],
].map(([id, label, path]) => ({ id, label, artifactPaths: [path] }));

const confidenceVariants: MapAtlasVariant[] = [
  { id: "high", label: "High", artifactPaths: ["data/map-views/signals/confidence-high.geojson"] },
  { id: "medium", label: "Medium", artifactPaths: ["data/map-views/signals/confidence-medium.geojson"] },
  { id: "low", label: "Low", artifactPaths: ["data/map-views/signals/confidence-low.geojson"] },
];

const accessibilityVariants: MapAtlasVariant[] = [
  { id: "accessible", label: "Accessible", artifactPaths: ["data/map-views/stpt-live/accessible.geojson"] },
  { id: "not-accessible", label: "Not accessible", artifactPaths: ["data/map-views/stpt-live/not-accessible.geojson"] },
];

const routeVariants: MapAtlasVariant[] = ["1", "2", "4", "8", "33", "E2", "E8"].map((route) => ({
  id: route,
  label: route,
  artifactPaths: [`data/map-views/stpt-live/vehicles-by-route/${route}.geojson`],
}));

export const mapAtlasViews: MapAtlasView[] = [
  {
    id: "live-transit",
    path: "/maps/live-transit",
    title: "Live Transit",
    category: "STPT",
    description: "Latest checked-in STPT vehicle positions with route, speed, accessibility, stop, and destination context.",
    artifactPaths: ["data/map-views/stpt-live/vehicles.geojson"],
    layerKind: "point",
    colorMode: "stpt",
    legend: stptLegend,
    examples: [{ label: "Routes", target: "/maps/live-transit/routes" }, { label: "Stops", target: "/maps/live-transit/stops" }],
    insight: "Use this as the dispatch snapshot: moving vehicles, stopped vehicles, and accessible fleet coverage are visible without opening raw STPT feeds.",
    metricLabels: ["vehicles", "routes", "accessible", "stopped"],
    emptyState: "No vehicles were present in the checked-in STPT snapshot.",
    featurePriority: ["route", "headsign", "stop", "speedKph", "isAccessible", "timestamp", "collectedAt", "source"],
    camera: cityCamera,
  },
  {
    id: "live-transit-routes",
    path: "/maps/live-transit/routes",
    title: "Route Vehicles",
    category: "STPT",
    description: "Route-filtered STPT vehicle snapshots for quick corridor checks during a live demo.",
    artifactPaths: routeVariants[0].artifactPaths,
    layerKind: "point",
    colorMode: "stpt",
    legend: stptLegend,
    examples: [{ label: "All vehicles", target: "/maps/live-transit" }, { label: "Stops", target: "/maps/live-transit/stops" }],
    insight: "Each chip isolates one route so a civic operator can talk through fleet distribution without visual clutter.",
    metricLabels: ["vehicles", "stopped", "accessible", "avg speed"],
    emptyState: "This route has no vehicles in the checked-in STPT snapshot.",
    defaultVariantId: "1",
    featurePriority: ["route", "headsign", "stop", "speedKph", "isAccessible", "timestamp"],
    variants: routeVariants,
    camera: routeCamera,
  },
  {
    id: "live-transit-accessibility",
    path: "/maps/live-transit/accessibility",
    title: "Accessible Vehicles",
    category: "STPT",
    description: "Accessible and non-accessible STPT vehicles split into separate operational layers.",
    artifactPaths: accessibilityVariants[0].artifactPaths,
    layerKind: "point",
    colorMode: "stpt",
    legend: stptLegend,
    examples: [{ label: "All vehicles", target: "/maps/live-transit" }, { label: "Route view", target: "/maps/live-transit/routes" }],
    insight: "The split makes accessibility coverage visible as a fleet operations issue instead of a hidden vehicle attribute.",
    metricLabels: ["vehicles", "routes", "accessible", "stopped"],
    emptyState: "No vehicles match this accessibility filter in the checked-in snapshot.",
    defaultVariantId: "accessible",
    featurePriority: ["route", "headsign", "stop", "speedKph", "isAccessible", "timestamp"],
    variants: accessibilityVariants,
    camera: cityCamera,
  },
  {
    id: "live-transit-stops",
    path: "/maps/live-transit/stops",
    title: "STPT Stops",
    category: "STPT",
    description: "STPT station index rendered as stop points with served line counts.",
    artifactPaths: ["data/map-views/stpt-live/stops.geojson"],
    layerKind: "point",
    colorMode: "stpt",
    legend: stptLegend,
    examples: [{ label: "Vehicles", target: "/maps/live-transit" }],
    insight: "Stops provide the civic geography behind the live fleet view and reveal dense transfer areas.",
    metricLabels: ["stops", "served lines", "max line count"],
    emptyState: "The station index did not produce any stop geometry.",
    featurePriority: ["name", "lines", "lineCount", "stopId", "source"],
    camera: cityCamera,
  },
  {
    id: "live-transit-headsigns",
    path: "/maps/live-transit/headsigns",
    title: "Headsign Clusters",
    category: "STPT",
    description: "Vehicle positions focused on destination/headsign inspection for terminal and service-pattern checks.",
    artifactPaths: ["data/map-views/stpt-live/vehicles.geojson"],
    layerKind: "point",
    colorMode: "stpt",
    legend: stptLegend,
    examples: [{ label: "Accessibility", target: "/maps/live-transit/accessibility" }],
    insight: "Headsigns expose whether vehicles in the same area are serving the same destination or diverging across branches.",
    metricLabels: ["vehicles", "headsigns", "routes", "stopped"],
    emptyState: "No headsign-bearing vehicles are present in the checked-in snapshot.",
    featurePriority: ["headsign", "route", "stop", "speedKph", "isAccessible", "timestamp"],
    camera: cityCamera,
  },
  {
    id: "tomtom-live",
    path: "/maps/tomtom-live",
    title: "TomTom Live Flow",
    category: "TomTom",
    description: "Latest cached TomTom flow segments colored by congestion severity, speed ratio, and delay.",
    artifactPaths: ["data/map-views/tomtom/latest-flow.geojson"],
    layerKind: "line",
    colorMode: "congestion",
    legend: congestionLegend,
    examples: [{ label: "Severe", target: "/maps/tomtom-severe" }, { label: "Timeslots", target: "/maps/tomtom-timeslots" }],
    insight: "This is the current traffic health panel: red and orange segments show where road speed has collapsed relative to free flow.",
    metricLabels: ["segments", "severe/heavy", "avg speed ratio", "max delay"],
    emptyState: "No TomTom live flow segments are available in the cached snapshot.",
    featurePriority: ["congestionLevel", "speedKph", "freeFlowKph", "speedRatio", "delaySeconds", "roadClosure", "collectedAt"],
    camera: cityCamera,
  },
  {
    id: "tomtom-timeslots",
    path: "/maps/tomtom-timeslots",
    title: "TomTom Timeslots",
    category: "TomTom",
    description: "Time-of-day TomTom flow snapshots for comparing recurring congestion patterns.",
    artifactPaths: timeslotVariants[0].artifactPaths,
    layerKind: "line",
    colorMode: "congestion",
    legend: congestionLegend,
    examples: [{ label: "Live", target: "/maps/tomtom-live" }, { label: "Severe only", target: "/maps/tomtom-severe" }],
    insight: "The chips turn the same road network into a time comparison without reloading the atlas shell.",
    metricLabels: ["segments", "severe/heavy", "avg speed ratio", "max delay"],
    emptyState: "This time slot has no cached TomTom flow segments.",
    defaultVariantId: "morning-rush",
    featurePriority: ["congestionLevel", "speedKph", "freeFlowKph", "speedRatio", "delaySeconds", "collectedAt"],
    variants: timeslotVariants,
    camera: cityCamera,
  },
  ...[
    ["tomtom-morning-rush", "Morning Rush", "timeslot-morning-rush.geojson"],
    ["tomtom-afternoon-rush", "Afternoon Rush", "timeslot-afternoon-rush.geojson"],
    ["tomtom-evening", "Evening Congestion", "timeslot-evening.geojson"],
  ].map(([id, title, file]) => ({
    id,
    path: `/maps/${id}`,
    title,
    category: "TomTom",
    description: `${title} flow snapshot, colored by speed loss against free-flow travel conditions.`,
    artifactPaths: [`data/map-views/tomtom/${file}`],
    layerKind: "line" as const,
    colorMode: "congestion" as const,
    legend: congestionLegend,
    examples: [{ label: "All slots", target: "/maps/tomtom-timeslots" }, { label: "Severe", target: "/maps/tomtom-severe" }],
    insight: `${title} is ready as a single-click comparison slide for recurring congestion conversations.`,
    metricLabels: ["segments", "severe/heavy", "avg speed ratio", "max delay"],
    emptyState: "This TomTom time snapshot has no cached flow segments.",
    featurePriority: ["congestionLevel", "speedKph", "freeFlowKph", "speedRatio", "delaySeconds", "collectedAt"],
    camera: cityCamera,
  })),
  {
    id: "tomtom-severe",
    path: "/maps/tomtom-severe",
    title: "Severe TomTom Segments",
    category: "TomTom",
    description: "Heavy, severe, blocked, or closure-marked TomTom segments filtered for operational triage.",
    artifactPaths: ["data/map-views/tomtom/severe-heavy.geojson"],
    layerKind: "line",
    colorMode: "congestion",
    legend: congestionLegend,
    examples: [{ label: "Live", target: "/maps/tomtom-live" }],
    insight: "This view removes normal traffic so the demo can focus immediately on streets that need attention.",
    metricLabels: ["segments", "severe/heavy", "avg speed ratio", "max delay"],
    emptyState: "No heavy, severe, blocked, or closure-marked TomTom segments are present.",
    featurePriority: ["congestionLevel", "speedKph", "freeFlowKph", "speedRatio", "delaySeconds", "roadClosure", "collectedAt"],
    camera: cityCamera,
  },
  {
    id: "tomtom-incidents",
    path: "/maps/tomtom-incidents",
    title: "TomTom Incidents",
    category: "TomTom",
    description: "Incident pins from cached TomTom incident details with severity and type information.",
    artifactPaths: ["data/map-views/tomtom/incidents.geojson"],
    layerKind: "point",
    colorMode: "single",
    legend: [{ label: "incident", color: "#fb7185" }],
    examples: [{ label: "Severe flow", target: "/maps/tomtom-severe" }],
    insight: "Incidents are separated from flow so they can be discussed as point events rather than speed-pattern artifacts.",
    metricLabels: ["incidents", "severity levels"],
    emptyState: "The cached TomTom incident response contains no incident pins.",
    featurePriority: ["severity", "typeCode", "collectedAt", "source"],
    camera: cityCamera,
  },
  ...[
    ["closures", "Road Restrictions", "all.geojson"],
    ["closures/active", "Active Restrictions", "active.geojson"],
    ["closures/scheduled", "Scheduled Restrictions", "scheduled.geojson"],
    ["closures/recent", "Recently Cleared", "recent.geojson"],
    ["closures/events", "Event Closures", "events.geojson"],
  ].map(([slug, title, file]) => ({
    id: slug.replace("/", "-"),
    path: `/maps/${slug}`,
    title,
    category: "Closures",
    description: "Municipal restriction notices matched to OSM road geometry at build time.",
    artifactPaths: [`data/map-views/closures/${file}`],
    layerKind: "line" as const,
    colorMode: "closure" as const,
    legend: closureLegend,
    examples: [{ label: "Active", target: "/maps/closures/active" }, { label: "Scheduled", target: "/maps/closures/scheduled" }],
    insight: title === "Active Restrictions" ? "Active restrictions are the operational truth set for today." : title === "Scheduled Restrictions" ? "Zero scheduled lines means the current notices do not expose future road geometry matches." : "Restriction geometry converts public notices into streets an operator can inspect.",
    metricLabels: ["matched roads", "notices", "active", "events"],
    emptyState: `No ${title.toLowerCase()} are present in the matched closure artifact.`,
    featurePriority: ["statusLabel", "roadName", "roadHint", "noticeTitle", "windowStart", "windowEnd", "noticeUrl", "publishedAt", "source"],
    camera: cityCamera,
  })),
  ...[
    ["signals", "Signal Candidates", "candidates.geojson"],
    ["signals/provided", "Provided Signal Programs", "provided.geojson"],
    ["signals/unmapped", "Unmapped OSM Signals", "unmapped-osm.geojson"],
    ["signals/stops", "Stop Hotspots", "stop-hotspots.geojson"],
  ].map(([slug, title, file]) => ({
    id: slug.replace("/", "-"),
    path: `/maps/${slug}`,
    title,
    category: "Signals",
    description: "Signal point layers from provided programs, OSM controls, and STPT stop/resume inference.",
    artifactPaths: [`data/map-views/signals/${file}`],
    layerKind: "point" as const,
    colorMode: "signalConfidence" as const,
    legend: signalLegend,
    examples: [{ label: "Confidence", target: "/maps/signals/confidence" }, { label: "Unmapped", target: "/maps/signals/unmapped" }],
    insight: title === "Provided Signal Programs" ? "Provided programs give the broad controller inventory, including cycle and phase counts." : title === "Unmapped OSM Signals" ? "Zero unmapped points means the current OSM signal controls are covered by program data." : "Signal confidence makes inference quality visible before deeper timing analysis.",
    metricLabels: ["signals", "high confidence", "samples", "avg cycle"],
    emptyState: `No ${title.toLowerCase()} are present in this signal artifact.`,
    featurePriority: ["confidence", "band", "route", "sampleCount", "stopCount", "resumeCount", "cycleSeconds", "phaseCount", "osmId", "source"],
    camera: cityCamera,
  })),
  {
    id: "signals-confidence",
    path: "/maps/signals/confidence",
    title: "Signal Confidence",
    category: "Signals",
    description: "Signal candidates split into confidence bands for fast inference QA.",
    artifactPaths: confidenceVariants[0].artifactPaths,
    layerKind: "point",
    colorMode: "signalConfidence",
    legend: signalLegend,
    examples: [{ label: "Candidates", target: "/maps/signals" }, { label: "Provided programs", target: "/maps/signals/provided" }],
    insight: "High-only results show the current inference set is conservative; low and medium empty states are useful QA findings.",
    metricLabels: ["signals", "high confidence", "samples", "avg confidence"],
    emptyState: "No signal candidates exist in this confidence band.",
    defaultVariantId: "high",
    featurePriority: ["confidence", "band", "route", "sampleCount", "stopCount", "resumeCount", "source"],
    variants: confidenceVariants,
    camera: cityCamera,
  },
  ...[
    ["transit-delay", "Transit Delay Corridors", "delay-corridors.geojson", "transitDelay"],
    ["transit-speed", "Transit Speed Corridors", "speed-corridors.geojson", "transitSpeed"],
    ["transit-samples", "Transit Sample Density", "sample-density.geojson", "sampleDensity"],
  ].map(([id, title, file, colorMode]) => ({
    id,
    path: `/maps/${id}`,
    title,
    category: "Transit Corridors",
    description: "STPT historical probe corridors aggregated by route for speed, delay, and sample-density review.",
    artifactPaths: [`data/map-views/transit/${file}`],
    layerKind: "line" as const,
    colorMode: colorMode as AtlasColorMode,
    legend: [
      { label: "low", color: "#38bdf8" },
      { label: "medium", color: "#facc15" },
      { label: "high", color: "#ef4444" },
    ],
    examples: [{ label: "Delay", target: "/maps/transit-delay" }, { label: "Speed", target: "/maps/transit-speed" }],
    insight: title === "Transit Delay Corridors" ? "Delay corridors identify routes where riders feel recurring slowdowns." : title === "Transit Speed Corridors" ? "Speed corridors rank service performance by route rather than by isolated vehicle pings." : "Sample density shows which corridor claims are backed by the most probe observations.",
    metricLabels: ["routes", "slowest", "max delay", "samples"],
    emptyState: "No STPT probe corridor aggregates are available for this view.",
    featurePriority: ["route", "avgSpeedKph", "avgDelaySeconds", "sampleCount", "densityRank", "source"],
    camera: cityCamera,
  })),
  {
    id: "osm-roads",
    path: "/maps/osm-roads",
    title: "Road Hierarchy",
    category: "OSM",
    description: "OSM road hierarchy split into major and simplified minor artifacts for city-wide spatial context.",
    artifactPaths: ["data/map-views/osm/roads-minor-simplified.geojson", "data/map-views/osm/roads-major.geojson"],
    layerKind: "line",
    colorMode: "roadRank",
    legend: roadLegend,
    examples: [{ label: "Major", target: "/maps/osm-major-roads" }, { label: "Lanes", target: "/maps/osm-lanes" }],
    insight: "The hierarchy layer is the base network QA view: major roads stay detailed while minor roads remain compact for browser demos.",
    metricLabels: ["roads", "major rank", "named roads"],
    emptyState: "No OSM road hierarchy features are available.",
    featurePriority: ["name", "highway", "rank", "lanes", "maxspeed", "osmId", "source"],
    camera: cityCamera,
  },
  {
    id: "osm-major-roads",
    path: "/maps/osm-major-roads",
    title: "Major Roads",
    category: "OSM",
    description: "Major OSM roads only, split from full OSM at build time for uncluttered arterial review.",
    artifactPaths: ["data/map-views/osm/roads-major.geojson"],
    layerKind: "line",
    colorMode: "roadRank",
    legend: roadLegend,
    examples: [{ label: "All hierarchy", target: "/maps/osm-roads" }],
    insight: "Major roads isolate the corridors most likely to matter for city traffic demos.",
    metricLabels: ["roads", "named roads", "max rank"],
    emptyState: "No major OSM road features are available.",
    featurePriority: ["name", "highway", "rank", "lanes", "maxspeed", "osmId", "source"],
    camera: cityCamera,
  },
  {
    id: "osm-lanes",
    path: "/maps/osm-lanes",
    title: "Generated Lane Bands",
    category: "OSM",
    description: "Generated lane bands from OSM lane counts, offset for corridor-level lane inspection.",
    artifactPaths: ["data/map-views/osm/lane-bands.geojson"],
    layerKind: "line",
    colorMode: "laneBand",
    legend: laneLegend,
    examples: [{ label: "Controls", target: "/maps/osm-controls" }],
    insight: "Lane bands make lane-count assumptions visible before simulation or routing layers depend on them.",
    metricLabels: ["lane bands", "roads", "max lanes"],
    emptyState: "No generated lane bands are available from OSM lane counts.",
    featurePriority: ["laneIndex", "laneCount", "offsetMeters", "rank", "osmId", "source"],
    camera: cityCamera,
  },
  {
    id: "osm-controls",
    path: "/maps/osm-controls",
    title: "Crossings And Signals",
    category: "OSM",
    description: "OSM traffic signals and crossings split into control-point layers.",
    artifactPaths: ["data/map-views/osm/traffic-signals.geojson", "data/map-views/osm/crossings.geojson"],
    layerKind: "point",
    colorMode: "osmControl",
    legend: [{ label: "signal", color: "#fb7185" }, { label: "crossing", color: "#ffd166" }],
    examples: [{ label: "Signals", target: "/maps/signals" }],
    insight: "Controls show pedestrian and signal infrastructure density before comparing it with inferred programs.",
    metricLabels: ["controls", "signals", "crossings"],
    emptyState: "No OSM traffic controls are available.",
    featurePriority: ["kind", "crossing", "osmId", "source"],
    camera: cityCamera,
  },
  {
    id: "scenarios",
    path: "/maps/scenarios",
    title: "Scenario Geography",
    category: "Scenarios",
    description: "Scenario catalog centers and metadata for simulation/demo entry points.",
    artifactPaths: ["data/map-views/scenarios/catalog.geojson"],
    layerKind: "point",
    colorMode: "single",
    legend: [{ label: "scenario", color: "#65d6ff" }],
    examples: [{ label: "Playback", target: "/maps/scenarios/playback" }],
    insight: "Scenario geography gives the demo a map-first way to introduce each simulation case.",
    metricLabels: ["scenarios", "districts", "signals"],
    emptyState: "No scenario catalog points are available.",
    featurePriority: ["scenarioId", "district", "actorCount", "signalCount", "durationSeconds", "source"],
    camera: cityCamera,
  },
  {
    id: "data-gaps",
    path: "/maps/data-gaps",
    title: "Data Gaps",
    category: "Quality",
    description: "Datasets that need better geometry, stronger adapters, or richer source coverage before they graduate into operational layers.",
    artifactPaths: ["data/map-views/data-gaps/gaps.geojson"],
    layerKind: "point",
    colorMode: "single",
    legend: [{ label: "gap", color: "#facc15" }],
    examples: [{ label: "OSM controls", target: "/maps/osm-controls" }],
    insight: "The gap view is intentionally demoable: it shows what is missing instead of hiding weak geometry behind polished maps.",
    metricLabels: ["gaps", "sources"],
    emptyState: "No data-gap markers are configured.",
    featurePriority: ["caveat", "source", "kind"],
    camera: cityCamera,
  },
];

export function findAtlasView(path: string) {
  return mapAtlasViews.find((view) => view.path === path);
}
