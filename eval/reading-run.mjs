// OKUMA PARÇASI DEĞERLENDİRME KOŞUCUSU.
//
//   node eval/reading-run.mjs                                    → bugünkü model
//   node eval/reading-run.mjs --model=deepseek/deepseek-v4-pro   → aday
//   node eval/reading-run.mjs b1-uc-kelime                       → tek vaka
//
// Okuma, koç taşındıktan sonra faturanın en büyük kalemi (%49). Ama flash-lite
// deneyimi şunu gösterdi: ucuz olmak yetmiyor, model öğretme işini yapmalı.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BURA = path.dirname(fileURLToPath(import.meta.url));
process.chdir(path.resolve(BURA, ".."));

if (fs.existsSync(".env")) {
  for (const s of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const i = s.indexOf("=");
    if (i > 0 && !s.trimStart().startsWith("#") && !process.env[s.slice(0, i).trim()]) {
      process.env[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    }
  }
}
// Önbellek ÖLÇÜMÜ BOZAR: ikinci model birincinin parçasını okur.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

const args = process.argv.slice(2);
const modelArg = args.find((a) => a.startsWith("--model="));
const model = modelArg ? modelArg.slice(8) : (process.env.READING_MODEL || "gemini-flash-latest");
process.env.READING_MODEL = model;
process.env.GEMINI_MODEL = model;      // sağlayıcı Gemini değilse zincir tek modele iner
const secilen = args.filter((a) => !a.startsWith("--"));

const { READING_CASES } = await import("./reading-cases.mjs");
const { denetleParca } = await import("./reading-checks.mjs");

const kullanim = [];
const gercekFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  const r = await gercekFetch(url, opt);
  const u = String(url);
  if (u.includes("generateContent") || u.includes("/chat/completions")) {
    try {
      const j = await r.clone().json();
      if (j?.usageMetadata) {
        kullanim.push({ gin: j.usageMetadata.promptTokenCount || 0, cik: (j.usageMetadata.candidatesTokenCount || 0) + (j.usageMetadata.thoughtsTokenCount || 0) });
      } else if (j?.usage) {
        kullanim.push({ gin: j.usage.prompt_tokens || 0, cik: j.usage.completion_tokens || 0 });
      }
    } catch (_) { /* ölçüm başarısız olsa da koşu sürsün */ }
  }
  return r;
};

const { generatePassage } = await import("../src/reading.js");

const vakalar = secilen.length ? READING_CASES.filter((c) => secilen.includes(c.id)) : READING_CASES;
console.log(`Okuma değerlendirmesi — ${vakalar.length} vaka · model=${model}\n`);

const sonuc = [];
let toplam = 0, gecen = 0, temizVaka = 0;

for (const vaka of vakalar) {
  let parca = null, hata = null;
  const t0 = Date.now();
  try { parca = await generatePassage(vaka.girdi.level, vaka.girdi.words, vaka.girdi.opts || {}); }
  catch (e) { hata = String(e.message || e); }
  const sure = Date.now() - t0;

  const d = hata ? [{ ad: "üretildi", gecti: false, detay: hata }] : denetleParca(vaka, parca);
  const g = d.filter((x) => x.gecti).length;
  toplam += d.length; gecen += g;
  const temiz = g === d.length;
  if (temiz) temizVaka++;

  console.log(`${temiz ? "✔" : "✖"} ${vaka.id.padEnd(18)} ${g}/${d.length}  (${sure}ms)`);
  for (const x of d.filter((y) => !y.gecti)) console.log(`    ✖ ${x.ad}${x.detay ? " → " + x.detay : ""}`);

  sonuc.push({ id: vaka.id, baslik: vaka.baslik, sure, hata, parca, denetimler: d });
}

// Fiyat: OpenRouter'dan çek, Gemini için elle tablo (tahmin etmemek için).
const ELLE = { "gemini-flash-latest": [1.50, 9.0], "gemini-flash-lite-latest": [0.30, 2.50], "gemini-pro-latest": [1.25, 10.0] };
let fiyat = ELLE[model];
if (!fiyat && model.includes("/") && process.env.OPENROUTER_API_KEY) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models", { headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } });
    const m = ((await r.json()).data || []).find((x) => x.id === model);
    if (m?.pricing) fiyat = [Number(m.pricing.prompt) * 1e6, Number(m.pricing.completion) * 1e6];
  } catch (_) { /* alınamazsa uyarı basılır */ }
}
const gin = kullanim.reduce((t, k) => t + k.gin, 0);
const cik = kullanim.reduce((t, k) => t + k.cik, 0);
const [pg, pc] = fiyat || [1.5, 9.0];
const ort = Math.round(sonuc.reduce((t, s) => t + s.sure, 0) / (sonuc.length || 1));

console.log(`\nVAKA:    ${temizVaka}/${vakalar.length} tam temiz`);
console.log(`DENETİM: ${gecen}/${toplam}  (%${((gecen / toplam) * 100).toFixed(0)})`);
console.log(`TOKEN:   ${gin} girdi · ${cik} çıktı · ${kullanim.length} çağrı`);
console.log(`MALİYET: ₺${((gin * pg + cik * pc) / 1e6 * 47.5).toFixed(3)}  ·  parça başına ₺${((gin * pg + cik * pc) / 1e6 * 47.5 / (vakalar.length || 1)).toFixed(4)}${fiyat ? "" : "  (fiyat alınamadı)"}`);
console.log(`GECİKME: ortalama ${ort}ms`);

fs.mkdirSync(path.join(BURA, "out"), { recursive: true });
const ad = `okuma__${model}`.replace(/[^a-z0-9._-]+/gi, "_");
fs.writeFileSync(path.join(BURA, "out", `${ad}.json`), JSON.stringify({ tarih: new Date().toISOString(), model, sonuc }, null, 1));
console.log(`\nAyrıntı: eval/out/${ad}.json`);
process.exitCode = gecen === toplam ? 0 : 1;
