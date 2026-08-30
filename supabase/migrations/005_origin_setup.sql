alter table public.profiles
  add column if not exists origin_configured boolean not null default false;

update public.profiles
set origin_configured = true
where origin_name <> '' and origin_address <> '';
