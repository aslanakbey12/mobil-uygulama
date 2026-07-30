-- 09) Kullanıcı aktifliği / istatistik özeti — arkadaşların "aktiflik" görünümü için.
-- Kullanıcı kendi satırını yazar; sunucu (service-role) arkadaşların satırlarını okuyup
-- FriendsScreen'e döner. Hassas veri yok: sadece herkese açık ilerleme özeti.
create table if not exists public.user_stats (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  last_active timestamptz default now(),
  streak      int default 0,
  xp          int default 0,
  learned     int default 0,
  updated_at  timestamptz default now()
);
alter table public.user_stats enable row level security;
drop policy if exists "own stats" on public.user_stats;
create policy "own stats" on public.user_stats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Arkadaş id listesiyle toplu okuma hızlı olsun
create index if not exists user_stats_last_active_idx on public.user_stats (last_active desc);
