// OKUMA PARÇASI EKLERİ — model çıktısının süzülmesi (reading.eklerTemizle).
//
// Çeviriler cümle İNDEKSİYLE eşleşiyor: model bir cümleyi atlar ya da ikisini
// birleştirirse her çeviri bir kaymış cümlenin altına düşer. Kullanıcıya yanlış
// cümlenin Türkçesini göstermek, hiç göstermemekten kötü — sayı tutmazsa boş.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test";
import { test } from "node:test";
import assert from "node:assert/strict";
const { eklerTemizle } = await import("../src/reading.js");

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

test("cümle sayısı tutmazsa çeviri hiç verilmez (kayma yerine boşluk)", () => {
  const out = eklerTemizle({ words: [], sentences: ["Bir.", "İki."] }, [], 3);
  assert.deepEqual(out.sentences, []);
});

test("bozuk çıktı çökertmez", () => {
  assert.deepEqual(eklerTemizle(null, ["a"], 1), { words: [], sentences: [] });
  assert.deepEqual(eklerTemizle({ words: "x", sentences: {} }, ["a"], 1), { words: [], sentences: [] });
});
