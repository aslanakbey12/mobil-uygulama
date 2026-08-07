-- 1) İÇERİK KALİTE SİNYALLERİ — kalıcı.
--
-- Sorun: okuma parçası 👍/👎 oyları (readingFeedback) ve görsel oyları (imgVotes)
-- yalnızca süreç belleğindeydi. Render her dağıtımda/uyku sonrası süreci yeniden
-- başlattığı için bu sinyaller SÜREKLİ ÇÖPE GİDİYORDU. Yani kullanıcılar içerik
-- kalitesi hakkında bize bilgi veriyordu ve biz hiçbirini saklamıyorduk.
create table if not exists public.content_feedback (
  kind       text not null,             -- 'reading' | 'image'
  ref        text not null,             -- okuma: cache anahtarı · görsel: "kelime|url"
  up         integer not null default 0,
  down       integer not null default 0,
  updated_at timestamptz default now(),
  primary key (kind, ref)
);
create index if not exists content_feedback_kind_idx on public.content_feedback (kind, down desc);

alter table public.content_feedback enable row level security;
-- Politika yok → yalnızca service-role (sunucu) erişir.

-- 2) VERİ SAKLAMA
--
-- Hiçbir tabloda temizlik yoktu; hepsi sonsuza kadar büyüyordu. KVKK açısından da
-- "ne kadar süre saklıyoruz" sorusunun cevabı olmalı. Aşağıdaki fonksiyon periyodik
-- çağrılır (sunucu açılışta ve günde bir kez çalıştırır).
create or replace function public.purge_old_data()
returns void
language plpgsql
security definer
as $$
begin
  -- YZ kullanım sayaçları: 60 günden eski (fatura/denetim için yeterli)
  delete from public.ai_usage        where day < current_date - 60;
  delete from public.ai_usage_global where day < current_date - 60;

  -- Oda davetleri: 7 günden eski (davet ömrü 30 dk, sonrası ölü kayıt)
  delete from public.room_invites where created_at < now() - interval '7 days';

  -- Okunmuş DM'ler: 1 yıldan eski. OKUNMAMIŞ olanlara dokunulmaz.
  delete from public.dm_messages
   where read_at is not null and created_at < now() - interval '365 days';

  -- Reddedilmiş/bekleyen eski arkadaşlık istekleri: 90 gün
  delete from public.friend_requests where created_at < now() - interval '90 days';

  -- Kötüye kullanım bildirimleri: 2 yıl.
  -- DENGE: reports.target BİLEREK auth.users'a cascade ile bağlanmadı — hakkında
  -- bildirim yapılan biri hesabını silerek kaydı temizleyip denetimden kaçmasın.
  -- Ama "asla silinmez" de olmaz; süresiz saklama KVKK'ya aykırı ve gizlilik
  -- politikamız §6'da bu istisnayı "sınırlı bir süre" diye taahhüt ediyor.
  -- 2 yıl, tekrarlayan kötüye kullanımı görmeye yeter, süresiz değildir.
  delete from public.reports where created_at < now() - interval '730 days';

  -- Engellemeler: 2 yıl. Kullanıcının kendi kurduğu engel, iki taraf da uzun
  -- süredir yoksa sonsuza kadar tutulmamalı. (Aktif engeller etkilenmez —
  -- created_at yenilenmediği için eski kayıtlar zaten ölü ilişkilerdir.)
  delete from public.blocks where created_at < now() - interval '730 days';

  -- Haftalık koç raporları: 2 yıl. Bunlar ilerleme geçmişi olduğu için uzun
  -- tutulur ("2 yıl önce üretimde %54'tün" demek değerli), ama sınırsız değil.
  -- Tablo yoksa hata vermesin diye koşullu (db/15_coach_reports.sql).
  if to_regclass('public.coach_reports') is not null then
    delete from public.coach_reports where created_at < now() - interval '730 days';
  end if;

  -- Koç sohbetleri: 1 yıl dokunulmamışsa sil. Sohbet içeriği kullanıcının en
  -- mahrem verisi; ilerleme geçmişi kadar uzun tutmaya gerek yok.
  if to_regclass('public.coach_chats') is not null then
    delete from public.coach_chats where updated_at < now() - interval '365 days';
  end if;
end;
$$;
