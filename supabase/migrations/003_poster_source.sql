alter table public.concerts
  add column if not exists official_poster_url text,
  add column if not exists poster_source text not null default 'official'
    check (poster_source in ('official', 'upload'));

update public.concerts
set official_poster_url = poster_url
where official_poster_url is null and poster_url is not null;
