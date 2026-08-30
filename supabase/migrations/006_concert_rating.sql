alter table public.concerts
  add column if not exists rating numeric(2,1);

alter table public.concerts
  add constraint concerts_rating_range
  check (rating is null or (rating >= 0.5 and rating <= 5 and mod(rating * 10, 5) = 0));

update public.concerts c
set rating = (
  select r.rating
  from public.concert_reviews r
  where r.concert_id = c.id and r.rating is not null
  order by r.created_at desc
  limit 1
)
where c.rating is null
  and exists (
    select 1 from public.concert_reviews r
    where r.concert_id = c.id and r.rating is not null
  );
