-- KALICI ÖRNEK CÜMLE ÖNBELLEĞİ
--
-- 18_reading_cache.sql'in aynısı, aynı sebeple. Okuma parçası için ölçülen şey
-- burada da geçerli: önbellek yalnızca bellekteyken isabet %21'de kalıyor ve
-- kapasiteyi büyütmek hiçbir şey değiştirmiyor — öldüren şey yeniden
-- başlatmalar. Kalıcı ortak önbellekte %69, altıncı ayda %93.
--
-- NEDEN AYRI BİR KALEM OLARAK ELE ALINDI: örnek cümle sessiz ama büyük.
-- Alıştırma'da HER kelimede çağrılıyor. 10.000 kullanıcılı modelde (bkz.
-- app/scripts/maliyet.mjs) ayda ~63.000 çağrı, ~$25 — koç sohbetinden sonraki
-- en pahalı üçüncü kalem, üstelik kimsenin aklına gelmeyen bir yerde. Okuma
-- parçası gibi paylaşılabilir olduğu hâlde paylaşılmıyordu.
--
-- ANAHTAR KİŞİSEL DEĞİL: kelime | seviye | bağlam. Bağlam kullanıcının serbest
-- metni değil, KAPALI BİR LİSTEDEN gelen bir konu etiketi ("teknoloji",
-- "seyahat", "günlük hayat"…) — app/src/core/store.js personalContext().
-- Sunucu da listeyi ayrıca doğruluyor (reading.js BAGLAMLAR): tanımadığı bir
-- bağlam "günlük hayat"a düşüyor. Bu yalnızca isabet için değil, GÜVENLİK için:
-- serbest metin anahtara girseydi istemci her çağrıda benzersiz bir bağlam
-- gönderip önbelleği işe yaramaz hale getirebilir ve her seferinde bize PARA
-- ÖDETEBİLİRDİ. Kapalı liste anahtar uzayını da sonlu tutuyor:
-- ~8.900 kelime × 6 seviye × 17 bağlam.
create table if not exists public.example_cache (
  key         text primary key,          -- "kelime|seviye|bağlam"
  example     jsonb not null,            -- { en, tr }
  hits        integer not null default 0,
  created_at  timestamptz not null default now(),
  last_hit_at timestamptz not null default now()
);

create index if not exists example_cache_last_hit_idx on public.example_cache (last_hit_at);

alter table public.example_cache enable row level security;
-- Politika yok → yalnızca service-role (sunucu) erişir. İstemci doğrudan okuyamaz.

create or replace function public.touch_example_cache(k text)
returns void language sql security definer as $$
  update public.example_cache set hits = hits + 1, last_hit_at = now() where key = k;
$$;

-- SAKLAMA: okuma parçasıyla aynı gerekçe — silinen her satır bir daha PARA
-- ÖDENEREK üretilir, o yüzden agresif değil. Cümleler parçalardan çok daha
-- küçük olduğu için süre de daha uzun: 365 gün.
--
-- TEMİZLİK BURADA DEĞİL, db/13_feedback_retention.sql'deki purge_old_data()
-- içinde — günde bir çağrılan tek yer orası. 18_reading_cache.sql ayrıca bir
-- purge_reading_cache() tanımlamıştı ama onu kimse çağırmıyor; ölü bir
-- fonksiyonun ikinci kopyasını üretmemek için burada aynısı yapılmadı.
-- ⚠️ Bu dosyayı çalıştırdıktan sonra 13_feedback_retention.sql'i DE yeniden
-- çalıştır (create or replace, tekrar çalıştırmak güvenli).

-- Kontrol sorgusu (Supabase SQL Editor):
--   select count(*) as cumle, sum(hits) as isabet,
--          round(sum(hits)::numeric / nullif(count(*),0), 1) as cumle_basina
--   from public.example_cache;
