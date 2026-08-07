// OKUMA PARÇASI MODEL KARŞILAŞTIRMASI
//
// Okuma, YZ faturamızın en büyük kalemi ve flash-lite çıktıda 3,6 kat ucuz.
// Ama kalite kararı benchmark'la verilemez: yayımlanan testler kodlama/ajan
// ölçütleri, bizim işimiz Türkçe öğrenene İngilizce parça üretmek. Tek dürüst
// yöntem kendi istemimizle üretip okumak.
//
// AYNI istem, AYNI kelimeler, AYNI seviye — tek değişken model.
//
// Çalıştırma:  node scripts/model-ab.mjs
// GEMINI_API_KEY server/.env içinde olmalı (.env gitignore'da).
import fs from "node:fs";
import path from "node:path";

// .env'i elle oku (sunucu Render'da env kullanıyor, yerelde dosya).
for (const satir of fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split(/\r?\n/) : []) {
  const i = satir.indexOf("=");
  if (i > 0 && !satir.trimStart().startsWith("#")) {
    const k = satir.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = satir.slice(i + 1).trim();
  }
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY yok. server/.env içine ekle (dosya gitignore'da).");
  process.exit(1);
}

// SUPABASE'İ DEVRE DIŞI BIRAK: bu bir ölçüm, kalıcı önbelleğe yazmasın —
// yoksa ikinci model önbellekten okur ve karşılaştırma anlamsızlaşır.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

const { __buildPromptTest: buildPrompt, __postGeminiTest: post } = await import("../src/reading.js");

// Gerçekçi girdi: 3 hedef kelime (yeni ayar), B1, bilinen kelime örneği.
const SENARYO = {
  level: "B1",
  words: ["acquire", "thorough", "reluctant"],
  knownSample: ["improve", "decision", "although", "recent", "provide", "however", "increase", "particular"],
};
const MODELLER = ["gemini-flash-latest", "gemini-flash-lite-latest"];

const prompt = buildPrompt(SENARYO.level, SENARYO.words, { knownSample: SENARYO.knownSample });
const body = {
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: { responseMimeType: "application/json", temperature: 0.8, maxOutputTokens: 2800, thinkingConfig: { thinkingBudget: 0 } },
};

const sonuc = { senaryo: SENARYO, prompt, uretilenler: [] };
for (const model of MODELLER) {
  const t0 = Date.now();
  try {
    const r = await post(model, body, 60000);
    const sure = Date.now() - t0;
    if (!r.ok) { sonuc.uretilenler.push({ model, hata: `HTTP ${r.status}`, sure }); continue; }
    const j = await r.json();
    const cand = j?.candidates?.[0];
    const txt = (cand?.content?.parts || []).map((p) => p?.text || "").join("");
    const kul = j?.usageMetadata || {};
    sonuc.uretilenler.push({
      model, sure, finishReason: cand?.finishReason,
      girdiTok: kul.promptTokenCount, ciktiTok: kul.candidatesTokenCount,
      parca: JSON.parse(txt.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()),
    });
    console.log(`✓ ${model} — ${sure}ms, çıktı ${kul.candidatesTokenCount} token`);
  } catch (e) {
    sonuc.uretilenler.push({ model, hata: String(e.message || e), sure: Date.now() - t0 });
    console.log(`✖ ${model} — ${String(e.message || e).slice(0, 80)}`);
  }
}

const hedef = process.argv[2] || path.join(process.cwd(), "model-ab-sonuc.json");
fs.writeFileSync(hedef, JSON.stringify(sonuc, null, 2), "utf8");
console.log("\nSonuç yazıldı:", hedef);
