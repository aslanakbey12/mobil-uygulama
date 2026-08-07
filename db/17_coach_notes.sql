-- KOÇUN KENDİ NOTLARI
--
-- SORUN: Koç her mesajda kullanıcıyı SIFIRDAN okuyup o an bir kanaat
-- oluşturuyordu. Sonraki mesajda yine sıfırdan. Elindeki veri "bu kişi ne
-- biliyor" sorusunu cevaplıyordu; "bu kişi NASIL BİRİ" sorusunu değil.
--
-- Gerçek bir koçta olan şey bu değil. İnsan koçun kafasında sende dair
-- BİRİKMİŞ ve zamanla değişen bir kanaat vardır:
--   "tarih vermekten kaçınıyor, sorunca konuyu değiştiriyor"
--   "söz veriyor ama yapmıyor — küçük adımlar vermeliyim"
--   "meydan okumaya iyi tepki veriyor, yumuşak konuşunca gevşiyor"
--
-- Bunların hiçbiri verimizde yoktu çünkü hiç YAZMIYORDUK. En iyi istem bile
-- olmayan veriyi uyduramaz; uydurursa da zaten sahte olur.
--
-- SOHBET GEÇMİŞİNDEN FARKLI. Geçmiş "ne konuşuldu"dur; not "bu kişi nasıl
-- biri"dir. Biri olay kaydı, diğeri yargı. Koç notu kendisi günceller ve
-- sonraki seansın isteminde en başta yer alır — böylece koç "seni tanıyorum"
-- demez, GÖSTERİR.

alter table public.coach_chats
  add column if not exists notes jsonb;                 -- { observations[], whatWorks, updatedAt }

-- Notların en son hangi mesaj sayısında yazıldığı. Her cevapta yeniden not
-- üretmek gereksiz maliyet; belirli bir birikimden sonra güncellenir.
alter table public.coach_chats
  add column if not exists note_mark integer not null default 0;

-- Kendi notlarını görmek için (Supabase SQL Editor):
--   select notes, note_mark, jsonb_array_length(messages) as mesaj
--   from public.coach_chats where user_id = auth.uid();
