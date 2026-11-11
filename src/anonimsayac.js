// ANONİM GERİ DÖNÜŞ SAYACI — doğrulama (saf fonksiyon, ağ/DB yok).
//
// NEDEN VAR: D1/D7/D30 yalnız hesaplı kullanıcılar için ölçülebiliyordu (db/24);
// misafirler görünmezdi, PostHog ise rıza gerektirdiği için kapalı. Bu sayaç kimlik
// taşımadığı için rıza gerektirmez: istemci günde en çok bir kez
// { k: kurulum günü, g: kuruluma göre gün, p: platform } yollar. Hesap, cihaz,
// reklam kimliği, sürüm, token YOK; sunucu IP'yi ve gövdeyi KAYDETMEZ.
//
// Katı doğrulama iki işe yarar: çöp/saldırı sayacı bozmasın, ve istemciye
// "fazladan alan gönder" kapısı açılmasın (bilinmeyen anahtar = 400).

export const PLATFORMLAR = new Set(["android", "ios", "web"]);
export const EN_ERKEN_KURULUM = "2026-06-01";
export const EN_GEC_GUN_FARKI = 400;

const GUN_MS = 86400000;
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

// "YYYY-MM-DD" gerçek bir takvim günü mü? (2026-02-30 gibi taşanları reddeder.)
function gunMs(s) {
  if (typeof s !== "string" || !TARIH.test(s)) return null;
  const t = Date.parse(s + "T00:00:00Z");
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString().slice(0, 10) === s ? t : null;
}

// Geçerliyse { k, g, p }, değilse null. `simdi` testte sabitlenir.
export function sayacDogrula(body, simdi = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const anahtarlar = Object.keys(body);
  if (anahtarlar.length !== 3 || !["k", "g", "p"].every((a) => anahtarlar.includes(a))) return null;
  const { k, g, p } = body;
  if (!PLATFORMLAR.has(p)) return null;
  if (!Number.isInteger(g) || g < 0 || g > EN_GEC_GUN_FARKI) return null;
  const kMs = gunMs(k);
  if (kMs === null || kMs < Date.parse(EN_ERKEN_KURULUM + "T00:00:00Z")) return null;
  const bugunUtc = Math.floor(simdi / GUN_MS) * GUN_MS;
  // Gelecek yasak. Tek pay: kullanıcının YEREL günü UTC'den bir gün ileride olabilir
  // (UTC+3'te gece 00:00–03:00), kurulum günü "yarın UTC" görünür; o yüzden +1 gün hoş görülür.
  if (kMs > bugunUtc + GUN_MS) return null;
  const fark = Math.round((bugunUtc - kMs) / GUN_MS);
  if (Math.abs(g - fark) > 1) return null;
  return { k, g, p };
}
