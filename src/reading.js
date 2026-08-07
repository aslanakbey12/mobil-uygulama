import { supa } from "./supabase.js";
// Okuma parçası üretimi (Google Gemini). API anahtarı YALNIZCA sunucuda (GEMINI_API_KEY).
// Kullanıcının öğrenme havuzundaki kelimelerden, seviyesine uygun kısa bir metin +
// 3 anlama sorusu üretir. Kota tasarrufu için üretilenler önbelleğe alınır.
const KEY = process.env.GEMINI_API_KEY || "";
// Not: eski modeller (2.0, 2.5-flash) yeni kullanıcılara kapatıldı. "flash-latest"
// her zaman güncel GA flash'a (şu an 3.5-flash) çözülür ve yeni kullanıcılara açıktır.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
// Okuma parçası için ayrı model (boş = genel zincir). bkz. generatePassage.
const READING_MODEL = process.env.READING_MODEL || "";
// KISA YARDIMCI ÇAĞRILAR için ayrı model (ipucu, örnek cümle, çeviri, görsel
// sorgusu, sohbet açılış/cevap). Ölçtük: flash bu çağrılarda 116-192 DÜŞÜNME
// token'ı harcıyor ve 120-250'lik bütçelerde cevaba yer kalmıyordu — hafıza
// ipucu kullanıcıya '", \"Ak k"' gibi bir kırıntı dönüyordu. flash-lite aynı
// işlerde HİÇ düşünmüyor, doğru çıktı veriyor ve çıktıda 3,6 kat ucuz.
// Bunlar zaten basit işler; pahalı modelin katkısı yok, zararı vardı.
export const UTIL_MODEL = process.env.UTIL_MODEL || "gemini-flash-lite-latest";
// Günlük okuma üretimi tavanı — KADEMEYE DUYARLI.
//
// Eskiden tek sayıydı (20) ve premium'a bakmıyordu. İki ayrı sorun yaratıyordu:
// (1) paywall "sınırsız okuma" vaat ediyordu ama premium de 20'de duvara çarpıyordu;
// (2) ücretsiz kullanıcı günde 20 Gemini üretimi yapabiliyordu — vaat edilenin
// 20 katı ve ölçekte karşılanamaz bir maliyet.
// Her parça bir YZ çağrısıdır; bu yüzden premium de "sınırsız" değil, yüksek tavanlı.
const DAILY_CAP = parseInt(process.env.READING_DAILY_CAP || "3", 10);
const DAILY_CAP_PREMIUM = parseInt(process.env.READING_DAILY_CAP_PREMIUM || "30", 10);

export function dailyCapFor(premium = false) {
  return premium ? DAILY_CAP_PREMIUM : DAILY_CAP;
}

import { underGlobalCap, bumpGlobal } from "./aiquota.js";

export const readingConfigured = () => !!KEY;

// Geçici teşhis: adaylarda GERÇEKTEN üretim yap, hangisi çalışıyor gör.
export async function testModels() {
  const cands = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-001", "gemini-2.5-pro", "gemini-flash-lite-latest", "gemini-3-flash-preview"];
  const out = {};
  for (const m of cands) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${KEY}`;
    const t0 = Date.now();
    try {
      const r = await postGemini(url, { contents: [{ parts: [{ text: "Say OK" }] }], generationConfig: { maxOutputTokens: 10 } }, 25000);
      out[m] = r.ok ? `OK ${Date.now() - t0}ms` : `HTTP ${r.status}`;
    } catch (e) { out[m] = e?.name === "AbortError" ? "timeout" : String(e.message || e).slice(0, 30); }
  }
  return out;
}

// Geçici teşhis: bu projede generateContent destekleyen mevcut modelleri listele.
export async function listModels() {
  if (!KEY) return ["no-key"];
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${KEY}&pageSize=200`);
    if (!r.ok) return [`ERR ${r.status}`];
    const d = await r.json();
    return (d.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name).replace("models/", ""));
  } catch (e) { return [String(e.message || e)]; }
}

// İKİ KATMANLI ÖNBELLEK.
//
// Bellek katmanı sıcak parçalar için (DB gidiş-dönüşü bile olmasın), KALICI
// katman ise asıl iş: bellek içi Map her yeniden başlatmada siliniyordu ve
// ölçtüğümüz isabet %21'de kalıyordu. Kalıcı ortak önbellekle %69'a çıkıyor,
// 6. ayda %93. Okuma YZ faturamızın en büyük kalemi olduğu için tek en büyük
// tasarruf bu. (bkz. db/18_reading_cache.sql)
const cache = new Map();       // `${seviye}|${tema}|${kelimeler}` -> passage
const CACHE_CAP = 500;         // yalnızca BELLEK katmanı için; kalıcı katman sınırsız
const daily = new Map();       // userId -> { day, n }

// Kalıcı katmandan oku. Hata yutulur: önbellek bir HIZLANDIRMA, arıza halinde
// parça yine üretilir — DB sorunu okumayı çökertmemeli.
async function cacheGet(key) {
  const db = supa();
  if (!db) return null;
  try {
    const { data, error } = await db.from("reading_cache").select("passage").eq("key", key).maybeSingle();
    if (error || !data?.passage) return null;
    db.rpc("touch_reading_cache", { k: key }).then(() => {}, () => {});   // sayaç: bekleme
    return data.passage;
  } catch (_) { return null; }
}

async function cachePut(key, passage) {
  const db = supa();
  if (!db) return;
  try { await db.from("reading_cache").upsert({ key, passage, last_hit_at: new Date().toISOString() }); }
  catch (_) { /* yazamamak parçayı geçersiz kılmaz — sadece bir dahakine yeniden üretilir */ }
}

async function cacheDrop(key) {
  const db = supa();
  if (!db) return;
  try { await db.from("reading_cache").delete().eq("key", key); } catch (_) { /* yok say */ }
}

function today() { return new Date().toISOString().slice(0, 10); }

// Kullanıcı tavanının yanında SİSTEM GENELİ freni de kontrol edilir
// (bkz. aiquota.js — kullanıcı başına tavanlar tek başına toplam harcamayı sınırlamıyordu).
export function underDailyCap(userId, premium = false) {
  if (!underGlobalCap()) return false;
  const e = daily.get(userId);
  if (!e || e.day !== today()) return true;
  return e.n < dailyCapFor(premium);
}

// Kullanıcının bugün kaç hakkı kaldı (arayüzde dürüstçe göstermek için).
export function remainingToday(userId, premium = false) {
  const e = daily.get(userId);
  const used = e && e.day === today() ? e.n : 0;
  return Math.max(0, dailyCapFor(premium) - used);
}
export function bumpDaily(userId) {
  bumpGlobal(1);
  const d = today(); const e = daily.get(userId);
  if (!e || e.day !== d) daily.set(userId, { day: d, n: 1 });
  else e.n++;
}

// Seviyeye göre uzunluk; hedef kelime sayısına göre tekrar aralığı (metin tıka basa olmasın).
function wordCountFor(level) {
  if (level === "A1" || level === "A2") return "90-120";
  if (level === "C1" || level === "C2") return "170-210";
  return "130-170";
}
function repeatFor(n) { return n <= 4 ? "2-4" : n <= 6 ? "2-3" : "2"; }

function buildPrompt(level, words, opts = {}) {
  const known = Array.isArray(opts.knownSample) ? opts.knownSample.filter(Boolean).slice(0, 15) : [];
  const evidence = known.length
    ? `The learner has already mastered words such as: ${known.join(", ")}. Calibrate difficulty to be comfortable and engaging for someone who knows these — do not make it trivially simple.\n`
    : "";
  const topic = opts.topic ? `The passage MUST be about this topic/theme: ${opts.topic}.\n` : "";
  return `You are an English teacher creating graded reading practice for a Turkish learner. Target CEFR level: ${level}.
${evidence}${topic}Write a coherent, engaging, well-structured passage (about ${wordCountFor(level)} words) in natural, idiomatic English — genuinely interesting to read (a mini-story, surprising fact, or vivid scene), so the learner enjoys it and improves. Avoid dull, list-like or textbook-style writing.
Requirements:
- Use EACH of these target words ${repeatFor(words.length)} times, in DIFFERENT sentences and natural contexts (varied forms allowed): ${words.join(", ")}.
- Keep about 90-95% of the vocabulary at or below ${level}. Apart from the target words, introduce AT MOST 2-3 new or harder words — no rare/obscure vocabulary.
- Then write exactly 3 multiple-choice comprehension questions in English (4 options, exactly one correct).
- Also build a "glossary" of 6-8 useful words from this passage (include the target words plus a couple of harder ones), each with: base form, Turkish meaning, CEFR level, and a very short English example.
Return ONLY valid JSON with this exact shape and nothing else:
{"title": string, "passage": string, "questions": [{"q": string, "options": [string, string, string, string], "answer": number}], "glossary": [{"en": string, "tr": string, "level": string, "ex": string}]}
"answer" is the 0-based index of the correct option.`;
}

// Gemini isteği — zaman aşımlı (asla dakikalarca askıda kalma). ms sonra iptal.
async function postGemini(url, body, ms = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
  } finally { clearTimeout(timer); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Model yedekleme zinciri: birincil (flash-latest, 3.5) 503/aşırı yük verirse YEDEK modele
// geçer. Yedek `gemini-pro-latest` = daha YÜKSEK kalite (alt sürüm değil). Her modelde retry.
// YAPIŞKAN MODEL SEÇİMİ — gecikmenin asıl kaynağı buydu.
// Sorun: zincirin başındaki model (flash-latest) uzun süredir 503 veriyor. Her istekte
// önce ona gidiliyor, 2 deneme + bekleme boşa harcanıyordu (~38 sn), ANCAK sonra çalışan
// modele geçiliyordu. Çözüm: en son BAŞARILI olan modeli hatırla ve önce onu dene.
// Google düzelirse fark edelim diye periyodik olarak tercih edilen sırayı yeniden yokla.
let lastGoodModel = null;
let lastProbeAt = 0;
const PROBE_INTERVAL_MS = 10 * 60 * 1000;   // 10 dk'da bir tercih edilen modeli yeniden dene

function modelChain() {
  const chain = [...new Set([MODEL, "gemini-3-flash-preview", "gemini-flash-lite-latest"])];
  if (!lastGoodModel) return chain;
  const now = Date.now();
  if (now - lastProbeAt > PROBE_INTERVAL_MS) {   // ara sıra tercih edileni yeniden yokla
    lastProbeAt = now;
    return chain;
  }
  return [lastGoodModel, ...chain.filter((m) => m !== lastGoodModel)];   // çalışan model önce
}

// Test için dışa aktarım (model uyumluluğu sessizce daralmasın).
export { bodyFor as __bodyForTest };
export { buildPrompt as __buildPromptTest };

// Model karşılaştırması için (scripts/model-ab.mjs). bodyFor'dan GEÇİYOR:
// lite ve pro modelleri thinkingConfig'i reddedip 400 döner, ham gövdeyle
// atmak karşılaştırmayı model farkı değil istek hatası olarak gösterirdi.
export function __postGeminiTest(model, body, ms = 60000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  return postGemini(url, bodyFor(model, { safetySettings: SAFETY, ...body }), ms);
}

// Teşhis/izleme için (sağlık ucunda gösterilebilir).
export function activeModel() { return lastGoodModel; }
// DÜŞÜNMEYİ KAPATMA — model adına göre değil, DESTEKLENEN alana çevirerek.
//
// Eski hali model adında "pro|lite" arayıp `thinkingConfig`i tamamen SİLİYORDU.
// Bu kalıp iki kez yama ile genişletildi ve yine yetmedi: `gemini-flash-latest`
// (artık Gemini 3.5 Flash) desene uymadığı için `thinkingBudget: 0` ile gidiyor
// ve 400 alıyordu. Yani her okuma parçası isteği önce boşa bir tur atıp yedeğe
// düşüyordu — sessizce, çünkü yedek çalışıyordu.
//
// Anahtarla ÖLÇTÜK (2026-08-07):
//
//   model                     thinkingBudget:0   thinkingLevel:"low"   config yok
//   gemini-flash-latest       400 RED            OK, düşünme 0         OK, düşünme 1660
//   gemini-flash-lite-latest  OK, düşünme 0      OK, düşünme 0         OK, düşünme 0
//   gemini-pro-latest         OK                 OK                    —
//
// İki sonuç: (1) `thinkingLevel: "low"` ÜÇ modelde de çalışıyor; (2) alanı silmek
// en kötü seçenek — flash o zaman 1660 düşünme token'ı yakıyor ve düşünme çıktı
// olarak faturalanıyor. Yani eski "sil" davranışı hem 400 üretiyor hem de
// başarılı olduğu yerde para yakıyordu.
//
// Artık model adı saymıyoruz: çağıran "düşünme istemiyorum" (thinkingBudget: 0)
// dediğinde bunu her modelin kabul ettiği biçime çeviriyoruz. Yeni bir model
// zincire girdiğinde bu kod sessizce bozulmaz.
function bodyFor(model, body) {
  const gc = body?.generationConfig;
  if (gc?.thinkingConfig?.thinkingBudget !== 0) return body;
  return { ...body, generationConfig: { ...gc, thinkingConfig: { thinkingLevel: "low" } } };
}
// Gemini'yi model-yedekli + retry ile çağır, ham metni döndür. 503'te önce aynı modelde
// birkaç kez, sonra yedek modelde dener → parça asla "high demand" yüzünden boş kalmaz.
// İçerik güvenliği: zararlı kategorileri engelle (öğrenme uygulaması, gence yakın kitle).
const SAFETY = [
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
];

// `prefer`: bu çağrı için ÖNCELİKLİ model. Koç sohbeti gibi kalitenin hıza
// baskın geldiği yerlerde daha güçlü bir model istenebilir. Zincir yine devrede:
// tercih edilen model 503/400 verirse normal yedeklere düşülür, yani kalite
// isteği asla "hiç cevap gelmemesi"ne dönüşmez.
export async function geminiText(body, { timeout = 30000, tries = 3, prefer = null } = {}) {
  let lastErr = "";
  // Güvenlik ayarlarını her isteğe ekle (istem enjeksiyonuna karşı da katman).
  body = { safetySettings: SAFETY, ...body };
  const zincir = prefer ? [prefer, ...modelChain().filter((m) => m !== prefer)] : modelChain();
  for (const model of zincir) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
    const mbody = bodyFor(model, body);
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const r = await postGemini(url, mbody, timeout);
        if (!r.ok) {
          if ((r.status === 503 || r.status === 429 || r.status === 500) && attempt < tries - 1) { await sleep(1800 * (attempt + 1)); continue; }
          // HATANIN SEBEBİNİ OKU. Eskiden yalnızca "HTTP 400 (model)" yazıyorduk ve
          // Gemini'nin gövdede verdiği asıl açıklamayı atıyorduk. Bir 400 hatasını
          // teşhis etmek imkânsız hale geliyordu: geçersiz alan mı, geçersiz anahtar
          // mı, desteklenmeyen model mi — hepsi aynı görünüyordu. Artık sebebi
          // taşıyoruz ve loglara da yazıyoruz.
          let neden = "";
          try {
            const g = await r.json();
            neden = String(g?.error?.message || "").slice(0, 300);
          } catch (_) { /* gövde JSON değilse sessiz geç */ }
          lastErr = `HTTP ${r.status} (${model})${neden ? ": " + neden : ""}`;
          console.warn("gemini hatası:", lastErr);
          break; // bu model olmadı → sonraki modele geç
        }
        const cand0 = (await r.json())?.candidates?.[0];
        const txt = (cand0?.content?.parts || []).map((p) => p?.text || "").join("").trim();
        if (!txt) { lastErr = `boş yanıt ${cand0?.finishReason || ""} (${model})`; if (attempt < tries - 1) { await sleep(1200); continue; } break; }
        // KESİK ÇIKTIYI BAŞARI SAYMA. finishReason'a yalnızca metin BOŞKEN
        // bakıyorduk; model 40 karakter üretip bütçesi dolunca (MAX_TOKENS) metin
        // boş olmadığı için sağlam sanılıp geri dönüyordu ve çağıran taraf
        // "Unterminated string in JSON" ile patlıyordu — sebebi anlatmayan bir hata.
        // JSON istediğimizde yarım çıktı ZATEN kullanılamaz: bunu başarısızlık say,
        // zincirdeki sonraki model denensin. Modellerin düşünme davranışı farklı
        // olduğu için bu gerçek bir kurtarma yolu. (Serbest metinde yarım cevap yine
        // de işe yarayabilir; bu yüzden yalnızca JSON kipinde uygulanıyor.)
        if (cand0?.finishReason === "MAX_TOKENS" && mbody?.generationConfig?.responseMimeType === "application/json") {
          lastErr = `çıktı bütçesi doldu, JSON yarım kaldı (${model})`;
          console.warn("gemini kesik çıktı:", lastErr);
          break;                 // aynı bütçeyle tekrar denemek aynı sonucu verir → sonraki model
        }
        lastGoodModel = model;   // bu model çalıştı → sonraki isteklerde önce bunu dene
        return txt;
      } catch (e) {
        lastErr = e?.name === "AbortError" ? `zaman aşımı (${model})` : String(e?.message || e);
        if (attempt < tries - 1) { await sleep(1500); continue; }
      }
    }
  }
  throw new Error(lastErr || "AI hatası");
}

// Kesik (truncate edilmiş) JSON'u onar: sondan geriye her '}' / ']' noktasında kes,
// açık kalan parantezleri kapatıp parse etmeyi dene → yarım kalan son öğe atılır,
// gerisi kurtarılır (ör. glossary'nin son elemanı eksik olsa da parça + sorular gelir).
function neededClosers(s) {
  let inStr = false, esc = false; const st = [];
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (ch === "\\") { if (inStr) esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{") st.push("}");
    else if (ch === "[") st.push("]");
    else if (ch === "}" || ch === "]") { if (st.pop() !== ch) return null; }
  }
  if (inStr) return null;
  return st.reverse().join("");
}
export function repairJson(t) {
  for (let cut = t.length; cut > 1; cut--) {
    const c = t[cut - 1];
    if (c !== "}" && c !== "]") continue;
    const cand = t.slice(0, cut);
    const closers = neededClosers(cand);
    if (closers == null) continue;
    try { return JSON.parse(cand + closers); } catch (e) {}
  }
  throw new Error("JSON onarılamadı");
}

// LLM bazen JSON'u ```json ...``` içinde ya da önüne/sonuna metin ekleyerek döndürür.
export function extractJson(txt) {
  let t = String(txt).trim();
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return t;
}

const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
function normalize(p, level, words) {
  const questions = (Array.isArray(p.questions) ? p.questions : [])
    .slice(0, 3)
    .map((q) => ({
      q: String(q.q || "").slice(0, 240),
      options: (Array.isArray(q.options) ? q.options : []).slice(0, 4).map((o) => String(o).slice(0, 140)),
      answer: Number.isInteger(q.answer) ? Math.max(0, Math.min(3, q.answer)) : 0,
    }))
    .filter((q) => q.options.length === 4 && q.q);
  const seen = new Set();
  const glossary = (Array.isArray(p.glossary) ? p.glossary : [])
    .map((g) => ({
      en: String(g.en || "").trim().slice(0, 40),
      tr: String(g.tr || "").trim().slice(0, 80),
      level: CEFR.includes(String(g.level || "").toUpperCase()) ? String(g.level).toUpperCase() : level,
      ex: String(g.ex || "").trim().slice(0, 140),
    }))
    .filter((g) => { const k = g.en.toLowerCase(); if (!g.en || !g.tr || seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 24);
  return {
    id: "r_" + Math.random().toString(36).slice(2, 10),
    title: String(p.title || "Okuma").slice(0, 80),
    passage: String(p.passage || "").slice(0, 2600).trim(),
    level, words, questions, glossary,
  };
}

// Hafıza kancası (mnemonic): bir kelimeyi akılda tutmaya yardımcı kısa Türkçe ipucu.
const mnemoCache = new Map();
export async function generateMnemonic(en, tr) {
  const key = String(en).toLowerCase();
  if (mnemoCache.has(key)) return mnemoCache.get(key);
  if (!KEY) throw new Error("AI servisi henüz yapılandırılmadı.");
  const prompt = `Türk öğrenci için İngilizce "${en}" (Türkçe anlamı: ${tr}) kelimesini akılda tutmaya yardımcı, KISA (tek cümle, en fazla 20 kelime) yaratıcı bir hafıza kancası yaz. Kelimenin okunuşunu ya da görüntüsünü Türkçe bir çağrışımla anlamına bağla. SADECE Türkçe ipucu cümlesini yaz; tırnak, başlık veya açıklama ekleme.`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } },
  };
  let txt = (await geminiText(body, { timeout: 20000, tries: 2, prefer: UTIL_MODEL })).replace(/^["'“”]+|["'“”]+$/g, "").slice(0, 300);
  if (!txt) throw new Error("AI boş yanıt döndü.");
  if (mnemoCache.size >= 3000) mnemoCache.delete(mnemoCache.keys().next().value);
  mnemoCache.set(key, txt);
  return txt;
}

// Kişiselleştirilmiş örnek cümle. ÖNBELLEK ANAHTARI = kelime|seviye|bağlam →
// aynı profildeki (seviye+ilgi/motive) TÜM kullanıcılara aynı cümle döner; AI bir kez çalışır.
// Kelime kartçıkları için TÜRKÇE çeviri: İngilizce tanım + örnek cümle.
// Neden: words.json'da tanımlar/cümleler yalnızca İngilizce (8683/8683). Yeni başlayan
// kullanıcı boşluk doldurmada hem cümleyi hem ipucunu anlamıyordu. Kullanıcı kartçığa
// dokununca Türkçesi çıkacak. Önbellek kelime bazında + TÜM kullanıcılarca paylaşılır
// (mnemonic deseni) → aynı kelime hayatta bir kez çevrilir.
const translateCache = new Map();
export async function translateWordCard(en, definition, example) {
  const key = String(en).toLowerCase();
  if (translateCache.has(key)) return translateCache.get(key);
  if (!KEY) throw new Error("AI servisi henüz yapılandırılmadı.");
  const def = String(definition || "").slice(0, 200);
  const ex = String(example || "").slice(0, 200);
  const prompt = `Türk İngilizce öğrencisi için çeviri yap. Kelime: "${en}".
İngilizce tanım: "${def}"
İngilizce örnek cümle: "${ex}"
Görev: Tanımın ve cümlenin DOĞAL Türkçe karşılığını yaz. Kısa ve anlaşılır olsun; kelime kelime çevirme.
ÖNEMLİ: Cümlede alt çizgi boşluğu (___) varsa Türkçe çeviride de boşluğu AYNEN koru (cevabı yazma).
SADECE JSON döndür: {"definitionTr": string, "exampleTr": string}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.3, maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } },
  };
  const txt = await geminiText(body, { timeout: 20000, tries: 2, prefer: UTIL_MODEL });
  let parsed; try { parsed = JSON.parse(extractJson(txt)); } catch (e) { throw new Error("AI yanıtı çözümlenemedi."); }
  const out = {
    definitionTr: String(parsed.definitionTr || "").slice(0, 240).trim(),
    exampleTr: String(parsed.exampleTr || "").slice(0, 240).trim(),
  };
  if (!out.definitionTr && !out.exampleTr) throw new Error("Çeviri üretilemedi.");
  if (translateCache.size >= 8000) translateCache.delete(translateCache.keys().next().value);
  translateCache.set(key, out);
  return out;
}

// Görsel arama sorgusu + "fotoğraflanabilir mi" kararı.
// SORUN: Pexels'te ham kelimeyle arama yapınca soyut kelimeler ("although", "opinion")
// için alakasız, çok anlamlı kelimeler için YANLIŞ fotoğraf geliyordu
// (bank → nehir kıyısı mı banka mı? light → ışık mı hafif mi?).
// ÇÖZÜM: Kelime başına BİR kez Gemini'ye sor — fotoğrafla anlatılabilir mi, anlatılabilirse
// hangi arama terimi doğru sonucu getirir. Kalıcı önbellek → tüm kullanıcılar paylaşır.
const imgQueryCache = new Map();
export async function imageQueryFor(en, tr, definition) {
  const key = String(en).toLowerCase();
  if (imgQueryCache.has(key)) return imgQueryCache.get(key);
  if (!KEY) throw new Error("AI servisi henüz yapılandırılmadı.");
  const prompt = `English word: "${en}" (Turkish meaning: ${String(tr || "").slice(0, 60)}; definition: ${String(definition || "").slice(0, 160)}).
1) Can this word's meaning be shown CLEARLY in a single photograph? Abstract/function words (although, however, opinion, despite) CANNOT — answer false for those. Concrete nouns, actions and visible qualities CAN.
2) If yes, give the BEST English photo-stock search query (2-4 words) that returns a photo unmistakably showing THIS meaning. Disambiguate polysemous words using the definition (e.g. "bank" money -> "bank teller counter"; "spring" season -> "spring blossom field").
Return ONLY JSON: {"depictable": boolean, "query": string}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
  };
  const txt = await geminiText(body, { timeout: 18000, tries: 2, prefer: UTIL_MODEL });
  let parsed; try { parsed = JSON.parse(extractJson(txt)); } catch (e) { throw new Error("AI yanıtı çözümlenemedi."); }
  const out = {
    depictable: !!parsed.depictable,
    query: String(parsed.query || "").slice(0, 60).trim(),
  };
  if (!out.query) out.depictable = false;      // sorgu yoksa güvenli tarafta kal
  if (imgQueryCache.size >= 8000) imgQueryCache.delete(imgQueryCache.keys().next().value);
  imgQueryCache.set(key, out);
  return out;
}

const exampleCache = new Map();
export async function generateExample(en, tr, level, context) {
  const lvl = ["A1", "A2", "B1", "B2", "C1", "C2"].includes(level) ? level : "B1";
  const ctx = String(context || "günlük hayat").toLowerCase().slice(0, 40);
  const key = `${String(en).toLowerCase()}|${lvl}|${ctx}`;
  if (exampleCache.has(key)) return exampleCache.get(key);
  if (!KEY) throw new Error("AI servisi henüz yapılandırılmadı.");
  const prompt = `Write ONE natural English example sentence at CEFR level ${lvl} that clearly uses the word "${en}" (Turkish meaning: ${tr}).
Context/topic: ${ctx}. Keep it short (max 14 words), natural, and make the word's meaning clear from context.
Also give a Turkish translation of the sentence.
Return ONLY JSON: {"en": string, "tr": string}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.8, maxOutputTokens: 1000, thinkingConfig: { thinkingBudget: 0 } },
  };
  const txt = await geminiText(body, { timeout: 20000, tries: 2, prefer: UTIL_MODEL });
  let parsed; try { parsed = JSON.parse(extractJson(txt)); } catch (e) { throw new Error("AI yanıtı çözümlenemedi."); }
  const out = { en: String(parsed.en || "").slice(0, 200).trim(), tr: String(parsed.tr || "").slice(0, 200).trim() };
  if (!out.en) throw new Error("Örnek cümle üretilemedi.");
  if (exampleCache.size >= 5000) exampleCache.delete(exampleCache.keys().next().value);
  exampleCache.set(key, out);
  return out;
}

export async function generatePassage(level, words, opts = {}) {
  const cacheKey = `${level}|${opts.topic || ""}|${[...words].sort().join(",")}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  // KALICI KATMAN. Süreç yeni başlamış olsa bile başka bir kullanıcının (ya da
  // bu kullanıcının dünkü oturumunun) ürettiği parça burada duruyor.
  const kalici = await cacheGet(cacheKey);
  if (kalici) { cache.set(cacheKey, kalici); return kalici; }
  if (!KEY) throw new Error("Okuma servisi henüz yapılandırılmadı.");

  const body = {
    contents: [{ parts: [{ text: buildPrompt(level, words, opts) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.8,
      // Çıktı tavanı %20 kısıldı (3500 → 2800). Çıktı token'ı faturanın büyük
      // kısmı; parça + 3 soru + sözlükçe buraya rahat sığıyor.
      maxOutputTokens: 2800,
      thinkingConfig: { thinkingBudget: 0 }, // düşünme kapalı: hızlı/ucuz
    },
  };
  // Model-yedekli + retry (503'te birincilde birkaç kez, sonra pro-latest yedeğe geçer).
  //
  // READING_MODEL ile okuma için ayrı model seçilebilir. Ayarlanabilir bırakıldı
  // çünkü okuma faturanın en büyük kalemi ve flash-lite çıktıda 3,6 kat ucuz —
  // ama kalite kararı ölçümle verilecek. Ayar env'de olunca geçiş (ya da geri
  // dönüş) yeni dağıtım değil, tek değer değişikliği.
  let out;
  try {
    const txt = await geminiText(body, { timeout: 50000, tries: 2, prefer: READING_MODEL || null });
    const clean = extractJson(txt);
    // Gemini çıktısı token sınırında kesilebilir → JSON yarım kalır (örn. glossary'nin
    // son öğesi eksik). Önce düz parse, olmazsa onar (yarım son öğe atılır, gerisi kurtarılır).
    let parsed;
    try { parsed = JSON.parse(clean); } catch (e) { parsed = repairJson(clean); }
    out = normalize(parsed, level, words);
    if (!out.passage || out.questions.length === 0) throw new Error("eksik parça");
  } catch (e) {
    throw new Error("Okuma oluşturulamadı → " + String(e?.message || e).slice(0, 150));
  }

  out.key = cacheKey;   // istemci kaliteyi bu anahtarla oylar
  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, out);
  // Kalıcı katmana yaz — asıl tasarruf burada. Beklemiyoruz: kullanıcının
  // parçası hazır, DB yazımı onu geciktirmemeli.
  cachePut(cacheKey, out).catch(() => {});
  return out;
}

// Kalite geri bildirimi (kalabalık-kaynaklı kalite kontrolü). Bir parça yeterince
// olumsuz oy alırsa önbellekten silinir → sonraki kullanıcıya YENİ parça üretilir.
// SAYAÇLAR DB'DEN OKUNUR. Eskiden yalnızca bu Map'teydi ve her yeniden başlatmada
// sıfırlanıyordu; persistFeedback da sıfırlanmış sayacı DB'nin ÜZERİNE yazıyordu.
// Sonuç: 2 olumsuz oy almış bir parça, yeniden başlatmadan sonra 1'den başlıyordu
// ve 3 eşiğine hiç ulaşamıyordu. Önbellek bellekteyken bunun bedeli sınırlıydı —
// zaten silinip gidiyordu. Önbellek KALICI olduğu andan itibaren aynı kusur "kötü
// parça sonsuza kadar herkese servis edilir" anlamına geliyor. Kalıcı önbellek,
// kalite kontrolünün de kalıcı olmasını zorunlu kılıyor.
const readingFeedback = new Map(); // cacheKey -> { up, down }  (yalnızca sıcak kopya)

async function oylariGetir(key) {
  if (readingFeedback.has(key)) return readingFeedback.get(key);
  const db = supa();
  if (!db) return { up: 0, down: 0 };
  try {
    const { data, error } = await db.from("content_feedback")
      .select("up, down").eq("kind", "reading").eq("ref", key).maybeSingle();
    if (error || !data) return { up: 0, down: 0 };
    return { up: Number(data.up) || 0, down: Number(data.down) || 0 };
  } catch (_) { return { up: 0, down: 0 }; }
}

export async function rateReading(key, up) {
  if (!key) return { replaced: false };
  const f = await oylariGetir(key);
  if (up) f.up++; else f.down++;
  readingFeedback.set(key, f);
  persistFeedback("reading", key, f);
  if (f.down >= 3 && f.down > f.up) {           // eşik: 3+ olumsuz ve olumsuz > olumlu
    cache.delete(key);                           // bellek katmanı
    await cacheDrop(key);                        // KALICI katman — burası atlanırsa
    readingFeedback.delete(key);                 // kötü parça herkese servis edilmeye devam eder
    return { replaced: true };
  }
  return { replaced: false };
}

// Ateşle-unut: yazma başarısız olursa kullanıcı akışı ETKİLENMEZ.
export function persistFeedback(kind, ref, f) {
  const db = supa();
  if (!db) return;
  db.from("content_feedback")
    .upsert({ kind, ref: String(ref).slice(0, 300), up: f.up, down: f.down, updated_at: new Date().toISOString() })
    .then(() => {}, () => {});
}
