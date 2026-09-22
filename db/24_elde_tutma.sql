-- 24 — ELDE TUTMA PANOSU (22 Eyl 2026). Supabase SQL Editor'da bir kez koş;
-- sonra "Saved queries" olarak aşağıdaki SELECT'leri kaydet ve haftada bir bak.
--
-- Kaynak: progress.data (kullanıcının kendi ilerlemesi) — history {"YYYY-MM-DD": xp}
-- ve usage {"YYYY-MM-DD": {n: {bölüm: adet}}}. Rıza gerektirmez (analitik değil,
-- ürün verisi); misafirler burada YOK (hesapsız kullanım yalnız cihazda).
-- Kayıt günü = auth.users.created_at. Görünümler yalnız service_role'e açık.

-- Kullanıcı × aktif gün: history'de xp>0 olan ya da usage'da kaydı olan günler.
create or replace view public.v_aktif_gunler as
select p.user_id,
       u.created_at::date                       as kayit_gunu,
       g.gun::date                              as gun
from public.progress p
join auth.users u on u.id = p.user_id
cross join lateral (
  select key as gun from jsonb_each(coalesce(p.data->'history', '{}'::jsonb)) h where (h.value)::text::numeric > 0
  union
  select key as gun from jsonb_each(coalesce(p.data->'usage', '{}'::jsonb))
) g
where g.gun ~ '^\d{4}-\d{2}-\d{2}$';

-- Kohort (kayıt haftası) × D1 / D7 / D30: o gün geri gelen kullanıcı yüzdesi.
-- Klasik tanım: kayıttan tam N gün sonra aktif. Yalnız N günü dolmuş kohortlar sayılır.
create or replace view public.v_elde_tutma as
with k as (
  select id as user_id, created_at::date as kayit_gunu, date_trunc('week', created_at)::date as kohort
  from auth.users
),
d as (
  select k.kohort, k.user_id,
         bool_or(a.gun = k.kayit_gunu + 1)  as d1,
         bool_or(a.gun = k.kayit_gunu + 7)  as d7,
         bool_or(a.gun = k.kayit_gunu + 30) as d30,
         bool_or(a.gun > k.kayit_gunu)      as geri_geldi,
         max(k.kayit_gunu)                  as kayit_gunu
  from k left join public.v_aktif_gunler a on a.user_id = k.user_id
  group by k.kohort, k.user_id
)
select kohort,
       count(*)                                                           as kullanici,
       round(100.0 * count(*) filter (where geri_geldi) / count(*))       as geri_gelen_pct,
       case when max(kayit_gunu) + 1  <= current_date then round(100.0 * count(*) filter (where d1)  / count(*)) end as d1_pct,
       case when max(kayit_gunu) + 7  <= current_date then round(100.0 * count(*) filter (where d7)  / count(*)) end as d7_pct,
       case when max(kayit_gunu) + 30 <= current_date then round(100.0 * count(*) filter (where d30) / count(*)) end as d30_pct
from d
group by kohort
order by kohort desc;

-- Günlük aktif kullanıcı (son 60 gün) + yeni kayıt.
create or replace view public.v_gunluk as
with g as (select generate_series(current_date - 59, current_date, interval '1 day')::date as gun)
select g.gun,
       (select count(distinct user_id) from public.v_aktif_gunler a where a.gun = g.gun) as aktif,
       (select count(*) from auth.users u where u.created_at::date = g.gun)             as yeni_kayit
from g order by g.gun desc;

-- Bölüm kullanımı (son 30 gün): hangi bölüm kaç kez açıldı, kaç farklı kişi.
create or replace view public.v_bolum_kullanimi as
select b.key                              as bolum,
       sum((b.value)::text::numeric)::int  as adet,
       count(distinct p.user_id)          as kisi
from public.progress p
cross join lateral jsonb_each(coalesce(p.data->'usage', '{}'::jsonb)) u
cross join lateral jsonb_each(coalesce(u.value->'n', '{}'::jsonb)) b
where u.key ~ '^\d{4}-\d{2}-\d{2}$' and u.key::date >= current_date - 30
group by b.key order by adet desc;

-- Huni: kayıt → ilk kelime → ilk alıştırma → 7. gün.
create or replace view public.v_huni as
select count(*)                                                                                  as kayit,
       count(*) filter (where (p.data->'cards') is not null and jsonb_typeof(p.data->'cards') = 'object'
                          and (select count(*) from jsonb_object_keys(p.data->'cards')) > 0)     as ilk_kelime,
       count(*) filter (where exists (select 1 from jsonb_each(coalesce(p.data->'usage','{}'::jsonb)) u
                                       where (u.value->'n') ? 'alistirma')) as ilk_alistirma,
       count(*) filter (where exists (select 1 from public.v_aktif_gunler a
                                       where a.user_id = u.id and a.gun >= u.created_at::date + 7))  as yedinci_gun
from auth.users u left join public.progress p on p.user_id = u.id;

revoke all on public.v_aktif_gunler, public.v_elde_tutma, public.v_gunluk, public.v_bolum_kullanimi, public.v_huni from public, anon, authenticated;
grant  select on public.v_aktif_gunler, public.v_elde_tutma, public.v_gunluk, public.v_bolum_kullanimi, public.v_huni to service_role;

-- PANO (kaydet, haftada bir çalıştır):
--   select * from public.v_elde_tutma;        -- D1/D7/D30 kohort
--   select * from public.v_gunluk limit 30;   -- DAU + yeni kayıt
--   select * from public.v_bolum_kullanimi;   -- hangi bölüm tutuyor
--   select * from public.v_huni;              -- kayıt → ilk kelime → ilk alıştırma → 7. gün
-- Okuma: D1 %40+ iyi, D7 %15+ iyi, D30 %5+ iyi (eğitim uygulaması ortalamaları).
-- Ücretli reklam kararı: D7 %15'in altındaysa önce ürün, sonra reklam.
