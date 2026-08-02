-- Kullanıcının seçtiği avatar emojisi (kişiselleştirme).
-- Supabase → SQL Editor'da BİR KEZ çalıştır.
--
-- Neden profiles tablosunda: arkadaşların da görmesi gerekiyor (/friends bu sütunu
-- okuyup listeye ekliyor). Yalnızca cihazda tutulsaydı kendinden başkası göremezdi.

alter table public.profiles
  add column if not exists avatar text;

-- Sadece emoji beklenir; uzun metin/HTML girilmesin diye kısa tutuluyor.
-- (2 emoji + varyasyon seçicileri için 16 karakter fazlasıyla yeter.)
alter table public.profiles
  drop constraint if exists profiles_avatar_len;
alter table public.profiles
  add constraint profiles_avatar_len check (avatar is null or char_length(avatar) <= 16);
