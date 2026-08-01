-- 10) Arkadaşlar arası ASENKRON mesajlaşma (DM).
--
-- NEDEN: Eski akış eşzamanlıydı — "odama gel" daveti 3 dakikada ölüyordu, karşı taraf
-- o an uygulamada değilse davet eden boş odada bekliyordu. Uygulamanın kullanıcı sayısı
-- azken bu özellik fiilen hiç çalışmıyordu. Asenkron mesajlaşma her ölçekte çalışır:
-- arkadaşın ne zaman açarsa okur ve cevap yazar.
create table if not exists public.dm_messages (
  id         bigint generated always as identity primary key,
  from_user  uuid not null references auth.users(id) on delete cascade,
  to_user    uuid not null references auth.users(id) on delete cascade,
  text       text not null,
  created_at timestamptz default now(),
  read_at    timestamptz
);

-- Sohbet dizisini hızlı çek: iki kişi arasındaki mesajlar, zaman sırasıyla.
create index if not exists dm_pair_idx on public.dm_messages (from_user, to_user, created_at desc);
create index if not exists dm_inbox_idx on public.dm_messages (to_user, read_at, created_at desc);

alter table public.dm_messages enable row level security;
-- Kullanıcı yalnızca KENDİ dahil olduğu mesajları okuyabilir.
-- (Sunucu service-role ile yazar; istemci doğrudan yazmaz — moderasyon/arkadaşlık
--  kontrolü sunucuda yapılır, istemciye güvenilmez.)
drop policy if exists "own dm read" on public.dm_messages;
create policy "own dm read" on public.dm_messages
  for select using (auth.uid() = from_user or auth.uid() = to_user);
