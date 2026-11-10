-- 27) progress.data için boyut sınırı.
-- Sorun: tek hesap PostgREST ile progress.data'ya sınırsız jsonb yazıp ücretsiz veritabanını
-- doldurabiliyordu. (user_stats yalnız int/timestamptz sütunlardan oluşuyor, jsonb yok:
-- şişirilemez, ona sınır eklenmedi.)
-- Sınır 3 MB (metin hâli). octet_length(data::text) kullanıldı: pg_column_size sıkıştırılmış
-- boyutu ölçer, tekrarlı veriyi hafif gösterip sınırı delerdi.
-- NOT VALID: mevcut satırlara bakmaz, göç büyük bir satır yüzünden asla patlamaz; sınır
-- yeni yazmalara hemen uygulanır. (Not: sınırı aşan eski bir satır, küçülene kadar güncellenemez.)
-- VALIDATE ayrı blokta ve hata yutuluyor: aşan satır varsa yalnız uyarı verir, göç düşmez.
alter table public.progress
  drop constraint if exists progress_data_boyut;
alter table public.progress
  add constraint progress_data_boyut check (octet_length(data::text) <= 3145728) not valid;

do $$
begin
  alter table public.progress validate constraint progress_data_boyut;
exception when others then
  raise warning 'progress_data_boyut doğrulanamadı (3 MB üstü satır var): %', sqlerrm;
end $$;

-- Aşan satırları görmek için:
--   select user_id, octet_length(data::text) from public.progress
--   where octet_length(data::text) > 3145728;
