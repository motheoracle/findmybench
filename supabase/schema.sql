-- FindMyBench — draft Supabase schema for v2 (not used by the v1 prototype).
-- Mirrors src/types.ts. Country-scoped from day one for global expansion.

create type difficulty as enum ('easy', 'moderate', 'tricky', 'hidden');
create type bench_tier as enum ('standard', 'obscure');
create type bench_material as enum ('wood', 'metal', 'stone', 'composite', 'mixed');

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  user_id uuid primary key references auth.users on delete cascade,
  obscure_active boolean not null default false,
  provider text,                 -- 'revenuecat' | 'stripe' | 'apple' | 'google'
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);

create table public.benches (
  id uuid primary key default gen_random_uuid(),
  country_code char(2) not null default 'GB',
  region text not null,
  name text not null,
  lat double precision not null,
  lng double precision not null,
  difficulty difficulty not null,
  tier bench_tier generated always as (
    case when difficulty in ('tricky', 'hidden') then 'obscure'::bench_tier else 'standard'::bench_tier end
  ) stored,
  material bench_material not null,
  material_note text,
  directions text not null,
  notes text,
  photo_path text,               -- Supabase Storage object path
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);
create index benches_country_idx on public.benches (country_code, tier);

alter table public.benches enable row level security;

-- Everyone can read standard benches.
create policy "standard benches are public" on public.benches
  for select using (tier = 'standard');

-- Obscure benches: full rows only for subscribers and the bench's creator.
create policy "obscure benches for subscribers" on public.benches
  for select using (
    tier = 'obscure' and (
      created_by = auth.uid()
      or exists (select 1 from public.subscriptions s where s.user_id = auth.uid() and s.obscure_active)
    )
  );

-- Signed-in users can log benches as themselves.
create policy "users insert own benches" on public.benches
  for insert with check (auth.uid() = created_by);

-- Locked previews: expose only an approximate location + teaser fields to everyone.
create or replace view public.obscure_bench_previews as
select
  id, country_code, region, difficulty, tier,
  round(lat::numeric, 2)::double precision as approx_lat,   -- ~1 km
  round(lng::numeric, 2)::double precision as approx_lng
from public.benches
where tier = 'obscure';

-- ============================================================
-- v0.2 additions: editing, reviews, gallery, moderation, prefs
-- ============================================================

alter table public.profiles
  add column credit_anonymously boolean not null default false,
  add column default_layer text not null default 'default' check (default_layer in ('default','satellite','terrain')),
  add column units text not null default 'metric' check (units in ('metric','imperial'));
-- Public view: the ONLY profile fields other users can read. Email/auth/billing never leave auth.users / subscriptions.
create or replace view public.public_profiles as
select id, case when credit_anonymously then 'Anonymous bench hunter' else display_name end as display_name
from public.profiles;

alter table public.benches add column updated_at timestamptz;
-- Owners edit their own benches.
create policy "owners update own benches" on public.benches
  for update using (created_by = auth.uid()) with check (created_by = auth.uid());

-- Duplicate guard (PostGIS). Enforced in the database, not just the client.
create extension if not exists postgis;
alter table public.benches add column geog geography(point, 4326)
  generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored;
create index benches_geog_idx on public.benches using gist (geog);
create or replace function public.reject_duplicate_bench() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.benches b
             where b.id <> new.id and st_dwithin(b.geog, st_setsrid(st_makepoint(new.lng, new.lat), 4326)::geography, 20)) then
    raise exception 'duplicate_bench' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger benches_no_duplicates before insert or update of lat, lng on public.benches
  for each row execute function public.reject_duplicate_bench();
-- Client-facing nearby check returns only id + distance (no coordinates) so it can't be used to probe locked benches.
create or replace function public.nearby_bench(p_lat double precision, p_lng double precision, p_radius_m int default 20)
returns table (id uuid, distance_m double precision) language sql stable security definer as $$
  select b.id, st_distance(b.geog, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography)
  from public.benches b
  where st_dwithin(b.geog, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, p_radius_m)
  order by 2 limit 1;
$$;

create type moderation_status as enum ('visible', 'flagged', 'hidden');

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  bench_id uuid not null references public.benches on delete cascade,
  author_id uuid not null references auth.users on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  rating smallint check (rating between 1 and 5),
  status moderation_status not null default 'visible',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
alter table public.reviews enable row level security;
create policy "read visible reviews" on public.reviews for select using (status <> 'hidden' or author_id = auth.uid());
create policy "write own reviews" on public.reviews for insert with check (author_id = auth.uid());
create policy "edit own reviews" on public.reviews for update using (author_id = auth.uid());
create policy "delete own reviews" on public.reviews for delete using (author_id = auth.uid());

create type photo_tag as enum ('bench-view', 'pov', 'nearby');
create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  bench_id uuid not null references public.benches on delete cascade,
  author_id uuid not null references auth.users on delete cascade,
  storage_path text not null,           -- bench-photos/{bench_id}/{author_id}/{uuid}.jpg
  tag photo_tag not null,
  caption text not null default '' check (char_length(caption) <= 140),
  width int not null check (width >= 320), height int not null check (height >= 320),
  bytes int not null check (bytes <= 15728640),
  phash text not null,                  -- perceptual hash computed server-side (Edge Function)
  status moderation_status not null default 'visible',
  created_at timestamptz not null default now(),
  unique (bench_id, phash)
);
alter table public.gallery_photos enable row level security;
create policy "read visible photos" on public.gallery_photos for select using (status <> 'hidden' or author_id = auth.uid());
create policy "authenticated upload own" on public.gallery_photos for insert with check (author_id = auth.uid());
create policy "delete own photos" on public.gallery_photos for delete using (author_id = auth.uid());
create or replace function public.enforce_photo_caps() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.gallery_photos where bench_id = new.bench_id and author_id = new.author_id) >= 3 then
    raise exception 'photo_cap_user';
  end if;
  if (select count(*) from public.gallery_photos where bench_id = new.bench_id) >= 40 then
    raise exception 'photo_cap_bench';
  end if;
  return new;
end $$;
create trigger gallery_caps before insert on public.gallery_photos for each row execute function public.enforce_photo_caps();
-- Storage: bucket 'bench-photos' with allowed_mime_types = {image/jpeg,image/png,image/webp,image/heic},
-- file_size_limit = 15MB, INSERT policy: auth.role() = 'authenticated' and (storage.foldername(name))[2] = auth.uid()::text.

-- Reports: one per user per item; 3 distinct reports auto-hide.
create table public.content_reports (
  id bigserial primary key,
  target_type text not null check (target_type in ('photo', 'review')),
  target_id uuid not null,
  reporter_id uuid not null references auth.users on delete cascade,
  reason text not null check (reason in ('off-topic','inappropriate','privacy','spam','other')),
  created_at timestamptz not null default now(),
  unique (target_type, target_id, reporter_id)
);
alter table public.content_reports enable row level security;
create policy "report as self" on public.content_reports for insert with check (reporter_id = auth.uid());
-- (A trigger on content_reports sets the target's status to 'flagged', or 'hidden' at >= 3 reports.)
