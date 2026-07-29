-- Expo Push cihaz token'ları (sosyal bildirimler: arkadaşlık isteği, davet, kabul).
-- Supabase SQL Editor'da çalıştır. Idempotent.
-- Çok cihaz desteği için PK (user_id, token). Erişim yalnız sunucu (service-role).

create table if not exists public.push_tokens (
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null,
  updated_at timestamptz default now(),
  primary key (user_id, token)
);
alter table public.push_tokens enable row level security; -- policy yok → yalnız service-role
