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
