// Kelime görseli (Pexels) — "dual coding" için kelime başına 1 ilgili fotoğraf.
// API anahtarı YALNIZCA sunucuda (PEXELS_API_KEY). Kelime bazında önbelleklenir →
// herkese aynı görsel, tek sorgu. Bulunamazsa null (istemci gizler).
const KEY = process.env.PEXELS_API_KEY || "";
export const imagesConfigured = () => !!KEY;

const cache = new Map();   // en(lower) -> { photos: [{ url, photographer }] }
const CACHE_CAP = 8000;

// Kelime için birkaç aday foto döndür (kullanıcı alakasızsa değiştirebilsin).
export async function fetchWordImage(en) {
  const q = String(en || "").trim().toLowerCase();
  if (!q) throw new Error("kelime gerekli");
  if (cache.has(q)) return cache.get(q);
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
  return out;
}
