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
import { benchService, DuplicateBenchError } from './lib/benchService';
import { entitlements, DEV_TOOLS_ENABLED } from './services/entitlements';
import { reviewRepo } from './services/reviewRepository';
import { galleryRepo } from './services/galleryRepository';
import { SAMPLE_BENCHES } from './data/sampleBenches';
import { ACTIVE_COUNTRY, ACTIVE_REGION, isInsideRegion } from './config/regions';
import { isPaidTier, tierForDifficulty } from './config/taxonomy';
import { isOwner, formatDistance, toViewBench } from './utils/geo';
import { readJSON, writeJSON } from './utils/storage';
import type {
  Bench,
  DraftLocation,
  GalleryPhoto,
  LngLat,
  MapLayerMode,
  PublicAuthor,
  ReportReason,
  Review,
  User,
  UserPreferences,
} from './types';

type PanelView =
  | { kind: 'browse' }
  | { kind: 'detail'; id: string; from?: 'browse' | 'mine' }
  | { kind: 'submit' }
  | { kind: 'edit'; id: string }
  | { kind: 'mine' };

type ModalState =
  | null
  | { kind: 'auth'; reason: string; then?: () => void }
  | { kind: 'checkout' }
  | { kind: 'settings' }
  | { kind: 'contribute'; benchId: string }
  | { kind: 'photo'; photoId: string }
  | { kind: 'moderation' };

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function toPublicAuthor(u: User): PublicAuthor {
  return {
    id: u.id,
    name: u.prefs.creditAnonymously ? 'Anonymous bench hunter' : u.name,
  };
}

export default function App() {
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const isMobile = !isDesktop;

  // ---- app state ----
  const [user, setUser] = useState<User | null>(null);
  const [subscribed, setSubscribed] = useState(() => entitlements.isObscureUnlocked());
  const [benches, setBenches] = useState<Bench[]>(() =>
    SAMPLE_BENCHES.filter((b) => b.country_code === ACTIVE_COUNTRY),
  );
  const [selectedReviews, setSelectedReviews] = useState<Review[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<GalleryPhoto[]>([]);
  const [dataRev, setDataRev] = useState(0);
  const [layerMode, setLayerMode] = useState<MapLayerMode>(
    () => readJSON<MapLayerMode>('layer', 'default'),
  );
  const [styleNonce, setStyleNonce] = useState(0);
  const [mapStatus, setMapStatus] = useState<MapStatus>('loading');
  const [view, setView] = useState<PanelView>({ kind: 'browse' });
  const [filter, setFilter] = useState<TierFilter>('all');
  const [pickMode, setPickMode] = useState(false);
  const [draft, setDraft] = useState<DraftLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [sheet, setSheet] = useState<SheetState>('half');
  const [toast, setToast] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3600);
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

  const selectedId = view.kind === 'detail' ? view.id : null;

  const refreshDetailContent = useCallback(async (benchId: string | null, viewerId?: string) => {
    if (!benchId) {
      setSelectedReviews([]);
      setSelectedPhotos([]);
      return;
    }
    try {
      const [reviews, photos] = await Promise.all([
        benchService.listReviews(benchId),
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
    });
    const unsubscribe = benchService.onAuthStateChange((u) => {
      setUser(u);
      void refreshBenches();
    });
    void refreshBenches();
    return unsubscribe;
  }, [refreshBenches]);

  useEffect(() => {
    void refreshDetailContent(selectedId, user?.id);
  }, [selectedId, user?.id, dataRev, refreshDetailContent]);

  useEffect(() => entitlements.onChange(setSubscribed), []);
  useEffect(() => {
    entitlements.setActiveUser(user?.id ?? null);
  }, [user?.id]);
  useEffect(() => writeJSON('layer', layerMode), [layerMode]);

  const fly = (p: LngLat, zoom?: number) => setFlyTarget({ ...p, zoom, key: Date.now() });
  const units = user?.prefs.units ?? 'metric';

  // ---- derived ----
  const viewBenches = useMemo(
    () => benches.map((b) => toViewBench(b, { subscribed, user })),
    [benches, subscribed, user],
  );
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
        ? { photos: galleryRepo.listForModeration(), reviews: reviewRepo.listForModeration() }
        : { photos: [], reviews: [] },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataRev],
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

  const requestUnlock = () =>
    user
      ? setModal({ kind: 'checkout' })
      : requireAuth('Create a free account first — your subscription is linked to it across devices.', () =>
          setModal({ kind: 'checkout' }),
        );

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
        });
        setModal(null);
        await refreshDetailContent(benchId, uid);
        setDataRev((r) => r + 1);
        showToast('Photo added to the gallery.');
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
    if (formActive || view.kind === 'mine') leaveForm();
    void benchService.signOut().then(() => {
      setUser(null);
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
    const remainingPhotos = user ? Math.max(0, 3 - myPhotoCountOnBench) : 0;
    panel = (
      <BenchDetail
        key={bench.id}
        view={selected}
        isOwner={isOwner(bench, user)}
        viewerId={user?.id}
        signedIn={!!user}
        photos={selectedPhotos}
        photoCount={selectedPhotos.filter((p) => p.status !== 'hidden').length}
        reviewCount={selectedReviews.filter((r) => r.status !== 'hidden').length}
        remainingPhotos={remainingPhotos}
        backLabel={view.from === 'mine' ? 'My Listings' : 'All benches'}
        onBack={() => setView(view.from === 'mine' && user ? { kind: 'mine' } : { kind: 'browse' })}
        onUnlock={requestUnlock}
        onZoom={() => fly({ lng: selected.displayLng, lat: selected.displayLat }, selected.locked ? 11 : 17)}
        onEdit={() => openEdit(bench.id)}
        onAddPhoto={() => requestAddPhoto(bench.id)}
        onOpenPhoto={(p) => setModal({ kind: 'photo', photoId: p.id })}
        reviews={
          <ReviewsSection
            reviews={selectedReviews}
            user={user}
            onRequireAuth={() => requireAuth('Sign in to leave a review — your display name is shown, never your email.')}
            onComposerOpen={() => isMobile && setSheet('full')}
            onCreate={(body) =>
              runReviewMutation(
                async () => {
                  await benchService.addReview({ benchId: bench.id, authorId: user!.id, body });
                },
                bench.id,
                'Review posted.',
              )
            }
            onUpdate={(id, body) =>
              runReviewMutation(
                async () => {
                  await benchService.updateReview(id, user!.id, body);
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
            onReport={(_id, _reason: ReportReason) => {
              showToast('Thanks — review reported.');
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
    <div className="brand">
      <img src="./favicon.svg" alt="" width={28} height={28} />
      <span>
        Find<b>My</b>Bench
      </span>
      <small className="region-pill">{ACTIVE_COUNTRY}</small>
    </div>
  );

  return (
    <div className={`app ${isDesktop ? 'is-desktop' : 'is-mobile'} ${menuOpen ? 'menu-open' : ''}`}>
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
          <BottomSheet state={sheet} onState={setSheet}>
            {panel}
          </BottomSheet>
        )}

        {DEV_TOOLS_ENABLED && (
          <Suspense fallback={null}>
            <DevPanel
            subscribed={subscribed}
            onToggleSubscribed={(v) => entitlements.setObscureUnlocked(v)}
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
            onOpenModeration={() => setModal({ kind: 'moderation' })}
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
            void refreshBenches().then(() => then?.());
          }}
        />
      )}
      {modal?.kind === 'checkout' && (
        <Suspense fallback={null}>
          <CheckoutModal
          onClose={() => setModal(null)}
          onActivate={() => {
            entitlements.setObscureUnlocked(true);
            setModal(null);
            showToast('Obscure benches unlocked 🔓');
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
          remaining={Math.max(0, 3 - selectedPhotos.filter((p) => p.author.id === user.id).length)}
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
                setDataRev((r) => r + 1);
                showToast('Photo deleted.');
              })
              .catch((err) => showToast(errMsg(err)));
          }}
          onReport={(reason) => {
            void benchService.reportPhoto(lightboxPhoto.id, user!.id, reason).then(() => {
              if (selectedId) void refreshDetailContent(selectedId, user?.id);
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
            galleryRepo.moderate(id, s);
            setDataRev((r) => r + 1);
          }}
            onReview={(id, s) => {
              reviewRepo.moderate(id, s);
              setDataRev((r) => r + 1);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}


