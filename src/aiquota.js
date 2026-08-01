// AI uçları için kullanıcı başına GÜNLÜK çağrı sınırı (maliyet/DoS koruması).
// Gemini/dış servis çağrısı yapan uçlar bunu kontrol eder → tek kullanıcı binlerce
// istekle kotayı (ve faturayı) tüketemez. Bellek içi; ölçekte Redis'e taşınır.
const CAP = parseInt(process.env.AI_DAILY_CAP || "300", 10);

const counts = new Map(); // userId -> { day, n }

function today() { return new Date().toISOString().slice(0, 10); }

export function underAiCap(userId) {
  if (!userId) return false;
  const e = counts.get(userId);
  if (!e || e.day !== today()) return true;
  return e.n < CAP;
}

export function bumpAi(userId, n = 1) {
  if (!userId) return;
  const d = today();
  const e = counts.get(userId);
  if (!e || e.day !== d) counts.set(userId, { day: d, n });
  else e.n += n;
}

export function aiDailyCap() { return CAP; }

// ── Çeviri kotası (AYRI ve daha yüksek) ───────────────────────────────────────
// Kart çevirileri minik çağrılar (≈150 token) ve sunucuda kalıcı önbelleklenir —
// aynı kelime hayatta bir kez çevrilir. Okuma/mnemonic ile aynı 300'lük kotayı
// paylaşırlarsa çok kart açan kullanıcı asıl AI özelliklerini kaybeder. O yüzden ayrı.
const TR_CAP = parseInt(process.env.AI_TRANSLATE_DAILY_CAP || "600", 10);
const trCounts = new Map();

export function underTranslateCap(userId) {
  if (!userId) return false;
  const e = trCounts.get(userId);
  if (!e || e.day !== today()) return true;
  return e.n < TR_CAP;
}

export function bumpTranslate(userId, n = 1) {
  if (!userId) return;
  const d = today();
  const e = trCounts.get(userId);
  if (!e || e.day !== d) trCounts.set(userId, { day: d, n });
  else e.n += n;
}
