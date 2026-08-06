// Kelime görseli (Pexels) — "dual coding" için kelime başına 1 ilgili fotoğraf.
// API anahtarı YALNIZCA sunucuda (PEXELS_API_KEY). Kelime bazında önbelleklenir →
// herkese aynı görsel, tek sorgu. Bulunamazsa null (istemci gizler).
import { supa } from "./supabase.js";

const KEY = process.env.PEXELS_API_KEY || "";
export const imagesConfigured = () => !!KEY;

const cache = new Map();   // en(lower) -> { photos: [{ url, photographer }] }
const CACHE_CAP = 8000;

// ── KALICI ÖNBELLEK (db/14_word_images.sql) ──────────────────────────────────
// Yukarıdaki Map bir L1 önbellek: hızlı ama süreçle birlikte ölüyor. Render
// ücretsiz katmanda süreç 15 dk hareketsizlikte uyuduğu ve her dağıtımda
// yeniden başladığı için pratikte çoğu istek soğuk önbelleğe düşüyordu →
// aynı kelime için Gemini + Pexels zinciri baştan çalışıyor, kullanıcı 2-5 sn
// bekliyordu. Postgres bunu kalıcı kılıyor: bir kelime hayatta BİR KEZ çözülür.
//
// Tablo yoksa ya da okunamazsa sessizce eski davranışa düşülür (yalnız bellek):
// görsel, uygulamanın çalışması için zorunlu değil — bir iyileştirme. Migration
// çalıştırılmadan da sunucu düzgün ayakta kalmalı.
let dbUyarildi = false;
function dbHata(e, nerede) {
  if (dbUyarildi) return;
  dbUyarildi = true;   // her istekte log şişirmeyelim; bir kez söyle yeter
  console.warn(`word_images ${nerede} başarısız (db/14_word_images.sql çalıştırıldı mı?):`, String(e?.message || e));
}

// Kalıcı önbellekten oku. Bulunamazsa null.
export async function loadWordImage(en) {
  const db = supa();
  if (!db) return null;
  try {
    const { data, error } = await db.from("word_images")
      .select("depictable, query, photos").eq("en", String(en).toLowerCase()).maybeSingle();
    if (error) { dbHata(error, "okuma"); return null; }
    if (!data) return null;
    return { depictable: !!data.depictable, query: data.query || null, photos: data.photos || [] };
  } catch (e) { dbHata(e, "okuma"); return null; }
}

// Kalıcı önbelleğe yaz. HATA YUTULUR: yazamamak isteği başarısız kılmamalı,
// yalnızca bir sonraki sefere yeniden hesaplanır.
export async function saveWordImage(en, { depictable, query, photos }) {
  const db = supa();
  if (!db) return;
  try {
    const { error } = await db.from("word_images").upsert({
      en: String(en).toLowerCase(),
      depictable: !!depictable,
      query: query || null,
      photos: Array.isArray(photos) ? photos : [],
      updated_at: new Date().toISOString(),
    });
    if (error) dbHata(error, "yazma");
  } catch (e) { dbHata(e, "yazma"); }
}

// Kalabalık-kaynaklı foto puanı: 👍 alan foto herkes için öne çıkar (sabitlenir),
// 👎 alan düşer; -3'e inen aday listeden elenir → kötü foto kendini temizler.
// Kapak: bu iki harita hiç temizlenmiyordu (kelime × url × oy veren) → sınırsız büyüme.
const VOTE_CAP = 20000;
const imgVotes = new Map(); // en -> Map(url -> skor)
const imgVoters = new Map();
function capVotes() {
  while (imgVotes.size > VOTE_CAP) imgVotes.delete(imgVotes.keys().next().value);
  while (imgVoters.size > VOTE_CAP) imgVoters.delete(imgVoters.keys().next().value);
} // `en|url` -> Set(userId) — bir kullanıcı aynı fotoya bir kez oy verir

export function rateWordImage(en, url, up, userId) {
  const k = String(en || "").trim().toLowerCase();
  if (!k || !url || !userId) return { ok: false };
  // Tek kullanıcı tekrar tekrar oylayıp global skoru (-3 elenme) manipüle edemesin.
  const vk = `${k}|${url}`;
  let voters = imgVoters.get(vk);
  if (!voters) { voters = new Set(); imgVoters.set(vk, voters); }
  if (voters.has(userId)) return { ok: true, dup: true };
  voters.add(userId);
  let m = imgVotes.get(k);
  if (!m) { m = new Map(); imgVotes.set(k, m); capVotes(); }
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
export async function fetchWordImage(en, searchQuery = null) {
  const q = String(en || "").trim().toLowerCase();
  if (!q) throw new Error("kelime gerekli");
  if (cache.has(q)) return { photos: rankPhotos(q, cache.get(q).photos) };

  // L2: kalıcı önbellek. HAM liste saklanır, sıralama HER OKUMADA uygulanır —
  // sıralanmış liste saklansaydı kullanıcı oyları (👍/👎) önbelleğe alınmış
  // kelimelerde bir daha etki etmez, foto sırası donardı.
  const kalici = await loadWordImage(q);
  if (kalici?.photos?.length) {
    if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value);
    cache.set(q, { photos: kalici.photos });     // L1'i de doldur
    return { photos: rankPhotos(q, kalici.photos) };
  }

  if (!KEY) throw new Error("Görsel servisi yapılandırılmadı.");

  // AI arama sorgusu (varsa): "bank" → "bank teller counter" gibi anlamı netleştirir.
  // Kelime fotoğraflanamaz (soyut) ise HİÇ görsel gösterme — alakasız foto, foto yokluğundan kötüdür.
  const searchTerm = (searchQuery && String(searchQuery).trim()) || q;

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(searchTerm)}&per_page=6&orientation=landscape`;
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
  // Kalıcıya HAM liste yazılır (sıralanmış değil — yukarıdaki gerekçe).
  // Beklenmez: kullanıcı fotoğrafı beklerken bir de veritabanı yazmasını beklemesin.
  saveWordImage(q, { depictable: true, query: searchQuery || null, photos }).catch(() => {});
  return { photos: rankPhotos(q, photos) };
}
