// Model uyumluluğu: bazı modeller `thinkingConfig`i reddedip 400 döner.
//
// GERÇEK OLAY: koç sohbeti zincirin ÜÇ modelinde de 400 aldı; hata
// gemini-flash-lite-latest'ten geldi. Kodda zaten "pro modelleri
// thinkingBudget:0'ı reddeder" notu vardı — aynı belirti, kapsam eksikti.
//
// Bu testler kapsamın sessizce daralmasını engeller.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { __bodyForTest: bodyFor } = await import("../src/reading.js");

const govde = () => ({
  contents: [{ parts: [{ text: "x" }] }],
  generationConfig: { responseMimeType: "application/json", temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } },
});

describe("gemini gövde uyarlaması", () => {
  test("PRO modelinde thinkingConfig KALDIRILIR", () => {
    const b = bodyFor("gemini-pro-latest", govde());
    assert.equal(b.generationConfig.thinkingConfig, undefined);
  });

  test("LITE modelinde thinkingConfig KALDIRILIR (400'ün sebebi buydu)", () => {
    const b = bodyFor("gemini-flash-lite-latest", govde());
    assert.equal(b.generationConfig.thinkingConfig, undefined);
  });

  test("normal flash modelinde KORUNUR (hız için gerekli)", () => {
    const b = bodyFor("gemini-flash-latest", govde());
    assert.deepEqual(b.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  });

  test("diğer alanlar bozulmaz", () => {
    const b = bodyFor("gemini-flash-lite-latest", govde());
    assert.equal(b.generationConfig.temperature, 0.7);
    assert.equal(b.generationConfig.responseMimeType, "application/json");
    assert.equal(b.contents[0].parts[0].text, "x");
  });

  test("ORİJİNAL gövde değişmez (yan etki yok)", () => {
    // Zincir birden çok modeli deniyor; gövdeyi yerinde değiştirmek, sonraki
    // modelin isteğini de bozardı.
    const g = govde();
    bodyFor("gemini-pro-latest", g);
    assert.deepEqual(g.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  });
});
