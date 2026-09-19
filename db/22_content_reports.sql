-- OKUMA ŞİKÂYETLERİ
--
-- Play'deki "yapay zekâ ile üretilen içerik" beyanının şartı: kullanıcı uygunsuz
-- üretilen içeriği UYGULAMADAN ÇIKMADAN bildirebilmeli ve bildirim geliştiriciye
-- ulaşmalı. content_feedback'teki 👍/👎 sayaçları bunu karşılamıyor: metin
-- bittikten sonra çıkıyor, sebebi yok, kimin dediği yok — yani "bildirim" değil,
-- kalite sinyali. Bu tablo her şikâyeti sebep ve (isteğe bağlı) notla, kullanıcı
-- kimliğiyle saklar ki biz gerçekten bakabilelim.
create table if not exists public.content_reports (
  id         bigint generated always as identity primary key,
  kind       text not null,                       -- 'reading'
  ref        text not null,                       -- okuma: cache anahtarı
  user_id    uuid,                                -- bildiren (hesap silinirse null kalır)
  reason     text not null,                       -- uygunsuz | hatali | seviye | diger
  note       text,                                -- serbest metin, ≤300
  created_at timestamptz default now()
);
create index if not exists content_reports_ref_idx on public.content_reports (kind, ref);

alter table public.content_reports enable row level security;
-- Politika yok → yalnızca service-role (sunucu) yazar/okur.

-- Bakma sorgusu (Supabase SQL Editor):
--   select created_at, reason, note, ref from public.content_reports
--   order by created_at desc limit 50;
