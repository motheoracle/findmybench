# FindMyBench — v0.2

UK-first interactive bench discovery. Vite + React + TypeScript + MapLibre GL JS, structured for Capacitor (iOS/Android).

## Run it on Windows (PowerShell)

You need **Node.js 20 or newer** (LTS from nodejs.org). Check with `node -v`.

```powershell
# 1. Extract the zip and go into the project
Expand-Archive -Path .\findmybench-v0.2.zip -DestinationPath .
cd .\findmybench

# 2. Install dependencies (first time only)
npm install

# 3. Start the dev server → open http://localhost:5173
npm run dev

# Optional: test on your phone over Wi-Fi
npm run dev:host

# Production build → .\dist
npm run build
npm run preview
```

If PowerShell blocks `npm` with an "execution policy" error, run this once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`. Or use `npm.cmd install` / `npm.cmd run dev` instead.

To change settings, copy `.env.example` to `.env.local` and edit it (`Copy-Item .env.example .env.local`).

## What's new in v0.2

| Feature | Details |
|---|---|
| **Edit own benches** | An **✎ Edit bench** button appears on the detail panel when you own the bench, and in **My Listings**. You can edit the name, difficulty, directions, material and custom detail, notes, main photo (replace or remove) and the pin position. Edits re-check for duplicates and update the map and panel straight away on all layers. |
| **Reviews & comments** | Use **Leave a review** on any unlocked bench. There's an optional 1–5 star rating and a hard limit of 10,000 characters, with a live `X / 10,000` counter (amber at 90%, red at 100%). You can edit or delete your own reviews, report other people's, and expand long reviews with "Read more". |
| **Account menu** | The avatar dropdown now has **My Listings** (your benches, with *View on map* and *Edit*) and **Account Settings** (display name, post anonymously, map layer on launch, distance units). Your email is masked and labelled private. Only the display name or "Anonymous bench hunter" ever appears publicly. Renaming yourself updates every bench, review and photo you've contributed. |
| **Duplicate detection** | A pin within **20 m** of an existing bench (set with `VITE_DUPLICATE_RADIUS_M`) is blocked. You'll see the existing bench's name and distance, an **Open existing bench** button, and **Add a photo to its gallery**. The rule is also enforced inside the repository. |
| **Photo galleries + guardrails** | Uploads need a signed-in account and a required context tag (*Bench view / POV from bench / Nearby landmark*). Captions are optional, up to 140 characters, with no links. You must confirm you took the photo at or near the bench. Each person can add **3 photos per bench** (40 per bench in total). Only JPEG, PNG, WebP or HEIC files under 15 MB and at least 320 px are accepted. Exact re-uploads are blocked using a SHA-256 hash, and location (EXIF/GPS) data is stripped. Anyone signed in can **⚑ Report photo**. Photos and reviews move through `visible → flagged → hidden`, and are hidden automatically after 3 reports. |
| **Moderation (DEV)** | The DEV panel's **Moderation** queue lets you approve, hide or delete flagged photos and reviews. |
| **Map layers** | All three are still free. **Default** is OpenFreeMap Liberty (vector). **Satellite** is Esri World Imagery to z19, with sharp vector labels, roads and dashed **footpaths** on top. **Terrain** is the Liberty vector base plus **Mapterhorn** hillshade and **contour lines** (with height labels) drawn in the browser. If the vector style can't load, Satellite falls back to imagery only and Terrain to OpenTopoMap. |
| **Pin precision** | You can zoom to z20. Coordinates are stored and shown to 6 decimal places (about 0.1 m). The draggable pin's tip now sits exactly on the coordinate. "Use Current Location" shows the GPS accuracy (±m) and warns when it's poor. |

All the v0.1 features are unchanged: browse without an account, the locked obscure tier and £2.99/mo preview card, the DEV subscription toggle, the account gate on Log a Bench, the offline fallback, mobile bottom sheet vs desktop sidebar, and the Capacitor setup.

## Project layout

```
src/
  App.tsx                       state, navigation, layout (sidebar vs bottom sheet)
  components/
    MapView.tsx                 MapLibre map, async styles, clustering, pick mode, fallback
    LayerSwitcher.tsx           Default / Satellite / Terrain (always free)
    BrowseView.tsx              list, search, tier filter
    BenchDetail.tsx             detail panel: edit button, gallery, reviews, locked preview
    SubmitBenchForm.tsx         Log a Bench + Edit bench (shared form), duplicate warning
    ReviewsSection.tsx          reviews list, composer with 10k counter, report
    ContributePhotoModal.tsx    structured gallery upload
    PhotoLightbox.tsx           photo viewer, report / delete
    MyListingsView.tsx          user's own benches
    AccountSettingsModal.tsx    display name + preferences (private details masked)
    ModerationModal.tsx         DEV moderation queue
    …PaywallCard, CheckoutModal, AuthModal, DevPanel, BottomSheet, Modal
  config/
    mapStyles.ts                tile sources + style builders (all env-overridable)
    community.ts                duplicate radius, review/photo limits, tags, report reasons
    regions.ts, taxonomy.ts
  services/                     swap-in points for Supabase
    auth.ts                     MockAuthService + publicAuthor() (public identity only)
    benchRepository.ts          CRUD + findNearby + duplicate enforcement
    reviewRepository.ts         reviews + reports + moderation
    galleryRepository.ts        gallery + caps + reports + moderation (server-side notes inside)
    entitlements.ts
  utils/ geo.ts (haversine, formatting), image.ts (validate/compress/hash), storage.ts
supabase/schema.sql             draft v2 schema: RLS, PostGIS duplicate trigger, caps, reports
```

## Production notes
- **Server-side enforcement.** v0.2 stores everything in `localStorage` and enforces the rules in the browser, which can be bypassed. `supabase/schema.sql` and the comment block at the top of `galleryRepository.ts` describe the matching server-side rules: Row-Level Security, a PostGIS duplicate trigger, upload-cap triggers, Storage MIME and size rules, an Edge Function that re-encodes images and computes a perceptual hash, and auto-hide on reports.
- **Locked-bench security.** The approximate pin for locked benches is a visual effect only. Use the RLS policies so exact coordinates never reach non-subscribers. The `nearby_bench` RPC returns only an id and distance, so the duplicate check can't be used to find exact locations.
- **Storage.** v0.2 keeps photos in `localStorage`, which holds roughly 5 MB, enough for about 20–30 compressed photos. Move to Supabase Storage before real use.
- **Map providers.** OpenFreeMap has no request limits. Esri imagery and OpenTopoMap have fair-use terms. Mapterhorn is open data with attribution. For heavy production traffic, consider MapTiler, Stadia, or self-hosted PMTiles. The Ordnance Survey OS Maps API is a strong UK-specific option for Terrain.
- **Payments.** In-app subscriptions on iOS/Android must use App Store / Play billing; RevenueCat covers both.

## Native wrapping (Capacitor)
```powershell
npm run cap:add:android    # Android Studio required
npm run cap:android        # build, sync, open Android Studio
```
iOS (`npm run cap:add:ios`, `npm run cap:ios`) needs a Mac with Xcode. After adding the platforms, set the permission strings:

- **iOS `Info.plist`**: `NSLocationWhenInUseUsageDescription`, `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`
- **Android `AndroidManifest.xml`**: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`
