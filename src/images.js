// Kelime görseli (Pexels) — "dual coding" için kelime başına 1 ilgili fotoğraf.
// API anahtarı YALNIZCA sunucuda (PEXELS_API_KEY). Kelime bazında önbelleklenir →
// herkese aynı görsel, tek sorgu. Bulunamazsa null (istemci gizler).
const KEY = process.env.PEXELS_API_KEY || "";
export const imagesConfigured = () => !!KEY;

const cache = new Map();   // en(lower) -> { url, alt, photographer, photographer_url, pexels_url } | null
const CACHE_CAP = 8000;

export async function fetchWordImage(en) {
  const q = String(en || "").trim().toLowerCase();
  if (!q) throw new Error("kelime gerekli");
  if (cache.has(q)) return cache.get(q);
  if (!KEY) throw new Error("Görsel servisi yapılandırılmadı.");

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&per_page=1&orientation=landscape`;
  let r;
  for (let attempt = 0; attempt < 2; attempt++) {
    r = await fetch(url, { headers: { Authorization: KEY } });
    if (r.ok) break;
    if (r.status === 429 && attempt < 1) { await new Promise((res) => setTimeout(res, 600)); continue; }
    throw new Error(`Görsel hatası (${r.status})`);
  }
  const data = await r.json();
  const photo = (data.photos || [])[0];
  const out = photo ? {
    url: photo.src?.medium || photo.src?.large || photo.src?.original || "",
    alt: photo.alt || q,
    photographer: photo.photographer || "",
    photographer_url: photo.photographer_url || "",
    pexels_url: photo.url || "",
  } : null;
  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value);
  cache.set(q, out);
  return out;
}
