# Backend Deploy (Render — ücretsiz, WebSocket destekli)

Sunucu deploy'a hazır: `package.json` start script'i `node src/server.js` (env'i platformdan okur),
`render.yaml` ayarları içeriyor, `.gitignore` sırları hariç tutuyor.

> Not: Render ücretsiz katman 15 dk hareketsizlikte uyur, ilk istekte ~1 dk'da uyanır. Test için yeterli.

---

## Ön koşul: Git kur (bir kez)
Bu makinede Git yok. Kur (PowerShell'de `!` ile ya da elle):
```
winget install --id Git.Git -e
```
Kurduktan sonra PowerShell'i kapatıp aç (PATH yenilensin).

---

## 1) Kodu GitHub'a koy
```
cd C:\kelime-odalari\kelime-odalari\server
git init -b main
git add .
git commit -m "Backend deploy hazir"
```
- GitHub'da **boş** bir repo aç (github.com → New repository, README ekleme).
- Çıkan komutları çalıştır (örnek):
```
git remote add origin https://github.com/KULLANICI/kelime-odalari-server.git
git push -u origin main
```

## 2) Render'da servis oluştur
1. https://render.com → ücretsiz hesap (GitHub ile giriş yapabilirsin).
2. **New → Web Service** → GitHub repo'nu seç.
   - (render.yaml'ı otomatik okur; okumazsa manuel gir:)
   - Runtime: **Node** · Build: `npm install` · Start: `node src/server.js`
   - Health check path: `/health` · Plan: **Free**
3. Environment sekmesinde `render.yaml`'daki değişkenler zaten gelir (MATCH_MIN=2 vb.).
   PORT'u **ELLE GİRME** (Render otomatik verir).
4. **Create Web Service** → build + deploy (~2-3 dk).
5. Bittiğinde URL'in: `https://kelime-odalari-server.onrender.com` gibi.
6. Test: tarayıcıda `.../health` → `{"ok":true,...}` görmelisin.

## 3) İstemciyi bağla
`app/src/config.js`:
```
export const API_BASE = "https://SENIN-URL.onrender.com";
```
(WebSocket otomatik `wss://.../ws` olur — ws.js http→ws çevirir.)
Sonra uygulamayı yeniden başlat → odalar/oyun/lig artık her yerden çalışır.

---

## Alternatif: Railway (Git'siz, CLI ile)
Git kurmak istemezsen:
```
npm i -g @railway/cli
railway login
cd C:\kelime-odalari\kelime-odalari\server
railway init
railway up
```
Env değişkenlerini Railway panelinden gir (render.yaml'daki liste). Not: Railway deneme
kredisinden sonra kart ister; Render + GitHub tamamen ücretsizdir.

---

## Deploy sonrası prod notları (sonra)
- Gerçek auth: Supabase JWT_SECRET ekle → `x-user-id` dev modu kapanır (güvenlik).
- Kalıcılık: lig/oyun/oda durumu şu an bellekte (yeniden deploy'da sıfırlanır) → ileride DB.
- Sesli oda: LiveKit anahtarları + `VOICE_LIVE=true`.
