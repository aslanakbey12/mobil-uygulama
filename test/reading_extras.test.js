// OKUMA PARÇASI EKLERİ — model çıktısının süzülmesi (reading.eklerTemizle) ve
// çağrının kendisi (reading.readingExtras, model taklitli).
//
// Çeviriler cümle NUMARASIYLA eşleşiyor ({i, tr}): model bir cümleyi atlarsa
// yalnız o boş kalır. Numarasız eski biçim (düz dizi) yalnız sayı tutarsa kabul
// — kaymış cümlenin Türkçesini göstermek hiç göstermemekten kötü.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test";
import { test, mock } from "node:test";
import assert from "node:assert/strict";
const { eklerTemizle, readingExtras } = await import("../src/reading.js");

test("yalnız istenen kelimeler, anlamı boş olan atılır, seviye süzülür", () => {
  const out = eklerTemizle({
    words: [
      { en: "Recommended", base: "recommend", tr: "tavsiye etti", level: "b1" },
      { en: "bakery", base: "bakery", tr: "", level: "A2" },          // anlamsız → atılır
      { en: "hacker", base: "hacker", tr: "korsan", level: "B1" },    // istenmedi → atılır
      { en: "flat", tr: "daire", level: "Z9" },                       // seviye geçersiz → boş
    ],
    sentences: ["Bir.", "İki."],
  }, ["recommended", "bakery", "flat"], 2);
  assert.deepEqual(out.words, [
    { en: "recommended", base: "recommend", tr: "tavsiye etti", level: "B1" },
    { en: "flat", base: "flat", tr: "daire", level: "" },
  ]);
  assert.deepEqual(out.sentences, ["Bir.", "İki."]);
});

test("numarasız düz dizi: sayı tutmazsa çeviri hiç verilmez (kayma yerine boşluk)", () => {
  const out = eklerTemizle({ words: [], sentences: ["Bir.", "İki."] }, [], 3);
  assert.deepEqual(out.sentences, []);
});

test("numaralı çeviri: atlanan cümle boş kalır, diğerleri YERİNDE", () => {
  const out = eklerTemizle({ sentences: [{ i: 1, tr: "Bir." }, { i: 3, tr: "Üç." }, { i: 9, tr: "taşan" }] }, [], 3);
  assert.deepEqual(out.sentences, ["Bir.", "", "Üç."]);
});

test("bağlam: yalnız istenen hedef, parça çeviride geçmiyorsa atılır", () => {
  const out = eklerTemizle({
    sentences: [{ i: 1, tr: "Maya kendi fırınını işletmek istiyordu." }],
    baglam: [
      { en: "run", i: 1, tr: "işletmek", parca: "İşletmek" },          // büyük/küçük harf farkı sorun değil
      { en: "own", i: 1, tr: "kendi", parca: "sahip olmak" },          // çeviride yok → parça boş, anlam kalır
      { en: "bakery", i: 1, tr: "fırın", parca: "fırınını" },          // hedef değil → atılır
      { en: "run", i: 2, tr: "koşmak", parca: "" },                    // yanlış cümle → atılır
    ],
  }, [], 1, [{ en: "run", i: 0 }, { en: "own", i: 0 }]);
  assert.deepEqual(out.baglam, [
    { en: "run", i: 0, tr: "işletmek", parca: "İşletmek" },
    { en: "own", i: 0, tr: "kendi", parca: "" },
  ]);
});

test("bozuk çıktı çökertmez", () => {
  assert.deepEqual(eklerTemizle(null, ["a"], 1), { words: [], sentences: [], baglam: [] });
  assert.deepEqual(eklerTemizle({ words: "x", sentences: {} }, ["a"], 1), { words: [], sentences: [], baglam: [] });
});

// 27–29 Eyl: JSON.parse(repairJson(…)) — repairJson nesne döndürüyor, her çağrı
// "çözümlenemedi" ile patladı ve özellik hiç çalışmadı. Testler yalnız süzgeci
// sınıyordu; bu test çağrının kendisini, geçerli (girintili) bir yanıtla koşuyor.
test("geçerli model yanıtı çözümlenir (çift parse hatası geri gelmesin)", async () => {
  const yanit = JSON.stringify({
    words: [{ en: "bakery", base: "bakery", tr: "fırın", level: "A2" }],
    sentences: [{ i: 1, tr: "Maya bir fırın işletiyor." }],
    baglam: [{ en: "run", i: 1, tr: "işletmek", parca: "işletiyor" }],
  }, null, 2);
  const f = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: yanit }] }, finishReason: "STOP" }],
    choices: [{ message: { content: yanit }, finish_reason: "stop" }],
  }), { status: 200, headers: { "content-type": "application/json" } }));
  try {
    const out = await readingExtras("Maya runs a bakery near the station.", ["bakery"], ["Maya runs a bakery near the station."], [{ en: "run", i: 0 }]);
    assert.equal(out.sentences[0], "Maya bir fırın işletiyor.");
    assert.equal(out.words[0].tr, "fırın");
    assert.deepEqual(out.baglam, [{ en: "run", i: 0, tr: "işletmek", parca: "işletiyor" }]);
  } finally { f.mock.restore(); }
});
