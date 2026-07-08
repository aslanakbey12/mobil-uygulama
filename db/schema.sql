-- Kelime Odaları — Supabase şeması (Postgres).
-- Supabase SQL Editor'da çalıştır. Satır düzeyi güvenlik (RLS) açık:
-- kullanıcı yalnızca kendi verisine erişir; sunucu service-role ile RLS'i aşar.

-- 1) Profiller (auth.users'a bağlı)
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text default '',
  level         text default 'B1',
  age_confirmed boolean default false,
  created_at    timestamptz default now()
);
alter table public.profiles enable row level security;
drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- 2) İlerleme (tüm ilerleme tek jsonb satırda: cards, swipe, mined, stats, settings)
create table if not exists public.progress (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  data       jsonb not null default '{}',
  updated_at timestamptz default now()
);
alter table public.progress enable row level security;
drop policy if exists "own progress" on public.progress;
create policy "own progress" on public.progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 3) Engellemeler (eşleştirmede kullanılır)
create table if not exists public.blocks (
  blocker    uuid not null references auth.users(id) on delete cascade,
  blocked    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (blocker, blocked)
);
alter table public.blocks enable row level security;
drop policy if exists "own blocks read" on public.blocks;
drop policy if exists "own blocks insert" on public.blocks;
create policy "own blocks read"   on public.blocks for select using (auth.uid() = blocker);
create policy "own blocks insert" on public.blocks for insert with check (auth.uid() = blocker);

-- 4) Raporlar (moderasyon ekibi service-role ile okur)
create table if not exists public.reports (
  id         bigint generated always as identity primary key,
  reporter   uuid not null references auth.users(id) on delete cascade,
  target     uuid not null,
  room       text,
  reason     text,
  created_at timestamptz default now()
);
alter table public.reports enable row level security;
drop policy if exists "own reports insert" on public.reports;
create policy "own reports insert" on public.reports for insert with check (auth.uid() = reporter);

-- 5) Oda kaydı (opsiyonel; analitik/moderasyon için)
create table if not exists public.rooms (
  id         text primary key,
  level      text,
  topic_id   text,
  created_at timestamptz default now(),
  closed_at  timestamptz
);

-- Yeni kullanıcı kaydolunca otomatik profil oluştur
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
