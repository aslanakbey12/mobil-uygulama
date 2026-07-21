-- Arkadaş sistemi (basit "kodla ekle" modeli — onay yok).
-- Tüm erişim SUNUCU (service-role) üzerinden; RLS açık, public policy yok → istemci doğrudan erişemez.

-- Kullanıcı başına kalıcı arkadaş kodu + görünen ad
create table if not exists friend_codes (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  code       text unique not null,
  name       text,
  created_at timestamptz default now()
);

-- Arkadaşlıklar (çift yönlü: A, B'yi ekleyince (A,B) ve (B,A) yazılır)
create table if not exists friendships (
  user_id    uuid references auth.users(id) on delete cascade,
  friend_id  uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, friend_id)
);

-- Oda davetleri (arkadaşını odaya çağır); karşı taraf Sosyal'de görür
create table if not exists room_invites (
  id         bigint generated always as identity primary key,
  to_user    uuid references auth.users(id) on delete cascade,
  from_name  text,
  room_code  text not null,
  mode       text default 'text',
  created_at timestamptz default now()
);
create index if not exists room_invites_to_idx on room_invites (to_user, created_at desc);

-- RLS: yalnız sunucu (service-role) erişir; istemci JWT'siyle doğrudan okuma/yazma kapalı
alter table friend_codes  enable row level security;
alter table friendships   enable row level security;
alter table room_invites  enable row level security;
