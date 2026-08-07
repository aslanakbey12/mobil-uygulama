// KESİK MODEL ÇIKTISI.
//
// GERÇEK OLAY: kullanıcı koçu açtı ve şu hatayı gördü:
//   "Unterminated string in JSON at position 40 (line 2 column 39)"
//
// Sebep: koç `gemini-pro-latest` kullanıyor ve pro modelleri varsayılan olarak
// "düşünüyor". O düşünme aynı `maxOutputTokens` bütçesinden harcanıyor, yani
// 600 token'ın çoğu düşünmeye gidince cevap daha ilk cümlede kesiliyordu.
//
// İki ayrı kusur üst üste bindi:
//   1) geminiText `finishReason`a YALNIZCA metin boşken bakıyordu. Kesik metin
//      boş olmadığı için sağlam sanılıp geri dönüyordu.
//   2) Çağıran taraf ham JSON.parse hatasını kullanıcıya gösteriyordu.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { parseJson } = await import("../src/coach.js");

describe("kesik JSON ayrıştırma", () => {
  test("sağlam JSON aynen geçer", () => {
    assert.deepEqual(parseJson('{"reply":"merhaba","actions":[]}'), { reply: "merhaba", actions: [] });
  });

  test("kod bloğu içindeki JSON ayrıştırılır", () => {
    assert.deepEqual(parseJson('```json\n{"reply":"selam"}\n```'), { reply: "selam" });
  });

  test("SON ÖĞE yarım kalmışsa gerisi kurtarılır — çöpe atmıyoruz", () => {
    const kesik = '{"reply":"tamam","actions":[{"kind":"practice","label":"Alıştırma"},{"kind":"gram';
    const r = parseJson(kesik);
    assert.equal(r.reply, "tamam");
    assert.equal(r.actions.length, 1);            // yarım eylem düştü, sağlam olan kaldı
    assert.equal(r.actions[0].kind, "practice");
  });

  test("İLK ALANIN ortasında kesilmişse anlaşılır Türkçe hata verir", () => {
    // Kullanıcının gördüğü hatanın birebir şekli. Kurtarılacak tam öğe yok.
    const kesik = '{\n  "reply": "Merhaba! Seni biraz tanıya';
    assert.throws(() => parseJson(kesik), (e) => {
      assert.doesNotMatch(e.message, /Unterminated|JSON at position|SyntaxError/i,
        "son kullanıcıya ayrıştırıcının teknik metni gösterilmemeli");
      assert.match(e.message, /Koç şu an cevap üretemedi/);
      return true;
    });
  });
});

describe("geminiText kesik çıktıyı başarı saymaz", () => {
  // Gemini'nin gerçek yanıt şekli. finishReason MAX_TOKENS ama metin BOŞ DEĞİL —
  // eski kod tam da burada yanılıyordu.
  const yanit = (txt, finishReason) => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text: txt }] }, finishReason }] }),
  });

  async function calistir(yanitlar, generationConfig) {
    const orj = globalThis.fetch;
    const cagrilan = [];
    let i = 0;
    globalThis.fetch = async (url) => { cagrilan.push(String(url)); return yanitlar[Math.min(i++, yanitlar.length - 1)]; };
    try {
      const { geminiText } = await import("../src/reading.js");
      const body = { contents: [{ parts: [{ text: "x" }] }], generationConfig };
      let hata = null, sonuc = null;
      try { sonuc = await geminiText(body, { timeout: 500, tries: 1 }); } catch (e) { hata = e; }
      return { sonuc, hata, cagrilan };
    } finally { globalThis.fetch = orj; }
  }

  test("JSON kipinde MAX_TOKENS → kesik metin DÖNMEZ, sonraki model denenir", async (t) => {
    if (!process.env.GEMINI_API_KEY) return t.skip("GEMINI_API_KEY yok — zincir kurulmuyor");
    const cfg = { responseMimeType: "application/json", maxOutputTokens: 600 };
    // 1. model kesik verir, 2. model sağlam verir.
    const { sonuc } = await calistir(
      [yanit('{\n  "reply": "Merhaba! Seni biraz tanıya', "MAX_TOKENS"), yanit('{"reply":"tamam"}', "STOP")],
      cfg,
    );
    assert.equal(sonuc, '{"reply":"tamam"}', "kesik çıktı geri dönmemeli, yedek modelin sağlam cevabı dönmeli");
  });

  test("serbest metinde MAX_TOKENS → yarım cevap yine de işe yarar, dokunulmaz", async (t) => {
    if (!process.env.GEMINI_API_KEY) return t.skip("GEMINI_API_KEY yok — zincir kurulmuyor");
    const { sonuc } = await calistir([yanit("Uzun bir cevabın yarısı", "MAX_TOKENS")], { maxOutputTokens: 600 });
    assert.equal(sonuc, "Uzun bir cevabın yarısı");
  });
});
