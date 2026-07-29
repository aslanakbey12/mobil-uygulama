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
