import { test } from "node:test";
import assert from "node:assert/strict";
const { premiumKarari } = await import("../src/premiumkarar.js");
const SIMDI = Date.parse("2026-09-29T10:00:00Z");
const ileri = SIMDI + 5 * 86400000, geri = SIMDI - 1000;

test("iptal (yenileme kapatıldı) dönem sonuna kadar premium bırakıyor", () => {
  assert.deepEqual(premiumKarari({ type: "CANCELLATION", expiration_at_ms: ileri }, SIMDI), { premium: true, bitis: new Date(ileri).toISOString() });
});
test("iade (bitiş geçmişte) premium'u kapatıyor", () => {
  assert.equal(premiumKarari({ type: "CANCELLATION", expiration_at_ms: geri }, SIMDI).premium, false);
});
test("ödeme sorunu ek süre boyunca açık", () => {
  assert.equal(premiumKarari({ type: "BILLING_ISSUE", expiration_at_ms: ileri }, SIMDI).premium, true);
});
test("süre bitince kapalı, satın almada açık, bilinmeyen olay dokunmuyor", () => {
  assert.equal(premiumKarari({ type: "EXPIRATION" }, SIMDI).premium, false);
  assert.equal(premiumKarari({ type: "INITIAL_PURCHASE", expiration_at_ms: ileri }, SIMDI).premium, true);
  assert.equal(premiumKarari({ type: "TEST" }, SIMDI), null);
});
