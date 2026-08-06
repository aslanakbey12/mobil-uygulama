-- HAFTALIK KOÇ RAPORLARI
--
-- Rapor haftada BİR kez üretilir ve o hafta boyunca DEĞİŞMEZ. Bu kasıtlı:
-- kullanıcı raporu her açtığında farklı bir "plan" görseydi, planın ciddiyetine
-- inanmazdı. Gerçek bir koç da haftanın ortasında fikrini değiştirmez.
--
-- Ayrıca maliyet freni: önbellek olmasaydı raporu her açan kullanıcı yeni bir
-- Gemini çağrısı tetiklerdi. Şimdi kullanıcı başına haftada tek çağrı.
--
-- Kalıcı olması ayrıca GEÇMİŞ demek: ileride "8 hafta önce üretimde %54'tün,
-- şimdi %71" diyebilmek, ilerlemenin bize atfedilmesini sağlayan şey.
-- Ödeme kararının dayandığı his tam olarak budur.

create table if not exists public.coach_reports (
  user_id    uuid not null references auth.users(id) on delete cascade,
  week       date not null,                    -- o haftanın PAZARTESİsi
  report     jsonb not null,                   -- { headline, win, gap, plan[] }
  created_at timestamptz not null default now(),
  primary key (user_id, week)
);

create index if not exists coach_reports_user_idx on public.coach_reports (user_id, week desc);

alter table public.coach_reports enable row level security;
-- RLS açık + politika YOK → yalnızca sunucu (service-role) okur/yazar.
-- Kullanıcı raporunu /coach/weekly ucundan alır; doğrudan tabloya erişmesi gerekmez.

-- SAKLAMA: raporlar ilerleme geçmişidir, uzun tutulur. Yine de sınırsız değil —
-- 2 yıldan eskisi purge_old_data() ile silinir (bkz. db/13_feedback_retention.sql).
