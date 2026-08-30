alter table public.concert_reviews
  add column if not exists rating numeric(2,1);

alter table public.concert_reviews
  add constraint concert_reviews_rating_range
  check (rating is null or (rating >= 0.5 and rating <= 5 and mod(rating * 10, 5) = 0));
