// YZ içeriği bildirimi (koç raporu, okuma ekleri) — tür ve sebep beyaz listede.
import { test } from "node:test";
import assert from "node:assert/strict";
const { reportAi, YZ_BILDIRIM_TURLERI, YZ_BILDIRIM_SEBEPLERI } = await import("../src/reading.js");

test("bilinen tür ve sebep kabul ediliyor", async () => {
  assert.deepEqual(await reportAi("coach", "2026-W39", "hatali", "", "u1"), { ok: true });
  assert.deepEqual(await reportAi("reading_extra", "k#word:brave", "uygunsuz", "", "u1"), { ok: true });
});

test("bilinmeyen tür, sebep ya da boş ref reddediliyor", async () => {
  assert.equal((await reportAi("reading", "k", "hatali")).ok, false);     // okuma kendi ucunda
  assert.equal((await reportAi("coach", "k", "keyfi")).ok, false);
  assert.equal((await reportAi("coach", "", "hatali")).ok, false);
});

test("listeler istemcinin gönderdiği kodları içeriyor", () => {
  assert.deepEqual(YZ_BILDIRIM_TURLERI, ["coach", "reading_extra"]);
  assert.deepEqual(YZ_BILDIRIM_SEBEPLERI, ["uygunsuz", "hatali", "diger"]);
});
