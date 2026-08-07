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
const modelArg = args.find((a) => a.startsWith("--model="));
if (modelArg) process.env.COACH_MODEL = modelArg.slice(8);
const secilen = args.filter((a) => !a.startsWith("--"));

const { CASES } = await import("./cases.mjs");
const { denetle } = await import("./checks.mjs");

// Token/maliyet ölçümü — her koşuda ne harcadığımızı da bilelim.
const kullanim = [];
const gercekFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  const r = await gercekFetch(url, opt);
  if (String(url).includes("generateContent")) {
    try {
      const j = await r.clone().json();
      const u = j?.usageMetadata || {};
      kullanim.push({ gin: u.promptTokenCount || 0, cik: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) });
    } catch (_) { /* ölçüm başarısız olsa da koşu sürsün */ }
  }
  return r;
};

const { coachReply } = await import("../src/coach.js");

const vakalar = secilen.length ? CASES.filter((c) => secilen.includes(c.id)) : CASES;
if (!vakalar.length) { console.error("Eşleşen vaka yok. id'ler: " + CASES.map((c) => c.id).join(", ")); process.exit(1); }

console.log(`Koç değerlendirmesi — ${vakalar.length} vaka · model=${process.env.COACH_MODEL || "gemini-pro-latest"}\n`);

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

const usd = kullanim.reduce((t, k) => t + (k.gin * 1.25 + k.cik * 10) / 1e6, 0);
console.log(`\nVAKA:    ${hatasizVaka}/${vakalar.length} tam temiz`);
console.log(`DENETİM: ${gecenDenetim}/${toplamDenetim}  (%${((gecenDenetim / toplamDenetim) * 100).toFixed(0)})`);
console.log(`MALİYET: ${kullanim.length} çağrı · ₺${(usd * 47.5).toFixed(2)}`);

const hedef = path.join(BURA, "son.json");
fs.writeFileSync(hedef, JSON.stringify({
  tarih: new Date().toISOString(),
  model: process.env.COACH_MODEL || "gemini-pro-latest",
  ozet: { hatasizVaka, vakaSayisi: vakalar.length, gecenDenetim, toplamDenetim },
  sonuc,
}, null, 1));
console.log(`\nAyrıntı: eval/son.json`);

// Çıkış kodu: CI'ya bağlanabilsin diye. Şimdilik bilgi amaçlı.
process.exit(gecenDenetim === toplamDenetim ? 0 : 1);
