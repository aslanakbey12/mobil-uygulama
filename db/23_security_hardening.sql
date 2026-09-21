-- 23 — GÜVENLİK SIKILAŞTIRMA (20 Eyl 2026 denetimi). Supabase SQL Editor'da koş.
-- Üç iş: (1) SECURITY DEFINER fonksiyonlar anon/authenticated'dan alınır,
-- (2) profiles'daki görünen alanlara uzunluk/biçim kısıtı, (3) content_reports
-- bildiren hesabına FK + retention.

-- (1) Postgres varsayılanı PUBLIC'e EXECUTE verir: anon anahtarla
--     rpc('purge_old_data') çağrılıp DB'ye ağır silme yükü bindirilebiliyordu.
--     Bunları yalnız sunucu (service_role) çağırır.
revoke execute on function public.purge_old_data()            from public, anon, authenticated;
revoke execute on function public.touch_reading_cache(text)   from public, anon, authenticated;
revoke execute on function public.purge_reading_cache()       from public, anon, authenticated;
revoke execute on function public.touch_example_cache(text)   from public, anon, authenticated;
-- Sunucu service_role ile çağırır; Supabase varsayılanı ona ayrıca grant verir,
-- yine de açıkça yazıyoruz ki revoke sırası ne olursa olsun sunucu kilitlenmesin.
grant execute on function public.purge_old_data()            to service_role;
grant execute on function public.touch_reading_cache(text)   to service_role;
grant execute on function public.purge_reading_cache()       to service_role;
grant execute on function public.touch_example_cache(text)   to service_role;
alter function public.purge_old_data()           set search_path = public;
alter function public.touch_reading_cache(text)  set search_path = public;
alter function public.purge_reading_cache()      set search_path = public;
alter function public.touch_example_cache(text)  set search_path = public;

-- (2) İstemci username/name'i doğrudan upsert ediyor; kural yalnız istemcideydi
--     (3-20 karakter, harf/rakam/alt çizgi). Başkasına gösterilen alan, DB'de
--     de sınırlı olmalı. Mevcut uyumsuz satırlar varsa önce onları düzelt:
--       select id, username, name from public.profiles
--        where username !~ '^[A-Za-z0-9_]{3,20}$' or length(name) > 40;
alter table public.profiles
  drop constraint if exists profiles_username_bicim,
  add  constraint profiles_username_bicim
       check (username is null or username ~ '^[A-Za-z0-9_]{3,20}$') not valid;
alter table public.profiles
  drop constraint if exists profiles_name_uzunluk,
  add  constraint profiles_name_uzunluk
       check (name is null or length(name) <= 40) not valid;
-- `not valid`: eski satırlar dokunulmaz, yeni yazımlar denetlenir. Eski satırlar
-- temizlenince:  alter table public.profiles validate constraint profiles_username_bicim;

-- (3) Bildiren silinince uuid orphan kalıyordu; FK ile null'a düşer.
--     Retention: 730 gün (rapor/engel kayıtlarıyla aynı; politika §6).
alter table public.content_reports
  drop constraint if exists content_reports_user_fk,
  add  constraint content_reports_user_fk
       foreign key (user_id) references auth.users(id) on delete set null;

create or replace function public.purge_content_reports()
returns void language sql security definer set search_path = public as $$
  delete from public.content_reports where created_at < now() - interval '730 days';
$$;
revoke execute on function public.purge_content_reports() from public, anon, authenticated;
grant  execute on function public.purge_content_reports() to service_role;
-- Sunucu günlük temizlikte (server.js purge) purge_old_data ile birlikte çağırır.
