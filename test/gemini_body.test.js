// DÜŞÜNMEYİ KAPATMA — model uyumluluğu.
//
// Bu dosya iki kez yanlış davranışı korudu, çünkü davranış ÖLÇÜLMEDEN
// yazılmıştı. Önce "pro thinkingBudget:0'ı reddeder" varsayıldı, sonra "lite de
// reddeder" diye kapsam genişletildi; ikisinde de çözüm alanı SİLMEKti.
//
// Gerçek anahtarla ölçüm (2026-08-07):
//
//   model                     thinkingBudget:0   thinkingLevel:"low"   config yok
//   gemini-flash-latest       400 RED            OK, düşünme 0         OK, düşünme 1660
//   gemini-flash-lite-latest  OK, düşünme 0      OK, düşünme 0         OK, düşünme 0
//   gemini-pro-latest         OK                 OK                    —
//
// Yani eski varsayımların ikisi de yanlıştı: pro ve lite budget:0'ı KABUL ediyor,
// asıl reddeden flash-latest'ti (desene uymadığı için hiç yakalanmamıştı) ve her
// okuma isteği önce boşa bir 400 turu atıyordu. Üstelik "sil" çözümü en pahalısı:
// flash o zaman 1660 düşünme token'ı yakıyor ve düşünme çıktı olarak faturalanıyor.
//
// Doğru cevap model adı saymak değil, çağıranın niyetini ("düşünme istemiyorum")
// her modelin kabul ettiği alana çevirmek.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { __bodyForTest: bodyFor } = await import("../src/reading.js");

const govde = (thinkingConfig = { thinkingBudget: 0 }) => ({
  contents: [{ parts: [{ text: "x" }] }],
  generationConfig: { responseMimeType: "application/json", temperature: 0.7, thinkingConfig },
});

describe("düşünme kapatma çevirisi", () => {
  // Zincirdeki her model + ileride gelebilecek adlar. Model adına BAKMADAN aynı
  // sonucu vermeli: kalıp eşleştirmeye dönüş bu testi düşürür.
  for (const model of [
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-pro-latest",
    "gemini-3-flash-preview",
    "gemini-4-bilinmeyen-gelecek-model",
  ]) {
    test(`${model}: thinkingBudget:0 -> thinkingLevel:"low"`, () => {
      const b = bodyFor(model, govde());
      assert.deepEqual(b.generationConfig.thinkingConfig, { thinkingLevel: "low" },
        "her model bu biçimi kabul ediyor; model adına göre dallanmak kırılgan");
    });
  }

  test("thinkingConfig ASLA silinmez — silmek flash'ta 1660 düşünme token'ı yakıyordu", () => {
    for (const model of ["gemini-flash-latest", "gemini-pro-latest", "gemini-flash-lite-latest"]) {
      const b = bodyFor(model, govde());
      assert.ok(b.generationConfig.thinkingConfig, `${model}: alan silinmemeli`);
    }
  });

  test("sıfır OLMAYAN bütçe olduğu gibi geçer (çağıran bilerek düşünme istiyor)", () => {
    const b = bodyFor("gemini-flash-latest", govde({ thinkingBudget: 512 }));
    assert.deepEqual(b.generationConfig.thinkingConfig, { thinkingBudget: 512 });
  });

  test("thinkingConfig yoksa gövdeye dokunulmaz (koç bilerek düşünüyor)", () => {
    const g = { contents: [{ parts: [{ text: "x" }] }], generationConfig: { temperature: 0.9 } };
    assert.equal(bodyFor("gemini-pro-latest", g), g);
  });

  test("diğer alanlar bozulmaz", () => {
    const b = bodyFor("gemini-flash-latest", govde());
    assert.equal(b.generationConfig.temperature, 0.7);
    assert.equal(b.generationConfig.responseMimeType, "application/json");
    assert.equal(b.contents[0].parts[0].text, "x");
  });

  test("ORİJİNAL gövde değişmez (yan etki yok)", () => {
    // Zincir birden çok modeli deniyor; gövdeyi yerinde değiştirmek, sonraki
    // modelin isteğini de bozardı.
    const g = govde();
    bodyFor("gemini-flash-latest", g);
    assert.deepEqual(g.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  });
});
