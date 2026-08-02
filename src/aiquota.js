// AI uçları için kullanıcı başına GÜNLÜK çağrı sınırı (maliyet/DoS koruması).
// Gemini/dış servis çağrısı yapan uçlar bunu kontrol eder → tek kullanıcı binlerce
// istekle kotayı (ve faturayı) tüketemez. Bellek içi; ölçekte Redis'e taşınır.
const CAP = parseInt(process.env.AI_DAILY_CAP || "300", 10);

const counts = new Map(); // userId -> { day, n }

function today() { return new Date().toISOString().slice(0, 10); }

// Hem kullanıcı hem SİSTEM tavanına bakar. Global kontrol buraya gömülü —
// böylece yeni bir YZ ucu eklendiğinde freni takmayı unutmak mümkün değil.
export function underAiCap(userId) {
  if (!userId) return false;
  if (!underGlobalCap()) return false;
  const e = counts.get(userId);
  if (!e || e.day !== today()) return true;
  return e.n < CAP;
}

export function bumpAi(userId, n = 1) {
  bumpGlobal(n);
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
  if (!underGlobalCap()) return false;
  const e = trCounts.get(userId);
  if (!e || e.day !== today()) return true;
  return e.n < TR_CAP;
}

export function bumpTranslate(userId, n = 1) {
  bumpGlobal(n);
  if (!userId) return;
  const d = today();
  const e = trCounts.get(userId);
  if (!e || e.day !== d) trCounts.set(userId, { day: d, n });
  else e.n += n;
}

// ── SİSTEM GENELİ günlük tavan (fren) ─────────────────────────────────────────
//
// NEDEN: Yukarıdaki tavanların hepsi KULLANICI BAŞINA. Tek kullanıcı faturayı
// patlatamıyor ama 1000 kullanıcı × 300 çağrı = günde 300 bin çağrı ve sistemde
// hiçbir fren yoktu. Bu sayaç tüm YZ çağrılarını (okuma + mnemonic + çeviri +
// görsel sorgusu + sohbet) tek bir günlük bütçede toplar.
//
// Tavana gelindiğinde uygulama ÇÖKMEZ: çağıran uçlar 503 döndürür, istemci zaten
// önbellek/yedek metne düşecek şekilde yazıldı. Bellek içi — süreç yeniden
// başlarsa sıfırlanır; Render'da tek süreç olduğu için pratikte yeterli.
const GLOBAL_CAP = parseInt(process.env.AI_GLOBAL_DAILY_CAP || "20000", 10);
let globalDay = today();
let globalN = 0;

export function underGlobalCap() {
  const d = today();
  if (d !== globalDay) { globalDay = d; globalN = 0; }
  return globalN < GLOBAL_CAP;
}

export function bumpGlobal(n = 1) {
  const d = today();
  if (d !== globalDay) { globalDay = d; globalN = n; return; }
  globalN += n;
}

export function globalUsage() { return { used: globalN, cap: GLOBAL_CAP, day: globalDay }; }
