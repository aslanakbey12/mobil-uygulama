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

function buildPrompt(level, words) {
  return `You are an English teacher creating graded reading practice for a Turkish learner at CEFR level ${level}.
Write a short, engaging, coherent passage (about 120-160 words) in natural English suitable for ${level} level.
You MUST use these target words naturally in the passage: ${words.join(", ")}.
Then write exactly 3 multiple-choice comprehension questions in English about the passage; each has 4 options and exactly one correct answer.
Return ONLY valid JSON with this exact shape and nothing else:
{"title": string, "passage": string, "questions": [{"q": string, "options": [string, string, string, string], "answer": number}]}
"answer" is the 0-based index of the correct option.`;
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

function normalize(p, level, words) {
  const questions = (Array.isArray(p.questions) ? p.questions : [])
    .slice(0, 3)
    .map((q) => ({
      q: String(q.q || "").slice(0, 240),
      options: (Array.isArray(q.options) ? q.options : []).slice(0, 4).map((o) => String(o).slice(0, 140)),
      answer: Number.isInteger(q.answer) ? Math.max(0, Math.min(3, q.answer)) : 0,
    }))
    .filter((q) => q.options.length === 4 && q.q);
  return {
    id: "r_" + Math.random().toString(36).slice(2, 10),
    title: String(p.title || "Okuma").slice(0, 80),
    passage: String(p.passage || "").slice(0, 2200).trim(),
    level, words, questions,
  };
}

export async function generatePassage(level, words) {
  const cacheKey = `${level}|${[...words].sort().join(",")}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  if (!KEY) throw new Error("Okuma servisi henüz yapılandırılmadı.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = {
    contents: [{ parts: [{ text: buildPrompt(level, words) }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.85, maxOutputTokens: 1000 },
  };
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`AI hatası (${r.status})${t ? ": " + t.slice(0, 120) : ""}`);
  }
  const data = await r.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const txt = parts.map((p) => p?.text || "").join("").trim();
  if (!txt) throw new Error("AI boş yanıt döndü (güvenlik filtresi olabilir), tekrar dene.");
  let parsed;
  try { parsed = JSON.parse(extractJson(txt)); }
  catch (e) { throw new Error("AI yanıtı çözümlenemedi: " + txt.slice(0, 160)); }
  const out = normalize(parsed, level, words);
  if (!out.passage || out.questions.length === 0) throw new Error("Geçerli bir parça üretilemedi, tekrar dene.");

  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, out);
  return out;
}
