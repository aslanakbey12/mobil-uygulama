-- 28) Anonim geri dönüş sayacı (kimliksiz, rızasız).
-- NEDEN: D1/D7/D30 (db/24) yalnız hesaplı kullanıcıyı görür; misafirler ve hiç kayıt
-- olmayanlar ölçülemiyordu, PostHog ise rıza gerektirdiği için kapalı. Bu tablo kimlik
-- taşımaz: satır = (kurulum günü, kuruluma göre gün farkı, platform) için kaç açılış.
-- Kişi, cihaz, IP ya da reklam kimliği YOK; tek tek kullanıcı bu tablodan geri çıkarılamaz.
-- Hepsi idempotenttir, tekrar çalıştırmak güvenli.

create table if not exists public.anonim_sayac (
  kurulum_gunu date not null,
  gun_farki    int  not null check (gun_farki between 0 and 400),
  platform     text not null check (platform in ('android', 'ios', 'web')),
  adet         int  not null default 0,
  primary key (kurulum_gunu, gun_farki, platform)
);

-- RLS AÇIK, POLİTİKA YOK: anon/authenticated anahtarlarıyla (uygulamadaki herkesin
-- elindeki anahtar) hiçbir okuma/yazma olmaz. Yalnız sunucunun service-role anahtarı
-- (RLS'i aşar) yazar; sayıları biz SQL editöründen okuruz.
alter table public.anonim_sayac enable row level security;

-- Artırma tek atomik komutta: iki eşzamanlı istek birbirinin sayısını ezmesin
-- (okuyup +1 yazmak yarış yaratırdı). Yalnız service_role çalıştırabilir.
create or replace function public.anonim_sayac_artir(p_kurulum_gunu date, p_gun_farki int, p_platform text)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.anonim_sayac as t (kurulum_gunu, gun_farki, platform, adet)
  values (p_kurulum_gunu, p_gun_farki, p_platform, 1)
  on conflict (kurulum_gunu, gun_farki, platform)
  do update set adet = t.adet + 1;
$$;
revoke all on function public.anonim_sayac_artir(date, int, text) from public, anon, authenticated;
grant execute on function public.anonim_sayac_artir(date, int, text) to service_role;

-- Kohort görünümü: her (kurulum günü, platform) için kurulum sayısı ve D1/D7/D30.
-- Kurulum = gun_farki 0 satırı. Yüzdeler o gün henüz yaşanmamış kohortlarda yanıltmasın
-- diye ilgili gün geçmemişse NULL döner (ör. dünkü kohortun D7'si "0%" değil, bilinmiyor).
-- Not: istemci günde bir kez yolladığından "D7 = kuruluma göre tam 7. günde açılış yapanlar".
create or replace view public.v_anonim_elde_tutma as
select
  kurulum_gunu,
  platform,
  coalesce(sum(adet) filter (where gun_farki = 0), 0)  as installs,
  coalesce(sum(adet) filter (where gun_farki = 1), 0)  as d1,
  coalesce(sum(adet) filter (where gun_farki = 7), 0)  as d7,
  coalesce(sum(adet) filter (where gun_farki = 30), 0) as d30,
  case when current_date >= kurulum_gunu + 1 and sum(adet) filter (where gun_farki = 0) > 0
    then round(100.0 * coalesce(sum(adet) filter (where gun_farki = 1), 0) / sum(adet) filter (where gun_farki = 0), 1) end as d1_yuzde,
  case when current_date >= kurulum_gunu + 7 and sum(adet) filter (where gun_farki = 0) > 0
    then round(100.0 * coalesce(sum(adet) filter (where gun_farki = 7), 0) / sum(adet) filter (where gun_farki = 0), 1) end as d7_yuzde,
  case when current_date >= kurulum_gunu + 30 and sum(adet) filter (where gun_farki = 0) > 0
    then round(100.0 * coalesce(sum(adet) filter (where gun_farki = 30), 0) / sum(adet) filter (where gun_farki = 0), 1) end as d30_yuzde
from public.anonim_sayac
group by kurulum_gunu, platform;

-- Görünüm de uygulama anahtarlarına kapalı (görünümler RLS'i sahibin yetkisiyle aşar).
revoke all on public.v_anonim_elde_tutma from anon, authenticated;
