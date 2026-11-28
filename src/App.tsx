import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MapView, { type FlyTarget, type MapStatus } from './components/MapView';
import LayerSwitcher from './components/LayerSwitcher';
import BrowseView, { type TierFilter } from './components/BrowseView';
import BenchDetail from './components/BenchDetail';
import SubmitBenchForm, { type SubmitPayload } from './components/SubmitBenchForm';
import ReviewsSection from './components/ReviewsSection';
import MyListingsView, { type ListingStats } from './components/MyListingsView';
import AuthModal from './components/AuthModal';
const CheckoutModal = lazy(() => import('./components/CheckoutModal'));
import AccountSettingsModal from './components/AccountSettingsModal';
import ContributePhotoModal, { type ContributionPayload } from './components/ContributePhotoModal';
import PhotoLightbox from './components/PhotoLightbox';
const ModerationModal = lazy(() => import('./components/ModerationModal'));
const DevPanel = lazy(() => import('./components/DevPanel'));
import BottomSheet, { type SheetState } from './components/BottomSheet';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useExplorerEntitlement } from './hooks/useExplorerEntitlement';
import { benchService, DuplicateBenchError } from './lib/benchService';
import { entitlements, DEV_TOOLS_ENABLED } from './services/entitlements';
import { reviewRepo } from './services/reviewRepository';
import { galleryRepo } from './services/galleryRepository';
import { SAMPLE_BENCHES } from './data/sampleBenches';
import { pickSessionSplashMessages } from './data/splashMessages';
import { ACTIVE_COUNTRY, ACTIVE_REGION, isInsideRegion } from './config/regions';
import { MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH } from './config/community';
import { isPaidTier, tierForDifficulty } from './config/taxonomy';
import { canUpdateMainPhoto, isOwner, formatDistance, toViewBench } from './utils/geo';
import { fetchWalkingRoute, haversineMeters } from './utils/routing';
import { readJSON, writeJSON } from './utils/storage';
import type {
  Bench,
  DraftLocation,
  GalleryPhoto,
  LngLat,
  MapLayerMode,
  PublicAuthor,
  Rating,
  ReportReason,
  Review,
  ThemeMode,
  User,
  UserPreferences,
} from './types';

const EXPLORER_PAYMENT_LINK = 'https://buy.stripe.com/cNi5kFgHq11De5N3F51wY00';
const REROUTE_DISTANCE_THRESHOLD_M = 8;
const ARRIVAL_DISTANCE_THRESHOLD_M = 15;
const HEADING_DEADBAND_DEG = 2.5;
const HEADING_SMOOTH_ALPHA = 0.16;

// Total = 8000ms: two 1.0s beats, one 1.5s beat, two 0.7s beats, 1.1s beat, final 2.0s beat
const SPLASH_DURATIONS_MS = [1000, 1000, 1500, 700, 700, 1100, 2000] as const;
const SPLASH_TOTAL_MS = SPLASH_DURATIONS_MS.reduce((sum, ms) => sum + ms, 0);

type PanelView =
  | { kind: 'browse' }
  | { kind: 'detail'; id: string; from?: 'browse' | 'mine' }
  | { kind: 'submit' }
  | { kind: 'edit'; id: string }
  | { kind: 'mine' };

type ModalState =
  | null
  | { kind: 'auth'; reason: string; then?: () => void }
  | { kind: 'checkout'; checkoutUrl?: string | null }
  | { kind: 'settings' }
  | { kind: 'contribute'; benchId: string }
  | { kind: 'photo'; photoId: string }
  | { kind: 'moderation' };

type RouteTarget = {
  id: string;
  name: string;
  lng: number;
  lat: number;
};

interface RouteMetrics {
  distanceMeters: number;
  durationSeconds: number;
}

type PermissionCapableOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function toPublicAuthor(u: User): PublicAuthor {
  return {
    id: u.id,
    name: u.prefs.creditAnonymously ? 'Anonymous bench hunter' : u.name,
  };
}

function getBenchIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return params.get('bench');
}

function setBenchIdInUrl(id: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (id) {
    url.searchParams.set('bench', id);
  } else {
    url.searchParams.delete('bench');
  }
  window.history.replaceState({}, '', url.toString());
}

function formatWalkEta(durationSeconds: number): string {
  const mins = Math.max(1, Math.round(durationSeconds / 60));
  return mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `~${mins} min`;
}

function normalizeHeading(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function shortestAngleDeltaDeg(fromDeg: number, toDeg: number): number {
  return ((normalizeHeading(toDeg) - normalizeHeading(fromDeg) + 540) % 360) - 180;
}

export default function App() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isMobile = !isDesktop;

  // ---- startup loading screen state (8s total with custom beat pacing) ----
  const [splashMessages] = useState<string[]>(() => pickSessionSplashMessages(SPLASH_DURATIONS_MS.length));
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashElapsedMs, setSplashElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const elapsed = now - startedAt;
      if (elapsed >= SPLASH_TOTAL_MS) {
        setSplashElapsedMs(SPLASH_TOTAL_MS);
        setSplashVisible(false);
        return;
      }
      setSplashElapsedMs(elapsed);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, []);

  const splashProgress = Math.min(100, (splashElapsedMs / SPLASH_TOTAL_MS) * 100);

  const splashMessage = useMemo(() => {
    let cursor = 0;
    for (let i = 0; i < SPLASH_DURATIONS_MS.length; i++) {
      cursor += SPLASH_DURATIONS_MS[i];
      if (splashElapsedMs < cursor) {
        return splashMessages[i] ?? splashMessages[0];
      }
    }
    return splashMessages[splashMessages.length - 1] ?? '';
  }, [splashElapsedMs, splashMessages]);

  // ---- app state ----
  const [user, setUser] = useState<User | null>(null);
  const {
    isExplorer,
    checkoutUrl: hookCheckoutUrl,
    refresh: refreshEntitlement,
  } = useExplorerEntitlement();
  const [devUnlocked, setDevUnlocked] = useState(false);
  const subscribed = Boolean(user && (isExplorer || (DEV_TOOLS_ENABLED && devUnlocked)));

  const [benches, setBenches] = useState<Bench[]>(() =>
    SAMPLE_BENCHES.filter((b) => b.country_code === ACTIVE_COUNTRY),
  );
  const [selectedReviews, setSelectedReviews] = useState<Review[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<GalleryPhoto[]>([]);
  const [flaggedPhotos, setFlaggedPhotos] = useState<GalleryPhoto[]>([]);
  const [flaggedReviews, setFlaggedReviews] = useState<Review[]>([]);
  const [dataRev, setDataRev] = useState(0);
  const [layerMode, setLayerMode] = useState<MapLayerMode>(
    () => readJSON<MapLayerMode>('layer', 'default'),
  );
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    () => readJSON<ThemeMode>('theme', 'light'),
  );
  const [styleNonce, setStyleNonce] = useState(0);
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading');
  const [view, setView] = useState<PanelView>({ kind: 'browse' });
  const [filter, setFilter] = useState<TierFilter>('all');
  const [pickMode, setPickMode] = useState(false);
  const [draft, setDraft] = useState<DraftLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [routeTarget, setRouteTarget] = useState<RouteTarget | null>(null);
  const [routeOrigin, setRouteOrigin] = useState<LngLat | null>(null);
  const [routeCoords, setRouteCoords] = useState<[number, number][] | null>(null);
  const [routeMetrics, setRouteMetrics] = useState<RouteMetrics | null>(null);
  const [userLocation, setUserLocation] = useState<LngLat | null>(null);
  const [userHeadingDeg, setUserHeadingDeg] = useState<number | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [sheet, setSheet] = useState<SheetState>('half');
  const [toast, setToast] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);
  const routeAbortRef = useRef<AbortController | null>(null);
  const lastRoutedOriginRef = useRef<LngLat | null>(null);
  const hasCompassHeadingRef = useRef(false);
  const smoothedHeadingRef = useRef<number | null>(null);
  const appliedUrlBenchRef = useRef<string | null>(null);
  const hasInitializedUrlSync = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
  }, []);

  const clearRoute = useCallback(() => {
    routeAbortRef.current?.abort();
    routeAbortRef.current = null;
    lastRoutedOriginRef.current = null;
    setRouteTarget(null);
    setRouteOrigin(null);
    setRouteCoords(null);
    setRouteMetrics(null);
  }, []);

  const requestCompassPermissionIfNeeded = useCallback(async () => {
    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') return;
    const ctor = DeviceOrientationEvent as PermissionCapableOrientationEvent;
    if (typeof ctor.requestPermission === 'function') {
      try {
        await ctor.requestPermission();
      } catch {
        // Permission denied or dismissed; movement heading fallback still works
      }
    }
  }, []);

  const updateSmoothedHeading = useCallback((rawDeg: number) => {
    const target = normalizeHeading(rawDeg);
    const current = smoothedHeadingRef.current;
    if (current === null) {
      smoothedHeadingRef.current = target;
      setUserHeadingDeg(target);
      return;
    }
    const delta = shortestAngleDeltaDeg(current, target);
    if (Math.abs(delta) < HEADING_DEADBAND_DEG) return;
    const next = normalizeHeading(current + delta * HEADING_SMOOTH_ALPHA);
    smoothedHeadingRef.current = next;
    setUserHeadingDeg(next);
  }, []);

  const refreshBenches = useCallback(async () => {
    try {
      const list = await benchService.listBenches(ACTIVE_COUNTRY, true);
      setBenches(list);
    } catch (err) {
      showToast(errMsg(err));
    }
    setDataRev((r) => r + 1);
  }, [showToast]);

  const refreshFlaggedQueue = useCallback(async () => {
    if (!DEV_TOOLS_ENABLED) {
      setFlaggedPhotos([]);
      setFlaggedReviews([]);
      return;
    }
    try {
      const [remotePhotos, remoteReviews] = await Promise.all([
        benchService.listFlaggedPhotos(),
        benchService.listFlaggedReviews(),
      ]);

      const localPhotos = galleryRepo.listForModeration();
      const mergedPhotos = new Map<string, GalleryPhoto>();
      for (const p of localPhotos) mergedPhotos.set(p.id, p);
      for (const p of remotePhotos) mergedPhotos.set(p.id, p);
      setFlaggedPhotos([...mergedPhotos.values()]);

      const localReviews = reviewRepo.listForModeration();
      const mergedReviews = new Map<string, Review>();
      for (const r of localReviews) mergedReviews.set(r.id, r);
      for (const r of remoteReviews) mergedReviews.set(r.id, r);
      setFlaggedReviews([...mergedReviews.values()]);
    } catch {
      setFlaggedPhotos(galleryRepo.listForModeration());
      setFlaggedReviews(reviewRepo.listForModeration());
    }
  }, []);

  const selectedId = view.kind === 'detail' ? view.id : null;

  useEffect(() => {
    if (!hasInitializedUrlSync.current) {
      hasInitializedUrlSync.current = true;
      return;
    }
    setBenchIdInUrl(selectedId);
  }, [selectedId]);

  const refreshDetailContent = useCallback(async (benchId: string | null, viewerId?: string) => {
    if (!benchId) {
      setSelectedReviews([]);
      setSelectedPhotos([]);
      return;
    }
    try {
      const [reviews, photos] = await Promise.all([
        benchService.listReviews(benchId, viewerId),
        benchService.listPhotos(benchId, viewerId),
      ]);
      setSelectedReviews(reviews);
      setSelectedPhotos(photos);
    } catch (err) {
      showToast(errMsg(err));
    }
  }, [showToast]);

  useEffect(() => {
    void benchService.getCurrentUser().then((u) => {
      setUser(u);
      if (u?.prefs.defaultLayer) setLayerMode(u.prefs.defaultLayer);
      if (u?.prefs.theme) setThemeMode(u.prefs.theme);
      void refreshEntitlement();
    });
    const unsubscribe = benchService.onAuthStateChange((u) => {
      setUser(u);
      if (!u) setDevUnlocked(false);
      if (u?.prefs.theme) setThemeMode(u.prefs.theme);
      void refreshEntitlement();
      void refreshBenches();
    });
    void refreshBenches();
    void refreshFlaggedQueue();
    return unsubscribe;
  }, [refreshBenches, refreshEntitlement, refreshFlaggedQueue]);

  useEffect(() => {
    void refreshDetailContent(selectedId, user?.id);
    void refreshFlaggedQueue();
  }, [selectedId, user?.id, dataRev, refreshDetailContent, refreshFlaggedQueue]);

  useEffect(() => {
    entitlements.setObscureUnlocked(false);
    entitlements.setActiveUser(user?.id ?? null);
  }, [user?.id]);
  useEffect(() => writeJSON('layer', layerMode), [layerMode]);
  useEffect(() => {
    writeJSON('theme', themeMode);
    document.documentElement.setAttribute('data-theme', themeMode);
    document.documentElement.classList.toggle('dark', themeMode === 'dark');
  }, [themeMode]);

  const fly = useCallback((p: LngLat, zoom?: number) => {
    setFlyTarget({ ...p, zoom, key: Date.now() });
  }, []);
  const units = user?.prefs.units ?? 'metric';

  // ---- real-time facing heading (smoothed compass + movement fallback) ----
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOrientation = (ev: DeviceOrientationEvent) => {
      const iosHeading = (ev as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
      if (typeof iosHeading === 'number' && !Number.isNaN(iosHeading)) {
        hasCompassHeadingRef.current = true;
        updateSmoothedHeading(iosHeading);
        return;
      }

      if (typeof ev.alpha === 'number' && !Number.isNaN(ev.alpha)) {
        const screenAngle =
          typeof window.screen?.orientation?.angle === 'number' ? window.screen.orientation.angle : 0;
        const compassHeading = normalizeHeading(360 - ev.alpha + screenAngle);
        hasCompassHeadingRef.current = true;
        updateSmoothedHeading(compassHeading);
      }
    };

    const winWithAbs = window as unknown as {
      addEventListener(type: 'deviceorientationabsolute', listener: (ev: DeviceOrientationEvent) => void): void;
      removeEventListener(type: 'deviceorientationabsolute', listener: (ev: DeviceOrientationEvent) => void): void;
    };

    window.addEventListener('deviceorientation', handleOrientation);
    winWithAbs.addEventListener('deviceorientationabsolute', handleOrientation);

    return () => {
      window.removeEventListener('deviceorientation', handleOrientation);
      winWithAbs.removeEventListener('deviceorientationabsolute', handleOrientation);
    };
  }, [updateSmoothedHeading]);

  // ---- live route tracking (watchPosition) ----
  useEffect(() => {
    if (!routeTarget) return;
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      showToast(`Directions target set for ${routeTarget.name}.`);
      return;
    }

    lastRoutedOriginRef.current = null;
    let hasAnnouncedInitialRoute = false;

    const recomputeRoute = (origin: LngLat, signal: AbortSignal) => {
      lastRoutedOriginRef.current = origin;
      void fetchWalkingRoute(origin, { lng: routeTarget.lng, lat: routeTarget.lat }, signal).then((res) => {
        if (signal.aborted) return;
        setRouteCoords(res.coords);
        setRouteMetrics({
          distanceMeters: res.distanceMeters,
          durationSeconds: res.durationSeconds,
        });
        const distLabel = formatDistance(res.distanceMeters, units);
        if (!hasAnnouncedInitialRoute) {
          hasAnnouncedInitialRoute = true;
          showToast(
            res.mode === 'walking-path'
              ? `Walking route (${distLabel}) ready to ${routeTarget.name}.`
              : `Direct line (${distLabel}) shown to ${routeTarget.name}.`,
          );
        }
      });
    };

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const ctrl = routeAbortRef.current;
        if (!ctrl || ctrl.signal.aborted) return;

        const current: LngLat = { lng: pos.coords.longitude, lat: pos.coords.latitude };
        setUserLocation(current);
        setRouteOrigin(current);

        if (
          !hasCompassHeadingRef.current &&
          typeof pos.coords.heading === 'number' &&
          !Number.isNaN(pos.coords.heading) &&
          (typeof pos.coords.speed !== 'number' || pos.coords.speed > 0.4)
        ) {
          updateSmoothedHeading(pos.coords.heading);
        }

        const distanceToBench = haversineMeters(current, {
          lng: routeTarget.lng,
          lat: routeTarget.lat,
        });

        if (distanceToBench <= ARRIVAL_DISTANCE_THRESHOLD_M) {
          showToast(`You've arrived at ${routeTarget.name}!`);
          clearRoute();
          return;
        }

        const prevRouted = lastRoutedOriginRef.current;
        const movedSinceRoute = prevRouted ? haversineMeters(prevRouted, current) : Infinity;

        if (!prevRouted || movedSinceRoute >= REROUTE_DISTANCE_THRESHOLD_M) {
          recomputeRoute(current, ctrl.signal);
        }
      },
      () => {
        // Keep existing route/target if GPS momentarily drops
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [routeTarget, units, clearRoute, showToast, updateSmoothedHeading]);

  // ---- derived ----
  const viewBenches = useMemo(
    () => benches.map((b) => toViewBench(b, { subscribed, user })),
    [benches, subscribed, user],
  );

  // Open ?bench=<id> once benches are loaded
  useEffect(() => {
    const targetId = getBenchIdFromUrl();
    if (!targetId || appliedUrlBenchRef.current === targetId) return;
    const match = viewBenches.find((v) => v.bench.id === targetId);
    if (match) {
      appliedUrlBenchRef.current = targetId;
      setView({ kind: 'detail', id: match.bench.id, from: 'browse' });
      if (isMobile) setSheet('half');
      fly({ lng: match.displayLng, lat: match.displayLat }, match.locked ? 11 : 15);
    }
  }, [viewBenches, isMobile, fly]);

  const editingId = view.kind === 'edit' ? view.id : null;
  const mapBenches = useMemo(
    () =>
      viewBenches.filter((v) => {
        if (!subscribed && (v.locked || isPaidTier(v.bench.difficulty))) return false;
        if (filter === 'all') return v.bench.id !== editingId;
        if (filter === 'urban') return (v.bench.difficulty === 'urban' || v.bench.difficulty === 'easy') && v.bench.id !== editingId;
        if (filter === 'transit') return (v.bench.difficulty === 'transit' || v.bench.difficulty === 'moderate') && v.bench.id !== editingId;
        if (filter === 'obscure') return (v.bench.difficulty === 'obscure' || v.bench.difficulty === 'hidden') && v.bench.id !== editingId;
        return v.bench.difficulty === filter && v.bench.id !== editingId;
      }),
    [viewBenches, filter, editingId, subscribed],
  );
  const selected = selectedId ? viewBenches.find((v) => v.bench.id === selectedId) ?? null : null;
  const formActive = view.kind === 'submit' || view.kind === 'edit';

  const duplicate = useMemo(
    () =>
      formActive && draft
        ? benchService.findNearby(benches, draft, { excludeId: editingId ?? undefined, country: ACTIVE_COUNTRY })
        : null,
    [formActive, draft, editingId, benches],
  );
  const duplicateLocked = !!duplicate && toViewBench(duplicate.bench, { subscribed, user }).locked;

  const myBenches = useMemo(() => (user ? benches.filter((b) => isOwner(b, user)) : []), [benches, user]);
  const myStats = useMemo(() => {
    const s: Record<string, ListingStats> = {};
    for (const b of myBenches) {
      s[b.id] = {
        reviews: b.id === selectedId ? selectedReviews.length : reviewRepo.countVisible(b.id),
        photos: b.id === selectedId ? selectedPhotos.length : galleryRepo.countVisible(b.id),
      };
    }
    return s;
  }, [myBenches, selectedId, selectedReviews.length, selectedPhotos.length]);

  const modQueue = useMemo(
    () =>
      DEV_TOOLS_ENABLED
        ? { photos: flaggedPhotos, reviews: flaggedReviews }
        : { photos: [], reviews: [] },
    [flaggedPhotos, flaggedReviews],
  );

  // ---- navigation ----
  const selectBench = (id: string, flyToIt = false, from: 'browse' | 'mine' = 'browse') => {
    setView({ kind: 'detail', id, from });
    if (isMobile) setSheet('half');
    if (flyToIt) {
      const v = viewBenches.find((x) => x.bench.id === id);
      if (v) fly({ lng: v.displayLng, lat: v.displayLat }, v.locked ? 11 : 15);
    }
  };

  const requireAuth = (reason: string, then?: () => void) => setModal({ kind: 'auth', reason, then });

  const openSubmit = () => {
    setView({ kind: 'submit' });
    setDraft(null);
    setPickMode(false);
    if (isMobile) setSheet('full');
  };
  const requestSubmit = () =>
    user ? openSubmit() : requireAuth('A free account lets you log benches and get credit for your finds.', openSubmit);

  const openEdit = (id: string) => {
    const b = benches.find((item) => item.id === id) ?? benchService.getCachedBench(id);
    if (!b || !isOwner(b, user)) return showToast('You can only edit benches you logged.');
    setView({ kind: 'edit', id });
    setDraft({ lat: b.lat, lng: b.lng });
    setPickMode(false);
    if (isMobile) setSheet('full');
    fly({ lat: b.lat, lng: b.lng }, 17);
  };

  const handlePhotographerMainPhoto = async (benchId: string, photoDataUrl: string) => {
    if (!user) return showToast('Sign in to update the main photo.');
    try {
      await benchService.setMainPhotoAsPhotographer(benchId, user.id, photoDataUrl);
      await refreshBenches();
      await refreshDetailContent(benchId, user.id);
      showToast('Main bench photo updated.');
    } catch (err) {
      showToast(errMsg(err));
    }
  };

  const openMine = () => {
    setMenuOpen(false);
    setPickMode(false);
    setView({ kind: 'mine' });
    if (isMobile) setSheet('full');
  };

  const leaveForm = (to: PanelView = { kind: 'browse' }) => {
    setPickMode(false);
    setDraft(null);
    setView(to);
  };

  const goHome = useCallback(() => {
    setMenuOpen(false);
    setModal(null);
    setPickMode(false);
    setDraft(null);
    clearRoute();
    setFilter('all');
    setView({ kind: 'browse' });
    if (isMobile) setSheet('half');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [clearRoute, isMobile]);

  const getCheckoutUrlForUser = useCallback(
    (activeUser: User | null) => {
      if (hookCheckoutUrl) return hookCheckoutUrl;
      if (!activeUser?.id) return null;
      return `${EXPLORER_PAYMENT_LINK}?client_reference_id=${encodeURIComponent(activeUser.id)}`;
    },
    [hookCheckoutUrl],
  );

  const openCheckoutFlow = useCallback(
    (activeUser: User | null) => {
      const url = getCheckoutUrlForUser(activeUser);
      setModal({ kind: 'checkout', checkoutUrl: url });
    },
    [getCheckoutUrlForUser],
  );

  const requestUnlock = () =>
    user
      ? openCheckoutFlow(user)
      : requireAuth('Create a free account first — your subscription is linked to it across devices.', () => {
          void benchService.getCurrentUser().then((signedInUser) => {
            openCheckoutFlow(signedInUser);
          });
        });

  // ---- location ----
  const setDraftChecked = (p: DraftLocation) => {
    if (!isInsideRegion(p.lng, p.lat)) {
      showToast(`FindMyBench is ${ACTIVE_REGION.name}-only for now — pick a spot inside the UK.`);
      return false;
    }
    setDraft(p);
    const dup = benchService.findNearby(benches, p, { excludeId: editingId ?? undefined, country: ACTIVE_COUNTRY });
    if (dup) showToast(`A bench is already logged ${formatDistance(dup.distanceM, units)} from here.`);
    return true;
  };

  const handlePick = (p: LngLat) => {
    if (setDraftChecked(p)) {
      setPickMode(false);
      if (isMobile) setSheet('half');
    }
  };

  const startPick = () => {
    setPickMode((on) => !on);
    if (isMobile) setSheet('peek');
  };

  const useCurrentLocation = () => {
    if (!('geolocation' in navigator)) return showToast('Location is not available on this device.');
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const p = { lng: pos.coords.longitude, lat: pos.coords.latitude, accuracyM: pos.coords.accuracy };
        setUserLocation(p);
        if (setDraftChecked(p)) {
          setPickMode(false);
          fly(p, 18);
        }
      },
      (err) => {
        setLocating(false);
        showToast(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied — drop a pin on the map instead.'
            : 'Could not get your location. Try again or pick on the map.',
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  };

  // ---- bench create / edit ----
  const handleSubmit = async (p: SubmitPayload) => {
    if (!user || !draft) return;
    try {
      const bench = await benchService.createBench(
        {
          country_code: ACTIVE_COUNTRY,
          region: 'Community find',
          name: p.name || 'Unnamed bench',
          lat: draft.lat,
          lng: draft.lng,
          difficulty: p.difficulty,
          tier: tierForDifficulty(p.difficulty),
          material: p.material,
          materialNote: p.materialNote,
          directions: p.directions,
          notes: p.notes,
          photo: p.photo,
          createdBy: user ? { ...toPublicAuthor(user), age: user.age, avatar: user.avatar } : undefined,
        },
        benches,
      );
      await refreshBenches();
      leaveForm({ kind: 'detail', id: bench.id });
      if (isMobile) setSheet('half');
      fly({ lng: bench.lng, lat: bench.lat }, 16);
      showToast('Bench saved — thanks for logging it!');
    } catch (err) {
      showToast(err instanceof DuplicateBenchError ? `${err.message} Open it or add a photo instead.` : errMsg(err));
    }
  };

  const handleEditSave = async (p: SubmitPayload) => {
    if (!user || !draft || view.kind !== 'edit') return;
    try {
      const bench = await benchService.updateBench(
        view.id,
        {
          name: p.name || 'Unnamed bench',
          difficulty: p.difficulty,
          directions: p.directions,
          material: p.material,
          materialNote: p.materialNote,
          notes: p.notes,
          photo: p.photo,
          lat: draft.lat,
          lng: draft.lng,
        },
        user.id,
        benches,
      );
      await refreshBenches();
      leaveForm({ kind: 'detail', id: bench.id, from: 'mine' });
      if (isMobile) setSheet('half');
      fly({ lng: bench.lng, lat: bench.lat }, 16);
      showToast('Changes saved.');
    } catch (err) {
      showToast(errMsg(err));
    }
  };

  // ---- gallery ----
  const requestAddPhoto = (benchId: string) => {
    const open = () => setModal({ kind: 'contribute', benchId });
    if (!user) return requireAuth('Sign in to add photos — it keeps galleries free of spam.', open);
    open();
  };

  const contributeToExisting = (benchId: string) => {
    leaveForm({ kind: 'detail', id: benchId });
    const b = benches.find((item) => item.id === benchId) ?? benchService.getCachedBench(benchId);
    if (b) fly({ lat: b.lat, lng: b.lng }, 17);
    if (isMobile) setSheet('half');
    requestAddPhoto(benchId);
  };

  const handleContribution = (benchId: string, c: ContributionPayload): string | null => {
    if (!user) return 'Sign in to add photos.';
    const uid = user.id;
    void (async () => {
      try {
        await benchService.addPhoto({
          benchId,
          uploaderId: uid,
          src: c.photo.dataUrl,
          tag: c.tag,
          caption: c.caption,
          width: c.photo.width,
          height: c.photo.height,
          bytes: c.photo.bytes,
          contentHash: c.photo.hash,
          moderationStatus: c.moderationStatus,
        });
        setModal(null);
        await refreshDetailContent(benchId, uid);
        await refreshFlaggedQueue();
        setDataRev((r) => r + 1);
        if (c.moderationStatus === 'flagged') {
          showToast(`Photo flagged for review. ${c.faceBlurNote}`);
        } else {
          showToast(`Photo is live! ${c.faceBlurNote}`);
        }
      } catch (err) {
        showToast(errMsg(err));
      }
    })();
    return null;
  };

  // ---- reviews ----
  const runReviewMutation = (fn: () => Promise<void>, benchId: string, ok?: string): string | null => {
    void (async () => {
      try {
        await fn();
        await refreshDetailContent(benchId, user?.id);
        setDataRev((r) => r + 1);
        if (ok) showToast(ok);
      } catch (err) {
        showToast(errMsg(err));
      }
    })();
    return null;
  };

  // ---- settings ----
  const saveSettings = async (patch: { name: string; prefs: UserPreferences }) => {
    if (!user) return 'Sign in first.';
    try {
      const prevDefault = user.prefs.defaultLayer;
      const nextPrefs = await benchService.updateProfile(user.id, patch);
      const updatedUser: User = {
        ...user,
        name: patch.name.trim(),
        prefs: nextPrefs,
      };
      setUser(updatedUser);
      if (prevDefault !== nextPrefs.defaultLayer) setLayerMode(nextPrefs.defaultLayer);
      if (nextPrefs.theme) setThemeMode(nextPrefs.theme);
      await refreshBenches();
      if (selectedId) await refreshDetailContent(selectedId, updatedUser.id);
      setModal(null);
      showToast('Settings saved.');
      return null;
    } catch (err) {
      return errMsg(err);
    }
  };

  const signOut = () => {
    setMenuOpen(false);
    setDevUnlocked(false);
    if (formActive || view.kind === 'mine') leaveForm();
    void benchService.signOut().then(() => {
      setUser(null);
      void refreshEntitlement();
      showToast('Signed out.');
    });
  };

  // ---- panel content (shared by sidebar + bottom sheet) ----
  let panel: JSX.Element;
  if (formActive && user) {
    const initial = view.kind === 'edit' ? benches.find((b) => b.id === view.id) : undefined;
    panel = (
      <SubmitBenchForm
        key={view.kind === 'edit' ? view.id : 'new'}
        mode={view.kind === 'edit' ? 'edit' : 'create'}
        initial={initial}
        user={user}
        draft={draft}
        pickMode={pickMode}
        locating={locating}
        duplicate={duplicate}
        duplicateLocked={duplicateLocked}
        units={units}
        onStartPick={startPick}
        onUseCurrentLocation={useCurrentLocation}
        onCancel={() => leaveForm(view.kind === 'edit' ? { kind: 'detail', id: view.id, from: 'mine' } : { kind: 'browse' })}
        onSubmit={view.kind === 'edit' ? handleEditSave : handleSubmit}
        onOpenExisting={(id) => {
          leaveForm();
          selectBench(id, true);
        }}
        onContributeToExisting={contributeToExisting}
      />
    );
  } else if (view.kind === 'mine' && user) {
    panel = (
      <MyListingsView
        benches={myBenches}
        stats={myStats}
        onBack={() => setView({ kind: 'browse' })}
        onView={(id) => selectBench(id, true, 'mine')}
        onEdit={openEdit}
        onLogBench={requestSubmit}
      />
    );
  } else if (view.kind === 'detail' && selected) {
    const bench = selected.bench;
    const myPhotoCountOnBench = user ? selectedPhotos.filter((p) => p.author.id === user.id).length : 0;
    const remainingPhotos = user
      ? Math.max(0, MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH - myPhotoCountOnBench)
      : 0;
    panel = (
      <BenchDetail
        key={bench.id}
        view={selected}
        isOwner={isOwner(bench, user)}
        canUpdateMainPhoto={canUpdateMainPhoto(bench, user)}
        viewerId={user?.id}
        signedIn={!!user}
        photos={selectedPhotos}
        photoCount={selectedPhotos.filter((p) => p.status !== 'hidden').length}
        reviewCount={selectedReviews.filter((r) => r.status !== 'hidden').length}
        remainingPhotos={remainingPhotos}
        backLabel={view.from === 'mine' ? 'My Listings' : 'All benches'}
        onBack={() => {
          clearRoute();
          setView(view.from === 'mine' && user ? { kind: 'mine' } : { kind: 'browse' });
        }}
        onUnlock={requestUnlock}
        onZoom={() => fly({ lng: selected.displayLng, lat: selected.displayLat }, selected.locked ? 11 : 17)}
        onDirections={() => {
          void requestCompassPermissionIfNeeded();
          const target: RouteTarget = {
            id: bench.id,
            name: bench.name,
            lng: selected.displayLng,
            lat: selected.displayLat,
          };
          routeAbortRef.current?.abort();
          const ctrl = new AbortController();
          routeAbortRef.current = ctrl;
          lastRoutedOriginRef.current = null;

          setRouteTarget(target);
          setRouteCoords(null);
          setRouteMetrics(null);
          fly({ lng: target.lng, lat: target.lat }, selected.locked ? 11 : 16);
          if (isMobile) setSheet('peek');
          showToast(`Tracking live walking route to ${target.name}...`);
        }}
        onEdit={() => openEdit(bench.id)}
        onUpdateMainPhoto={(photoDataUrl) => handlePhotographerMainPhoto(bench.id, photoDataUrl)}
        onAddPhoto={() => requestAddPhoto(bench.id)}
        onOpenPhoto={(p) => setModal({ kind: 'photo', photoId: p.id })}
        reviews={
          <ReviewsSection
            reviews={selectedReviews}
            user={user}
            onRequireAuth={() => requireAuth('Sign in to leave a review — your display name is shown, never your email.')}
            onComposerOpen={() => isMobile && setSheet('full')}
            onCreate={(body, rating?: Rating) =>
              runReviewMutation(
                async () => {
                  await benchService.addReview({ benchId: bench.id, authorId: user!.id, body, rating });
                },
                bench.id,
                'Review posted.',
              )
            }
            onUpdate={(id, body, rating?: Rating) =>
              runReviewMutation(
                async () => {
                  await benchService.updateReview(id, user!.id, body, rating);
                },
                bench.id,
                'Review updated.',
              )
            }
            onDelete={(id) =>
              void runReviewMutation(
                async () => {
                  await benchService.deleteReview(id, user!.id);
                },
                bench.id,
                'Review deleted.',
              )
            }
            onReport={(id, reason: ReportReason, details: string) => {
              if (!user) {
                requireAuth('Sign in to report a review.');
                return null;
              }
              void benchService
                .reportReview(id, reason, details)
                .then(async () => {
                  await refreshDetailContent(bench.id, user.id);
                  await refreshFlaggedQueue();
                  setDataRev((r) => r + 1);
                  showToast('Thanks — review reported and sent for moderation.');
                })
                .catch((err) => showToast(errMsg(err)));
              return null;
            }}
          />
        }
      />
    );
  } else {
    panel = (
      <BrowseView
        benches={viewBenches}
        filter={filter}
        onFilter={setFilter}
        subscribed={subscribed}
        user={user}
        onSelect={(id) => selectBench(id, true)}
        onLogBench={requestSubmit}
        onUnlock={requestUnlock}
      />
    );
  }

  const lightboxPhoto =
    modal?.kind === 'photo' ? selectedPhotos.find((p) => p.id === modal.photoId) ?? null : null;
  const contributeBench =
    modal?.kind === 'contribute'
      ? benches.find((b) => b.id === modal.benchId) ?? benchService.getCachedBench(modal.benchId)
      : undefined;

  const account = (
    <div className="account">
      {user ? (
        <>
          <button className="avatar" onClick={() => setMenuOpen((o) => !o)} aria-label="Account menu" aria-expanded={menuOpen}>
            {user.name.slice(0, 1).toUpperCase()}
          </button>
          {menuOpen && (
            <>
              <div className="menu-scrim" onClick={() => setMenuOpen(false)} />
              <div className="account-menu" role="menu">
                <div className="account-menu-head">
                  <strong>{user.name}</strong>
                  <small>{user.email}</small>
                  <small>{subscribed ? 'Explorer — obscure unlocked' : 'Free plan'}</small>
                </div>
                <button role="menuitem" onClick={openMine}>
                  🪵 My Listings <span className="menu-count">{myBenches.length}</span>
                </button>
                <button role="menuitem" onClick={() => { setMenuOpen(false); setModal({ kind: 'settings' }); }}>
                  ⚙ Account Settings
                </button>
                {!subscribed && (
                  <button role="menuitem" onClick={() => { setMenuOpen(false); requestUnlock(); }}>
                    🔓 Unlock obscure benches
                  </button>
                )}
                <button role="menuitem" onClick={signOut}>Sign out</button>
              </div>
            </>
          )}
        </>
      ) : (
        <button
          className="btn btn-sm btn-outline"
          onClick={() => requireAuth('Sign in to log benches, leave reviews and add photos.')}
        >
          Sign in
        </button>
      )}
    </div>
  );

  const brand = (
    <button
      type="button"
      className="brand"
      onClick={goHome}
      aria-label="FindMyBench home"
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        font: 'inherit',
        color: 'inherit',
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <img src="./favicon.svg" alt="" width={28} height={28} />
      <span>
        Find<b>My</b>Bench
      </span>
      <small className="region-pill">{ACTIVE_COUNTRY}</small>
    </button>
  );

  const centerOnBlip = userLocation ?? routeOrigin;

  return (
    <div className={`app ${isDesktop ? 'is-desktop' : 'is-mobile'} ${menuOpen ? 'menu-open' : ''}`}>
      {splashVisible && (
        <div className="startup-splash" role="status" aria-live="polite">
          <div className="startup-splash-inner">
            <img src="./favicon.svg" alt="" width={72} height={72} className="startup-splash-logo" />
            <div className="startup-splash-title">
              Find<b>My</b>Bench
            </div>
            <div className="startup-splash-welcome">
              Welcome — finding great places to sit, pause, and take in the view.
            </div>
            <div className="startup-splash-track" aria-hidden="true">
              <div
                className="startup-splash-fill"
                style={{ width: `${splashProgress.toFixed(1)}%` }}
              />
            </div>
            <div className="startup-splash-caption">{splashMessage}</div>
          </div>
        </div>
      )}

      {isDesktop && (
        <aside className="sidebar">
          <header className="sidebar-head">
            {brand}
            {account}
          </header>
          <div className="sidebar-body">{panel}</div>
        </aside>
      )}

      <main className="map-wrap">
        <MapView
          benches={mapBenches}
          selectedId={selectedId}
          layerMode={layerMode}
          styleNonce={styleNonce}
          pickMode={pickMode}
          draft={formActive ? draft : null}
          flyTarget={flyTarget}
          routeTarget={routeTarget}
          routeOrigin={routeOrigin}
          routeCoords={routeCoords}
          userLocation={userLocation}
          userHeadingDeg={userHeadingDeg}
          isMobile={isMobile}
          onSelect={(id) => selectBench(id)}
          onPick={handlePick}
          onDraftMove={(p) => setDraftChecked(p)}
          onStatus={setMapStatus}
        />

        <div className="map-overlay-top">
          {isMobile && (
            <div className="mobile-bar">
              {brand}
              {account}
            </div>
          )}
          <LayerSwitcher mode={layerMode} onChange={setLayerMode} />
        </div>

        {routeTarget && (
          <div className="pick-banner" role="status">
            <span>🧭 {routeTarget.name}</span>
            <button
              className="btn btn-sm btn-ghost-light"
              onClick={clearRoute}
            >
              Clear
            </button>
          </div>
        )}

        {(routeTarget || centerOnBlip) && (
          <div
            style={{
              position: 'absolute',
              right: 12,
              bottom: isMobile ? 92 : 34,
              zIndex: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {routeTarget && routeMetrics && (
              <div
                role="status"
                style={{
                  background: 'rgba(20, 24, 21, 0.9)',
                  color: '#f7f4ec',
                  padding: '7px 11px',
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  boxShadow: '0 4px 14px rgba(0,0,0,0.22)',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatDistance(routeMetrics.distanceMeters, units)} · {formatWalkEta(routeMetrics.durationSeconds)} walk
              </div>
            )}
            {centerOnBlip && (
              <button
                type="button"
                aria-label="Center on my location"
                title="Center on my location"
                onClick={() => {
                  void requestCompassPermissionIfNeeded();
                  fly(centerOnBlip, 17);
                }}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,0.16)',
                  background: 'rgba(20, 24, 21, 0.92)',
                  color: '#ffffff',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <line x1="12" y1="2" x2="12" y2="6" />
                  <line x1="12" y1="18" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="6" y2="12" />
                  <line x1="18" y1="12" x2="22" y2="12" />
                </svg>
              </button>
            )}
          </div>
        )}

        {pickMode && (
          <div className="pick-banner" role="status">
            <span>📍 Tap the map where the bench is</span>
            <button className="btn btn-sm btn-ghost-light" onClick={() => setPickMode(false)}>Cancel</button>
          </div>
        )}

        {(mapStatus === 'offline' || mapStatus === 'degraded') && (
          <div className="map-status" role="status">
            {mapStatus === 'offline'
              ? 'Map tiles unavailable — showing benches on a plain background.'
              : 'Some map tiles failed to load.'}
            <button className="btn btn-sm btn-ghost-light" onClick={() => setStyleNonce((n) => n + 1)}>Retry</button>
          </div>
        )}

        {isMobile && (
          <BottomSheet
            state={sheet}
            onState={setSheet}
            resetKey={`${view.kind}:${view.kind === 'detail' || view.kind === 'edit' ? view.id : ''}:${pickMode ? 'pick' : 'view'}`}
          >
            {panel}
          </BottomSheet>
        )}

        {DEV_TOOLS_ENABLED && (
          <Suspense fallback={null}>
            <DevPanel
              subscribed={subscribed}
              onToggleSubscribed={(v) => {
                setDevUnlocked(v);
              }}
              user={user}
              onQuickSignIn={() => {
                showToast('Use Sign in in the top bar with your Supabase email and password.');
              }}
              onSignOut={signOut}
              onResetBenches={() => {
                void refreshBenches();
                leaveForm();
                showToast('Refreshed benches from Supabase.');
              }}
              mapStatus={mapStatus}
              moderationCount={modQueue.photos.length + modQueue.reviews.length}
              onOpenModeration={() => {
                void refreshFlaggedQueue();
                setModal({ kind: 'moderation' });
              }}
            />
          </Suspense>
        )}
      </main>

      {toast && <div className="toast" role="status">{toast}</div>}

      {modal?.kind === 'auth' && (
        <AuthModal
          reason={modal.reason}
          onClose={() => setModal(null)}
          onSignedIn={() => {
            const then = modal.then;
            setModal(null);
            void refreshEntitlement();
            void refreshBenches().then(() => then?.());
          }}
        />
      )}
      {modal?.kind === 'checkout' && (
        <Suspense fallback={null}>
          <CheckoutModal
            checkoutUrl={modal.checkoutUrl ?? getCheckoutUrlForUser(user)}
            onRefresh={() => {
              void refreshEntitlement();
            }}
            onClose={() => {
              setModal(null);
              void refreshEntitlement();
            }}
          />
        </Suspense>
      )}
      {modal?.kind === 'settings' && user && (
        <AccountSettingsModal user={user} subscribed={subscribed} onClose={() => setModal(null)} onSave={saveSettings} />
      )}
      {modal?.kind === 'contribute' && contributeBench && user && (
        <ContributePhotoModal
          bench={contributeBench}
          remaining={Math.max(
            0,
            MAX_GALLERY_PHOTOS_PER_USER_PER_BENCH - selectedPhotos.filter((p) => p.author.id === user.id).length,
          )}
          onClose={() => setModal(null)}
          onSubmit={(c) => handleContribution(contributeBench.id, c)}
        />
      )}
      {modal?.kind === 'photo' && lightboxPhoto && (
        <PhotoLightbox
          photo={lightboxPhoto}
          user={user}
          onClose={() => setModal(null)}
          onDelete={() => {
            if (!user) return;
            const target = lightboxPhoto;
            const activeBenchId = selectedId;
            setModal(null);
            void benchService
              .deletePhoto(target.id, user.id, target.src)
              .then(async () => {
                if (activeBenchId) await refreshDetailContent(activeBenchId, user.id);
                await refreshFlaggedQueue();
                setDataRev((r) => r + 1);
                showToast('Photo deleted.');
              })
              .catch((err) => showToast(errMsg(err)));
          }}
          onReport={(reason) => {
            void benchService.reportPhoto(lightboxPhoto.id, user!.id, reason).then(async () => {
              if (selectedId) await refreshDetailContent(selectedId, user?.id);
              await refreshFlaggedQueue();
              setDataRev((r) => r + 1);
              showToast('Thanks — photo reported.');
            });
            return null;
          }}
        />
      )}
      {modal?.kind === 'moderation' && (
        <Suspense fallback={null}>
          <ModerationModal
            photos={modQueue.photos}
            reviews={modQueue.reviews}
            benchName={(id) => benches.find((b) => b.id === id)?.name ?? id}
            onClose={() => setModal(null)}
            onPhoto={(id, s) => {
              const target = modQueue.photos.find((p) => p.id === id);
              galleryRepo.moderate(id, s);
              void benchService
                .moderatePhoto(id, s, target?.src)
                .then(async () => {
                  if (selectedId) await refreshDetailContent(selectedId, user?.id);
                  await refreshFlaggedQueue();
                  setDataRev((r) => r + 1);
                  showToast(
                    s === 'delete'
                      ? 'Photo deleted.'
                      : s === 'visible'
                        ? 'Photo approved and visible.'
                        : 'Photo hidden.',
                  );
                })
                .catch((err) => showToast(errMsg(err)));
            }}
            onReview={(id, s) => {
              reviewRepo.moderate(id, s);
              void benchService
                .moderateReview(id, s)
                .then(async () => {
                  if (selectedId) await refreshDetailContent(selectedId, user?.id);
                  await refreshFlaggedQueue();
                  setDataRev((r) => r + 1);
                  showToast(
                    s === 'delete'
                      ? 'Review deleted.'
                      : s === 'visible'
                        ? 'Review approved and visible.'
                        : 'Review hidden.',
                  );
                })
                .catch((err) => showToast(errMsg(err)));
            }}
          />
        </Suspense>
      )}
    </div>
  );
}