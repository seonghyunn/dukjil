alter table public.concerts
  add column if not exists setlist_source_id text,
  add column if not exists setlist_source_url text;
