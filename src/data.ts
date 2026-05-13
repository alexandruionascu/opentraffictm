import signalsJson from "../data/traffic-lights/signals.json";

export type ActorType = "car" | "bus" | "pedestrian";
export type SignalState = "green" | "yellow" | "red";
export type ModelBackend = "browser-native" | "sumo-import" | "sota-adapter";

export interface Coordinate {
  lng: number;
  lat: number;
}

export interface Actor {
  id: string;
  type: ActorType;
  label: string;
  route: Coordinate[];
  speedMps: number;
  dwellSeconds?: number;
  routeOffsetSeconds?: number;
  lengthMeters?: number;
}

export interface SignalPhase {
  state: SignalState;
  durationSeconds: number;
}

export interface SignalProgram {
  id: string;
  name: string;
  position: Coordinate;
  primaryHeadingDeg?: number;
  phases: SignalPhase[];
  offsetSeconds: number;
}

interface SignalJsonPhase {
  state: SignalState;
  durationSeconds: number;
}

interface SignalJsonProgram {
  id: string;
  name: string;
  position: Coordinate;
  primaryHeadingDeg: number;
  offsetSeconds: number;
  phases: SignalJsonPhase[];
}

interface SignalsJson {
  generatedAt: string;
  scope: string;
  programs: SignalJsonProgram[];
}

const importedSignalPrograms: SignalProgram[] = (signalsJson as SignalsJson).programs.map((program) => ({
  id: program.id,
  name: program.name,
  position: program.position,
  primaryHeadingDeg: program.primaryHeadingDeg,
  offsetSeconds: program.offsetSeconds,
  phases: program.phases,
}));

export interface Scenario {
  id: string;
  name: string;
  district: string;
  description: string;
  boundsLabel: string;
  center: Coordinate;
  zoom: number;
  durationSeconds: number;
  actors: Actor[];
  signals: SignalProgram[];
}

export interface DatasetEntry {
  id: string;
  name: string;
  format: string[];
  description: string;
  source: string;
  folder: string;
}

export interface OfficialSourceEntry {
  id: string;
  name: string;
  organization: string;
  url: string;
  purpose: string;
  localFolder: string | null;
  note: string;
}

export interface LeaderboardEntry {
  name: string;
  track: "Human" | "Agent" | "Browser Native" | "SUMO" | "SOTA";
  score: number;
  scenarios: number;
  schemaErrors: number;
  summary: string;
}

export const timisoaraCenter: Coordinate = { lng: 21.2087, lat: 45.7489 };

const boulevardRepublicii: Coordinate[] = [
  { lng: 21.2052, lat: 45.7528 },
  { lng: 21.2075, lat: 45.7515 },
  { lng: 21.2102, lat: 45.7502 },
  { lng: 21.2135, lat: 45.7487 },
  { lng: 21.2161, lat: 45.7475 },
];

const boulevardRepubliciiReverse = [...boulevardRepublicii].reverse();

const caleaAradului: Coordinate[] = [
  { lng: 21.2178, lat: 45.7677 },
  { lng: 21.2157, lat: 45.7628 },
  { lng: 21.2139, lat: 45.7581 },
  { lng: 21.2116, lat: 45.7539 },
  { lng: 21.2097, lat: 45.7503 },
];

const caleaAraduluiReverse = [...caleaAradului].reverse();

const caleaSagului: Coordinate[] = [
  { lng: 21.2064, lat: 45.7316 },
  { lng: 21.2077, lat: 45.7365 },
  { lng: 21.2094, lat: 45.7415 },
  { lng: 21.2115, lat: 45.7463 },
  { lng: 21.2133, lat: 45.7504 },
];

const caleaSaguluiReverse = [...caleaSagului].reverse();

const circumvalatiunii: Coordinate[] = [
  { lng: 21.1913, lat: 45.7568 },
  { lng: 21.1975, lat: 45.7554 },
  { lng: 21.2038, lat: 45.7532 },
  { lng: 21.2101, lat: 45.7502 },
  { lng: 21.2167, lat: 45.7472 },
  { lng: 21.2227, lat: 45.7448 },
];

const circumvalatiuniiReverse = [...circumvalatiunii].reverse();

const takeIonescu: Coordinate[] = [
  { lng: 21.2299, lat: 45.7624 },
  { lng: 21.2252, lat: 45.7592 },
  { lng: 21.2205, lat: 45.7557 },
  { lng: 21.2161, lat: 45.7522 },
  { lng: 21.2117, lat: 45.7488 },
];

const takeIonescuReverse = [...takeIonescu].reverse();

const rebreanu: Coordinate[] = [
  { lng: 21.2348, lat: 45.7368 },
  { lng: 21.2281, lat: 45.7395 },
  { lng: 21.2219, lat: 45.7424 },
  { lng: 21.2161, lat: 45.7456 },
  { lng: 21.2115, lat: 45.7494 },
];

const rebreanuReverse = [...rebreanu].reverse();

const pedestrianCrossing: Coordinate[] = [
  { lng: 21.2088, lat: 45.7492 },
  { lng: 21.2093, lat: 45.7488 },
  { lng: 21.2098, lat: 45.7484 },
];

const pedestrianCrossingNorth: Coordinate[] = [
  { lng: 21.2134, lat: 45.7542 },
  { lng: 21.2139, lat: 45.7538 },
  { lng: 21.2144, lat: 45.7535 },
];

const pedestrianCrossingSouth: Coordinate[] = [
  { lng: 21.2107, lat: 45.7469 },
  { lng: 21.2112, lat: 45.7465 },
  { lng: 21.2118, lat: 45.7461 },
];

const osmLoopVehicleRoutes: Coordinate[][] = [
  [
    { lng: 21.2023148, lat: 45.7339433 },
    { lng: 21.2021135, lat: 45.7340231 },
    { lng: 21.2011211, lat: 45.7344172 },
    { lng: 21.2016823, lat: 45.7340914 },
    { lng: 21.2019712, lat: 45.7339577 },
    { lng: 21.2020271, lat: 45.7339318 },
    { lng: 21.2022079, lat: 45.7338481 },
    { lng: 21.2022613, lat: 45.7338252 },
    { lng: 21.2023035, lat: 45.7338073 },
    { lng: 21.2024083, lat: 45.7337672 },
    { lng: 21.2024916, lat: 45.7337353 },
    { lng: 21.2028617, lat: 45.7336008 },
    { lng: 21.2030986, lat: 45.7335239 },
    { lng: 21.2033438, lat: 45.7334762 },
    { lng: 21.2034765, lat: 45.7334504 },
    { lng: 21.2033837, lat: 45.7334944 },
    { lng: 21.2031509, lat: 45.7336047 },
    { lng: 21.2026905, lat: 45.7337863 },
    { lng: 21.202544, lat: 45.7338475 },
    { lng: 21.2024786, lat: 45.7338748 },
    { lng: 21.2023148, lat: 45.7339433 },
  ],
  [
    { lng: 21.2019622, lat: 45.7495432 },
    { lng: 21.2021429, lat: 45.7495308 },
    { lng: 21.2023975, lat: 45.7495696 },
    { lng: 21.2025247, lat: 45.7495889 },
    { lng: 21.2025638, lat: 45.7495217 },
    { lng: 21.2026168, lat: 45.7494304 },
    { lng: 21.2027483, lat: 45.7493294 },
    { lng: 21.2027373, lat: 45.7494602 },
    { lng: 21.2027175, lat: 45.7495125 },
    { lng: 21.2027085, lat: 45.7495362 },
    { lng: 21.2026797, lat: 45.7496125 },
    { lng: 21.2038561, lat: 45.7497907 },
    { lng: 21.2040515, lat: 45.7498485 },
    { lng: 21.2038332, lat: 45.7498641 },
    { lng: 21.2034477, lat: 45.7498127 },
    { lng: 21.2026497, lat: 45.7496918 },
    { lng: 21.2024983, lat: 45.7496688 },
    { lng: 21.2023667, lat: 45.7496489 },
    { lng: 21.20212, lat: 45.7496033 },
    { lng: 21.2019622, lat: 45.7495432 },
  ],
  [
    { lng: 21.2155719, lat: 45.7391247 },
    { lng: 21.2156296, lat: 45.7389731 },
    { lng: 21.2158459, lat: 45.7386724 },
    { lng: 21.2158752, lat: 45.7386353 },
    { lng: 21.2159369, lat: 45.7385374 },
    { lng: 21.216016, lat: 45.738418 },
    { lng: 21.2161043, lat: 45.738285 },
    { lng: 21.2165239, lat: 45.7376789 },
    { lng: 21.2166179, lat: 45.7376138 },
    { lng: 21.2166163, lat: 45.7377026 },
    { lng: 21.2164342, lat: 45.7380015 },
    { lng: 21.216327, lat: 45.738141 },
    { lng: 21.2161476, lat: 45.7384103 },
    { lng: 21.2161222, lat: 45.7384486 },
    { lng: 21.2160493, lat: 45.7385643 },
    { lng: 21.215984, lat: 45.7386645 },
    { lng: 21.2157181, lat: 45.7390096 },
    { lng: 21.2155719, lat: 45.7391247 },
  ],
];

const osmMatchedVehicleRoutes: Coordinate[][] = [
  [
    { lng: 21.1996611, lat: 45.7585987 },
    { lng: 21.1995467, lat: 45.7585791 },
    { lng: 21.1994288, lat: 45.7585577 },
    { lng: 21.1989538, lat: 45.75848 },
    { lng: 21.1984586, lat: 45.7583863 },
    { lng: 21.1981389, lat: 45.7583179 },
    { lng: 21.1978536, lat: 45.7582612 },
    { lng: 21.1975143, lat: 45.7581795 },
    { lng: 21.1971102, lat: 45.7580718 },
    { lng: 21.1967173, lat: 45.7579654 },
    { lng: 21.1963407, lat: 45.7578502 },
    { lng: 21.1961389, lat: 45.7577892 },
    { lng: 21.1959291, lat: 45.7577258 },
    { lng: 21.1958065, lat: 45.7576804 },
    { lng: 21.1956546, lat: 45.7576241 },
    { lng: 21.1953928, lat: 45.7575168 },
    { lng: 21.1949123, lat: 45.7573208 },
    { lng: 21.1946999, lat: 45.7572201 },
    { lng: 21.1944971, lat: 45.7571288 },
    { lng: 21.1942871, lat: 45.7570389 },
    { lng: 21.1940944, lat: 45.7569454 },
    { lng: 21.1939095, lat: 45.7568447 },
    { lng: 21.1936674, lat: 45.756707 },
    { lng: 21.1934051, lat: 45.7565477 },
    { lng: 21.1931174, lat: 45.7563592 },
    { lng: 21.1927669, lat: 45.7560888 },
    { lng: 21.1924853, lat: 45.7558677 },
    { lng: 21.1921122, lat: 45.7555594 },
    { lng: 21.1919832, lat: 45.7554508 },
    { lng: 21.1918515, lat: 45.7553223 },
    { lng: 21.191538, lat: 45.755008 },
    { lng: 21.1913613, lat: 45.7548078 },
    { lng: 21.1911218, lat: 45.7545271 },
    { lng: 21.1909336, lat: 45.7542977 },
  ],
  [
    { lng: 21.1911268, lat: 45.7542181 },
    { lng: 21.1913402, lat: 45.7545094 },
    { lng: 21.1915601, lat: 45.754766 },
    { lng: 21.1917727, lat: 45.7550018 },
    { lng: 21.1919668, lat: 45.7551856 },
    { lng: 21.1920174, lat: 45.75523 },
    { lng: 21.1921482, lat: 45.7553445 },
    { lng: 21.1922786, lat: 45.7554594 },
    { lng: 21.1923842, lat: 45.7555523 },
    { lng: 21.1926431, lat: 45.7557723 },
    { lng: 21.1928635, lat: 45.7559375 },
    { lng: 21.1930182, lat: 45.7560595 },
    { lng: 21.193258, lat: 45.7562432 },
    { lng: 21.193528, lat: 45.7564316 },
    { lng: 21.1936761, lat: 45.7565329 },
    { lng: 21.1939184, lat: 45.7566794 },
    { lng: 21.194171, lat: 45.7568172 },
    { lng: 21.1943834, lat: 45.7569119 },
    { lng: 21.1945654, lat: 45.7569927 },
    { lng: 21.1948587, lat: 45.7571338 },
    { lng: 21.195066, lat: 45.7572189 },
    { lng: 21.1952912, lat: 45.7573081 },
    { lng: 21.1957016, lat: 45.7574773 },
    { lng: 21.1959995, lat: 45.7575915 },
    { lng: 21.1962154, lat: 45.7576583 },
    { lng: 21.1964146, lat: 45.7577199 },
    { lng: 21.1967831, lat: 45.7578341 },
    { lng: 21.1971949, lat: 45.7579473 },
    { lng: 21.1978929, lat: 45.7581203 },
    { lng: 21.1981305, lat: 45.7581742 },
    { lng: 21.1984908, lat: 45.7582482 },
    { lng: 21.1990244, lat: 45.7583444 },
  ],
  [
    { lng: 21.2052184, lat: 45.7644901 },
    { lng: 21.2050603, lat: 45.7645315 },
    { lng: 21.2037789, lat: 45.7648671 },
    { lng: 21.2028131, lat: 45.7651179 },
    { lng: 21.2025561, lat: 45.7651879 },
    { lng: 21.2022401, lat: 45.7652687 },
    { lng: 21.2015399, lat: 45.7654474 },
    { lng: 21.2008655, lat: 45.7656277 },
    { lng: 21.2006042, lat: 45.7656933 },
    { lng: 21.1999733, lat: 45.7658333 },
    { lng: 21.1993906, lat: 45.7659627 },
    { lng: 21.1985749, lat: 45.7661378 },
    { lng: 21.1978856, lat: 45.7662824 },
    { lng: 21.1964801, lat: 45.7665573 },
    { lng: 21.1960129, lat: 45.7666554 },
  ],
  [
    { lng: 21.2190922, lat: 45.7328418 },
    { lng: 21.2193029, lat: 45.7328655 },
    { lng: 21.2195676, lat: 45.7329068 },
    { lng: 21.2202896, lat: 45.7330283 },
    { lng: 21.221345, lat: 45.7332232 },
    { lng: 21.2220278, lat: 45.7333806 },
    { lng: 21.2221241, lat: 45.7334034 },
    { lng: 21.2227083, lat: 45.7335639 },
    { lng: 21.2234834, lat: 45.7338057 },
    { lng: 21.2240535, lat: 45.7340102 },
    { lng: 21.2252382, lat: 45.7344825 },
    { lng: 21.2252755, lat: 45.7344968 },
    { lng: 21.2253561, lat: 45.7345285 },
    { lng: 21.2260563, lat: 45.7347883 },
    { lng: 21.2265062, lat: 45.7349413 },
    { lng: 21.2265433, lat: 45.7349539 },
    { lng: 21.2266894, lat: 45.7350011 },
    { lng: 21.2267058, lat: 45.7350065 },
    { lng: 21.2267263, lat: 45.7350133 },
    { lng: 21.2267431, lat: 45.7350189 },
    { lng: 21.2267637, lat: 45.7350257 },
  ],
  [
    { lng: 21.2064095, lat: 45.7439477 },
    { lng: 21.2064943, lat: 45.7437982 },
    { lng: 21.2065133, lat: 45.7437646 },
    { lng: 21.206568, lat: 45.7436645 },
    { lng: 21.2065792, lat: 45.7436439 },
    { lng: 21.2065874, lat: 45.7436328 },
    { lng: 21.2066935, lat: 45.7434587 },
    { lng: 21.2067558, lat: 45.7433587 },
    { lng: 21.2068322, lat: 45.7432445 },
    { lng: 21.2074056, lat: 45.7424395 },
    { lng: 21.2074606, lat: 45.7423612 },
    { lng: 21.2075263, lat: 45.7422712 },
    { lng: 21.2075583, lat: 45.7422273 },
    { lng: 21.207597, lat: 45.7421742 },
    { lng: 21.2076302, lat: 45.7421287 },
    { lng: 21.2084665, lat: 45.7409601 },
    { lng: 21.2091394, lat: 45.7400197 },
    { lng: 21.2092081, lat: 45.7399237 },
    { lng: 21.2095323, lat: 45.7394792 },
    { lng: 21.2095949, lat: 45.7393991 },
    { lng: 21.2096278, lat: 45.7393448 },
    { lng: 21.2096306, lat: 45.7392958 },
    { lng: 21.2096179, lat: 45.7392514 },
  ],
  [
    { lng: 21.2098381, lat: 45.7393097 },
    { lng: 21.2096981, lat: 45.7394904 },
    { lng: 21.2096742, lat: 45.7395247 },
    { lng: 21.2093516, lat: 45.7399874 },
    { lng: 21.2093158, lat: 45.7400393 },
    { lng: 21.2092939, lat: 45.7400688 },
    { lng: 21.2092726, lat: 45.7400976 },
    { lng: 21.2086447, lat: 45.7410173 },
    { lng: 21.2078664, lat: 45.7421572 },
    { lng: 21.2078342, lat: 45.742201 },
    { lng: 21.2077614, lat: 45.7423023 },
    { lng: 21.2077443, lat: 45.7423265 },
    { lng: 21.2076715, lat: 45.7424296 },
    { lng: 21.2073067, lat: 45.7429453 },
    { lng: 21.2069928, lat: 45.7433889 },
    { lng: 21.2069672, lat: 45.7434252 },
    { lng: 21.2069011, lat: 45.7435249 },
  ],
  [
    { lng: 21.2164661, lat: 45.7565924 },
    { lng: 21.2147977, lat: 45.7567361 },
    { lng: 21.2137796, lat: 45.7568588 },
    { lng: 21.2136937, lat: 45.7568711 },
    { lng: 21.2135868, lat: 45.7568865 },
    { lng: 21.2135313, lat: 45.7568944 },
    { lng: 21.2129323, lat: 45.7569851 },
    { lng: 21.2119918, lat: 45.7571501 },
    { lng: 21.2115214, lat: 45.7572432 },
    { lng: 21.2100023, lat: 45.7576159 },
  ],
  [
    { lng: 21.2095417, lat: 45.7580881 },
    { lng: 21.2095874, lat: 45.7585839 },
    { lng: 21.2096057, lat: 45.7588899 },
    { lng: 21.2096455, lat: 45.7594329 },
    { lng: 21.2096727, lat: 45.7597835 },
    { lng: 21.209688, lat: 45.7599508 },
    { lng: 21.2097085, lat: 45.7601374 },
    { lng: 21.2097137, lat: 45.7601701 },
    { lng: 21.2097319, lat: 45.7602886 },
    { lng: 21.2097382, lat: 45.7603258 },
    { lng: 21.2097725, lat: 45.7605087 },
    { lng: 21.2098296, lat: 45.7607816 },
    { lng: 21.209873, lat: 45.7609431 },
    { lng: 21.2099238, lat: 45.761126 },
    { lng: 21.2099794, lat: 45.7612913 },
    { lng: 21.2100356, lat: 45.7614349 },
    { lng: 21.2101078, lat: 45.761592 },
    { lng: 21.2103938, lat: 45.7621516 },
  ],
];

const vehicleRoutes = [
  boulevardRepublicii,
  boulevardRepubliciiReverse,
  caleaAradului,
  caleaAraduluiReverse,
  caleaSagului,
  caleaSaguluiReverse,
  circumvalatiunii,
  circumvalatiuniiReverse,
  takeIonescu,
  takeIonescuReverse,
  rebreanu,
  rebreanuReverse,
];

const mapMatchedVehicleRoutes = [
  ...osmLoopVehicleRoutes,
  ...osmMatchedVehicleRoutes,
];
const activeVehicleRoutes =
  mapMatchedVehicleRoutes.length > 0 ? mapMatchedVehicleRoutes : vehicleRoutes;

const pedestrianRoutes = [
  pedestrianCrossing,
  pedestrianCrossingNorth,
  pedestrianCrossingSouth,
];

function createCars(count: number): Actor[] {
  return Array.from({ length: count }, (_, index) => {
    const route = activeVehicleRoutes[index % activeVehicleRoutes.length];
    const routeGroup = index % 8;
    return {
      id: `car-${String(index + 1).padStart(2, "0")}`,
      type: "car",
      label: `Car ${index + 1}`,
      route,
      speedMps: 8.8 + ((index * 7) % 18) / 2.7,
      routeOffsetSeconds:
        routeGroup * 4 + Math.floor(index / activeVehicleRoutes.length) * 11,
      lengthMeters: 4.8,
    };
  });
}

function createPedestrians(count: number): Actor[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `ped-${String(index + 1).padStart(2, "0")}`,
    type: "pedestrian",
    label: `Pedestrian ${index + 1}`,
    route: pedestrianRoutes[index % pedestrianRoutes.length],
    speedMps: 1.1 + (index % 4) * 0.15,
    routeOffsetSeconds: 5 + index * 7,
    lengthMeters: 0.8,
  }));
}

function createBuses(): Actor[] {
  return [
    {
      id: "bus-33",
      type: "bus",
      label: "Bus 33",
      route: activeVehicleRoutes[2] ?? caleaSagului,
      speedMps: 7,
      dwellSeconds: 16,
      routeOffsetSeconds: 8,
      lengthMeters: 12,
    },
    {
      id: "bus-40",
      type: "bus",
      label: "Bus 40",
      route: activeVehicleRoutes[7] ?? caleaAraduluiReverse,
      speedMps: 7.4,
      dwellSeconds: 14,
      routeOffsetSeconds: 31,
      lengthMeters: 12,
    },
    {
      id: "bus-e2",
      type: "bus",
      label: "Express E2",
      route: activeVehicleRoutes[12] ?? takeIonescu,
      speedMps: 8.2,
      dwellSeconds: 12,
      routeOffsetSeconds: 52,
      lengthMeters: 12,
    },
  ];
}

export const scenarios: Scenario[] = [
  {
    id: "TM-CITY-01",
    name: "Whole-city signal pressure",
    district: "Timișoara core",
    description:
      "A seeded city-center traffic model with commuter cars, bus priority, and pedestrian crossings around the main corridor mesh.",
    boundsLabel: "Whole-city Timișoara demo, focused on core corridors",
    center: timisoaraCenter,
    zoom: 13.15,
    durationSeconds: 520,
    actors: [...createCars(54), ...createBuses(), ...createPedestrians(18)],
    signals: importedSignalPrograms,
  },
];

export const datasets: DatasetEntry[] = [
  {
    id: "osm-road-context",
    name: "OSM road context",
    format: ["OSM", "GeoJSON", "Overpass"],
    description:
      "Road graph, lanes, intersections, crossings, and corridor context for Timișoara.",
    source: "https://www.openstreetmap.org",
    folder: "data/osm",
  },
  {
    id: "traffic-light-intervals",
    name: "Traffic-light intervals",
    format: ["JSON", "CSV"],
    description:
      "Future real signal programs used to compare live timing with model timing.",
    source: "Provided during hackathon",
    folder: "data/traffic-lights",
  },
  {
    id: "sumo-pipeline",
    name: "SUMO simulation artifacts",
    format: ["net.xml", "rou.xml", "fcd.xml"],
    description:
      "SUMO-compatible network, route, detector, and floating-car-data exports.",
    source: "Generated from OSM and scenarios",
    folder: "data/sumo",
  },
  {
    id: "timisoara-road-closures",
    name: "Timișoara road closures",
    format: ["JSON", "HTML", "GeoJSON"],
    description:
      "Official municipal closure notices mirrored locally for live overlay and planning views.",
    source: "Primăria Municipiului Timișoara",
    folder: "data/sources/timisoara-road-closures",
  },
  {
    id: "scenario-packs",
    name: "Scenario packs",
    format: ["JSON"],
    description:
      "Shared task definitions for browser-native, SUMO, and future SOTA model runs.",
    source: "OpenTrafficTM",
    folder: "data/scenarios",
  },
  {
    id: "traffic-validation",
    name: "Traffic validation assets",
    format: ["JSON"],
    description:
      "Licensed validation snapshots, derived metrics, and run manifests for private API traffic sources.",
    source: "OpenTrafficTM",
    folder: "data/traffic-validation",
  },
];

export const officialSources: OfficialSourceEntry[] = [
  {
    id: "timisoara-road-closures-notices",
    name: "Road closures and restrictions notices",
    organization: "Primăria Municipiului Timișoara",
    url: "https://www.primariatm.ro/dfmt/servicii-online",
    purpose:
      "Official notices about current and recent road closures, restrictions, and event-based blocks.",
    localFolder: "data/sources/timisoara-road-closures",
    note: "Used for the closure overlay and kept locally as mirrored notice text plus normalized JSON.",
  },
  {
    id: "stpt-live-vehicles",
    name: "Live STPT vehicle feed",
    organization: "Societatea de Transport Public Timișoara",
    url: "https://live.stpt.ro/",
    purpose:
      "Live public-transport vehicle positions and route context for corridor delay and probe movement.",
    localFolder: "data/sources/stpt-live",
    note: "Local snapshots are refreshed from the public vehicle feed; useful as a transit probe layer.",
  },
  {
    id: "timisoara-open-data-mobilitate",
    name: "Timișoara open mobility data",
    organization: "Municipiul Timișoara",
    url: "https://data.primariatm.ro/",
    purpose:
      "Public mobility and infrastructure datasets for city-level planning and validation.",
    localFolder: "data/sources/timisoara-open-data",
    note: "Annual and structured municipal mobility resources, stored locally in normalized form.",
  },
  {
    id: "timisoara-rss-services",
    name: "Municipal RSS/XML service entry",
    organization: "Primăria Municipiului Timișoara",
    url: "https://www.primariatm.ro/dfmt/servicii-online",
    purpose:
      "Entry point for official XML/RSS notices and related public-service updates.",
    localFolder: null,
    note: "Useful for discovering other municipal feeds and notice endpoints without scraping map products.",
  },
];

export const leaderboards: LeaderboardEntry[] = [
  {
    name: "TransitLens",
    track: "Agent",
    score: 97.4,
    scenarios: 12,
    schemaErrors: 0,
    summary:
      "Highest seeded score with tight calibration across core corridors.",
  },
  {
    name: "Browser Native IDM Baseline",
    track: "Browser Native",
    score: 89.6,
    scenarios: 4,
    schemaErrors: 0,
    summary:
      "Deterministic web baseline ready for traffic-light interval comparisons.",
  },
  {
    name: "SUMO Import Baseline",
    track: "SUMO",
    score: 0,
    scenarios: 0,
    schemaErrors: 0,
    summary:
      "Adapter placeholder for imported SUMO traces and signal programs.",
  },
];

export const technicalPapers = [
  {
    title:
      "Hybrid Solution Combining Kalman Filtering with Takagi-Sugeno Fuzzy Inference System for Online Car-Following Model Calibration",
    status: "Open access",
    summary:
      "Uses Timisoara traffic-monitoring data to calibrate car-following parameters against real movement.",
  },
  {
    title:
      "Ensemble based traffic light control for city zones using a reduced number of sensors",
    status: "Timisoara case study",
    summary:
      "Provides a Timisoara signal-control case study with a reduced sensor footprint and city-center simulations.",
  },
  {
    title: "Urban traffic congestion prediction based on routes information",
    status: "Timisoara case study",
    summary:
      "Uses a Timisoara sensor-network case study for congestion prediction on crowded intersections.",
  },
  {
    title:
      "A dataset of urban traffic flow for 13 Romanian cities amid lockdown and after ease of COVID19 related restrictions",
    status: "Open access",
    summary:
      "Includes Timisoara traffic-flow traces sampled at 15-minute intervals and suitable for short-term validation.",
  },
  {
    title:
      "Analysis of the problems related to traffic and road infrastructure in the area of the Timisoara student complex",
    status: "Open access",
    summary:
      "Summarizes local congestion and road-infrastructure issues in the student complex area.",
  },
  {
    title:
      "TACTICS: Adaptive Framework for Reactive Control of Road Traffic Systems",
    status: "Open access",
    summary:
      "Shows a Timisoara adaptive signal-control framework that reduces waiting times and queue lengths.",
  },
];
