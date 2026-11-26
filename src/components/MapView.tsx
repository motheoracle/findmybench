import { useEffect, useRef, useState } from 'react';
import maplibregl, {
  type ExpressionSpecification,
  type GeoJSONSource,
  type Map as MLMap,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FeatureCollection, Point } from 'geojson';
import type { LngLat, MapLayerMode, ViewBench } from '../types';
import { ACTIVE_REGION } from '../config/regions';
import { LABEL_FONT, OFFLINE_STYLE, resolveStyle } from '../config/mapStyles';

export type MapStatus = 'loading' | 'ok' | 'offline' | 'degraded';
export interface FlyTarget extends LngLat {
  zoom?: number;
  key: number;
}

interface Props {
  benches: ViewBench[];
  selectedId: string | null;
  layerMode: MapLayerMode;
  styleNonce: number;
  pickMode: boolean;
  draft: LngLat | null;
  flyTarget: FlyTarget | null;
  isMobile: boolean;
  onSelect(id: string): void;
  onPick(p: LngLat): void;
  onDraftMove(p: LngLat): void;
  onStatus(s: MapStatus): void;
}

const SRC = 'benches';
const COLORS = {
  standard: '#2f7d4f',
  obscure: '#6b4fbf',
  locked: '#8a8f98',
  cluster: '#1f3d2b',
  cream: '#f3ead8',
  amber: '#e0a43a',
};

function toGeoJSON(benches: ViewBench[]): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: benches.map((v) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.displayLng, v.displayLat] },
      properties: {
        id: v.bench.id,
        name: v.bench.name,
        state: v.locked ? 'locked' : v.bench.tier,
      },
    })),
  };
}

const selectedFilter = (id: string | null): ExpressionSpecification => [
  'all',
  ['!', ['has', 'point_count']],
  ['==', ['get', 'id'], id ?? '__none__'],
];

export default function MapView(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const draftMarkerRef = useRef<maplibregl.Marker | null>(null);
  const latest = useRef(props);
  latest.current = props;

  /** True when the style being applied/applied is a real tiled style (not the offline background). */
  const pendingRealRef = useRef(false);
  const realLoadedRef = useRef(false);
  const offlineRef = useRef(false);
  const loadSeqRef = useRef(0);
  const tileErrorsRef = useRef(0);
  const [styleRev, setStyleRev] = useState(0);

  // ---------- helpers ----------
  const addBenchLayers = (map: MLMap) => {
    if (map.getSource(SRC)) return;
    const hasGlyphs = !!map.getStyle()?.glyphs;

    map.addSource(SRC, {
      type: 'geojson',
      data: toGeoJSON(latest.current.benches),
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 12,
    });

    // Approximate-area halo for locked (obscure) benches — shows *where-ish*, not *where*.
    map.addLayer({
      id: 'bench-locked-area',
      type: 'circle',
      source: SRC,
      minzoom: 8,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'state'], 'locked']],
      paint: {
        // ≈1.5 km radius in screen pixels at UK latitudes
        'circle-radius': ['interpolate', ['exponential', 2], ['zoom'], 8, 4, 16, 1050],
        'circle-color': COLORS.obscure,
        'circle-opacity': 0.08,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': COLORS.obscure,
        'circle-stroke-opacity': 0.35,
      },
    });

    map.addLayer({
      id: 'bench-clusters',
      type: 'circle',
      source: SRC,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': COLORS.cluster,
        'circle-opacity': 0.92,
        'circle-radius': ['step', ['get', 'point_count'], 16, 5, 20, 15, 26],
        'circle-stroke-width': 3,
        'circle-stroke-color': COLORS.cream,
      },
    });

    if (hasGlyphs) {
      map.addLayer({
        id: 'bench-cluster-count',
        type: 'symbol',
        source: SRC,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-font': LABEL_FONT,
          'text-size': 13,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': COLORS.cream },
      });
    }

    map.addLayer({
      id: 'bench-selected',
      type: 'circle',
      source: SRC,
      filter: selectedFilter(latest.current.selectedId),
      paint: {
        'circle-radius': 19,
        'circle-color': COLORS.amber,
        'circle-opacity': 0.3,
        'circle-stroke-width': 2,
        'circle-stroke-color': COLORS.amber,
      },
    });

    map.addLayer({
      id: 'bench-points',
      type: 'circle',
      source: SRC,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 6.5, 12, 9, 16, 11],
        'circle-color': [
          'match', ['get', 'state'],
          'standard', COLORS.standard,
          'obscure', COLORS.obscure,
          'locked', COLORS.locked,
          COLORS.standard,
        ],
        'circle-stroke-width': 2.5,
        'circle-stroke-color': ['match', ['get', 'state'], 'locked', '#3b3f46', '#ffffff'],
      },
    });

    // Centre "keyhole" dot marks locked pins at a glance.
    map.addLayer({
      id: 'bench-lock-dot',
      type: 'circle',
      source: SRC,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'state'], 'locked']],
      paint: { 'circle-radius': 2.6, 'circle-color': '#2b2e33' },
    });
  };

  /** Fetch + apply the style for `mode`. Bench layers are re-added on every `style.load`. */
  const loadStyle = async (map: MLMap, mode: MapLayerMode) => {
    const seq = ++loadSeqRef.current;
    realLoadedRef.current = false;
    tileErrorsRef.current = 0;
    latest.current.onStatus('loading');
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 10_000);
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('offline');
      const style = await resolveStyle(mode, ctrl.signal);
      if (seq !== loadSeqRef.current || mapRef.current !== map) return; // superseded
      pendingRealRef.current = true;
      offlineRef.current = false;
      map.setStyle(style, { diff: false });
    } catch {
      if (seq !== loadSeqRef.current || mapRef.current !== map) return;
      pendingRealRef.current = false;
      offlineRef.current = true;
      map.setStyle(OFFLINE_STYLE, { diff: false });
      latest.current.onStatus('offline');
    } finally {
      window.clearTimeout(timer);
    }
  };

  // ---------- init (once) ----------
  useEffect(() => {
    if (!containerRef.current) return;
    const [[w, s], [e, n]] = ACTIVE_REGION.bounds;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OFFLINE_STYLE, // plain background until the real style resolves (pins show immediately)
      center: ACTIVE_REGION.center,
      zoom: ACTIVE_REGION.zoom,
      minZoom: ACTIVE_REGION.minZoom,
      maxZoom: 20, // satellite imagery to z19 + 1 overzoom for precise pin placement
      maxBounds: [
        [w - 6, s - 4],
        [e + 6, n + 4],
      ],
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __fmbMap?: MLMap }).__fmbMap = map; // test/debug hook (dev only)
    map.touchZoomRotate.disableRotation();

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(
      new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        fitBoundsOptions: { maxZoom: 14 },
      }),
      'top-right',
    );

    map.on('style.load', () => {
      addBenchLayers(map);
      setStyleRev((r) => r + 1);
      if (pendingRealRef.current) {
        pendingRealRef.current = false;
        realLoadedRef.current = true;
        latest.current.onStatus('ok');
      }
    });

    map.on('error', (ev) => {
      // Tile errors after load (e.g. a provider rate-limits) → flag degraded, keep app usable.
      const sourceId = (ev as unknown as { sourceId?: string }).sourceId;
      if (sourceId && sourceId !== SRC && realLoadedRef.current) {
        tileErrorsRef.current += 1;
        if (tileErrorsRef.current === 8) latest.current.onStatus('degraded');
      }
    });

    void loadStyle(map, latest.current.layerMode);

    // Interactions (layer-delegated listeners survive setStyle)
    map.on('click', 'bench-clusters', async (ev: MapLayerMouseEvent) => {
      if (latest.current.pickMode) return;
      const f = ev.features?.[0];
      if (!f) return;
      const src = map.getSource(SRC) as GeoJSONSource;
      const zoom = await src.getClusterExpansionZoom(f.properties?.cluster_id as number);
      map.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom: zoom + 0.3 });
    });
    map.on('click', 'bench-points', (ev: MapLayerMouseEvent) => {
      if (latest.current.pickMode) return;
      const id = ev.features?.[0]?.properties?.id as string | undefined;
      if (id) latest.current.onSelect(id);
    });
    map.on('click', (ev) => {
      if (!latest.current.pickMode) return;
      latest.current.onPick({ lng: ev.lngLat.lng, lat: ev.lngLat.lat });
    });
    for (const layer of ['bench-clusters', 'bench-points']) {
      map.on('mouseenter', layer, () => {
        if (!latest.current.pickMode) map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', layer, () => {
        map.getCanvas().style.cursor = latest.current.pickMode ? 'crosshair' : '';
      });
    }

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);

    const onOnline = () => {
      if (offlineRef.current) void loadStyle(map, latest.current.layerMode);
    };
    window.addEventListener('online', onOnline);

    return () => {
      window.removeEventListener('online', onOnline);
      loadSeqRef.current++;
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- layer mode / retry ----------
  const firstStyleRun = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (firstStyleRun.current) {
      firstStyleRun.current = false;
      return;
    }
    void loadStyle(map, props.layerMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.layerMode, props.styleNonce]);

  // ---------- data ----------
  useEffect(() => {
    const src = mapRef.current?.getSource(SRC) as GeoJSONSource | undefined;
    src?.setData(toGeoJSON(props.benches));
  }, [props.benches, styleRev]);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer('bench-selected')) map.setFilter('bench-selected', selectedFilter(props.selectedId));
  }, [props.selectedId, styleRev]);

  // ---------- fly ----------
  useEffect(() => {
    const map = mapRef.current;
    const t = props.flyTarget;
    if (!map || !t) return;
    map.flyTo({
      center: [t.lng, t.lat],
      zoom: Math.max(map.getZoom(), t.zoom ?? 13),
      padding: props.isMobile ? { top: 40, bottom: Math.round(window.innerHeight * 0.45), left: 0, right: 0 } : 40,
      speed: 1.4,
      essential: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.flyTarget?.key]);

  // ---------- pick mode cursor ----------
  useEffect(() => {
    const map = mapRef.current;
    if (map) map.getCanvas().style.cursor = props.pickMode ? 'crosshair' : '';
  }, [props.pickMode]);

  // ---------- draft pin ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.draft) {
      draftMarkerRef.current?.remove();
      draftMarkerRef.current = null;
      return;
    }
    if (!draftMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'draft-pin';
      el.innerHTML = '<span></span>';
      const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'bottom' })
        .setLngLat([props.draft.lng, props.draft.lat])
        .addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        latest.current.onDraftMove({ lng: p.lng, lat: p.lat });
      });
      draftMarkerRef.current = marker;
    } else {
      draftMarkerRef.current.setLngLat([props.draft.lng, props.draft.lat]);
    }
  }, [props.draft]);

  return <div ref={containerRef} className="map-canvas" aria-label="Map of benches" />;
}
