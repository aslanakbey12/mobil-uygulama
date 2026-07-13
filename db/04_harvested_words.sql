-- Global "yeni kelime" toplama tablosu: okuma parçalarında AI'nın ürettiği, words.json'da
-- OLMAYAN kelimeler burada birikir (dedup + kaç kez görüldü). İleride gözden geçirip
-- words.json'a eklenir. AI zaten CEFR seviyesini verdiği için zorluk ön-etiketli gelir.

create table if not exists public.harvested_words (
  en text primary key,
  tr text,
  level text,
  ex text,
  count int not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.harvested_words enable row level security;
-- RLS açık + doğrudan politika yok → normal kullanıcı tabloya doğrudan erişemez.
-- Yazma yalnızca aşağıdaki RPC (security definer) üzerinden yapılır.

create or replace function public.collect_word(p_en text, p_tr text, p_level text, p_ex text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.harvested_words (en, tr, level, ex, count, updated_at)
  values (lower(trim(p_en)), p_tr, p_level, p_ex, 1, now())
  on conflict (en) do update
    set count = harvested_words.count + 1,
        updated_at = now(),
        tr = coalesce(nullif(harvested_words.tr, ''), excluded.tr),
        ex = coalesce(nullif(harvested_words.ex, ''), excluded.ex),
        level = coalesce(nullif(harvested_words.level, ''), excluded.level);
end;
$$;

grant execute on function public.collect_word(text, text, text, text) to authenticated, anon;

-- GÖZDEN GEÇİRME (istediğinde SQL Editor'da çalıştır):
--   select en, tr, level, count, updated_at
--   from public.harvested_words
--   order by count desc, en;
