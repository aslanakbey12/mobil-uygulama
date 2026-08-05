-- 1) friendships: friend_id üzerinden yapılan sorgular TAM TARAMA yapıyordu.
-- Birincil anahtar (user_id, friend_id) sırasıyla; ikinci sütuna göre arama
-- indeksten yararlanamaz. Kod friend_id ile 7 yerde sorguluyor.
create index if not exists friendships_friend_idx on public.friendships (friend_id);

-- 2) YZ kotaları KALICI olsun.
-- Sorun: kotalar yalnızca süreç belleğindeydi. Render her dağıtımda/uyku sonrası
-- süreci yeniden başlattığı için günlük kotalar sıfırlanıyordu — yani kota koruması
-- dağıtım yaparak (ya da servis uyuyup uyanarak) baypas edilebiliyordu.
-- Burada gün + kullanıcı + tür bazında sayaç tutulur; sunucu açılışta bugünün
-- sayaçlarını yükler, çalışırken periyodik olarak yazar.
create table if not exists public.ai_usage (
  day        date   not null,
  user_id    uuid   not null references auth.users(id) on delete cascade,
  kind       text   not null,          -- 'ai' | 'translate' | 'reading'
  n          integer not null default 0,
  updated_at timestamptz default now(),
  primary key (day, user_id, kind)
);

-- Sistem geneli günlük toplam (küresel fren de dağıtımdan sağ çıksın)
create table if not exists public.ai_usage_global (
  day        date    primary key,
  n          integer not null default 0,
  updated_at timestamptz default now()
);

-- Bu tablolara YALNIZCA sunucu (service-role) yazar; istemcinin erişimi olmamalı.
alter table public.ai_usage        enable row level security;
alter table public.ai_usage_global enable row level security;
-- Politika tanımlanmadı → RLS altında normal kullanıcı hiçbir satırı göremez/yazamaz.
-- service-role RLS'i aştığı için sunucu çalışmaya devam eder.

-- Eski günleri temizle (tablo sonsuza kadar büyümesin)
create index if not exists ai_usage_day_idx on public.ai_usage (day);
