-- Kelime Odaları — profil alanları (kullanıcı adı, yaş + garanti sütunlar).
-- Supabase SQL Editor'da çalıştır. Idempotent: tekrar çalıştırmak güvenlidir.
-- Uygulama profiles'a şunları yazar/okur: username, name, age, level, age_confirmed.

alter table public.profiles add column if not exists username      text;
alter table public.profiles add column if not exists name          text default '';
alter table public.profiles add column if not exists age           int;
alter table public.profiles add column if not exists level         text default 'B1';
alter table public.profiles add column if not exists age_confirmed boolean default false;

-- Kullanıcı adı benzersiz (büyük/küçük harf duyarsız). Çakışırsa upsert hata verir → istemci "alınmış" der.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username));
