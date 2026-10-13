/** Foxhole map catalogue, reviewed against the War API icon schema (Update 63). */
export const WAR_DATA_VERSION = '2026.10';
export const WAR_ZONES = {
  "west_islands": [
    "OlavisWakeHex",
    "PariPeakHex",
    "PalantineBermHex",
    "OarbreakerHex",
    "KuuraStrandHex",
    "GutterHex",
    "FishermansRowHex",
    "StemaLandingHex"
  ],
  "west_coast": [
    "NevishLineHex",
    "FarranacCoastHex",
    "WestgateHex",
    "OriginHex",
    "CallumsCapeHex",
    "StonecradleHex",
    "KingsCageHex",
    "SableportHex",
    "AshFieldsHex"
  ],
  "center": [
    "SpeakingWoodsHex",
    "MooringCountyHex",
    "LinnMercyHex",
    "LochMorHex",
    "UmbralWildwoodHex",
    "HeartlandsHex",
    "RedRiverHex",
    "BasinSionnachHex",
    "ReachingTrailHex",
    "CallahansPassageHex",
    "DeadLandsHex",
    "GreatMarchHex",
    "KalokaiHex",
    "HowlCountyHex",
    "ViperPitHex",
    "MarbanHollow",
    "DrownedValeHex",
    "ShackledChasmHex",
    "AcrithiaHex"
  ],
  "east_coast": [
    "ClansheadValleyHex",
    "WeatheredExpanseHex",
    "ClahstraHex",
    "AllodsBightHex",
    "TerminusHex",
    "MorgensCrossingHex",
    "StlicanShelfHex",
    "EndlessShoreHex",
    "ReaversPassHex"
  ],
  "east_islands": [
    "GodcroftsHex",
    "TempestIslandHex",
    "WrestaHex",
    "LykosIsleHex",
    "TheFingersHex",
    "TyrantFoothillsHex",
    "PipersEnclaveHex",
    "OnyxHex"
  ]
} as const;
export type WarZone = keyof typeof WAR_ZONES;
export const WAR_ZONE_KEYS = Object.keys(WAR_ZONES) as WarZone[];
export const WAR_REGION_NAMES: Readonly<Record<string, string>> = {
  "OlavisWakeHex": "Olavi's Wake",
  "PariPeakHex": "Pari Peak",
  "PalantineBermHex": "Palantine Berm",
  "OarbreakerHex": "Oarbreaker Isles",
  "KuuraStrandHex": "Kuura Strand",
  "GutterHex": "The Gutter",
  "FishermansRowHex": "Fisherman's Row",
  "StemaLandingHex": "Stema Landing",
  "NevishLineHex": "Nevish Line",
  "FarranacCoastHex": "Farranac Coast",
  "WestgateHex": "Westgate",
  "OriginHex": "Origin",
  "CallumsCapeHex": "Callum's Cape",
  "StonecradleHex": "Stonecradle",
  "KingsCageHex": "King's Cage",
  "SableportHex": "Sableport",
  "AshFieldsHex": "Ash Fields",
  "SpeakingWoodsHex": "Speaking Woods",
  "MooringCountyHex": "The Moors",
  "LinnMercyHex": "The Linn of Mercy",
  "LochMorHex": "Loch Mór",
  "UmbralWildwoodHex": "Umbral Wildwood",
  "HeartlandsHex": "The Heartlands",
  "RedRiverHex": "Red River",
  "BasinSionnachHex": "Basin Sionnach",
  "ReachingTrailHex": "Reaching Trail",
  "CallahansPassageHex": "Callahan's Passage",
  "DeadLandsHex": "Deadlands",
  "GreatMarchHex": "Great March",
  "KalokaiHex": "Kalokai",
  "HowlCountyHex": "Howl County",
  "ViperPitHex": "Viper Pit",
  "MarbanHollow": "Marban Hollow",
  "DrownedValeHex": "The Drowned Vale",
  "ShackledChasmHex": "Shackled Chasm",
  "AcrithiaHex": "Acrithia",
  "ClansheadValleyHex": "Clanshead Valley",
  "WeatheredExpanseHex": "Weathered Expanse",
  "ClahstraHex": "The Clahstra",
  "AllodsBightHex": "Allod's Bight",
  "TerminusHex": "Terminus",
  "MorgensCrossingHex": "Morgen's Crossing",
  "StlicanShelfHex": "Stlican Shelf",
  "EndlessShoreHex": "Endless Shore",
  "ReaversPassHex": "Reaver's Pass",
  "GodcroftsHex": "Godcrofts",
  "TempestIslandHex": "Tempest Island",
  "WrestaHex": "Wresta",
  "LykosIsleHex": "Lykos Isle",
  "TheFingersHex": "The Fingers",
  "TyrantFoothillsHex": "Tyrant Foothills",
  "PipersEnclaveHex": "Piper's Enclave",
  "OnyxHex": "Onyx"
};
export function warZoneOf(region: string): WarZone | undefined { return WAR_ZONE_KEYS.find(zone => (WAR_ZONES[zone] as readonly string[]).includes(region)); }
export function validWarZones(zones: readonly string[]): zones is readonly WarZone[] { return zones.length >= 1 && zones.length <= 3 && new Set(zones).size === zones.length && zones.every(zone => WAR_ZONE_KEYS.includes(zone as WarZone)); }
export const WAR_STRUCTURES = {
  "1A": {
    "name": "Victory Point",
    "tracked": true,
    "concreteHours": 0
  },
  "1B": {
    "name": "Town Base",
    "tracked": true,
    "concreteHours": 0
  },
  "1C": {
    "name": "Relic Base",
    "tracked": true,
    "concreteHours": 0
  },
  "2A": {
    "name": "Safehouse",
    "tracked": true,
    "concreteHours": 0
  },
  "3A": {
    "name": "Storm Cannon",
    "tracked": true,
    "concreteHours": 48
  },
  "3B": {
    "name": "Intelligence Center",
    "tracked": true,
    "concreteHours": 24
  },
  "3C": {
    "name": "Weather Station",
    "tracked": true,
    "concreteHours": 24
  },
  "4A": {
    "name": "Launch Site",
    "tracked": true,
    "concreteHours": 0
  },
  "4B": {
    "name": "Rocket Target",
    "tracked": true,
    "concreteHours": 0
  },
  "5A": {
    "name": "Keep",
    "tracked": true,
    "concreteHours": 0
  },
  "5B": {
    "name": "Hospital",
    "tracked": false,
    "concreteHours": 0
  },
  "5C": {
    "name": "Engineering Center",
    "tracked": false,
    "concreteHours": 0
  },
  "5D": {
    "name": "Construction Yard",
    "tracked": false,
    "concreteHours": 0
  },
  "5E": {
    "name": "Garage",
    "tracked": true,
    "concreteHours": 0
  },
  "5F": {
    "name": "Factory",
    "tracked": true,
    "concreteHours": 0
  },
  "5G": {
    "name": "Refinery",
    "tracked": true,
    "concreteHours": 0
  },
  "5H": {
    "name": "Mass Production Factory",
    "tracked": true,
    "concreteHours": 0
  },
  "5I": {
    "name": "Storage Depot",
    "tracked": true,
    "concreteHours": 0
  },
  "5J": {
    "name": "Seaport",
    "tracked": true,
    "concreteHours": 0
  },
  "5K": {
    "name": "Mortar House",
    "tracked": true,
    "concreteHours": 0
  },
  "5L": {
    "name": "Coastal Gun",
    "tracked": true,
    "concreteHours": 0
  },
  "5M": {
    "name": "Shipyard",
    "tracked": false,
    "concreteHours": 0
  },
  "5N": {
    "name": "Offshore Platform",
    "tracked": false,
    "concreteHours": 0
  },
  "5O": {
    "name": "Observation Tower",
    "tracked": true,
    "concreteHours": 0
  }
} as const;
export type StructureCode = keyof typeof WAR_STRUCTURES;
export const WAR_ICONS: Readonly<Record<number, StructureCode>> = {
  "27": "5A",
  "11": "5B",
  "19": "5C",
  "39": "5D",
  "12": "5E",
  "34": "5F",
  "17": "5G",
  "51": "5H",
  "33": "5I",
  "52": "5J",
  "84": "5K",
  "53": "5L",
  "18": "5M",
  "75": "5N",
  "28": "5O",
  "45": "1C",
  "56": "1B",
  "57": "1B",
  "58": "1B",
  "35": "2A",
  "59": "3A",
  "60": "3B",
  "83": "3C",
  "37": "4A",
  "72": "4A",
  "70": "4B",
  "71": "4B"
};
export const KNOWN_UNTRACKED_ICONS: readonly number[] = [20, 61, 62, 23, 21, 38, 32, 40, 88, 89, 90, 91, 92];
