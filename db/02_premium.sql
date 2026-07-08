-- Premium alanları (profiles tablosuna ekle)
alter table public.profiles add column if not exists is_premium boolean default false;
alter table public.profiles add column if not exists premium_until timestamptz;
