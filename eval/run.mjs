// KOÇ DEĞERLENDİRME KOŞUCUSU.
//
//   node eval/run.mjs                 → tüm vakalar, sonucu eval/son.json'a yazar
//   node eval/run.mjs mazeret plan    → sadece bu id'ler
//   node eval/run.mjs --model=gemini-flash-latest   → başka modelle dene
//
// NİYE: istemi ya da modeli değiştirdiğimizde neyi düzelttiğimizi ve neyi
// BOZDUĞUMUZU görmek için. Bir davranışı düzeltip üç tanesini sessizce kırmak
// bu işin en klasik tuzağı; tek savunması budur.
//
// MALİYET: vaka başına bir koç çağrısı (~₺0,58 pro'da). Tüm küme ~₺6.
// Ucuz değil ama bir istem değişikliğini körlemesine yayınlamaktan çok daha ucuz.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BURA = path.dirname(fileURLToPath(import.meta.url));
const KOK = path.resolve(BURA, "..");
process.chdir(KOK);

// .env yükle (sunucu Render'da env kullanıyor; yerelde dosya).
if (fs.existsSync(".env")) {
  for (const s of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const i = s.indexOf("=");
    if (i > 0 && !s.trimStart().startsWith("#") && !process.env[s.slice(0, i).trim()]) {
      process.env[s.slice(0, i).trim()] = s.slice(i + 1).trim();
    }
  }
}
if (!process.env.GEMINI_API_KEY) {
  console.error("GEMINI_API_KEY yok. server/.env içine ekle.");
  process.exit(1);
}
// Değerlendirme DB'ye dokunmamalı: sohbet/not yazmasın, önbelleğe girmesin.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

const args = process.argv.slice(2);

// SAĞLAYICI HAZIR AYARLARI. Hepsi OpenAI uyumlu uç kullanıyor, o yüzden tek
// uyarlayıcı (src/llm.js) yetiyor. Anahtar isimleri .env'den okunur.
const SAGLAYICILAR = {
  gemini:     { provider: "gemini", varsayilanModel: "gemini-pro-latest" },
  deepseek:   { provider: "openai", base: "https://api.deepseek.com/v1",              anahtar: "DEEPSEEK_API_KEY",   varsayilanModel: "deepseek-v4-flash" },
  openrouter: { provider: "openai", base: "https://openrouter.ai/api/v1",             anahtar: "OPENROUTER_API_KEY", varsayilanModel: "anthropic/claude-haiku-4.5" },
  // Qwen ULUSLARARASI (Singapur). Konsolda gösterilen uç adresi hesaba göre
  // değişebiliyor (bazı hesaplarda workspace'e özgü *.maas.aliyuncs.com adresi
  // veriliyor), o yüzden QWEN_BASE_URL ile ezilebilir.
  qwen:       { provider: "openai", base: process.env.QWEN_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", anahtar: "QWEN_API_KEY", varsayilanModel: "qwen3.7-plus" },
};

const provArg = args.find((a) => a.startsWith("--provider="));
const sag = provArg ? provArg.slice(11) : "gemini";
const P = SAGLAYICILAR[sag];
if (!P) { console.error(`Bilinmeyen sağlayıcı: ${sag}. Seçenekler: ${Object.keys(SAGLAYICILAR).join(", ")}`); process.exit(1); }
if (P.provider !== "gemini") {
  const k = process.env[P.anahtar];
  if (!k) { console.error(`${P.anahtar} yok. server/.env içine ekle.`); process.exit(1); }
  process.env.LLM_PROVIDER = "openai";
  process.env.LLM_BASE_URL = P.base;
  process.env.LLM_API_KEY = k;
}

const modelArg = args.find((a) => a.startsWith("--model="));
const model = modelArg ? modelArg.slice(8) : P.varsayilanModel;
process.env.COACH_MODEL = model;
process.env.GEMINI_MODEL = model;   // zincir başka sağlayıcıda tek modele iniyor
const secilen = args.filter((a) => !a.startsWith("--"));

const { CASES } = await import("./cases.mjs");
const { denetle } = await import("./checks.mjs");

// Token/maliyet ölçümü. İKİ CEVAP ŞEKLİ de tanınmalı: Gemini usageMetadata,
// OpenAI uyumlu usage. Sadece birini tanımak, karşılaştırmanın yarısını
// "0 token" göstermek olurdu — yani tam da ölçmek istediğimiz şeyi kaybederdik.
const kullanim = [];
const gercekFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  const r = await gercekFetch(url, opt);
  const u_ = String(url);
  if (u_.includes("generateContent") || u_.includes("/chat/completions")) {
    try {
      const j = await r.clone().json();
      if (j?.usageMetadata) {
        const u = j.usageMetadata;
        kullanim.push({ gin: u.promptTokenCount || 0, cik: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) });
      } else if (j?.usage) {
        kullanim.push({ gin: j.usage.prompt_tokens || 0, cik: j.usage.completion_tokens || 0 });
      }
    } catch (_) { /* ölçüm başarısız olsa da koşu sürsün */ }
  }
  return r;
};

// $/1M (girdi, çıktı). Karar anında doğrulanmalı — sağlayıcılar fiyat değiştiriyor
// (DeepSeek açıkça "yakında önemli zam" diyor). Burada sadece koşu maliyetini
// göstermek için var.
const FIYAT = {
  "gemini-pro-latest": [1.25, 10.0],
  "gemini-flash-latest": [1.50, 9.0],
  "gemini-flash-lite-latest": [0.30, 2.50],
  "deepseek-v4-flash": [0.14, 0.28],
  "deepseek-v4-pro": [0.435, 0.87],
  "anthropic/claude-haiku-4.5": [1.00, 5.0],
  "qwen3.7-plus": [0.40, 1.20],
};

const { coachReply } = await import("../src/coach.js");

const vakalar = secilen.length ? CASES.filter((c) => secilen.includes(c.id)) : CASES;
if (!vakalar.length) { console.error("Eşleşen vaka yok. id'ler: " + CASES.map((c) => c.id).join(", ")); process.exit(1); }

console.log(`Koç değerlendirmesi — ${vakalar.length} vaka · sağlayıcı=${sag} · model=${model}\n`);

const sonuc = [];
let toplamDenetim = 0, gecenDenetim = 0, hatasizVaka = 0;

for (const vaka of vakalar) {
  let cevap = null, hata = null;
  const t0 = Date.now();
  try { cevap = await coachReply(vaka.girdi); } catch (e) { hata = String(e.message || e); }
  const sure = Date.now() - t0;

  const denetimler = hata ? [{ ad: "çağrı başarılı", gecti: false, detay: hata }] : denetle(vaka, cevap);
  const gecen = denetimler.filter((d) => d.gecti).length;
  toplamDenetim += denetimler.length;
  gecenDenetim += gecen;
  const temiz = gecen === denetimler.length;
  if (temiz) hatasizVaka++;

  console.log(`${temiz ? "✔" : "✖"} ${vaka.id.padEnd(22)} ${gecen}/${denetimler.length}  (${sure}ms)`);
  for (const d of denetimler.filter((x) => !x.gecti)) {
    console.log(`    ✖ ${d.ad}${d.detay ? " → " + d.detay : ""}`);
  }
  if (!temiz && cevap?.reply) console.log(`    cevap: ${cevap.reply.replace(/\s+/g, " ").slice(0, 150)}`);

  sonuc.push({ id: vaka.id, baslik: vaka.baslik, sure, hata, cevap, denetimler, gecen, toplam: denetimler.length });
}

// FİYATI SAĞLAYICIDAN AL. Elle tutulan tablo, karşılaştırmanın anlamını yok
// ediyordu: OpenRouter model kimlikleri tabloda olmadığı için hepsine Gemini pro
// fiyatı uygulanıp DeepSeek 10 kat pahalı görünüyordu. OpenRouter fiyatı zaten
// API'sinde veriyor — tahmin etmek yerine soruyoruz.
let fiyat = FIYAT[model];
if (!fiyat && sag === "openrouter") {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models", { headers: { authorization: `Bearer ${process.env.LLM_API_KEY}` } });
    const j = await r.json();
    const m = (j.data || []).find((x) => x.id === model);
    if (m?.pricing) fiyat = [Number(m.pricing.prompt) * 1e6, Number(m.pricing.completion) * 1e6];
  } catch (_) { /* alınamazsa aşağıdaki uyarı devreye girer */ }
}
const [pg, pc] = fiyat || [1.25, 10.0];
const tokGin = kullanim.reduce((t, k) => t + k.gin, 0);
const tokCik = kullanim.reduce((t, k) => t + k.cik, 0);
const usd = (tokGin * pg + tokCik * pc) / 1e6;
const ortSure = Math.round(sonuc.reduce((t, s) => t + s.sure, 0) / (sonuc.length || 1));
console.log(`\nVAKA:    ${hatasizVaka}/${vakalar.length} tam temiz`);
console.log(`DENETİM: ${gecenDenetim}/${toplamDenetim}  (%${((gecenDenetim / toplamDenetim) * 100).toFixed(0)})`);
console.log(`TOKEN:   ${tokGin} girdi · ${tokCik} çıktı · ${kullanim.length} çağrı`);
console.log(`MALİYET: ₺${(usd * 47.5).toFixed(3)}${fiyat ? "" : "  (fiyat alınamadı, Gemini pro varsayıldı)"}`);
console.log(`GECİKME: ortalama ${ortSure}ms`);

// HER MODELİN SONUCUNU AYRI SAKLA. Tek bir son.json'a yazmak, model
// karşılaştırmasında üretilen METİNLERİ kaybettiriyordu — oysa asıl değerlendirme
// orada: denetimler sözleşmeye uyumu ölçüyor, Türkçenin doğallığını ve tavsiyenin
// isabetini ölçmüyor. Onu ancak okuyarak anlarız.
const govde = JSON.stringify({
  tarih: new Date().toISOString(),
  saglayici: sag,
  model,
  ozet: { hatasizVaka, vakaSayisi: vakalar.length, gecenDenetim, toplamDenetim },
  sonuc,
}, null, 1);

fs.mkdirSync(path.join(BURA, "out"), { recursive: true });
const adSade = `${sag}__${model}`.replace(/[^a-z0-9._-]+/gi, "_");
fs.writeFileSync(path.join(BURA, "out", `${adSade}.json`), govde);
fs.writeFileSync(path.join(BURA, "son.json"), govde);
console.log(`\nAyrıntı: eval/out/${adSade}.json`);

// Çıkış kodu: CI'ya bağlanabilsin diye. Şimdilik bilgi amaçlı.
// exitCode: process.exit() Windows'ta açık tanıtıcılarla libuv uyarısı veriyordu.
process.exitCode = gecenDenetim === toplamDenetim ? 0 : 1;
