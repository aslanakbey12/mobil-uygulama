# Kelime & Okuma & Tartışma — Backend (MVP iskeleti)

Bu servis, sesli tartışma odalarının **kalbidir**: kullanıcıları seviyeye göre
eşleştirir (matchmaking), oda kurar ve LiveKit'e katılmak için token üretir.

> Durum: MVP iskelet. Eşleştirme ve odalar **bellek içinde** tutulur (sunucu
> yeniden başlayınca sıfırlanır). Kimlik doğrulama, kalıcı depolama (Postgres/Redis)
> ve moderasyon sonraki adımlarda eklenecek.

## Kurulum

```bash
cd server
cp .env.example .env      # LIVEKIT_* değerlerini doldur (cloud.livekit.io)
npm install
npm run start             # veya: npm run dev  (dosya değişince yeniden başlar)
```

LiveKit'i şimdilik boş bırakırsan eşleştirme yine çalışır; sadece `/token`
ucu "LiveKit yapılandırılmamış" hatası döner.

## Akış (uçtan uca)

1. İstemci `POST /matchmaking/join` → `{ userId, name, level }`
2. İstemci kısa aralıklarla `GET /matchmaking/status?userId=...` yoklar
   - `waiting` → "X kişi bekliyor, sıran Y"
   - `matched` → oda bilgisi gelir (`room.name`, `room.topic`)
3. Eşleşince `POST /token` → `{ userId, name, roomName }` → LiveKit `token` + `url`
4. İstemci LiveKit SDK ile odaya katılır, sesli tartışma başlar
5. Çıkışta `POST /rooms/leave` → `{ userId }`

## API

| Yöntem | Yol | Gövde / Sorgu | Açıklama |
|---|---|---|---|
| GET | `/health` | — | durum, kuyruklar, oda sayısı |
| POST | `/matchmaking/join` | `{userId,name,level}` | kuyruğa katıl |
| GET | `/matchmaking/status` | `?userId=` | durum (waiting/matched/idle) |
| POST | `/matchmaking/leave` | `{userId}` | kuyruktan ayrıl |
| POST | `/token` | `{userId,name,roomName}` | LiveKit erişim token'ı |
| POST | `/rooms/leave` | `{userId}` | odadan ayrıl |
| POST | `/livekit/webhook` | LiveKit olayı | (ileride moderasyon) |

## Eşleştirme kuralları (.env)

- `MATCH_MIN` (vars. 2): oda için minimum kişi
- `MATCH_IDEAL` (vars. 4): bu sayıya ulaşınca hemen başlat
- `MATCH_RELAX_MS` (vars. 20000): en eski bekleyen bu süreyi aşınca MIN ile başlat

Yani 4 kişi hızlı birikirse hemen; birikmezse ~20 sn sonra 2-3 kişiyle başlar
(boş bekleme yerine esnek grup).

## Hızlı test (LiveKit olmadan)

```bash
# iki kullanıcı kuyruğa girsin (MIN=2 ise ~20 sn sonra ya da hemen eşleşir)
curl -s localhost:3000/matchmaking/join -H 'content-type: application/json' -d '{"userId":"u1","name":"Ali","level":"B1"}'
curl -s localhost:3000/matchmaking/join -H 'content-type: application/json' -d '{"userId":"u2","name":"Ayse","level":"B1"}'
curl -s "localhost:3000/matchmaking/status?userId=u1"
curl -s localhost:3000/health
```

## Sonraki adımlar

- [ ] Supabase auth (gerçek `userId`, JWT doğrulama)
- [ ] Kuyruk/oda durumunu Redis'e taşı (çok örnekli ölçek)
- [ ] Moderasyon: rapor/engelle uçları, yaş kapısı, webhook ile olay loglama
- [ ] Metin-bağlı oturum: odaya konuyla birlikte kısa okuma parçası ekle
- [ ] (Opsiyonel) AI kolaylaştırıcı: oturum başında konuyu açan, sonunda geri bildirim veren ajan
- [ ] WebSocket ile anlık eşleşme bildirimi (polling yerine)
