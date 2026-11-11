// Hesap silinirken RevenueCat müşteri kaydı da silinmeli; hata silmeyi bozmamalı.
import test from "node:test";
import assert from "node:assert/strict";
import { revenueCatMusteriSil } from "../src/revenuecat.js";

const log = { info() {}, error() {} };
const eski = process.env.REVENUECAT_SECRET_KEY;
test.afterEach(() => { if (eski === undefined) delete process.env.REVENUECAT_SECRET_KEY; else process.env.REVENUECAT_SECRET_KEY = eski; });

test("anahtar yoksa istek atılmaz", async () => {
  delete process.env.REVENUECAT_SECRET_KEY;
  let cagri = 0;
  assert.equal(await revenueCatMusteriSil("u1", log, async () => { cagri++; return { ok: true }; }), "atlandi");
  assert.equal(cagri, 0);
});

test("doğru adres, yöntem ve başlıkla DELETE atılır", async () => {
  process.env.REVENUECAT_SECRET_KEY = "sk_test_x";
  let url, init;
  const r = await revenueCatMusteriSil("a/b", log, async (u, i) => { url = u; init = i; return { ok: true, status: 200 }; });
  assert.equal(r, "silindi");
  assert.equal(url, "https://api.revenuecat.com/v1/subscribers/a%2Fb");
  assert.equal(init.method, "DELETE");
  assert.equal(init.headers.Authorization, "Bearer sk_test_x");
  assert.ok(init.signal);
});

test("404 başarı sayılır; 500 ve ağ hatası fırlatmaz", async () => {
  process.env.REVENUECAT_SECRET_KEY = "sk_test_x";
  assert.equal(await revenueCatMusteriSil("u", log, async () => ({ ok: false, status: 404 })), "silindi");
  assert.equal(await revenueCatMusteriSil("u", log, async () => ({ ok: false, status: 500 })), "hata");
  assert.equal(await revenueCatMusteriSil("u", log, async () => { throw new Error("ağ"); }), "hata");
});
