// Okuma parçası üretimi (Google Gemini). API anahtarı YALNIZCA sunucuda (GEMINI_API_KEY).
// Kullanıcının öğrenme havuzundaki kelimelerden, seviyesine uygun kısa bir metin +
// 3 anlama sorusu üretir. Kota tasarrufu için üretilenler önbelleğe alınır.
const KEY = process.env.GEMINI_API_KEY || "";
// Not: eski modeller (2.0, 2.5-flash) yeni kullanıcılara kapatıldı. "flash-latest"
// her zaman güncel GA flash'a (şu an 3.5-flash) çözülür ve yeni kullanıcılara açıktır.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const DAILY_CAP = parseInt(process.env.READING_DAILY_CAP || "20", 10);

export const readingConfigured = () => !!KEY;

const cache = new Map();       // `${level}|${words}` -> passage
const CACHE_CAP = 500;
const daily = new Map();       // userId -> { day, n }

function today() { return new Date().toISOString().slice(0, 10); }

export function underDailyCap(userId) {
  const e = daily.get(userId);
  if (!e || e.day !== today()) return true;
  return e.n < DAILY_CAP;
}
export function bumpDaily(userId) {
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

// LLM bazen JSON'u ```json ...``` içinde ya da önüne/sonuna metin ekleyerek döndürür.
function extractJson(txt) {
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
  };
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await postGemini(url, body, 20000);
    if (r.ok) break;
    if ((r.status === 503 || r.status === 429 || r.status === 500) && attempt < 2) { await new Promise((res) => setTimeout(res, 700 * (attempt + 1))); continue; }
    throw new Error(`AI hatası (${r.status})`);
  }
  const data = await r.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  let txt = parts.map((p) => p?.text || "").join("").trim().replace(/^["'“”]+|["'“”]+$/g, "");
  if (!txt) throw new Error("AI boş yanıt döndü.");
  txt = txt.slice(0, 300);
  if (mnemoCache.size >= 3000) mnemoCache.delete(mnemoCache.keys().next().value);
  mnemoCache.set(key, txt);
  return txt;
}

// Kişiselleştirilmiş örnek cümle. ÖNBELLEK ANAHTARI = kelime|seviye|bağlam →
// aynı profildeki (seviye+ilgi/motive) TÜM kullanıcılara aynı cümle döner; AI bir kez çalışır.
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.8, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
  };
  let r;
  for (let attempt = 0; attempt < 3; attempt++) {
    r = await postGemini(url, body, 20000);
    if (r.ok) break;
    if ((r.status === 503 || r.status === 429 || r.status === 500) && attempt < 2) { await new Promise((res) => setTimeout(res, 700 * (attempt + 1))); continue; }
    throw new Error(`AI hatası (${r.status})`);
  }
  const data = await r.json();
  const txt = (data?.candidates?.[0]?.content?.parts || []).map((p) => p?.text || "").join("").trim();
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
  if (!KEY) throw new Error("Okuma servisi henüz yapılandırılmadı.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = {
    contents: [{ parts: [{ text: buildPrompt(level, words, opts) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.8,
      maxOutputTokens: 3500,  // passage + 3 soru + glossary sığsın ama az çıktı = hızlı
      thinkingConfig: { thinkingBudget: 0 }, // düşünme kapalı: hızlı/ucuz
    },
  };
  // Her deneme 60sn zaman aşımlı; 2 deneme (yavaş modelde dakikalarca bekletme).
  let out = null, lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await postGemini(url, body, 60000);
      if (!r.ok) {
        const bodyTxt = await r.text().catch(() => "");
        if ((r.status === 503 || r.status === 429 || r.status === 500) && attempt < 1) { await new Promise((res) => setTimeout(res, 900 * (attempt + 1))); continue; }
        throw new Error(`HTTP ${r.status} ${bodyTxt.slice(0, 100)}`);
      }
      const data = await r.json();
      const cand0 = data?.candidates?.[0];
      const finish = cand0?.finishReason || "";
      const txt = (cand0?.content?.parts || []).map((p) => p?.text || "").join("").trim();
      if (!txt) throw new Error(`boş yanıt (finishReason: ${finish || "?"})`);
      const cand = normalize(JSON.parse(extractJson(txt)), level, words);
      if (!cand.passage || cand.questions.length === 0) throw new Error("eksik parça");
      out = cand;
      break;
    } catch (e) {
      lastErr = String(e?.name === "AbortError" ? "zaman aşımı (60s)" : (e?.message || e));
      if (attempt < 1) { await new Promise((res) => setTimeout(res, 800)); continue; }
    }
  }
  if (!out) throw new Error("Okuma oluşturulamadı → " + lastErr.slice(0, 150));

  out.key = cacheKey;   // istemci kaliteyi bu anahtarla oylar
  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, out);
  return out;
}

// Kalite geri bildirimi (kalabalık-kaynaklı kalite kontrolü). Bir parça yeterince
// olumsuz oy alırsa önbellekten silinir → sonraki kullanıcıya YENİ parça üretilir.
const readingFeedback = new Map(); // cacheKey -> { up, down }
export function rateReading(key, up) {
  if (!key) return { replaced: false };
  const f = readingFeedback.get(key) || { up: 0, down: 0 };
  if (up) f.up++; else f.down++;
  readingFeedback.set(key, f);
  if (f.down >= 3 && f.down > f.up) {           // eşik: 3+ olumsuz ve olumsuz > olumlu
    cache.delete(key);                           // önbellekten çıkar → yeniden üretilir
    readingFeedback.delete(key);
    return { replaced: true };
  }
  return { replaced: false };
}
