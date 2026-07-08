// Moderasyon: engelleme + raporlama. Bellek içi hızlı önbellek + Supabase kalıcılık.
import { supa } from "./supabase.js";

const blocks = new Map();   // userId -> Set(blockedUserId)  (eşleştirme için hızlı önbellek)
const reports = [];         // son raporların bellek kopyası
const roomReporters = new Map(); // "room|target" -> Set(reporterId)  (otomatik çıkarma için)

const EJECT_THRESHOLD = parseInt(process.env.REPORT_EJECT_THRESHOLD || "2", 10);

function addBlockLocal(userId, targetId) {
  if (!userId || !targetId || userId === targetId) return;
  if (!blocks.has(userId)) blocks.set(userId, new Set());
  blocks.get(userId).add(targetId);
}

export function block(userId, targetId) {
  addBlockLocal(userId, targetId);
  const s = supa();
  if (s) s.from("blocks").insert({ blocker: userId, blocked: targetId }).then(() => {}, () => {});
}

// İki yönlü: biri diğerini engellediyse eşleşmemeliler.
export function areBlocked(a, b) {
  return Boolean(blocks.get(a)?.has(b) || blocks.get(b)?.has(a));
}

export function report({ reporterId, targetId, roomName, reason }) {
  reports.push({ reporterId, targetId, roomName, reason: reason || "", ts: Date.now() });
  if (reports.length > 2000) reports.shift();
  if (roomName) {
    const key = `${roomName}|${targetId}`;
    if (!roomReporters.has(key)) roomReporters.set(key, new Set());
    roomReporters.get(key).add(reporterId);
  }
  const s = supa();
  if (s) s.from("reports").insert({ reporter: reporterId, target: targetId, room: roomName, reason: reason || "" }).then(() => {}, () => {});
  return reports.length;
}

// Aynı odada farklı kişilerden gelen rapor sayısı eşiği aşarsa → kullanıcı çıkarılır.
export function shouldEject(roomName, targetId) {
  if (!roomName) return false;
  const set = roomReporters.get(`${roomName}|${targetId}`);
  return Boolean(set && set.size >= EJECT_THRESHOLD);
}

export function clearRoomReports(roomName, targetId) {
  roomReporters.delete(`${roomName}|${targetId}`);
}

// Sunucu açılışında engelleri Postgres'ten belleğe yükle (yeniden başlatmada korunur).
export async function loadBlocks() {
  const s = supa();
  if (!s) return;
  try {
    const { data } = await s.from("blocks").select("blocker,blocked");
    if (data) for (const b of data) addBlockLocal(b.blocker, b.blocked);
  } catch (e) {}
}

export function recentReports(limit = 50) {
  return reports.slice(-limit);
}

export function moderationStats() {
  let blockedPairs = 0;
  for (const set of blocks.values()) blockedPairs += set.size;
  return { blockedPairs, reports: reports.length };
}
