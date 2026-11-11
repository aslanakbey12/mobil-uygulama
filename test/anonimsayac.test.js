// Anonim sayaç ucu: katı doğrulama, upsert çağrısı, kimliksiz çalışma.
import test from "node:test";
import assert from "node:assert/strict";

process.env.SUPABASE_URL = "https://ornek.supabase.co";
process.env.SUPABASE_SERVICE_KEY = "sahte-anahtar";

const cagrilar = [];
test.mock.module("../src/supabase.js", {
  namedExports: {
    supaConfigured: () => true,
    supa: () => ({ rpc: async (ad, arg) => { cagrilar.push([ad, arg]); return { error: null }; } }),
  },
});
const { app } = await import("../src/server.js");
const { sayacDogrula } = await import("../src/anonimsayac.js");
await app.ready();

const gun = (fark) => new Date(Date.now() + fark * 86400000).toISOString().slice(0, 10);
const yolla = (payload, ip = "10.0.0.1") =>
  app.inject({ method: "POST", url: "/sayac", payload, remoteAddress: ip });

test("geçerli istek 204, kimliksiz, upsert RPC'si doğru argümanla çağrılır", async () => {
  cagrilar.length = 0;
  const r = await yolla({ k: gun(-3), g: 3, p: "android" }, "10.0.1.1");
  assert.equal(r.statusCode, 204);
  assert.deepEqual(cagrilar, [["anonim_sayac_artir", { p_kurulum_gunu: gun(-3), p_gun_farki: 3, p_platform: "android" }]]);
});

test("geçersiz gövdeler 400 ve DB'ye dokunmaz", async () => {
  cagrilar.length = 0;
  const kotu = [
    { k: gun(5), g: 0, p: "ios" },                // gelecek
    { k: gun(-3), g: 9, p: "ios" },               // yanlış g
    { k: gun(-3), g: 3, p: "windows" },           // kötü platform
    { k: "2026-05-31", g: 0, p: "web" },          // çok eski
    { k: "2026-02-30", g: 0, p: "web" },          // gerçek olmayan tarih
    { k: gun(-3), g: 3.5, p: "web" },
    { k: gun(-3), g: -1, p: "web" },
    { k: gun(-3), g: 3, p: "web", ek: 1 },        // fazladan alan
    { k: gun(-3), g: 3 },
    {},
  ];
  for (const b of kotu) assert.equal((await yolla(b, "10.0.2.2")).statusCode, 400, JSON.stringify(b));
  assert.equal(cagrilar.length, 0);
});

test("gün farkı ±1 hoş görülür (saat dilimi payı), ±2 değil", () => {
  const simdi = Date.parse("2026-11-10T12:00:00Z");
  assert.ok(sayacDogrula({ k: "2026-11-07", g: 4, p: "ios" }, simdi));
  assert.ok(sayacDogrula({ k: "2026-11-07", g: 2, p: "ios" }, simdi));
  assert.equal(sayacDogrula({ k: "2026-11-07", g: 5, p: "ios" }, simdi), null);
});

test("gövde 256 baytı aşarsa reddedilir", async () => {
  const r = await yolla({ k: gun(-3), g: 3, p: "web", x: "a".repeat(400) }, "10.0.3.3");
  assert.equal(r.statusCode, 413);
});

// Operatör NAT'ı yüzünden tavan yüksek (200): yüzlerce telefon tek IP arkasında.
test("IP başına günde 200 istek, sonrası 429", async () => {
  const kodlar = [];
  for (let i = 0; i < 201; i++) kodlar.push((await yolla({ k: gun(-1), g: 1, p: "web" }, "10.0.4.4")).statusCode);
  assert.equal(kodlar.filter((k) => k === 204).length, 200);
  assert.equal(kodlar[200], 429);
});

test.after(() => app.close());
