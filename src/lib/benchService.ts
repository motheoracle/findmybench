import { supabase } from './supabase';
import { SAMPLE_BENCHES } from '../data/sampleBenches';
import { tierForDifficulty } from '../config/taxonomy';
import { DUPLICATE_RADIUS_M, PHOTO_TAGS } from '../config/community';
import { distanceM, roundCoord } from '../utils/geo';
import type {
  Bench,
  BenchEditable,
  CountryCode,
  Difficulty,
  GalleryPhoto,
  LngLat,
  Material,
  ModerationStatus,
  NearbyMatch,
  PhotoTag,
  PublicAuthor,
  ReportReason,
  Review,
  Units,
  User,
  UserPreferences,
  UserReport,
} from '../types';

const STORAGE_BUCKET = 'bench-photos';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

export type NewBenchInput = Omit<Bench, 'id' | 'createdAt' | 'updatedAt' | 'source'>;

export class DuplicateBenchError extends Error {
  constructor(public match: NearbyMatch) {
    super(`A bench is already logged ${Math.round(match.distanceM)} m from this spot.`);
  }
}

interface BenchRow {
  id: string;
  owner_id: string;
  name: string;
  lat: number;
  lng: number;
  difficulty: Difficulty;
  material: Material;
  material_note: string | null;
  directions: string;
  notes: string | null;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

interface ReviewRow {
  id: string;
  bench_id: string;
  author_id: string;
  body: string;
  rating?: number | null;
  is_hidden?: boolean | null;
  report_count?: number | null;
  report_reasons?: string[] | null;
  created_at: string;
}

interface PhotoRow {
  id: string;
  bench_id: string;
  uploader_id: string;
  photo_url: string;
  context_tag: 'Bench view' | 'POV from bench' | 'Nearby landmark/context';
  caption: string | null;
  is_hidden: boolean;
  report_count: number;
  created_at: string;
}

interface ProfileRow {
  id: string;
  display_name: string;
  units: Units;
  age: number | null;
  avatar_url: string | null;
}

function toDbPhotoTag(tag: PhotoTag): PhotoRow['context_tag'] {
  switch (tag) {
    case 'bench-view':
      return 'Bench view';
    case 'pov':
      return 'POV from bench';
    case 'nearby':
      return 'Nearby landmark/context';
  }
}

function fromDbPhotoTag(tag: PhotoRow['context_tag']): PhotoTag {
  switch (tag) {
    case 'Bench view':
      return 'bench-view';
    case 'POV from bench':
      return 'pov';
    case 'Nearby landmark/context':
      return 'nearby';
  }
}

function resolveModerationStatus(row: {
  is_hidden?: boolean | null;
  report_count?: number | null;
}): ModerationStatus {
  if ((row.report_count ?? 0) > 0) return 'flagged';
  if (row.is_hidden) return 'hidden';
  return 'visible';
}

function mapReviewReports(row: Pick<ReviewRow, 'report_reasons' | 'report_count'>): UserReport[] {
  const reasons = Array.isArray(row.report_reasons) ? row.report_reasons : [];
  if (reasons.length > 0) {
    return reasons.map((reason, idx) => ({
      userId: `reporter-${idx + 1}`,
      reason: reason as ReportReason,
    }));
  }
  const count = Math.max(0, Number(row.report_count ?? 0));
  return Array.from({ length: count }, (_, idx) => ({
    userId: `reporter-${idx + 1}`,
    reason: 'other' as ReportReason,
  }));
}

function dataUrlToBlob(dataUrl: string): { blob: Blob; ext: string } {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('Invalid image data format.');
  }
  const mime = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  return { blob: new Blob([bytes], { type: mime }), ext };
}

async function uploadPhotoToBucket(userId: string, benchId: string, src: string): Promise<string> {
  if (!src.startsWith('data:')) {
    return src;
  }
  const { blob, ext } = dataUrlToBlob(src);
  const fileId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${userId}/${benchId}/${fileId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: false,
    });

  if (uploadError) {
    throw new Error(uploadError.message || 'Failed to upload photo.');
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function removePhotoFromBucketIfOwnedUrl(photoSrc?: string): Promise<void> {
  if (!photoSrc) return;
  const marker = `/storage/v1/object/public/${STORAGE_BUCKET}/`;
  const idx = photoSrc.indexOf(marker);
  if (idx === -1) return;
  const storagePath = decodeURIComponent(photoSrc.slice(idx + marker.length).split('?')[0]);
  if (!storagePath) return;
  try {
    await supabase.storage.from(STORAGE_BUCKET).remove([storagePath]);
  } catch {
    // Ignore storage cleanup failure
  }
}

class SupabaseBenchService {
  private benchCache = new Map<string, Bench>();
  private profileCache: Record<string, ProfileRow> = {};

  private async ensureProfiles(userIds: string[]): Promise<Record<string, ProfileRow>> {
    const missing = [...new Set(userIds.filter((id) => id && !Boolean(this.profileCache[id])))];
    if (missing.length > 0) {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, display_name, units, age, avatar_url')
        .in('id', missing);
      if (!error && data) {
        for (const row of data as ProfileRow[]) {
          this.profileCache[row.id] = row;
        }
      }
    }
    return this.profileCache;
  }

  private mapBenchRow(row: BenchRow, profiles: Record<string, ProfileRow>): Bench {
    const prof = profiles[row.owner_id];
    return {
      id: row.id,
      country_code: 'GB',
      region: 'Community find',
      name: row.name,
      lat: row.lat,
      lng: row.lng,
      difficulty: row.difficulty,
      tier: tierForDifficulty(row.difficulty),
      material: row.material,
      materialNote: row.material_note ?? undefined,
      directions: row.directions,
      notes: row.notes ?? undefined,
      photo: row.photo_url ?? undefined,
      mainPhotoSetByPhotographer: false,
      createdBy: {
        id: row.owner_id,
        name: prof?.display_name ?? 'Bench Explorer',
        age: prof?.age ?? undefined,
        avatar: prof?.avatar_url ?? undefined,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: 'user',
    };
  }

  private mapReviewRow(r: ReviewRow, profiles: Record<string, ProfileRow>): Review {
    return {
      id: r.id,
      benchId: r.bench_id,
      author: {
        id: r.author_id,
        name: profiles[r.author_id]?.display_name ?? 'Bench Explorer',
        age: profiles[r.author_id]?.age ?? undefined,
        avatar: profiles[r.author_id]?.avatar_url ?? undefined,
      } satisfies PublicAuthor,
      body: r.body,
      rating:
        typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5
          ? (r.rating as 1 | 2 | 3 | 4 | 5)
          : undefined,
      createdAt: r.created_at,
      status: resolveModerationStatus(r),
      reports: mapReviewReports(r),
    };
  }

  async getCurrentUser(): Promise<User | null> {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;
    const authUser = data.user;

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('id, display_name, units, age, avatar_url')
      .eq('id', authUser.id)
      .maybeSingle();

    const metaName =
      typeof authUser.user_metadata?.display_name === 'string' && authUser.user_metadata.display_name.trim()
        ? authUser.user_metadata.display_name.trim()
        : authUser.email?.split('@')[0] || 'Bench Explorer';

    let profile = profileRow as ProfileRow | null;
    if (!profile) {
      const { data: created } = await supabase
        .from('profiles')
        .upsert(
          {
            id: authUser.id,
            display_name: metaName,
            units: 'metric',
          },
          { onConflict: 'id' },
        )
        .select('id, display_name, units, age, avatar_url')
        .single();
      profile = (created as ProfileRow | null) ?? {
        id: authUser.id,
        display_name: metaName,
        units: 'metric',
        age: null,
        avatar_url: null,
      };
    }

    if (profile) {
      this.profileCache[profile.id] = profile;
    }

    return {
      id: authUser.id,
      name: profile?.display_name ?? metaName,
      email: authUser.email ?? '',
      age: profile?.age ?? undefined,
      avatar: profile?.avatar_url ?? undefined,
      role: 'user',
      prefs: {
        creditAnonymously: false,
        defaultLayer: 'default',
        units: profile?.units === 'imperial' ? 'imperial' : 'metric',
      },
    };
  }

  async signInWithPassword(email: string, password: string): Promise<User> {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error || !data.user) {
      throw new Error(error?.message || 'Sign in failed.');
    }
    const user = await this.getCurrentUser();
    if (!user) throw new Error('Could not load user profile.');
    return user;
  }

  async signUpWithPassword(
    email: string,
    password: string,
    displayName?: string,
  ): Promise<{ user: User | null; needsConfirmation: boolean }> {
    const trimmedName = displayName?.trim() || email.split('@')[0] || 'Bench Explorer';
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: trimmedName },
      },
    });
    if (error) {
      throw new Error(error.message || 'Sign up failed.');
    }
    if (!data.session || !data.user) {
      return { user: null, needsConfirmation: true };
    }
    const user = await this.getCurrentUser();
    return { user, needsConfirmation: false };
  }

  async resendConfirmationEmail(email: string): Promise<void> {
    const trimmed = email.trim();
    if (!trimmed) {
      throw new Error('Enter your email address first.');
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: trimmed,
    });
    if (error) {
      throw new Error(error.message || 'Could not resend confirmation email.');
    }
  }

  async signOut(): Promise<void> {
    const { error } = await supabase.auth.signOut();
    if (error) {
      throw new Error(error.message || 'Sign out failed.');
    }
  }

  onAuthStateChange(callback: (user: User | null) => void): () => void {
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user) {
        callback(null);
        return;
      }
      void this.getCurrentUser().then(callback);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }

  async updateProfile(
    userId: string,
    patch: { name: string; age?: number; avatar?: string; prefs: UserPreferences },
  ): Promise<UserPreferences> {
    const cleanName = patch.name.trim() || 'Bench Explorer';
    let avatarUrl = patch.avatar ?? null;
    if (avatarUrl && avatarUrl.startsWith('data:')) {
      avatarUrl = await uploadPhotoToBucket(userId, 'avatars', avatarUrl);
    }
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: cleanName,
        units: patch.prefs.units,
        age: patch.age ?? null,
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);
    if (error) {
      throw new Error(error.message || 'Could not update profile.');
    }
    this.profileCache[userId] = {
      id: userId,
      display_name: cleanName,
      units: patch.prefs.units,
      age: patch.age ?? null,
      avatar_url: avatarUrl,
    };
    return patch.prefs;
  }

  async listBenches(country: CountryCode = 'GB', includeSamples = true): Promise<Bench[]> {
    const { data, error } = await supabase
      .from('benches')
      .select('id, owner_id, name, lat, lng, difficulty, material, material_note, directions, notes, photo_url, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message || 'Failed to load benches.');
    }

    const rows = (data ?? []) as BenchRow[];
    const profiles = await this.ensureProfiles(rows.map((r) => r.owner_id));
    const userBenches = rows.map((r) => this.mapBenchRow(r, profiles));

    this.benchCache.clear();
    for (const b of userBenches) {
      this.benchCache.set(b.id, b);
    }

    const combined = includeSamples ? [...SAMPLE_BENCHES, ...userBenches] : userBenches;
    return combined.filter((b) => b.country_code === country);
  }

  getCachedBench(id: string): Bench | undefined {
    return this.benchCache.get(id) ?? SAMPLE_BENCHES.find((b) => b.id === id);
  }

  findNearby(
    benches: Bench[],
    p: LngLat,
    opts: { radiusM?: number; excludeId?: string; country?: CountryCode } = {},
  ): NearbyMatch | null {
    const radius = opts.radiusM ?? DUPLICATE_RADIUS_M;
    let best: NearbyMatch | null = null;
    for (const b of benches) {
      if (opts.country && b.country_code !== opts.country) continue;
      if (b.id === opts.excludeId) continue;
      const d = distanceM(p, b);
      if (d <= radius && (!best || d < best.distanceM)) {
        best = { bench: b, distanceM: d };
      }
    }
    return best;
  }

  async createBench(input: NewBenchInput, existingBenches: Bench[]): Promise<Bench> {
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr || !authData.user) {
      throw new Error('Sign in to log a bench.');
    }
    const ownerId = authData.user.id;

    const dup = this.findNearby(existingBenches, input, { country: input.country_code });
    if (dup) {
      throw new DuplicateBenchError(dup);
    }

    const benchId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let photoUrl: string | null = null;
    if (input.photo) {
      photoUrl = await uploadPhotoToBucket(ownerId, benchId, input.photo);
    }

    const lat = roundCoord(input.lat);
    const lng = roundCoord(input.lng);

    const { data, error } = await supabase
      .from('benches')
      .insert({
        id: benchId,
        owner_id: ownerId,
        name: input.name.trim() || 'Unnamed bench',
        lat,
        lng,
        difficulty: input.difficulty,
        material: input.material,
        material_note: input.materialNote?.trim() || null,
        directions: input.directions.trim(),
        notes: input.notes?.trim() || null,
        photo_url: photoUrl,
      })
      .select('id, owner_id, name, lat, lng, difficulty, material, material_note, directions, notes, photo_url, created_at, updated_at')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Could not save bench.');
    }

    if (photoUrl) {
      try {
        await supabase.from('bench_photos').insert({
          bench_id: benchId,
          uploader_id: ownerId,
          photo_url: photoUrl,
          context_tag: toDbPhotoTag('bench-view'),
          caption: 'Initial bench photo',
          is_hidden: false,
          report_count: 0,
        });
      } catch {
        // Ignore if initial gallery row fails
      }
    }

    const profiles = await this.ensureProfiles([ownerId]);
    const mapped = this.mapBenchRow(data as BenchRow, profiles);
    this.benchCache.set(mapped.id, mapped);
    return mapped;
  }

  async updateBench(
    id: string,
    patch: BenchEditable,
    actorId: string,
    existingBenches: Bench[],
  ): Promise<Bench> {
    const current = existingBenches.find((b) => b.id === id);
    if (!current || current.source === 'sample') {
      throw new Error('Sample benches cannot be edited.');
    }
    if (current.createdBy?.id !== actorId) {
      throw new Error('You can only edit benches you logged.');
    }

    const dup = this.findNearby(existingBenches, patch, { excludeId: id, country: current.country_code });
    if (dup) {
      throw new DuplicateBenchError(dup);
    }

    const preservedMainPhotoUrl: string | null = current.photo ?? null;

    const { data, error } = await supabase
      .from('benches')
      .update({
        name: patch.name.trim() || 'Unnamed bench',
        difficulty: patch.difficulty,
        material: patch.material,
        material_note: patch.materialNote?.trim() || null,
        directions: patch.directions.trim(),
        notes: patch.notes?.trim() || null,
        photo_url: preservedMainPhotoUrl,
        lat: roundCoord(patch.lat),
        lng: roundCoord(patch.lng),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('owner_id', actorId)
      .select('id, owner_id, name, lat, lng, difficulty, material, material_note, directions, notes, photo_url, created_at, updated_at')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Could not update bench.');
    }

    const profiles = await this.ensureProfiles([actorId]);
    const mapped = this.mapBenchRow(data as BenchRow, profiles);
    this.benchCache.set(mapped.id, mapped);
    return mapped;
  }

  async setMainPhotoAsPhotographer(
    benchId: string,
    photographerId: string,
    newPhotoSrc: string,
  ): Promise<Bench> {
    if (!isUuid(benchId)) {
      throw new Error('Invalid bench ID.');
    }
    const photoUrl = await uploadPhotoToBucket(photographerId, benchId, newPhotoSrc);
    const nowIso = new Date().toISOString();

    const { data, error } = await supabase
      .from('benches')
      .update({
        photo_url: photoUrl,
        updated_at: nowIso,
      })
      .eq('id', benchId)
      .select('id, owner_id, name, lat, lng, difficulty, material, material_note, directions, notes, photo_url, created_at, updated_at')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Could not update main bench photo.');
    }

    try {
      await supabase.from('bench_photos').insert({
        bench_id: benchId,
        uploader_id: photographerId,
        photo_url: photoUrl,
        context_tag: toDbPhotoTag('bench-view'),
        caption: 'Updated main bench photo',
        is_hidden: false,
        report_count: 0,
      });
    } catch {
      // Ignore if gallery row fails
    }

    const row = data as BenchRow;
    const profiles = await this.ensureProfiles([row.owner_id, photographerId]);
    const mapped: Bench = {
      ...this.mapBenchRow(row, profiles),
      mainPhotoSetByPhotographer: true,
      mainPhotoUpdatedAt: nowIso,
    };
    this.benchCache.set(mapped.id, mapped);
    return mapped;
  }

  async listReviews(benchId: string, viewerId?: string): Promise<Review[]> {
    if (!isUuid(benchId)) return [];
    const { data, error } = await supabase
      .from('bench_reviews')
      .select('*')
      .eq('bench_id', benchId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message || 'Failed to load reviews.');
    }

    const rows = ((data ?? []) as ReviewRow[]).filter(
      (r) => (!r.is_hidden && (r.report_count ?? 0) === 0) || r.author_id === viewerId,
    );
    const profiles = await this.ensureProfiles(rows.map((r) => r.author_id));
    return rows.map((r) => this.mapReviewRow(r, profiles));
  }

  async listFlaggedReviews(): Promise<Review[]> {
    const { data, error } = await supabase
      .from('bench_reviews')
      .select('*')
      .or('is_hidden.eq.true,report_count.gt.0')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message || 'Failed to load review moderation queue.');
    }

    const rows = (data ?? []) as ReviewRow[];
    const profiles = await this.ensureProfiles(rows.map((r) => r.author_id));
    return rows.map((r) => this.mapReviewRow(r, profiles));
  }

  async addReview(input: { benchId: string; authorId: string; body: string; rating?: 1 | 2 | 3 | 4 | 5 }): Promise<Review> {
    if (!isUuid(input.benchId)) {
      throw new Error('Sample benches do not support Supabase reviews yet — log a bench to post reviews.');
    }
    const trimmed = input.body.trim();
    if (!trimmed) throw new Error('Write something before posting.');
    if (trimmed.length > 10000) throw new Error('Reviews are limited to 10,000 characters.');

    const { data, error } = await supabase
      .from('bench_reviews')
      .insert({
        bench_id: input.benchId,
        author_id: input.authorId,
        body: trimmed,
        ...(typeof input.rating === 'number' ? { rating: input.rating } : {}),
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Could not post review.');
    }

    const profiles = await this.ensureProfiles([input.authorId]);
    const row = data as ReviewRow;
    return {
      ...this.mapReviewRow(row, profiles),
      rating:
        typeof row.rating === 'number' && row.rating >= 1 && row.rating <= 5
          ? (row.rating as 1 | 2 | 3 | 4 | 5)
          : input.rating,
    };
  }

  async updateReview(id: string, authorId: string, body: string, rating?: 1 | 2 | 3 | 4 | 5): Promise<void> {
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Write something before posting.');
    if (trimmed.length > 10000) throw new Error('Reviews are limited to 10,000 characters.');

    const { error } = await supabase
      .from('bench_reviews')
      .update({ body: trimmed, ...(typeof rating === 'number' ? { rating } : {}) })
      .eq('id', id)
      .eq('author_id', authorId);

    if (error) {
      throw new Error(error.message || 'Could not update review.');
    }
  }

  async deleteReview(id: string, authorId: string): Promise<void> {
    const { error } = await supabase
      .from('bench_reviews')
      .delete()
      .eq('id', id)
      .eq('author_id', authorId);

    if (error) {
      throw new Error(error.message || 'Could not delete review.');
    }
  }

  async reportReview(reviewId: string, reason: ReportReason): Promise<void> {
    if (!isUuid(reviewId)) return;
    const { error } = await supabase.rpc('report_bench_review', {
      p_review_id: reviewId,
      p_reason: reason,
    });
    if (error) {
      throw new Error(error.message || 'Could not report review.');
    }
  }

  async moderateReview(reviewId: string, decision: ModerationStatus | 'delete'): Promise<void> {
    if (!isUuid(reviewId)) return;

    if (decision === 'delete') {
      const { data, error } = await supabase
        .from('bench_reviews')
        .delete()
        .eq('id', reviewId)
        .select('id');
      if (error) {
        throw new Error(error.message || 'Could not delete review.');
      }
      if (!data || data.length === 0) {
        throw new Error(
          'Delete blocked by Supabase RLS policy — grant moderator DELETE permission on bench_reviews.',
        );
      }
      return;
    }

    const patch =
      decision === 'visible'
        ? { is_hidden: false, report_count: 0, report_reasons: [] }
        : decision === 'flagged'
          ? { is_hidden: true, report_count: 1 }
          : { is_hidden: true, report_count: 0 };

    const { data, error } = await supabase
      .from('bench_reviews')
      .update(patch)
      .eq('id', reviewId)
      .select('id');
    if (error) {
      throw new Error(error.message || 'Could not update review moderation status.');
    }
    if (!data || data.length === 0) {
      throw new Error(
        'Update blocked by Supabase RLS policy — grant moderator UPDATE permission on bench_reviews.',
      );
    }
  }

  async listPhotos(benchId: string, viewerId?: string): Promise<GalleryPhoto[]> {
    if (!isUuid(benchId)) return [];
    const { data, error } = await supabase
      .from('bench_photos')
      .select('id, bench_id, uploader_id, photo_url, context_tag, caption, is_hidden, report_count, created_at')
      .eq('bench_id', benchId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(error.message || 'Failed to load bench photos.');
    }

    const rows = ((data ?? []) as PhotoRow[]).filter(
      (r) => (!r.is_hidden && r.report_count === 0) || r.uploader_id === viewerId,
    );
    const profiles = await this.ensureProfiles(rows.map((r) => r.uploader_id));

    return rows.map((r) => ({
      id: r.id,
      benchId: r.bench_id,
      author: {
        id: r.uploader_id,
        name: profiles[r.uploader_id]?.display_name ?? 'Bench Explorer',
        age: profiles[r.uploader_id]?.age ?? undefined,
        avatar: profiles[r.uploader_id]?.avatar_url ?? undefined,
      },
      src: r.photo_url,
      tag: fromDbPhotoTag(r.context_tag),
      caption: r.caption ?? '',
      width: 0,
      height: 0,
      bytes: 0,
      contentHash: '',
      createdAt: r.created_at,
      status: resolveModerationStatus(r),
      reports: [],
    }));
  }

  async listFlaggedPhotos(): Promise<GalleryPhoto[]> {
    const { data, error } = await supabase
      .from('bench_photos')
      .select('id, bench_id, uploader_id, photo_url, context_tag, caption, is_hidden, report_count, created_at')
      .or('is_hidden.eq.true,report_count.gt.0')
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message || 'Failed to load moderation queue.');
    }

    const rows = (data ?? []) as PhotoRow[];
    const profiles = await this.ensureProfiles(rows.map((r) => r.uploader_id));

    return rows.map((r) => ({
      id: r.id,
      benchId: r.bench_id,
      author: {
        id: r.uploader_id,
        name: profiles[r.uploader_id]?.display_name ?? 'Bench Explorer',
        age: profiles[r.uploader_id]?.age ?? undefined,
        avatar: profiles[r.uploader_id]?.avatar_url ?? undefined,
      },
      src: r.photo_url,
      tag: fromDbPhotoTag(r.context_tag),
      caption: r.caption ?? '',
      width: 0,
      height: 0,
      bytes: 0,
      contentHash: '',
      createdAt: r.created_at,
      status: resolveModerationStatus(r),
      reports: [],
    }));
  }

  async moderatePhoto(
    photoId: string,
    decision: ModerationStatus | 'delete',
    photoSrc?: string,
  ): Promise<void> {
    if (!isUuid(photoId)) return;

    if (decision === 'delete') {
      const { data, error } = await supabase
        .from('bench_photos')
        .delete()
        .eq('id', photoId)
        .select('id');
      if (error) {
        throw new Error(error.message || 'Could not delete photo.');
      }
      if (!data || data.length === 0) {
        throw new Error(
          'Delete blocked by Supabase RLS policy — grant moderator DELETE permission on bench_photos.',
        );
      }
      await removePhotoFromBucketIfOwnedUrl(photoSrc);
      return;
    }

    const patch =
      decision === 'visible'
        ? { is_hidden: false, report_count: 0 }
        : decision === 'flagged'
          ? { is_hidden: true, report_count: 1 }
          : { is_hidden: true, report_count: 0 };

    const { data, error } = await supabase
      .from('bench_photos')
      .update(patch)
      .eq('id', photoId)
      .select('id');
    if (error) {
      throw new Error(error.message || 'Could not update photo moderation status.');
    }
    if (!data || data.length === 0) {
      throw new Error(
        'Update blocked by Supabase RLS policy — grant moderator UPDATE permission on bench_photos.',
      );
    }
  }

  async addPhoto(input: {
    benchId: string;
    uploaderId: string;
    src: string;
    tag: PhotoTag;
    caption: string;
    width?: number;
    height?: number;
    bytes?: number;
    contentHash?: string;
    moderationStatus?: ModerationStatus;
  }): Promise<GalleryPhoto> {
    if (!isUuid(input.benchId)) {
      throw new Error('Sample benches do not support Supabase photo uploads yet — log a bench to add photos.');
    }
    if (!PHOTO_TAGS.some((t) => t.value === input.tag)) {
      throw new Error('Choose what the photo shows.');
    }
    const caption = input.caption.trim();
    if (caption.length > 240) {
      throw new Error('Captions are limited to 240 characters.');
    }

    const status: ModerationStatus = input.moderationStatus ?? 'visible';
    const isHidden = status === 'hidden' || status === 'flagged';
    const reportCount = status === 'flagged' ? 1 : 0;

    const photoUrl = await uploadPhotoToBucket(input.uploaderId, input.benchId, input.src);

    const { data, error } = await supabase
      .from('bench_photos')
      .insert({
        bench_id: input.benchId,
        uploader_id: input.uploaderId,
        photo_url: photoUrl,
        context_tag: toDbPhotoTag(input.tag),
        caption: caption || null,
        is_hidden: isHidden,
        report_count: reportCount,
      })
      .select('id, bench_id, uploader_id, photo_url, context_tag, caption, is_hidden, report_count, created_at')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Could not add photo.');
    }

    const profiles = await this.ensureProfiles([input.uploaderId]);
    const row = data as PhotoRow;
    const resolvedStatus = resolveModerationStatus(row);

    return {
      id: row.id,
      benchId: row.bench_id,
      author: {
        id: row.uploader_id,
        name: profiles[row.uploader_id]?.display_name ?? 'Bench Explorer',
      },
      src: row.photo_url,
      tag: fromDbPhotoTag(row.context_tag),
      caption: row.caption ?? '',
      width: input.width ?? 0,
      height: input.height ?? 0,
      bytes: input.bytes ?? 0,
      contentHash: input.contentHash ?? '',
      createdAt: row.created_at,
      status: resolvedStatus,
      reports: [],
    };
  }

  async deletePhoto(photoId: string, actorId: string, photoSrc?: string): Promise<void> {
    if (!isUuid(photoId)) return;
    const { error } = await supabase
      .from('bench_photos')
      .delete()
      .eq('id', photoId)
      .eq('uploader_id', actorId);

    if (error) {
      throw new Error(error.message || 'Could not delete photo.');
    }

    await removePhotoFromBucketIfOwnedUrl(photoSrc);
  }

  async reportPhoto(photoId: string, _reporterId: string, _reason: ReportReason): Promise<void> {
    const { data, error: readErr } = await supabase
      .from('bench_photos')
      .select('report_count')
      .eq('id', photoId)
      .single();

    if (readErr || !data) {
      throw new Error(readErr?.message || 'Photo not found.');
    }

    const nextCount = Number((data as { report_count: number }).report_count ?? 0) + 1;
    const { error: updErr } = await supabase
      .from('bench_photos')
      .update({
        report_count: nextCount,
        is_hidden: nextCount >= 3,
      })
      .eq('id', photoId);

    if (updErr) {
      throw new Error(updErr.message || 'Could not report photo.');
    }
  }
}

export function validateDisplayName(name: string): string | null {
  const t = name.trim();
  if (!t) return 'Enter a display name.';
  if (t.length < 2) return 'Display name must be at least 2 characters.';
  if (t.length > 40) return 'Display name must be 40 characters or fewer.';
  return null;
}

export const benchService = new SupabaseBenchService();