// GÖRSEL KARARI DEĞERLENDİRMESİ.
//
// Kullanıcı gözlemi: "bazı kelimeler gerçekten görselleştirilemiyor ama yine de
// görselini bulmaya çalışıyor". Boru hattı doğru kurulmuş — model önce
// `depictable` kararı veriyor, false ise Pexels'e hiç gidilmiyor. Yani mimari
// değil KARAR kalitesi sorunlu.
//
// SOMUT KELİMEYİ KAÇIRMAK ile SOYUT KELİMEYE "çizilebilir" DEMEK aynı ağırlıkta
// değil. Birincisinde kullanıcı görsel görmez (sessiz kayıp); ikincisinde
// "although" için alakasız bir fotoğraf görür ve ürün saçmalamış olur. O yüzden
// ikisi ayrı raporlanıyor.
//
//   node eval/image-run.mjs                                     → bugünkü model
//   node eval/image-run.mjs --model=gemini-flash-latest
//   node eval/image-run.mjs --model=deepseek/deepseek-v4-pro
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
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

const modelArg = process.argv.find((a) => a.startsWith("--model="));
if (modelArg) { process.env.UTIL_MODEL = modelArg.slice(8); process.env.GEMINI_MODEL = modelArg.slice(8); }

// beklenen: true = fotoğrafla açıkça gösterilebilir
const VAKALAR = [
  // SOMUT — görsel olmalı
  { en: "apple",     tr: "elma",        def: "a round fruit with red or green skin", bekle: true },
  { en: "bridge",    tr: "köprü",       def: "a structure built over a river or road", bekle: true },
  { en: "elephant",  tr: "fil",         def: "a very large grey animal with a trunk", bekle: true },
  { en: "umbrella",  tr: "şemsiye",     def: "a device you hold over you in the rain", bekle: true },
  { en: "keyboard",  tr: "klavye",      def: "the set of keys used to type", bekle: true },
  { en: "swimming",  tr: "yüzme",       def: "moving through water using your body", bekle: true },
  { en: "hammer",    tr: "çekiç",       def: "a tool with a heavy metal head", bekle: true },
  { en: "crowded",   tr: "kalabalık",   def: "full of people", bekle: true },

  // SOYUT / İŞLEV — görsel OLMAMALI
  { en: "although",     tr: "rağmen",      def: "despite the fact that", bekle: false },
  { en: "however",      tr: "ancak",       def: "used to introduce a contrast", bekle: false },
  { en: "despite",      tr: "rağmen",      def: "without being affected by", bekle: false },
  { en: "nevertheless", tr: "yine de",     def: "in spite of what has just been said", bekle: false },
  { en: "acquire",      tr: "edinmek",     def: "to get or obtain something", bekle: false },
  { en: "consider",     tr: "düşünmek",    def: "to think about carefully", bekle: false },
  { en: "purpose",      tr: "amaç",        def: "the reason something is done", bekle: false },
  { en: "likely",       tr: "muhtemel",    def: "probable; expected to happen", bekle: false },
  { en: "various",      tr: "çeşitli",     def: "of different kinds", bekle: false },
  { en: "ability",      tr: "yetenek",     def: "the fact of being able to do something", bekle: false },

  // ÇOK ANLAMLI — sorgu doğru anlamı ayırmalı
  { en: "bank",   tr: "banka",   def: "an organisation that keeps and lends money", bekle: true, sorguIcerir: ["money", "teller", "finance", "atm", "cash", "building"] },
  { en: "spring", tr: "ilkbahar", def: "the season after winter", bekle: true, sorguIcerir: ["season", "blossom", "flower", "meadow", "field"] },
  { en: "bat",    tr: "yarasa",  def: "a small flying animal active at night", bekle: true, sorguIcerir: ["animal", "cave", "night", "flying", "wildlife"] },
];

const { imageQueryFor } = await import("../src/reading.js");
const model = process.env.UTIL_MODEL || "gemini-flash-lite-latest";
console.log(`Görsel kararı — ${VAKALAR.length} kelime · model=${model}\n`);

let dogru = 0;
const soyutHata = [];   // soyuta "çizilebilir" dedi → KULLANICI SAÇMA FOTOĞRAF GÖRÜR
const somutHata = [];   // somuta "çizilemez" dedi → sessiz kayıp
const sorguHata = [];

for (const v of VAKALAR) {
  let r = null, hata = null;
  try { r = await imageQueryFor(v.en, v.tr, v.def); } catch (e) { hata = String(e.message || e).slice(0, 40); }
  if (hata) { console.log(`✖ ${v.en.padEnd(13)} HATA ${hata}`); continue; }

  const ok = r.depictable === v.bekle;
  if (ok) dogru++;
  else if (v.bekle === false) soyutHata.push(v.en);
  else somutHata.push(v.en);

  let sorguNotu = "";
  if (v.sorguIcerir && r.depictable) {
    const q = String(r.query || "").toLowerCase();
    const tuttu = v.sorguIcerir.some((k) => q.includes(k));
    if (!tuttu) { sorguHata.push(`${v.en} → "${r.query}"`); sorguNotu = "  ⚠ anlam ayrımı yok"; }
  }
  console.log(`${ok ? "✔" : "✖"} ${v.en.padEnd(13)} ${String(r.depictable).padEnd(5)} (beklenen ${v.bekle})  "${r.query}"${sorguNotu}`);
}

console.log(`\nDOĞRU     : ${dogru}/${VAKALAR.length}  (%${Math.round((dogru / VAKALAR.length) * 100)})`);
console.log(`SOYUTA "EVET" dedi (kullanıcı saçma fotoğraf görür): ${soyutHata.length ? soyutHata.join(", ") : "yok"}`);
console.log(`SOMUTA "HAYIR" dedi (sessiz kayıp)                 : ${somutHata.length ? somutHata.join(", ") : "yok"}`);
console.log(`ANLAM AYRIMI YAPAMADI                              : ${sorguHata.length ? sorguHata.join(" | ") : "yok"}`);
process.exitCode = soyutHata.length ? 1 : 0;
