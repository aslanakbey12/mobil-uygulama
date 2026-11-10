-- 26) Premium sütunlarını kullanıcıya KAPAT (tetikleyici).
-- 06_security.sql'deki sütun-seviyesi REVOKE işe yaramıyordu: Supabase authenticated'a
-- tabloda tablo-seviyesi ALL verir, bu varken sütun REVOKE'u etkisizdir; üstüne profiles'ta
-- "for all" kendi-satır politikası var → kullanıcı kendi is_premium'unu true yapabiliyordu.
--
-- Çözüm: BEFORE INSERT OR UPDATE tetikleyicisi. Rol tespiti current_user ile:
-- PostgREST her istekte rolü SET ROLE ile değiştirir (anon / authenticated / service_role);
-- migration, SQL Editor ve doğrudan postgres bağlantıları postgres/supabase_admin olarak gelir.
-- Yalnız anon/authenticated kısıtlanır; geri kalan her rol (service_role = RevenueCat
-- webhook'unun setPremium upsert'i, postgres = göçler) etkilenmez.
-- SECURITY DEFINER KULLANILMIYOR: definer olsaydı current_user sahip rolü olurdu ve
-- ayrım bozulurdu. search_path boş: yalnız pg_catalog, ad çalma yok.
--
-- INSERT'te raise yerine varsayılana zorlanır, UPDATE'te eski değer korunur: istemci
-- profil upsert'inde bu alanları yollasa bile kayıt kırılmaz, ama değer değişmez.
create or replace function public.profiles_premium_koru()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.is_premium := false;
      new.premium_until := null;
    else
      new.is_premium := old.is_premium;
      new.premium_until := old.premium_until;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_premium_koru on public.profiles;
create trigger profiles_premium_koru
  before insert or update on public.profiles
  for each row execute function public.profiles_premium_koru();

-- MANUEL TEST (SQL Editor'da, normal kullanıcı gibi; <UID> kendi auth.users id'n):
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<UID>","role":"authenticated"}', true);
--   update public.profiles set is_premium = true, premium_until = now() + interval '1 year' where id = '<UID>';
--   select is_premium, premium_until from public.profiles where id = '<UID>';  -- değişmemiş olmalı (false/null)
--   rollback;
-- Service tarafı: rol değiştirmeden (postgres) aynı update çalışır ve değer değişir (rollback ile geri al).
