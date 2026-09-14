-- collect_word: girdi sınırları.
--
-- NEDEN: fonksiyon security definer ve RLS'yi atlıyor; p_en/p_tr/p_ex için hiçbir
-- uzunluk kontrolü yoktu. Doğrulanmış bir hesap döngüyle megabaytlık anahtarlarla
-- harvested_words'ü şişirebilirdi (Supabase ücretsiz plan 500 MB). Sınırlar
-- istemcinin gerçekten yolladığı boyutların üstünde: en 40, tr 120, ex 300.
-- Harf/boşluk/tire/kesme dışı karakter içeren `en` reddedilir (sözlük anahtarı).
-- Reddetme sessiz (return): istemci yalnızca "toplamayı dene" der, hata beklemez.
create or replace function public.collect_word(p_en text, p_tr text, p_level text, p_ex text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_en text := lower(trim(coalesce(p_en, '')));
begin
  if v_en = '' or length(v_en) > 40 then return; end if;
  if v_en !~ '^[a-z][a-z '' -]*$' then return; end if;
  if length(coalesce(p_tr, '')) > 120 then return; end if;
  if length(coalesce(p_ex, '')) > 300 then return; end if;
  if nullif(p_level, '') is not null and p_level not in ('A1','A2','B1','B2','C1','C2') then return; end if;   -- istemci boş dize yollayabilir

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

revoke execute on function public.collect_word(text, text, text, text) from anon;
grant execute on function public.collect_word(text, text, text, text) to authenticated;
