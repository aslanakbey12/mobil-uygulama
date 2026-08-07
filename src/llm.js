// MODEL TAŞIMA KATMANI — sağlayıcıdan bağımsız.
//
// NEDEN VAR: "Gemini'de kalmak zorunda mıyız" sorusunu tahminle değil ÖLÇÜMLE
// cevaplamak için. Değerlendirme takımı (eval/) elimizde; eksik olan tek şey aynı
// vakaları başka bir modele gönderebilmekti.
//
// TASARIM KARARI: çağıran taraf (coach.js, reading.js, chat_ai.js, lesson.js)
// DEĞİŞMİYOR. Hepsi Gemini şeklinde gövde kuruyor ve öyle kalsın — 17 çağrı
// noktasını nötr bir şekle çevirmek, ölçüm daha yapılmadan büyük bir göç
// yapmak olurdu. Bunun yerine gövdeyi burada çeviriyoruz. Ölçüm bir kazanan
// gösterirse asıl göçü o zaman, gerekçesi elimizdeyken yaparız.
//
// VARSAYILAN DAVRANIŞ DEĞİŞMEZ: LLM_PROVIDER ayarlanmadıkça her şey aynen
// Gemini'ye gider. Üretim yolu bu değişiklikten etkilenmiyor.
const KEY = process.env.GEMINI_API_KEY || "";

// OpenAI uyumlu sağlayıcılar (DeepSeek, OpenRouter, OpenAI, Together, Fireworks…)
// aynı istek şeklini kullanıyor; tek bir uyarlayıcı hepsini karşılıyor.
const PROVIDER = process.env.LLM_PROVIDER || "gemini";
// OPENROUTER_API_KEY tek başına yeterli olsun: adres sabit, üç ayrı ortam
// değişkenini tutarlı tutmak gereksiz bir hata kaynağı. LLM_BASE_URL/LLM_API_KEY
// başka bir OpenAI-uyumlu sağlayıcıya (DeepSeek doğrudan, Qwen, yerel) geçmek
// isteyince ezmek için duruyor.
const BASE_URL = process.env.LLM_BASE_URL || (process.env.OPENROUTER_API_KEY ? "https://openrouter.ai/api/v1" : "");
const ALT_KEY = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY || "";

export function activeProvider() { return PROVIDER; }

// Zaman aşımlı POST — asla dakikalarca askıda kalma.
async function post(url, headers, body, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
  } finally { clearTimeout(timer); }
}

// Gemini gövdesinden düz metni çıkar (tüm çağrılarımız tek parçalı istem yolluyor).
function istemMetni(body) {
  return (body?.contents || []).flatMap((c) => (c?.parts || []).map((p) => p?.text || "")).join("\n");
}

// ── NORMALİZE SONUÇ ─────────────────────────────────────────────────────────
// { ok, status, text, finishReason, usage: { gin, cik }, error }
// finishReason "MAX_TOKENS" ise çağıran taraf kesik çıktıyı başarı saymıyor.

async function gemini(model, body, ms) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`;
  const r = await post(url, { "content-type": "application/json" }, body, ms);
  if (!r.ok) {
    let error = "";
    try { error = String((await r.json())?.error?.message || "").slice(0, 300); } catch (_) { /* JSON değilse geç */ }
    return { ok: false, status: r.status, error };
  }
  const j = await r.json();
  const c = j?.candidates?.[0];
  const u = j?.usageMetadata || {};
  return {
    ok: true, status: 200,
    text: (c?.content?.parts || []).map((p) => p?.text || "").join("").trim(),
    finishReason: c?.finishReason,
    usage: { gin: u.promptTokenCount || 0, cik: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) },
  };
}

async function openaiUyumlu(model, body, ms) {
  const gc = body?.generationConfig || {};
  const istek = {
    model,
    messages: [{ role: "user", content: istemMetni(body) }],
    temperature: gc.temperature,
    max_tokens: gc.maxOutputTokens,
  };
  // JSON kipi. NOT: OpenAI uyumlu sağlayıcılar json_object kipinde istemin içinde
  // "json" kelimesinin geçmesini şart koşuyor — bizim istemlerimiz zaten
  // "Return ONLY JSON" diyor, ama bu bağımlılık kırılgan olduğu için burada
  // kontrol edip gerekirse ekliyoruz.
  if (gc.responseMimeType === "application/json") {
    istek.response_format = { type: "json_object" };
    if (!/json/i.test(istek.messages[0].content)) istek.messages[0].content += "\n\nReturn valid JSON.";
  }
  // thinkingConfig Gemini'ye özgü; karşılığı yok, sessizce düşer.

  const r = await post(
    `${BASE_URL.replace(/\/+$/, "")}/chat/completions`,
    {
      "content-type": "application/json",
      authorization: `Bearer ${ALT_KEY}`,
      // OpenRouter bu iki başlığı sıralamalarında kullanıyor; zararsız, diğerleri yok sayar.
      "http-referer": "https://liveda.app",
      "x-title": "Liveda",
    },
    istek, ms,
  );
  if (!r.ok) {
    let error = "";
    try { const j = await r.json(); error = String(j?.error?.message || j?.message || "").slice(0, 300); } catch (_) { /* geç */ }
    return { ok: false, status: r.status, error };
  }
  const j = await r.json();
  const c = j?.choices?.[0];
  const u = j?.usage || {};
  return {
    ok: true, status: 200,
    text: String(c?.message?.content || "").trim(),
    // OpenAI "length" der, Gemini "MAX_TOKENS" — çağıran tarafın tek bir şey
    // bilmesi yeter, çeviriyi burada yapıyoruz.
    finishReason: c?.finish_reason === "length" ? "MAX_TOKENS" : c?.finish_reason,
    usage: { gin: u.prompt_tokens || 0, cik: u.completion_tokens || 0 },
  };
}

// SAĞLAYICI MODEL ADINDAN ANLAŞILIR.
//
// Tek bir genel LLM_PROVIDER anahtarı yanlış olurdu: onu açtığımız anda OKUMA da
// yardımcı çağrılar da OpenRouter'a giderdi. Oysa ölçümle şuna karar verdik —
// koç DeepSeek'te (82/83, 6 kat ucuz), okuma Gemini flash'ta (lite kalite
// kaybettiriyordu), kısa yardımcı çağrılar flash-lite'ta.
//
// OpenRouter model kimlikleri "saglayici/model" biçiminde ("deepseek/deepseek-v4-pro"),
// Gemini'ninkilerde eğik çizgi yok. Yani ad zaten hangi kapıya gideceğini söylüyor;
// ayrı bir yapılandırma anahtarına ve onu tutarlı tutma yüküne gerek yok.
//
// LLM_PROVIDER hâlâ çalışıyor: her şeyi tek sağlayıcıya zorlamak için (ölçüm ve
// acil durum kaçışı). Boşsa ad üzerinden karar verilir.
export async function callModel(model, body, ms = 30000) {
  const openRouterAdi = model.includes("/");
  const zorla = PROVIDER !== "gemini";
  if (!openRouterAdi && !zorla) return gemini(model, body, ms);
  if (!BASE_URL || !ALT_KEY) {
    return { ok: false, status: 0, error: `"${model}" OpenAI-uyumlu bir sağlayıcı istiyor ama LLM_BASE_URL/LLM_API_KEY eksik` };
  }
  return openaiUyumlu(model, body, ms);
}
