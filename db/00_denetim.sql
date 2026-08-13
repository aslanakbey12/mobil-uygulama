-- HANGİ GÖÇLER ÇALIŞTIRILMAMIŞ — tek sorguda döküm.
--
-- NEDEN VAR: db/ altındaki dosyalar elle çalıştırılıyor ve hangisinin
-- çalıştığını tutan bir kayıt yok. Sonuç, gerçek bir olayla ortaya çıktı:
-- 02_premium.sql hiç çalıştırılmamıştı, yani profiles.is_premium sütunu
-- YOKTU. Sunucudaki isPremium() o sütunu okumaya çalışıp hata alıyor ve
-- catch bloğunda `false` dönüyordu — sessizce.
--
-- Etkisi ödeme sisteminin tamamıydı: hiç kimse premium olamıyordu, gerçek bir
-- satın alma yapılsa bile. Webhook'un setPremium'u da aynı sütuna yazmaya
-- çalışıp sessizce başarısız oluyordu (`catch (e) {}`). Yani para alınır,
-- özellik açılmazdı. Kod tarafı kusursuz görünüyordu; eksik olan VERİTABANIYDI.
--
-- Supabase → SQL Editor'e yapıştır, çalıştır. "EKSİK" yazan her satır için
-- karşısındaki dosyayı çalıştır.
select
  d.dosya,
  case when d.var then '✓ tamam' else '✗ EKSİK — bu dosyayı çalıştır' end as durum
from (
  values
    ('02_premium.sql',          to_regclass('public.profiles') is not null
                                and exists (select 1 from information_schema.columns
                                            where table_schema='public' and table_name='profiles'
                                              and column_name='is_premium')),
    ('03_profile.sql',          exists (select 1 from information_schema.columns
                                        where table_schema='public' and table_name='profiles'
                                          and column_name='username')),
    ('04_harvested_words.sql',  to_regclass('public.harvested_words') is not null),
    ('05_friends.sql',          to_regclass('public.blocks') is not null),
    ('07_friend_requests.sql',  to_regclass('public.friend_requests') is not null),
    ('08_push.sql',             to_regclass('public.push_tokens') is not null),
    ('09_activity.sql',         to_regclass('public.user_stats') is not null),
    ('10_dm.sql',               to_regclass('public.dm_messages') is not null),
    ('11_avatar.sql',           exists (select 1 from information_schema.columns
                                        where table_schema='public' and table_name='profiles'
                                          and column_name='avatar')),
    ('12_perf_quota.sql',       to_regclass('public.ai_usage') is not null),
    ('13_feedback_retention.sql', to_regclass('public.content_feedback') is not null),
    ('14_word_images.sql',      to_regclass('public.word_images') is not null),
    ('15_coach_reports.sql',    to_regclass('public.coach_reports') is not null),
    ('16_coach_chats.sql',      to_regclass('public.coach_chats') is not null),
    -- notes sütunu coach_CHATS'e ekleniyor, coach_reports'a değil. İlk yazışta
    -- yanlış tabloya bakıyordum: sonuç yine "EKSİK" çıkıyordu ama YANLIŞ
    -- sebeple — göç çalıştırılmış olsa bile eksik görünecekti. Denetim aracının
    -- yanlış alarmı, denetimsizlikten beterdir: bir kez yanlış çıkarsa bir daha
    -- kimse ona bakmaz.
    ('17_coach_notes.sql',      exists (select 1 from information_schema.columns
                                        where table_schema='public' and table_name='coach_chats'
                                          and column_name='notes')),
    ('18_reading_cache.sql',    to_regclass('public.reading_cache') is not null),
    ('19_report_stats.sql',     exists (select 1 from information_schema.columns
                                        where table_schema='public' and table_name='coach_reports'
                                          and column_name='stats')),
    -- YAŞ KAPISI: 16+ taahhüdü gizlilik politikasında YAZILI. Sütun yoksa
    -- isAgeConfirmed fail-closed davranıp herkesi sosyal odalardan dışarıda
    -- bırakır — sessiz ama tam tersi yönde bir arıza.
    ('yaş onayı (age_confirmed)', exists (select 1 from information_schema.columns
                                          where table_schema='public' and table_name='profiles'
                                            and column_name='age_confirmed'))
) as d(dosya, var)
order by d.var, d.dosya;
