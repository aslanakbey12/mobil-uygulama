-- KELİME GÖRSELLERİ — KALICI ÖNBELLEK
--
-- SORUN: Görsel çözümü iki dış çağrı gerektiriyor — önce Gemini'ye "bu kelime
-- fotoğraflanabilir mi + doğru arama terimi ne", sonra Pexels'e arama. Sonuç
-- sunucuda önbellekleniyordu ama YALNIZCA BELLEKTE (images.js ve reading.js
-- içindeki Map'ler). Render ücretsiz katmanda süreç 15 dk hareketsizlikte
-- uyuyor ve her dağıtımda ölüyor → önbellek sıfırlanıyor, aynı kelime için
-- aynı sorular yeniden soruluyordu.
--
-- Kullanıcı tarafındaki bedeli: soğuk önbellekte kelime başına 2-5 saniye
-- (ağ gidiş-dönüşü ~0,8 sn + Gemini 1-3 sn + Pexels 0,3-1 sn). Bu tablodan
-- okumak tek sorgu, ~50 ms.
--
-- Katalog SABİT (8683 kelime), yani bu tablo doğal kullanımla dolar ve bir daha
-- hiç büyümez. "apple" hayatta bir kez çözülür, sonra TÜM kullanıcılara anında
-- gider.
--
-- NOT: depictable=false satırları da saklanır — asıl kazanç orada. Soyut
-- kelimeler (although, opinion, despite...) için Pexels'e hiç gidilmiyor ama
-- Gemini'ye her uyanışta yeniden soruluyordu.

create table if not exists public.word_images (
  en          text primary key,          -- küçük harfe çevrilmiş kelime
  depictable  boolean not null,          -- Gemini kararı: fotoğrafla anlatılabilir mi
  query       text,                      -- Gemini'nin önerdiği arama terimi (depictable ise)
  photos      jsonb not null default '[]'::jsonb,   -- [{url, photographer}, ...]
  updated_at  timestamptz not null default now()
);

alter table public.word_images enable row level security;
-- RLS açık + politika YOK → normal kullanıcı bu tabloya doğrudan erişemez.
-- Yalnızca sunucu (service-role anahtarı) okur/yazar. Kullanıcının burayı
-- doğrudan okumasına gerek yok; zaten /word/image ucundan geliyor.

-- Bakım: bir arama terimi kötü sonuç veriyorsa ya da URL'ler öldüyse tek satır
-- silmek yeter — sonraki istek yeniden çözer.
--   delete from public.word_images where en = 'bank';
--
-- Gözden geçirme (hangi kelimeler fotoğrafsız sayılmış):
--   select en from public.word_images where depictable = false order by en;
--
-- İLERİSİ: bu tablo yeterince dolunca içeriği words.json'a aktarılıp uygulamayla
-- birlikte gönderilebilir. Gemini kararı hiç değişmeyen bir veri olduğu için
-- çalışma anında hesaplanması gerekmiyor; o zaman ağ isteği tamamen kalkar.
--   select en, depictable, query from public.word_images order by en;
