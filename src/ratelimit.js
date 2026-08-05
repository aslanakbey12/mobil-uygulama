// Basit bellek-içi global rate limit (IP başına, sabit pencere). @fastify/rate-limit
// bağımlılığı eklemeden temel flood koruması. Mobil taşıyıcı NAT'ı yüzünden çok
// kullanıcı tek IP paylaşabildiğinden eşik CÖMERT tutuldu (amaç: sadece saldırıyı kesmek).
const WINDOW_MS = parseInt(process.env.RL_WINDOW_MS || "60000", 10);
const MAX = parseInt(process.env.RL_MAX || "240", 10); // dakikada 240 istek/IP

const hits = new Map(); // ip -> { count, reset }

export function rateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  let e = hits.get(ip);
  if (!e || now > e.reset) { e = { count: 0, reset: now + WINDOW_MS }; hits.set(ip, e); }
  e.count++;
  if (hits.size > 5000) { for (const [k, v] of hits) if (now > v.reset) hits.delete(k); }
  return e.count > MAX;
}

// ── YZ UÇLARI: KULLANICI BAŞINA sınır ─────────────────────────────────────────
//
// NEDEN AYRI: Yukarıdaki sınır IP başına ve cömert (mobil operatör NAT'ı yüzünden
// çok kullanıcı tek IP paylaşabiliyor). Bu, tek bir hesabın pahalı YZ uçlarını
// dakikalarca dövmesini engellemiyordu — üstelik ucuz uçlarla (örn. /friends)
// aynı kotayı paylaşıyorlardı. Günlük kota (aiquota) uzun vadeli koruma;
// bu ise ANLIK patlamayı keser.
const AI_WINDOW_MS = parseInt(process.env.AI_RL_WINDOW_MS || "60000", 10);
const AI_MAX = parseInt(process.env.AI_RL_MAX || "20", 10);   // dakikada 20 YZ isteği/kullanıcı
const aiHits = new Map(); // userId -> { count, reset }

export function aiRateLimited(userId) {
  if (!userId) return false;
  const now = Date.now();
  let e = aiHits.get(userId);
  if (!e || now > e.reset) { e = { count: 0, reset: now + AI_WINDOW_MS }; aiHits.set(userId, e); }
  e.count++;
  // Süresi dolmuş kayıtları temizle (harita sonsuza kadar büyümesin)
  if (aiHits.size > 5000) { for (const [k, v] of aiHits) if (now > v.reset) aiHits.delete(k); }
  return e.count > AI_MAX;
}
