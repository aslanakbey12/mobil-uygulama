// SENARYO KARNESİ — değerlendirme provanın TAMAMINI görmeli.
//
// Burada gerçek bir ölçüm hatası vardı ve kimseye hata gibi görünmüyordu:
// özet istemi son 16 mesajı alıyordu, oysa tur sınırı 22 (dolu bir prova
// ~44 mesaj). Görevlerin ilki — "kendini tanıt", "sipariş ver" — hemen her
// zaman sohbetin başında yapılır ve o mesajlar pencerenin dışında kalıyordu.
// Kullanıcı görevi yapıyor, karnede ✗ görüyor ve ölçüme güvenmeyi bırakıyordu.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

let sonIstem = "";
mock.module("../src/reading.js", {
  exports: {
    readingConfigured: () => true,
    UTIL_MODEL: "test",
    extractJson: (t) => t,
    geminiText: async (body) => {
      sonIstem = body.contents[0].parts[0].text;
      return JSON.stringify({ used: [], tasks: [], corrections: [], praise: "iyi" });
    },
  },
});

const { generateRecap } = await import("../src/chat_ai.js");

const konusma = (n) => Array.from({ length: n }, (_, i) => ({
  mine: i % 2 === 0, text: `mesaj-${i}`,
}));

describe("özet penceresi", () => {
  test("GÖREV VARSA ilk mesajlar da isteme giriyor", async () => {
    await generateRecap(konusma(44), [], "B1", [
      { id: "intro", en: "introduce themselves" },
    ]);
    assert.ok(sonIstem.includes("mesaj-0"), "ilk mesaj pencerede yok — ilk görev ✗ alır");
    assert.ok(sonIstem.includes("mesaj-43"));
  });

  test("görev yoksa pencere dar kalıyor (gereksiz jeton harcanmasın)", async () => {
    await generateRecap(konusma(44), [], "B1", []);
    assert.ok(!sonIstem.includes("mesaj-0"));
    assert.ok(sonIstem.includes("mesaj-43"));
  });

  test("görev sonuçları İSTEMCİDEN gelen listeye hizalanıyor", async () => {
    const r = await generateRecap(konusma(4), [], "B1", [
      { id: "intro", en: "introduce themselves" },
      { id: "ask", en: "ask a question" },
    ]);
    assert.deepEqual(r.tasks.map((t) => t.id), ["intro", "ask"]);
    assert.deepEqual(r.tasks.map((t) => t.done), [false, false]);
  });
});
