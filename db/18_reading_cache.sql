-- KALICI OKUMA PARÇASI ÖNBELLEĞİ
--
-- SORUN: Önbellek 500 girişlik bir bellek içi Map'ti ve süreç her yeniden
-- başladığında siliniyordu. Render ücretsiz katmanı sık yeniden başlatıyor.
-- Simülasyonda ölçtük (1000 kullanıcı, günde 1 okuma, 30 gün):
--
--   bugünkü hal (500 giriş + yeniden başlatma) ....... %21 isabet
--   kapasite kaldırılsa, hâlâ bellekte ............... %21 isabet   ← fark YOK
--   kalıcı ortak önbellek ............................ %69 isabet
--
-- Kapasiteyi büyütmek tek başına hiçbir şey değiştirmiyor; öldüren şey yeniden
-- başlatmalar. Kalıcı olunca isabet zamanla artmaya da devam ediyor:
-- 1. ay %69 → 3. ay %87 → 6. ay %93. Okuma, YZ faturamızın en büyük kalemi
-- olduğu için bu tek başına en büyük tasarruf.
--
-- PAYLAŞIMLI OLMASI KASITLI. Anahtar (seviye, tema, hedef kelimeler) — kişiye
-- özel hiçbir şey içermiyor ve parçanın içinde de kimlik bilgisi yok. Aynı
-- kelimeleri çalışan iki kullanıcının aynı parçayı görmesi zaten istediğimiz şey:
-- tasarrufun tamamı buradan geliyor.
create table if not exists public.reading_cache (
  key         text primary key,          -- "seviye|tema|sıralı kelimeler"
  passage     jsonb not null,
  hits        integer not null default 0,
  created_at  timestamptz not null default now(),
  last_hit_at timestamptz not null default now()
);

-- Temizlik ve "hangi parçalar gerçekten kullanılıyor" sorgusu için.
create index if not exists reading_cache_last_hit_idx on public.reading_cache (last_hit_at);

alter table public.reading_cache enable row level security;
-- Politika yok → yalnızca service-role (sunucu) erişir. İstemci doğrudan okuyamaz.

-- Bir isabette sayacı artır. Tek ifadede yapılıyor: iki ayrı sorgu atıp araya
-- gecikme koymak, önbelleğin varlık sebebi olan hızı geri verirdi.
create or replace function public.touch_reading_cache(k text)
returns void language sql security definer as $$
  update public.reading_cache set hits = hits + 1, last_hit_at = now() where key = k;
$$;

-- SAKLAMA: 180 gündür hiç okunmamış parçaları at. Sınırsız büyümesin, ama
-- agresif de olmasın — silinen her parça bir daha PARA ÖDENEREK üretilir.
-- purge_old_data() içine ekleniyor (db/13_feedback_retention.sql günde bir çağırır).
create or replace function public.purge_reading_cache()
returns void language plpgsql security definer as $$
begin
  delete from public.reading_cache where last_hit_at < now() - interval '180 days';
end;
$$;

-- Kontrol sorgusu (Supabase SQL Editor):
--   select count(*) as parca, sum(hits) as isabet,
--          round(sum(hits)::numeric / nullif(count(*),0), 1) as parca_basina
--   from public.reading_cache;
