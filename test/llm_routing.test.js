// SAĞLAYICI YÖNLENDİRMESİ.
//
// Ölçümle şu dağılıma karar verdik:
//   koç      → DeepSeek v4-pro (82/83, Gemini pro'nun 6 katı ucuz)
//   okuma    → Gemini flash    (lite kalite kaybettiriyordu — parça 92 kelime,
//                               hedef kelimeler birer kez, sözlükçenin yarısı
//                               kullanıcının zaten bildiği kelimeler)
//   yardımcı → Gemini flash-lite
//
// Tek bir genel LLM_PROVIDER anahtarı bu dağılımı imkânsız kılardı: açıldığı anda
// okuma da OpenRouter'a giderdi. Bu yüzden sağlayıcı MODEL ADINDAN anlaşılıyor.
// Bu testler o kuralın sessizce bozulmasını engelliyor — bozulursa fark etmezdik,
// sadece faturada ve kalitede görürdük.
process.env.OPENROUTER_API_KEY = "test-or-key";
process.env.GEMINI_API_KEY = "test-gemini-key";

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

const { callModel } = await import("../src/llm.js");

function yakala(cevap = { ok: true, json: async () => ({}) }) {
  const cagrilar = [];
  const orj = globalThis.fetch;
  globalThis.fetch = async (url, opt) => { cagrilar.push({ url: String(url), opt }); return cevap; };
  return { cagrilar, geri: () => { globalThis.fetch = orj; } };
}

const govde = () => ({
  contents: [{ parts: [{ text: "merhaba" }] }],
  generationConfig: { responseMimeType: "application/json", temperature: 0.7, maxOutputTokens: 100 },
});

describe("model adı sağlayıcıyı belirler", () => {
  for (const m of ["gemini-pro-latest", "gemini-flash-latest", "gemini-flash-lite-latest"]) {
    test(`${m} → Google'a gider`, async () => {
      const y = yakala();
      try {
        await callModel(m, govde(), 1000);
        assert.match(y.cagrilar[0].url, /generativelanguage\.googleapis\.com/,
          "eğik çizgisiz ad Gemini'yi gösterir; buraya OpenRouter'a gitmek okumayı da taşırdı");
      } finally { y.geri(); }
    });
  }

  for (const m of ["deepseek/deepseek-v4-pro", "qwen/qwen3.7-plus", "anthropic/claude-haiku-4.5"]) {
    test(`${m} → OpenRouter'a gider`, async () => {
      const y = yakala();
      try {
        await callModel(m, govde(), 1000);
        assert.match(y.cagrilar[0].url, /openrouter\.ai/);
        assert.equal(y.cagrilar[0].opt.headers.authorization, "Bearer test-or-key");
      } finally { y.geri(); }
    });
  }

  test("OpenAI uyumlu gövdeye çevriliyor (Gemini şekli gönderilmiyor)", async () => {
    const y = yakala();
    try {
      await callModel("deepseek/deepseek-v4-pro", govde(), 1000);
      const b = JSON.parse(y.cagrilar[0].opt.body);
      assert.equal(b.model, "deepseek/deepseek-v4-pro");
      assert.match(b.messages[0].content, /^merhaba/);
      assert.equal(b.max_tokens, 100);
      assert.deepEqual(b.response_format, { type: "json_object" });
      assert.equal(b.contents, undefined, "Gemini alanları sızmamalı");
      // OpenAI uyumlu json_object kipi, istemin içinde "json" kelimesinin
      // GEÇMESİNİ şart koşuyor; yoksa sağlayıcı 400 döner. Bizim istemlerimiz
      // zaten "Return ONLY JSON" diyor ama bu bağımlılık kırılgan olduğu için
      // uyarlayıcı garanti altına alıyor.
      assert.match(b.messages[0].content, /json/i);
    } finally { y.geri(); }
  });

  test("finish_reason 'length' → MAX_TOKENS'a çevrilir", async () => {
    // Bu çeviri olmadan kesik çıktı koruması YALNIZCA Gemini'de çalışırdı:
    // OpenAI uyumlu sağlayıcılarda yarım JSON sağlam sanılıp geri dönerdi.
    const y = yakala({ ok: true, json: async () => ({
      choices: [{ message: { content: '{"a":1' }, finish_reason: "length" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }) });
    try {
      const r = await callModel("deepseek/deepseek-v4-pro", govde(), 1000);
      assert.equal(r.finishReason, "MAX_TOKENS");
      assert.deepEqual(r.usage, { gin: 10, cik: 5 });
    } finally { y.geri(); }
  });
});
