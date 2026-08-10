-- HAFTALIK RAPORA GEÇEN HAFTAYI HATIRLATMAK
--
-- SORUN: coach_reports yalnızca ÜRETİLEN raporu saklıyordu, raporun dayandığı
-- rakamları değil. Yani her hafta sıfırdan bir fotoğraf çekiyorduk ve iki
-- fotoğrafı yan yana koyamıyorduk.
--
-- Oysa insanı hareket ettiren şey mutlak sayı değil YÖN. "Bu hafta 40 kelime
-- öğrendin" tek başına bir şey ifade etmiyor; "geçen hafta 25'ti, bu hafta 40"
-- bambaşka bir cümle. Aynı veri, iki katı anlam.
--
-- Gerileme için de aynısı geçerli ve daha önemli: kullanıcı yavaşladığını
-- kendisi fark etmez, koçun söylemesi gerekir. Söyleyebilmesi için geçen
-- haftanın rakamlarını hatırlaması şart.
--
-- NOT: karşılaştırma ancak İKİNCİ haftadan itibaren çalışır — ilk hafta
-- kıyaslanacak bir şey yok. Kod bunu bekliyor ve o durumda karşılaştırma
-- bloğunu isteme hiç koymuyor (uydurma kıyas üretmesin diye).
alter table public.coach_reports
  add column if not exists stats jsonb;        -- raporun dayandığı ham rakamlar

-- Kontrol sorgusu (Supabase SQL Editor):
--   select week, stats->>'learnedThisWeek' as ogrenilen,
--          stats->>'activeDays' as aktif_gun
--   from public.coach_reports
--   where user_id = auth.uid()
--   order by week desc limit 4;
