// YZ uçları için kota: kullanıcı başına GÜNLÜK sınır + SİSTEM GENELİ tavan.
//
// KALICILIK (db/12_perf_quota.sql):
// Sayaçlar eskiden yalnızca süreç belleğindeydi. Render her dağıtımda ve her uyku
// sonrası süreci yeniden başlattığı için kotalar sıfırlanıyordu — koruma, dağıtım
// yapılarak (ya da servis uyuyup uyanarak) baypas edilebiliyordu.
// Şimdi: bellek HIZLI YOL olarak kalır (her çağrıda DB'ye gitmeyiz), ama açılışta
// bugünün sayaçları yüklenir ve çalışırken periyodik olarak yazılır.
import { supa } from "./supabase.js";

const CAP = parseInt(process.env.AI_DAILY_CAP || "300", 10);
const TR_CAP = parseInt(process.env.AI_TRANSLATE_DAILY_CAP || "600", 10);
const GLOBAL_CAP = parseInt(process.env.AI_GLOBAL_DAILY_CAP || "20000", 10);
const FLUSH_MS = parseInt(process.env.AI_QUOTA_FLUSH_MS || "60000", 10);

function today() { return new Date().toISOString().slice(0, 10); }

// kind -> Map(userId -> { day, n })
const mem = { ai: new Map(), translate: new Map() };
let globalDay = today();
let globalN = 0;
const dirty = new Set();          // "kind|userId" — yazılmayı bekleyenler
let globalDirty = false;

// ── BELLEK TEMİZLİĞİ ──────────────────────────────────────────────────────────
// Gün değişince sayaç sıfırlanıyordu ama KAYIT duruyordu: kullanıcı başına bir
// ölü kayıt, sonsuza kadar. 10.000 kullanıcıda 10.000 ölü kayıt.
// Artık her erişimde tembel temizlik + periyodik toplu süpürme yapılır.
function sweep() {
  const d = today();
  for (const m of Object.values(mem)) {
    for (const [k, v] of m) if (v.day !== d) m.delete(k);
  }
  if (globalDay !== d) { globalDay = d; globalN = 0; globalDirty = true; }
}

function get(kind, userId) {
  const m = mem[kind];
  const e = m.get(userId);
  const d = today();
  if (!e || e.day !== d) { const n = { day: d, n: 0 }; m.set(userId, n); return n; }
  return e;
}

// ── KÜRESEL FREN ──────────────────────────────────────────────────────────────
export function underGlobalCap() {
  if (globalDay !== today()) { globalDay = today(); globalN = 0; globalDirty = true; }
  return globalN < GLOBAL_CAP;
}
export function bumpGlobal(n = 1) {
  if (globalDay !== today()) { globalDay = today(); globalN = 0; }
  globalN += n;
  globalDirty = true;
}
export function globalUsage() { return { used: globalN, cap: GLOBAL_CAP, day: globalDay }; }

// ── KULLANICI KOTALARI ────────────────────────────────────────────────────────
// Küresel kontrol İÇERİ GÖMÜLÜ: yeni bir YZ ucu eklenirken freni takmak unutulamaz.
export function underAiCap(userId) {
  if (!userId) return false;
  if (!underGlobalCap()) return false;
  return get("ai", userId).n < CAP;
}
export function bumpAi(userId, n = 1) {
  bumpGlobal(n);
  if (!userId) return;
  get("ai", userId).n += n;
  dirty.add("ai|" + userId);
}
export function aiDailyCap() { return CAP; }

export function underTranslateCap(userId) {
  if (!userId) return false;
  if (!underGlobalCap()) return false;
  return get("translate", userId).n < TR_CAP;
}
export function bumpTranslate(userId, n = 1) {
  bumpGlobal(n);
  if (!userId) return;
  get("translate", userId).n += n;
  dirty.add("translate|" + userId);
}

// ── KALICILIK ─────────────────────────────────────────────────────────────────
// Açılışta bugünün sayaçlarını yükle. DB yoksa/hata verirse sessizce bellekle devam
// edilir — kota koruması bozulur ama servis ayakta kalır (fail-open BİLİNÇLİ:
// kotayı okuyamadık diye kimseyi engellemek daha kötü).
export async function loadQuotas() {
  const db = supa();
  if (!db) return;
  const d = today();
  try {
    const { data } = await db.from("ai_usage").select("user_id, kind, n").eq("day", d);
    for (const r of data || []) {
      if (mem[r.kind]) mem[r.kind].set(r.user_id, { day: d, n: r.n || 0 });
    }
    const { data: g } = await db.from("ai_usage_global").select("n").eq("day", d).maybeSingle();
    if (g) { globalDay = d; globalN = g.n || 0; }
  } catch (_) {}
}

export async function flushQuotas() {
  const db = supa();
  if (!db) return;
  const d = today();
  const rows = [];
  for (const key of dirty) {
    const [kind, userId] = key.split("|");
    const e = mem[kind]?.get(userId);
    if (e && e.day === d) rows.push({ day: d, user_id: userId, kind, n: e.n, updated_at: new Date().toISOString() });
  }
  dirty.clear();
  try {
    if (rows.length) await db.from("ai_usage").upsert(rows);
    if (globalDirty) {
      globalDirty = false;
      await db.from("ai_usage_global").upsert({ day: globalDay, n: globalN, updated_at: new Date().toISOString() });
    }
  } catch (_) {}
}

let timer = null;
export function startQuotaPersistence() {
  if (timer) return;
  timer = setInterval(() => { sweep(); flushQuotas(); }, FLUSH_MS);
  if (timer.unref) timer.unref();   // süreç kapanışını engellemesin
}
export function stopQuotaPersistence() {
  if (timer) { clearInterval(timer); timer = null; }
}
