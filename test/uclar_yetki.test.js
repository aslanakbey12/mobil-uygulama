// HER UÇ KİMLİK İSTİYOR MU? (18 Eki 2026)
//
// Her rota kendi kimlik kontrolünü yapıyor (getUserId → 401). Biri unutulursa
// hiçbir şey bozulmaz, uç sessizce herkese açılır. Bu test rotaları
// YÖNLENDİRİCİNİN KENDİSİNDEN alır (server.js `rotalar`, onRoute kancası) —
// yeni eklenen uç elle listeye yazılmadan kapsama girer.
//
// Ağ yok: app.inject sahte istek; SUPABASE_URL sahte ama servis anahtarı yok
// (supa() null), çöp token JWS biçiminde olmadığı için JWKS'e gitmeden düşer.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://ornek.supabase.co";
delete process.env.SUPABASE_SERVICE_KEY;
delete process.env.AUTH_STRICT;           // varsayılan: kilitli
delete process.env.SOSYAL_ACIK;           // sosyal uçlar 404
delete process.env.SAGLIK_ANAHTARI;       // /health/detay 404
delete process.env.REVENUECAT_WEBHOOK_TOKEN;
for (const k of Object.keys(process.env)) if (/GEMINI|OPENAI|LIVEKIT|GROQ|ANTHROPIC/i.test(k)) delete process.env[k];

const { app, rotalar } = await import("../src/server.js");
const { sosyalYolMu } = await import("../src/sosyal.js");
await app.ready();

// BİLEREK KİMLİKSİZ UÇLAR — her biri gerekçeli; liste kısa kalmalı.
// Değer: kimliksiz istekte beklenen durum kodu.
const ACIK = {
  // Uptime izleme + Render sağlık denetimi; yalnız {ok, surum} döner.
  "GET /health": 200,
  // Kendi anahtarı var (x-saglik-anahtari); anahtar tanımsızsa uç hiç yok.
  "GET /health/detay": 404,
  // Misafir çökme raporu (29 Eyl 2026 kararı): kullanıcıların çoğu hesapsız;
  // IP başına sıkı sınır, kayıtta kimlik yok, yalnız loga yazar.
  "POST /client-error": 200,
};

const ornekYol = (url) => url.replace(/:[A-Za-z_]+/g, "ornek").replace(/\*/g, "ornek");
const beklenen = (r) => {
  const k = `${r.method} ${r.url}`;
  if (k in ACIK) return ACIK[k];
  return sosyalYolMu(r.url) ? 404 : 401;
};
const gonder = (r, headers = {}) =>
  app.inject({
    method: r.method,
    url: ornekYol(r.url),
    headers,
    ...(r.method === "GET" || r.method === "DELETE" ? {} : { payload: {} }),
  });

test("rotalar yönlendiriciden toplanmış (boş değil)", () => {
  assert.ok(rotalar.length >= 40, `yalnız ${rotalar.length} rota bulundu`);
});

test("açık listedeki her uç hâlâ var (liste çürümesin)", () => {
  const var_ = new Set(rotalar.map((r) => `${r.method} ${r.url}`));
  for (const k of Object.keys(ACIK)) assert.ok(var_.has(k), `${k} artık yok — ACIK listesinden çıkar`);
});

test("Authorization başlığı yokken her uç 401 (sosyal 404)", async () => {
  const hatalar = [];
  for (const r of rotalar) {
    const res = await gonder(r);
    if (res.statusCode !== beklenen(r)) hatalar.push(`${r.method} ${r.url} → ${res.statusCode} (beklenen ${beklenen(r)})`);
  }
  assert.deepEqual(hatalar, []);
});

test("çöp Bearer token ile her uç 401 (sosyal 404)", async () => {
  const hatalar = [];
  for (const r of rotalar) {
    const res = await gonder(r, { authorization: "Bearer cop-token" });
    if (res.statusCode !== beklenen(r)) hatalar.push(`${r.method} ${r.url} → ${res.statusCode} (beklenen ${beklenen(r)})`);
  }
  assert.deepEqual(hatalar, []);
});

test("dev yedeği (x-user-id / body.userId) kilitli modda kimlik sayılmıyor", async () => {
  const hatalar = [];
  for (const r of rotalar) {
    if (beklenen(r) !== 401) continue;
    const res = await app.inject({
      method: r.method, url: ornekYol(r.url) + "?userId=saldirgan",
      headers: { "x-user-id": "saldirgan" },
      ...(r.method === "GET" ? {} : { payload: { userId: "saldirgan" } }),
    });
    if (res.statusCode !== 401) hatalar.push(`${r.method} ${r.url} → ${res.statusCode}`);
  }
  assert.deepEqual(hatalar, []);
});

test.after(() => app.close());
