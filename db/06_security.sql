-- Güvenlik sertleştirmesi (2026-07-29). Supabase SQL Editor'da çalıştır. Idempotent.
--
-- collect_word RPC'si hem anon hem authenticated'a açıktı. Uygulamanın public anon
-- anahtarı APK/web bundle'ından çıkarılabildiği için, kimliksiz biri bu RPC ile
-- harvested_words tablosunu çöple doldurabiliyordu. Yalnız GİRİŞLİ kullanıcıya bırak.

revoke execute on function public.collect_word(text, text, text, text) from anon;

-- Not: authenticated grant'ı 04_harvested_words.sql'de verilmişti ve korunuyor.
-- İstemcideki toplama (harvest.js) girişli oturumla çalıştığından etkilenmez.

-- public.rooms tablosunda RLS AÇILMAMIŞTI → anon anahtarıyla herkes okuyup yazabiliyordu.
-- RLS aç, policy verme → sadece sunucu (service-role) erişir; anon/authenticated doğrudan erişemez.
-- (Tablo opsiyonel analitik içindi; sunucu bellek-içi çalışıyor, istemci bu tabloya dokunmuyor.)
alter table public.rooms enable row level security;

-- ⚠️ KRİTİK: profiles RLS politikası "for all" olduğundan kullanıcı KENDİ satırındaki
-- is_premium/premium_until sütunlarını anon anahtarıyla doğrudan yazabiliyordu → BEDAVA PREMIUM
-- (sunucu isPremium()'u bu sütundan okuyor). Sütun-seviyesi yetkiyi geri al: bu iki sütunu
-- yalnız SUNUCU (service-role) yazabilsin. Kullanıcı username/name/age/level/age_confirmed'ı
-- düzenlemeye devam eder (o sütunlar etkilenmez); premium yalnız RevenueCat webhook'undan gelir.
revoke insert (is_premium, premium_until), update (is_premium, premium_until)
  on public.profiles from anon, authenticated;
