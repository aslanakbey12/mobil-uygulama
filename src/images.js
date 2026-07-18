// Kelime görseli (Pexels) — "dual coding" için kelime başına 1 ilgili fotoğraf.
// API anahtarı YALNIZCA sunucuda (PEXELS_API_KEY). Kelime bazında önbelleklenir →
// herkese aynı görsel, tek sorgu. Bulunamazsa null (istemci gizler).
const KEY = process.env.PEXELS_API_KEY || "";
export const imagesConfigured = () => !!KEY;

const cache = new Map();   // en(lower) -> { photos: [{ url, photographer }] }
const CACHE_CAP = 8000;

// Kalabalık-kaynaklı foto puanı: 👍 alan foto herkes için öne çıkar (sabitlenir),
// 👎 alan düşer; -3'e inen aday listeden elenir → kötü foto kendini temizler.
const imgVotes = new Map(); // en -> Map(url -> skor)

export function rateWordImage(en, url, up) {
  const k = String(en || "").trim().toLowerCase();
  if (!k || !url) return { ok: false };
  let m = imgVotes.get(k);
  if (!m) { m = new Map(); imgVotes.set(k, m); }
  m.set(url, (m.get(url) || 0) + (up ? 1 : -1));
  return { ok: true, score: m.get(url) };
}

// Adayları oy skoruna göre sırala (en beğenilen önce); çok eksi alanları ele.
function rankPhotos(en, photos) {
  const m = imgVotes.get(en);
  if (!m || !photos?.length) return photos;
  const ranked = [...photos]
    .filter((p) => (m.get(p.url) ?? 0) > -3)
    .sort((a, b) => (m.get(b.url) ?? 0) - (m.get(a.url) ?? 0));
  return ranked.length ? ranked : photos; // hepsi elendiyse orijinale düş
}

// Kelime için birkaç aday foto döndür (kullanıcı alakasızsa değiştirebilsin).
export async function fetchWordImage(en) {
  const q = String(en || "").trim().toLowerCase();
  if (!q) throw new Error("kelime gerekli");
  if (cache.has(q)) return { photos: rankPhotos(q, cache.get(q).photos) };
  if (!KEY) throw new Error("Görsel servisi yapılandırılmadı.");

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=6&orientation=landscape`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let r;
  try {
    r = await fetch(url, { headers: { Authorization: KEY }, signal: ctrl.signal });
  } finally { clearTimeout(timer); }
  if (!r.ok) throw new Error(`Görsel hatası (${r.status})`);
  const data = await r.json();
  const photos = (data.photos || [])
    .map((p) => ({
      url: p.src?.large || p.src?.medium || p.src?.landscape || p.src?.original || "",
      photographer: p.photographer || "",
    }))
    .filter((x) => x.url)
    .slice(0, 5);
  const out = { photos };
  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value);
  cache.set(q, out);
  return { photos: rankPhotos(q, photos) };
}
