# Hesap & Kalıcılık Kurulumu (Supabase)

Bu adımlar tamamlanınca: kullanıcı ilerlemesi buluta senkronlanır (cihaz değişse de
kaybolmaz), kimlik sunucuda doğrulanır, engellemeler kalıcı olur.

## 1) Supabase projesi
1. https://app.supabase.com → yeni proje.
2. **SQL Editor** → `server/db/schema.sql` içeriğini çalıştır (tablolar + RLS + profil trigger'ı).
3. **Authentication → Providers → Anonymous** seçeneğini **aç** (sürtünmesiz giriş için).

## 2) Anahtarlar
**Project Settings → API**'den al:
- `Project URL`  → istemci `SUPABASE_URL` + sunucu `SUPABASE_URL`
- `anon` key     → istemci `SUPABASE_ANON_KEY` (güvenli, istemcide olur)
- `service_role` key → sunucu `SUPABASE_SERVICE_KEY` (GİZLİ, sadece sunucu)
- `JWT Secret`   → sunucu `SUPABASE_JWT_SECRET`

## 3) Sunucu (`server/`)
```bash
cp .env.example .env     # SUPABASE_* ve LIVEKIT_* doldur
npm install
npm run start
```
- `SUPABASE_JWT_SECRET` doluysa: her istekte `Authorization: Bearer <jwt>` doğrulanır,
  kullanıcı kimliği token'dan alınır (güvenli).
- Boşsa: **geliştirme modu** — kimlik body/query/`x-user-id`'den alınır.

## 4) İstemci (`app/`)
`app/src/config.js` içine `SUPABASE_URL` ve `SUPABASE_ANON_KEY` yaz.
```bash
npm install
npx expo run:ios   # veya run:android (sesli oda native modül ister)
```

## Nasıl çalışıyor
- **Giriş:** uygulama açılışında Supabase **anonim oturum** açar → gerçek `user id` + JWT.
  (İleride e-posta ile hesabı kalıcılaştırmak için `linkIdentity` eklenebilir.)
- **İlerleme:** `progress` tablosunda tek `jsonb` satır. `store.js` önce yerelden okur
  (çevrimdışı), sonra bulutla senkronlar; kaydederken yerel + bulut.
- **Eşleştirme/odalar:** gerçek zamanlı, bellekte (geçici) — kasıtlı. Sunucu yeniden
  başlasa kullanıcı yeniden eşleşir.
- **Moderasyon:** `blocks` ve `reports` Postgres'e yazılır; engeller açılışta belleğe
  yüklenir, eşleştirme bunları dikkate alır.

## Güvenlik notları
- `service_role` anahtarı **asla** istemciye konmaz.
- RLS açık: kullanıcı yalnızca kendi profch/ilerleme satırına erişir.
- Raporları yalnızca service-role (moderasyon) okur.
