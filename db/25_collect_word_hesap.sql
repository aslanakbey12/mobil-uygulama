-- 25: collect_word YALNIZ OTURUM AÇMIŞ KULLANICI + TABLO TAVANI (denetim 28 Eyl 2026)
--
-- SORUN: 06 ve 21 yalnız `from anon` geri alıyordu. Postgres fonksiyon
-- oluşurken EXECUTE'u PUBLIC'e verir; anon bunu PUBLIC üzerinden miras alır.
-- Yani istemcideki herkese açık anahtarla hesap açmadan binlerce satır
-- yazılabiliyordu (ücretsiz plan 500 MB → proje salt okunura düşer) ve
-- elle gözden geçirilen listeye yabancı metin girebiliyordu.
-- Doğru desen 23'te var (from public, anon); burada da uygulanıyor. Ayrıca
-- fonksiyon içinde auth.uid() denetimi: yetki yanlışlıkla geri verilse de kapalı.
--
-- Tavan: tablo ~50.000 satırı geçince yeni kelime eklenmez (sayaç artmaya devam
-- eder). reltuples tahmini: her çağrıda count(*) taraması yapmamak için.
--
-- Supabase → SQL Editor'da bir kez çalıştır. Teyit:
--   select has_function_privilege('anon','public.collect_word(text,text,text,text)','execute');  -- false olmalı

create or replace function public.collect_word(p_en text, p_tr text, p_level text, p_ex text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_en text := lower(trim(coalesce(p_en, '')));
begin
  if auth.uid() is null then return; end if;
  if v_en = '' or length(v_en) > 40 then return; end if;
  if v_en !~ '^[a-z][a-z '' -]*$' then return; end if;
  if length(coalesce(p_tr, '')) > 120 then return; end if;
  if length(coalesce(p_ex, '')) > 300 then return; end if;
  if nullif(p_level, '') is not null and p_level not in ('A1','A2','B1','B2','C1','C2') then return; end if;

  if not exists (select 1 from public.harvested_words where en = v_en)
     and (select reltuples from pg_class where oid = 'public.harvested_words'::regclass) > 50000 then
    return;
  end if;

  insert into public.harvested_words (en, tr, level, ex, count, updated_at)
  values (v_en, p_tr, p_level, p_ex, 1, now())
  on conflict (en) do update
    set count = harvested_words.count + 1,
        updated_at = now(),
        tr = coalesce(nullif(harvested_words.tr, ''), excluded.tr),
        ex = coalesce(nullif(harvested_words.ex, ''), excluded.ex),
        level = coalesce(nullif(harvested_words.level, ''), excluded.level);
end;
$$;

revoke execute on function public.collect_word(text, text, text, text) from public, anon;
grant execute on function public.collect_word(text, text, text, text) to authenticated;
