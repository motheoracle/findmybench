-- FindMyBench v0.2 Schema & Row-Level Security Reference
-- Run/review in Supabase SQL Editor before opening to public traffic.

alter table if exists public.bench_reviews
  add column if not exists rating smallint check (rating between 1 and 5);

alter table if exists public.benches enable row level security;
alter table if exists public.bench_reviews enable row level security;
alter table if exists public.gallery_photos enable row level security;

-- Public read access for visible records
drop policy if exists "Public read benches" on public.benches;
create policy "Public read benches" on public.benches
  for select using (true);

drop policy if exists "Authenticated insert benches" on public.benches;
create policy "Authenticated insert benches" on public.benches
  for insert with check (auth.uid() = owner_id);

drop policy if exists "Owner update benches" on public.benches;
create policy "Owner update benches" on public.benches
  for update using (auth.uid() = owner_id);

drop policy if exists "Owner delete benches" on public.benches;
create policy "Owner delete benches" on public.benches
  for delete using (auth.uid() = owner_id);

drop policy if exists "Public read reviews" on public.bench_reviews;
create policy "Public read reviews" on public.bench_reviews
  for select using (true);

drop policy if exists "Authenticated insert reviews" on public.bench_reviews;
create policy "Authenticated insert reviews" on public.bench_reviews
  for insert with check (auth.uid() = author_id);

drop policy if exists "Author update reviews" on public.bench_reviews;
create policy "Author update reviews" on public.bench_reviews
  for update using (auth.uid() = author_id);

drop policy if exists "Author delete reviews" on public.bench_reviews;
create policy "Author delete reviews" on public.bench_reviews
  for delete using (auth.uid() = author_id);

-- Bench gallery photos & storage bucket hygiene
alter table if exists public.bench_photos enable row level security;

drop policy if exists "bench_photos_select_public" on public.bench_photos;
create policy "bench_photos_select_public"
on public.bench_photos for select
using (not coalesce(is_hidden, false) or auth.uid() = uploader_id);

drop policy if exists "bench_photos_insert_auth" on public.bench_photos;
create policy "bench_photos_insert_auth"
on public.bench_photos for insert
with check (auth.uid() = uploader_id);

drop policy if exists "bench_photos_delete_owner" on public.bench_photos;
create policy "bench_photos_delete_owner"
on public.bench_photos for delete
using (auth.uid() = uploader_id);
