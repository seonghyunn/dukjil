create table if not exists public.concert_setlist_songs (
  id uuid primary key default gen_random_uuid(),
  concert_id uuid not null references public.concerts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position integer not null check (position > 0),
  title text not null check (char_length(title) between 1 and 300),
  created_at timestamptz not null default now(),
  unique (concert_id, position)
);

create index if not exists idx_concert_setlist_songs_concert_position
  on public.concert_setlist_songs(concert_id, position);

alter table public.concert_setlist_songs enable row level security;

create policy "setlist_select_own" on public.concert_setlist_songs for select to authenticated
  using (user_id = auth.uid());
create policy "setlist_insert_own" on public.concert_setlist_songs for insert to authenticated
  with check (user_id = auth.uid() and exists (
    select 1 from public.concerts c where c.id = concert_id and c.user_id = auth.uid()
  ));
create policy "setlist_update_own" on public.concert_setlist_songs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "setlist_delete_own" on public.concert_setlist_songs for delete to authenticated
  using (user_id = auth.uid());
