create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  origin_name text not null default '서울',
  origin_address text not null default '서울특별시 중구',
  origin_latitude double precision not null default 37.5665,
  origin_longitude double precision not null default 126.978,
  origin_country_code text not null default 'KR',
  updated_at timestamptz not null default now()
);

create table if not exists public.concerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  performance_at timestamptz not null,
  venue text not null,
  address text,
  latitude double precision,
  longitude double precision,
  country_code text not null default 'KR',
  booking_provider text,
  source_url text,
  list_price integer check (list_price is null or list_price >= 0),
  paid_amount integer check (paid_amount is null or paid_amount >= 0),
  status text not null check (status in ('scheduled', 'attended')),
  review text not null default '' check (char_length(review) <= 5000),
  poster_url text,
  poster_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table if not exists public.concert_artists (
  concert_id uuid not null references public.concerts(id) on delete cascade,
  artist_id uuid not null references public.artists(id) on delete restrict,
  primary key (concert_id, artist_id)
);

create index if not exists idx_concerts_user_performance on public.concerts(user_id, performance_at);
create index if not exists idx_concerts_user_status on public.concerts(user_id, status);
create index if not exists idx_concert_artists_artist on public.concert_artists(artist_id);

alter table public.profiles enable row level security;
alter table public.concerts enable row level security;
alter table public.artists enable row level security;
alter table public.concert_artists enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "concerts_select_own" on public.concerts for select to authenticated using ((select auth.uid()) = user_id);
create policy "concerts_insert_own" on public.concerts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "concerts_update_own" on public.concerts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "concerts_delete_own" on public.concerts for delete to authenticated using ((select auth.uid()) = user_id);
create policy "artists_read" on public.artists for select to authenticated using (true);
create policy "artists_add" on public.artists for insert to authenticated with check (char_length(name) between 1 and 120);
create policy "links_select_own" on public.concert_artists for select to authenticated using (exists (select 1 from public.concerts c where c.id = concert_id and c.user_id = (select auth.uid())));
create policy "links_insert_own" on public.concert_artists for insert to authenticated with check (exists (select 1 from public.concerts c where c.id = concert_id and c.user_id = (select auth.uid())));
create policy "links_delete_own" on public.concert_artists for delete to authenticated using (exists (select 1 from public.concerts c where c.id = concert_id and c.user_id = (select auth.uid())));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posters', 'posters', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "poster_read_own" on storage.objects for select to authenticated using (bucket_id = 'posters' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "poster_add_own" on storage.objects for insert to authenticated with check (bucket_id = 'posters' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "poster_update_own" on storage.objects for update to authenticated using (bucket_id = 'posters' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "poster_delete_own" on storage.objects for delete to authenticated using (bucket_id = 'posters' and (storage.foldername(name))[1] = (select auth.uid())::text);
