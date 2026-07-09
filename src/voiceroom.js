// Sıralı sesli tur odası: 4 kişi sırayla konuşur; sıra gelen otomatik kaydeder,
// klip yüklenince HERKESE (konuşan dahil) aynı anda oynatılır, sonra sıra döner.
// Klipler MVP'de bellekte tutulur (üretimde Cloudflare R2 / Supabase Storage).
import { randomUUID } from "node:crypto";

const rooms = new Map();  // roomName -> voiceroom state
const clips = new Map();  // clipId -> { buf, contentType, ts }
const CLIP_TTL = 30 * 60 * 1000;
const MAX_TURN_MS = 65000;

let broadcaster = null;   // server.js kurar: (roomName, members, payload) => void
export function setBroadcaster(fn) { broadcaster = fn; }
function bc(vr, payload) { if (broadcaster) broadcaster(vr.room, vr.members, payload); }

export function createVoiceRoom(room) {
  const members = (room.members || []).map(m => ({ userId: m.userId, name: m.name, bot: !!m.bot }));
  const vr = {
    room: room.name,
    topic: room.topic || null,
    members,
    order: members.map(m => m.userId),
    turnIdx: 0,
    phase: "speaking",   // "speaking" (sıra gelen konuşuyor) | "playing" (klip oynatılıyor)
    round: 1,
    log: [],             // [{ from, name, clipId, ts }]
    timer: null,
    status: "active",
  };
  rooms.set(room.name, vr);
  return vr;
}
export function getVoiceRoom(name) { return rooms.get(name) || null; }
export function endVoiceRoom(name) {
  const vr = rooms.get(name);
  if (vr?.timer) clearTimeout(vr.timer);
  rooms.delete(name);
}

function currentSpeaker(vr) { return vr.order[vr.turnIdx] || null; }

export function stateFor(vr) {
  const sp = currentSpeaker(vr);
  return {
    room: vr.room,
    topic: vr.topic,
    members: vr.members,
    speakerId: sp,
    speakerName: (vr.members.find(m => m.userId === sp) || {}).name || "",
    phase: vr.phase,
    round: vr.round,
    turnIdx: vr.turnIdx,
    log: vr.log.slice(-12),
    status: vr.status,
  };
}

function advanceTurn(vr) {
  if (vr.timer) { clearTimeout(vr.timer); vr.timer = null; }
  vr.turnIdx = (vr.turnIdx + 1) % vr.order.length;
  if (vr.turnIdx === 0) vr.round++;
  vr.phase = "speaking";
  bc(vr, { type: "vr_state", state: stateFor(vr) });
  maybeBotTurn(vr);
}

// Sıra bir bota gelirse kısa süre sonra otomatik pas (akış kilitlenmesin).
export function maybeBotTurn(vr) {
  const sp = vr.members.find(m => m.userId === currentSpeaker(vr));
  if (sp && sp.bot && vr.status === "active" && vr.phase === "speaking") {
    if (vr.timer) clearTimeout(vr.timer);
    vr.timer = setTimeout(() => { if (vr.status === "active") advanceTurn(vr); }, 2600);
  }
}

// Konuşan klibini yükledi → herkese oynat, klip süresi kadar sonra sıra ilerle.
export function onClip(vr, userId, clipId, durationMs) {
  if (!vr || vr.status !== "active") return { error: "oda aktif değil" };
  if (currentSpeaker(vr) !== userId) return { error: "sıra sende değil" };
  const me = vr.members.find(m => m.userId === userId);
  vr.log.push({ from: userId, name: me?.name, clipId, ts: Date.now() });
  vr.phase = "playing";
  const dur = Math.max(500, Math.min(Number(durationMs) || 3000, MAX_TURN_MS));
  bc(vr, { type: "vr_clip", clipId, from: userId, name: me?.name, durationMs: dur });
  if (vr.timer) clearTimeout(vr.timer);
  vr.timer = setTimeout(() => advanceTurn(vr), dur + 1000); // oynatma bitince sıra döner
  return { ok: true };
}

// Sıra gelen konuşmak istemiyor → atla.
export function passTurn(vr, userId) {
  if (!vr || vr.status !== "active") return { error: "oda aktif değil" };
  if (currentSpeaker(vr) !== userId) return { error: "sıra sende değil" };
  advanceTurn(vr);
  return { ok: true };
}

// ── Klip deposu (MVP: bellek) ──
export function putClip(buf, contentType) {
  const id = "clip_" + randomUUID().slice(0, 12);
  clips.set(id, { buf, contentType: contentType || "audio/m4a", ts: Date.now() });
  const now = Date.now();
  for (const [k, v] of clips) if (now - v.ts > CLIP_TTL) clips.delete(k); // basit temizlik
  return id;
}
export function getClip(id) { return clips.get(id) || null; }

export function voiceStats() { return { voiceRooms: rooms.size, clips: clips.size }; }
