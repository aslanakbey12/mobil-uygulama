// Eşleştirme kuyruğu (MVP: bellek içi; seviye + oda tipi + KELİME ÖRTÜŞMESİ).
// Kurallar:
//  - Aynı (seviye, tip) kuyruğunda, "öğrenme havuzu" örtüşen kişiler önce eşleşir.
//  - IDEAL kişi birikince örtüşmeye göre hemen oda kur.
//  - En eski bekleyen RELAX_MS'i aşarsa örtüşme şartı gevşer, MIN ile kur (kimse takılmasın).
//  - Oda "odak kelimeler" alır: grubun ortak eksik kelimeleri (Felsefe A).
import { pickTopic } from "./topics.js";
import { createRoom, isUserInRoom, getRoomOfUser } from "./rooms.js";
import { areBlocked } from "./moderation.js";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
const MODES = ["voice", "text", "game"];

const MIN = parseInt(process.env.MATCH_MIN || "2", 10);
const IDEAL = parseInt(process.env.MATCH_IDEAL || "4", 10);
const RELAX_MS = parseInt(process.env.MATCH_RELAX_MS || "20000", 10);
const OVERLAP_MIN = parseInt(process.env.MATCH_OVERLAP_MIN || "3", 10); // eşleşmek için en az N ortak kelime
const POOL_CAP = 300;         // sunucuda tutulan havuz üst sınırı
const FOCUS_CAP = 12;         // odaya yazılacak odak kelime sayısı

// Bot-fill: yeterince gerçek oyuncu yoksa, kısa beklemeden sonra odayı botlarla doldur
// (likidite: kimse boş odada takılmasın + tek kişi de girip inceleyebilsin). "0" ile kapatılır.
const BOT_FILL = process.env.MATCH_BOT_FILL !== "0";
const BACKFILL_MS = parseInt(process.env.MATCH_BACKFILL_MS || "12000", 10);
const TARGET_SIZE = { voice: 3, text: 3, game: 4 };
const BOT_NAMES = ["Ada", "Kaan", "Ela", "Deniz", "Mert", "Nil", "Efe", "Zeynep", "Aylin", "Poyraz"];

function makeBot(seed, level, mode, name) {
  const pool = ((seed && seed.pool) || []).slice(0, 60); // tohumdan havuz (grid/odak için)
  const ens = pool.map(x => (typeof x === "string" ? x : x && x.en)).filter(Boolean);
  return {
    userId: "bot_" + Math.random().toString(36).slice(2, 10),
    name: name || BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)],
    level, mode, pool, poolSet: new Set(ens), joinedAt: Date.now(), bot: true,
  };
}

// `${level}|${mode}` -> [{ userId, name, level, mode, joinedAt }]
const queues = new Map();
for (const l of LEVELS) for (const m of MODES) queues.set(`${l}|${m}`, []);
const qKey = (level, mode) => `${level}|${mode}`;

function inQueue(userId) {
  for (const q of queues.values()) {
    if (q.some(u => u.userId === userId)) return true;
  }
  return false;
}

export function join({ userId, name, level, mode, pool }) {
  if (!LEVELS.includes(level)) level = "B1";
  mode = mode === "text" ? "text" : mode === "game" ? "game" : "voice";
  if (isUserInRoom(userId)) return { status: "matched", room: publicRoom(getRoomOfUser(userId)) };
  if (!inQueue(userId)) {
    // pool öğeleri "en" (öğrenme) ya da {en,w} (oyun) olabilir
    const raw = Array.isArray(pool) ? pool.slice(0, POOL_CAP) : [];
    const ens = raw.map(x => (typeof x === "string" ? x : x && x.en)).filter(Boolean);
    queues.get(qKey(level, mode)).push({
      userId, name: name || "Anonim", level, mode,
      pool: raw, poolSet: new Set(ens), joinedAt: Date.now()
    });
  }
  tryForm(level, mode);
  return status(userId);
}

export function leave(userId) {
  for (const q of queues.values()) {
    const i = q.findIndex(u => u.userId === userId);
    if (i !== -1) q.splice(i, 1);
  }
}

export function status(userId) {
  const room = getRoomOfUser(userId);
  if (room) return { status: "matched", room: publicRoom(room) };
  for (const [key, q] of queues) {
    const i = q.findIndex(u => u.userId === userId);
    if (i !== -1) {
      const [level, mode] = key.split("|");
      return { status: "waiting", level, mode, position: i + 1, waiting: q.length };
    }
  }
  return { status: "idle" };
}

// Bir (seviye, tip) kuyruğunda oda kur: önce kelime örtüşmesine göre, zaman aşımında gevşet.
function tryForm(level, mode) {
  const q = queues.get(qKey(level, mode));
  if (!q || q.length === 0) return;

  // Bot-fill: en eski gerçek oyuncu yeterince bekledi → botlarla doldurup başlat
  // (MIN kontrolünden ÖNCE; tek kişi de girebilsin, kimse takılmasın)
  if (BOT_FILL && Date.now() - q[0].joinedAt >= BACKFILL_MS) {
    const target = TARGET_SIZE[mode] || 2;
    const real = q.slice(0, target);
    const seed = real[0];
    const members = [...real];
    while (members.length < target) {
      const used = new Set(members.map(m => m.name));
      const avail = BOT_NAMES.filter(n => !used.has(n));
      const name = avail[Math.floor(Math.random() * avail.length)] || undefined;
      members.push(makeBot(seed, level, mode, name));
    }
    removeFromQueue(q, real);
    return form(level, mode, members);
  }

  if (q.length < MIN) return;
  const relaxed = Date.now() - q[0].joinedAt >= RELAX_MS;

  // IDEAL kişi birikince: örtüşme eşiğiyle hemen grupla
  if (q.length >= IDEAL) {
    const chosen = pickByOverlap(q, IDEAL, relaxed ? 0 : OVERLAP_MIN);
    if (chosen.length >= MIN) { removeFromQueue(q, chosen); return form(level, mode, chosen); }
  }

  // Zaman aşımı: örtüşme şartını kaldır, MIN ile kur (kimse takılı kalmasın)
  if (relaxed) {
    const chosen = pickByOverlap(q, Math.min(IDEAL, q.length), 0);
    if (chosen.length >= MIN) { removeFromQueue(q, chosen); return form(level, mode, chosen); }
  }
}

// İki bekleyenin havuz kesişimi (ortak öğrenilen kelime sayısı).
function overlap(a, b) {
  if (!a.poolSet || !b.poolSet || !a.poolSet.size || !b.poolSet.size) return 0;
  const [small, big] = a.poolSet.size <= b.poolSet.size ? [a.poolSet, b.poolSet] : [b.poolSet, a.poolSet];
  let n = 0;
  for (const w of small) if (big.has(w)) n++;
  return n;
}

// En eski bekleyeni (seed) çekirdek al, örtüşmesi en yüksek (>= minOverlap) ve
// birbirini engellemeyen en fazla `max` kişiyi seç.
function pickByOverlap(q, max, minOverlap) {
  const seed = q[0];
  const scored = q.slice(1)
    .filter(c => !areBlocked(seed.userId, c.userId))
    .map(c => ({ c, ov: overlap(seed, c) }))
    .filter(x => x.ov >= minOverlap)
    .sort((a, b) => b.ov - a.ov);

  const chosen = [seed];
  for (const { c } of scored) {
    if (chosen.length >= max) break;
    if (chosen.every(g => !areBlocked(g.userId, c.userId))) chosen.push(c);
  }
  return chosen;
}

// Grubun odak kelimeleri: en çok kişide ortak olan (>=2) kelimeler; tek kişiyse kendi havuzu.
function computeFocus(members) {
  const freq = new Map();
  for (const m of members) for (const w of (m.poolSet || [])) freq.set(w, (freq.get(w) || 0) + 1);
  const entries = [...freq.entries()];
  const shared = entries.filter(([, n]) => n >= 2);
  return (shared.length ? shared : entries)
    .sort((a, b) => b[1] - a[1])
    .slice(0, FOCUS_CAP)
    .map(([w]) => w);
}

function removeFromQueue(q, members) {
  for (const m of members) {
    const i = q.indexOf(m);
    if (i !== -1) q.splice(i, 1);
  }
}

function form(level, mode, members) {
  const topic = pickTopic(level);
  const focusWords = computeFocus(members);
  const room = createRoom({
    level,
    mode,
    topic,
    focusWords,
    members: members.map(m => ({ userId: m.userId, name: m.name, bot: !!m.bot })),
    // Oyun modu: grid kurmak için üyelerin ağırlıklı havuzlarını odaya iliştir
    memberPools: mode === "game" ? members.map(m => ({ userId: m.userId, name: m.name, pool: m.pool })) : undefined,
  });
  for (const cb of matchListeners) { try { cb(room); } catch (e) {} }
  return room;
}

// Oda kurulunca haber ver (WebSocket anlık bildirim için).
const matchListeners = [];
export function onMatch(cb) { matchListeners.push(cb); }

// Periyodik tarama: zaman aşımına uğrayan bekleyenleri esnek odalarla başlat.
let sweeper = null;
export function startSweeper(intervalMs = 3000) {
  if (sweeper) return;
  sweeper = setInterval(() => {
    for (const l of LEVELS) for (const m of MODES) tryForm(l, m);
  }, intervalMs);
  if (sweeper.unref) sweeper.unref();
}
export function stopSweeper() {
  if (sweeper) { clearInterval(sweeper); sweeper = null; }
}

function publicRoom(room) {
  if (!room) return null;
  return {
    name: room.name,
    level: room.level,
    mode: room.mode || "voice",
    topic: room.topic,
    focusWords: room.focusWords || [],
    members: room.members.map(m => ({ name: m.name })),
    size: room.members.length
  };
}

export function queueStats() {
  const out = {};
  for (const [key, q] of queues) if (q.length) out[key] = q.length;
  return out;
}
