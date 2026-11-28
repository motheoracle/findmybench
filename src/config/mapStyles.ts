import maplibregl, {
  type LayerSpecification,
  type SourceSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import mlcontour from 'maplibre-contour';
import type { MapLayerMode } from '../types';

/**
 * Map layer sources — ALL THREE MODES ARE FREE FOR EVERY USER. Never gate these behind the subscription.
 *
 * - Default   OpenFreeMap "Liberty" — keyless, actively maintained vector style built on OpenStreetMap data.
 *             Can also use a free-tier MapTiler or Mapbox style via .env if desired.
 * - Satellite Esri World Imagery (high-res global/UK aerial tiles, to z19) + hybrid vector roads,
 *             footpaths/tracks, and labels. Overridable via VITE_SATELLITE_TILES, VITE_MAPTILER_KEY,
 *             or VITE_MAPBOX_TOKEN.
 * - Terrain   OpenFreeMap Liberty base + Mapterhorn hillshade (Terrarium DEM) + browser-generated
 *             contour lines (maplibre-contour), with OpenTopoMap raster fallback.
 */
const env = import.meta.env;

const MAPTILER_KEY: string = (env.VITE_MAPTILER_KEY ?? '').trim();
const MAPBOX_TOKEN: string = (env.VITE_MAPBOX_TOKEN ?? '').trim();

const DEFAULT_VECTOR_STYLE = MAPTILER_KEY
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(MAPTILER_KEY)}`
  : MAPBOX_TOKEN
    ? `https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`
    : 'https://tiles.openfreemap.org/styles/liberty';

const DEFAULT_SATELLITE_TILES = MAPTILER_KEY
  ? `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${encodeURIComponent(MAPTILER_KEY)}`
  : MAPBOX_TOKEN
    ? `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg90?access_token=${encodeURIComponent(MAPBOX_TOKEN)}`
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const DEFAULT_SATELLITE_ATTRIBUTION = MAPTILER_KEY
  ? '<a href="https://www.maptiler.com/copyright/" target="_blank">© MapTiler</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a>'
  : MAPBOX_TOKEN
    ? '<a href="https://www.mapbox.com/about/maps/" target="_blank">© Mapbox</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">© OpenStreetMap</a>'
    : 'Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const VECTOR_STYLE_URL: string = env.VITE_MAP_STYLE_DEFAULT ?? DEFAULT_VECTOR_STYLE;
const SATELLITE_TILES: string = env.VITE_SATELLITE_TILES ?? DEFAULT_SATELLITE_TILES;
const SATELLITE_ATTRIBUTION: string = env.VITE_SATELLITE_ATTRIBUTION ?? DEFAULT_SATELLITE_ATTRIBUTION;
const SATELLITE_MAXZOOM = Number(env.VITE_SATELLITE_MAXZOOM ?? 19);
const DEM_TILES: string = env.VITE_DEM_TILES ?? 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp';
const DEM_TILE_SIZE = Number(env.VITE_DEM_TILE_SIZE ?? 512);
const DEM_MAXZOOM = Number(env.VITE_DEM_MAXZOOM ?? 12);
const DEM_ATTRIBUTION = '<a href="https://mapterhorn.com/attribution" target="_blank">© Mapterhorn</a>';
const TOPO_FALLBACK_TILES: string = env.VITE_TOPO_TILES ?? 'https://tile.opentopomap.org/{z}/{x}/{y}.png';

export const LABEL_FONT = ['Noto Sans Bold'];
const REGULAR_FONT = ['Noto Sans Regular'];

export const LAYER_MODES: { value: MapLayerMode; label: string; short: string }[] = [
  { value: 'default', label: 'Default', short: 'Map' },
  { value: 'satellite', label: 'Satellite', short: 'Sat' },
  { value: 'terrain', label: 'Terrain', short: 'Topo' },
];

/** Plain background used while loading and when tiles are unreachable. No glyphs → no remote fetches. */
export const OFFLINE_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e7e3d6' } }],
};

// ---------- vector base (cached) ----------
let vectorCache: Promise<StyleSpecification> | null = null;
function fetchVectorStyle(signal?: AbortSignal): Promise<StyleSpecification> {
  if (!vectorCache) {
    vectorCache = fetch(VECTOR_STYLE_URL, { signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Style HTTP ${r.status}`);
        return r.json() as Promise<StyleSpecification>;
      })
      .catch((e) => {
        vectorCache = null; // allow retry
        throw e;
      });
  }
  return vectorCache;
}
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ---------- contours (registered once) ----------
let demSource: InstanceType<typeof mlcontour.DemSource> | null = null;
function getDemSource() {
  if (!demSource) {
    demSource = new mlcontour.DemSource({
      url: DEM_TILES,
      encoding: 'terrarium',
      maxzoom: DEM_MAXZOOM,
      worker: true,
      cacheSize: 100,
      timeoutMs: 10_000,
    });
    demSource.setupMaplibre(maplibregl);
  }
  return demSource;
}

function terrainOverlay(): { sources: Record<string, SourceSpecification>; below: LayerSpecification[]; labels: LayerSpecification[] } {
  const dem = getDemSource();
  return {
    sources: {
      'fmb-dem': {
        type: 'raster-dem',
        // Shares the contour plugin's tile cache so each DEM tile downloads once.
        tiles: [dem.sharedDemProtocolUrl],
        tileSize: DEM_TILE_SIZE,
        maxzoom: DEM_MAXZOOM,
        encoding: 'terrarium',
        attribution: DEM_ATTRIBUTION,
      },
      'fmb-contours': {
        type: 'vector',
        tiles: [
          dem.contourProtocolUrl({
            thresholds: { 10: [100, 500], 11: [50, 250], 12: [20, 100], 13: [10, 50], 15: [5, 25] },
            elevationKey: 'ele',
            levelKey: 'level',
            contourLayer: 'contours',
            overzoom: 1,
          }),
        ],
        minzoom: 10,
        maxzoom: 16,
      },
    },
    below: [
      {
        id: 'fmb-hillshade',
        type: 'hillshade',
        source: 'fmb-dem',
        paint: {
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], 6, 0.45, 12, 0.32, 15, 0.22],
          'hillshade-shadow-color': '#4a4636',
          'hillshade-highlight-color': '#ffffff',
          'hillshade-accent-color': '#5d5a48',
        },
      },
      {
        id: 'fmb-contour-lines',
        type: 'line',
        source: 'fmb-contours',
        'source-layer': 'contours',
        paint: {
          'line-color': '#9a6b3c',
          'line-opacity': ['match', ['get', 'level'], 1, 0.55, 0.3],
          'line-width': ['match', ['get', 'level'], 1, 1.1, 0.55],
        },
      },
    ],
    labels: [
      {
        id: 'fmb-contour-labels',
        type: 'symbol',
        source: 'fmb-contours',
        'source-layer': 'contours',
        filter: ['>', ['get', 'level'], 0],
        layout: {
          'symbol-placement': 'line',
          'text-size': 10,
          'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' m'],
          'text-font': REGULAR_FONT,
          'text-max-angle': 30,
        },
        paint: { 'text-color': '#7a522b', 'text-halo-color': '#fbf8f1', 'text-halo-width': 1.2 },
      },
    ],
  };
}

// ---------- builders ----------
function buildTerrain(base: StyleSpecification): StyleSpecification {
  const s = clone(base);
  const o = terrainOverlay();
  Object.assign(s.sources, o.sources);
  // Hillshade + contours go above landcover/water but below roads; labels above roads, below place names.
  const firstRoad = s.layers.findIndex((l) => /^(tunnel|road|highway|bridge)/.test(l.id));
  s.layers.splice(firstRoad < 0 ? s.layers.length : firstRoad, 0, ...o.below);
  const firstSymbol = s.layers.findIndex((l) => l.type === 'symbol');
  s.layers.splice(firstSymbol < 0 ? s.layers.length : firstSymbol, 0, ...o.labels);
  // Soften patterned fills (heath/wetland tufts) so contours and hillshade read clearly.
  for (const l of s.layers) {
    if (l.type === 'fill' && l.paint && 'fill-pattern' in l.paint) {
      (l.paint as Record<string, unknown>)['fill-opacity'] = 0.35;
    }
  }
  return s;
}

const HYBRID_LABEL = /^(label_|water_name|waterway_line_label|highway-name|highway-shield-non-us)/;

function buildSatellite(base: StyleSpecification | null): StyleSpecification {
  const sources: Record<string, SourceSpecification> = {
    satellite: {
      type: 'raster',
      tiles: [SATELLITE_TILES],
      tileSize: 256,
      maxzoom: SATELLITE_MAXZOOM,
      attribution: SATELLITE_ATTRIBUTION,
    },
  };
  const layers: LayerSpecification[] = [
    { id: 'bg', type: 'background', paint: { 'background-color': '#1b2419' } },
    { id: 'satellite', type: 'raster', source: 'satellite', paint: { 'raster-contrast': 0.06, 'raster-saturation': 0.05 } },
  ];
  if (!base) return { version: 8, sources, layers };

  const vectorSourceId = Object.keys(base.sources).find((k) => base.sources[k].type === 'vector') ?? 'openmaptiles';
  sources[vectorSourceId] = clone(base.sources[vectorSourceId]);
  layers.push(
    {
      id: 'hybrid-roads',
      type: 'line',
      source: vectorSourceId,
      'source-layer': 'transportation',
      minzoom: 11,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'], true, false],
      paint: {
        'line-color': '#ffe7a8',
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.25, 16, 0.5],
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 18, 3],
      },
    },
    {
      // Footpaths & tracks — the most useful overlay for finding off-trail benches.
      id: 'hybrid-paths',
      type: 'line',
      source: vectorSourceId,
      'source-layer': 'transportation',
      minzoom: 13,
      filter: ['match', ['get', 'class'], ['path', 'track'], true, false],
      paint: {
        'line-color': '#ffffff',
        'line-opacity': 0.75,
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.8, 18, 2.2],
        'line-dasharray': [2, 1.5],
      },
    },
  );
  for (const l of base.layers) {
    if (l.type !== 'symbol' || !HYBRID_LABEL.test(l.id)) continue;
    const layer = clone(l);
    layer.paint = {
      ...(layer.paint ?? {}),
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.78)',
      'text-halo-width': 1.4,
    };
    layers.push(layer);
  }
  return { version: 8, glyphs: base.glyphs, sprite: base.sprite, sources, layers };
}

function buildTerrainRasterFallback(): StyleSpecification {
  return {
    version: 8,
    sources: {
      topo: {
        type: 'raster',
        tiles: [TOPO_FALLBACK_TILES],
        tileSize: 256,
        maxzoom: 17,
        attribution: 'Map data © OpenStreetMap contributors, SRTM | Style © OpenTopoMap (CC-BY-SA)',
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#f2efe6' } },
      { id: 'topo', type: 'raster', source: 'topo' },
    ],
  };
}

/**
 * Resolve the full style for a mode. Throws only when nothing usable can be built
 * (MapView then shows the offline background).
 */
function sanitizeCoastlineLayers(style: StyleSpecification): StyleSpecification {
  if (!Array.isArray(style.layers)) return style;
  for (const layer of style.layers) {
    const id = (layer.id || '').toLowerCase();
    const srcLayer = String((layer as { 'source-layer'?: string })['source-layer'] || '').toLowerCase();
    const isSandOrForeshore =
      id.includes('sand') ||
      id.includes('beach') ||
      id.includes('foreshore') ||
      id.includes('intertidal') ||
      id.includes('mud') ||
      id.includes('wetland') ||
      srcLayer.includes('sand') ||
      srcLayer.includes('foreshore') ||
      srcLayer.includes('intertidal');
    if (isSandOrForeshore && layer.type === 'fill') {
      layer.paint = {
        ...(layer.paint || {}),
        'fill-color': '#d8e3d2',
        'fill-opacity': 0.25,
      };
    }
  }
  return style;
}

export async function resolveStyle(mode: MapLayerMode, signal?: AbortSignal): Promise<StyleSpecification> {
  let base: StyleSpecification | null = null;
  try {
    base = sanitizeCoastlineLayers(await fetchVectorStyle(signal));
  } catch (e) {
    if (mode === 'default') throw e;
  }
  if (mode === 'satellite') return buildSatellite(base);
  if (mode === 'terrain') return base ? buildTerrain(base) : buildTerrainRasterFallback();
  return clone(base!);
}