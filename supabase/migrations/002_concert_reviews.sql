create table if not exists public.concert_reviews (
  id uuid primary key default gen_random_uuid(),
  concert_id uuid not null references public.concerts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists idx_concert_reviews_concert_created
  on public.concert_reviews(concert_id, created_at);

alter table public.concert_reviews enable row level security;

create policy "reviews_select_own" on public.concert_reviews for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "reviews_insert_own" on public.concert_reviews for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.concerts c
      where c.id = concert_id and c.user_id = (select auth.uid())
    )
  );
create policy "reviews_delete_own" on public.concert_reviews for delete to authenticated
  using ((select auth.uid()) = user_id);

insert into public.concert_reviews (concert_id, user_id, body, created_at)
select id, user_id, review, created_at
from public.concerts
where review <> ''
  and not exists (
    select 1 from public.concert_reviews r where r.concert_id = concerts.id
  );
