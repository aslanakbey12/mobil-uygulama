-- KOÇ SOHBET HAFIZASI
--
-- SORUN: Koç her seansı unutuyordu. Mesajlar yalnızca istemcinin React
-- state'inde duruyordu (useState); ekran kapanınca buhar oluyordu. Sunucu da
-- durumsuzdu — geçmişi her istekte istemciden alıyor, hiçbir şey saklamıyordu.
-- Kalıcı olan tek şey plandı.
--
-- Sonuç: kullanıcı uygulamayı kapatıp açtığında koç ona NE SÖYLEDİĞİNİ
-- hatırlamıyordu. Planı biliyordu ama "geçen sefer şunu konuşmuştuk, denedin
-- mi?" diyemiyordu. Her açılışta sıfırdan tanışıyordu.
--
-- Bir koçu koç yapan şey tam olarak bu süreklilik. Hafızasız bir koç,
-- tanımı gereği koç değil — sadece her seferinde aynı soruları soran bir bot.
--
-- KULLANICI BAŞINA TEK SATIR: koçluk ilişkisi süreklidir, seanslara bölünmez.
-- Seans sınırı zamandan türetilir (son mesajdan bu yana geçen süre), ayrı
-- kayıtlardan değil — böylece koç "üç gündür yoksun" diyebilir.

create table if not exists public.coach_chats (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  -- [{ m: 1|0 (m=1 kullanıcı), t: "metin", at: "ISO" }]
  -- Kısa anahtarlar bilinçli: bu dizi her istekte okunup yazılıyor, uzun
  -- anahtar adları binlerce mesajda anlamlı yer tutar.
  messages   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.coach_chats enable row level security;
-- RLS açık + politika YOK → yalnızca sunucu (service-role) okur/yazar.
-- Sohbet içeriği kullanıcının en mahrem verisi; istemciye doğrudan açmıyoruz,
-- yalnızca /coach/* uçlarından kendi sohbetine erişiyor.

-- SAKLAMA: sohbetler 1 yıl (bkz. db/13_feedback_retention.sql). İlerleme
-- geçmişi kadar uzun tutmaya gerek yok; koç için son birkaç ay yeterli.
--
-- Kendi sohbetini görmek için (Supabase SQL Editor):
--   select jsonb_array_length(messages) as mesaj, updated_at
--   from public.coach_chats where user_id = '<senin-uuid>';
--
--   select m->>'t' as metin, (m->>'m')::int as benden_mi
--   from public.coach_chats, jsonb_array_elements(messages) m
--   where user_id = '<senin-uuid>';
