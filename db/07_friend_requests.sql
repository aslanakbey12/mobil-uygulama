-- Arkadaşlık İSTEĞİ modeli (kod yerine kullanıcı adı + karşı tarafın onayı).
-- Supabase SQL Editor'da çalıştır. Idempotent.
--
-- Akış: A, B'nin kullanıcı adını girer → friend_requests(from=A, to=B) oluşur.
-- B kabul ederse friendships çift yönlü yazılır + istek silinir. B reddederse istek silinir.
-- (Eski kodla-ekle friend_codes/friendships tabloları duruyor; yeni istemci bunu kullanır.)

create table if not exists public.friend_requests (
  id         bigint generated always as identity primary key,
  from_user  uuid not null references auth.users(id) on delete cascade,
  to_user    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (from_user, to_user)
);
create index if not exists friend_requests_to_idx on public.friend_requests (to_user, created_at desc);

-- RLS aç, policy verme → yalnız sunucu (service-role) erişir; istemci doğrudan erişemez.
alter table public.friend_requests enable row level security;
