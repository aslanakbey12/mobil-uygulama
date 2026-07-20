// Oda deposu (MVP: bellek içi). Ölçekte Postgres/Redis ile değiştirilecek.
import { randomUUID } from "node:crypto";

const rooms = new Map();        // roomName -> room
const userRoom = new Map();     // userId -> roomName
const codes = new Map();        // code -> roomName  (premium davet odaları)

export const MAX_ROOM = 5;

export function createRoom({ level, topic, members, mode, focusWords, memberPools }) {
  const roomName = "room_" + randomUUID().slice(0, 8);
  const m = mode === "text" ? "text" : mode === "game" ? "game" : "voice";
  const room = {
    name: roomName,
    level,
    mode: m,                     // "voice" (sesli) | "text" (yazılı) | "game" (Kelime Casusu)
    topic,                       // { id, text, minLevel }
    focusWords: Array.isArray(focusWords) ? focusWords : [], // grubun ortak eksik kelimeleri
    memberPools,                 // oyun modunda: [{ userId, name, pool:[{en,w}] }]
    members,                     // [{ userId, name }]
    createdAt: Date.now(),
    status: "open"
  };
  rooms.set(roomName, room);
  for (const m of members) userRoom.set(m.userId, roomName);
  return room;
}

// Premium kullanıcı kendi odasını kurar; paylaşılabilir kısa kod döner.
export function createHostedRoom({ host, level, topic, mode, focusWords }) {
  const room = createRoom({ level, topic, mode, focusWords, members: [{ userId: host.userId, name: host.name }] });
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6 haneli
  room.code = code;
  room.host = host.userId;
  codes.set(code, room.name);
  return room;
}

// AI konuşma partneri odası (AÇIK): tek gerçek kullanıcı + AI üye. Kullanıcının
// seçtiği kelimelerle AI sohbet başlatır. focusWords = seçilen kelimeler.
export function createAiRoom({ user, level, focusWords, botName, topic }) {
  const room = createRoom({
    level, mode: "text", topic: topic || {},
    focusWords: Array.isArray(focusWords) ? focusWords : [],
    members: [{ userId: user.userId, name: user.name }],
  });
  room.ai = { name: botName, id: "ai_" + room.name };
  return room;
}

export function getRoomByCode(code) {
  const name = codes.get(String(code));
  return name ? rooms.get(name) || null : null;
}

// Kodla / davetle odaya katıl. Doluysa veya kapalıysa null/sebep döner.
export function addMember(room, member) {
  if (!room || room.status !== "open") return { ok: false, reason: "oda yok" };
  if (room.members.some(m => m.userId === member.userId)) return { ok: true, room };
  if (room.members.length >= MAX_ROOM) return { ok: false, reason: "oda dolu" };
  room.members.push({ userId: member.userId, name: member.name });
  userRoom.set(member.userId, room.name);
  return { ok: true, room };
}

export function getRoom(roomName) {
  return rooms.get(roomName) || null;
}

export function getRoomOfUser(userId) {
  const name = userRoom.get(userId);
  return name ? rooms.get(name) || null : null;
}

export function isUserInRoom(userId) {
  return userRoom.has(userId);
}

export function closeRoom(roomName) {
  const room = rooms.get(roomName);
  if (!room) return;
  room.status = "closed";
  for (const m of room.members) {
    if (userRoom.get(m.userId) === roomName) userRoom.delete(m.userId);
  }
  if (room.code) codes.delete(room.code);
  rooms.delete(roomName);
}

export function leaveRoom(userId) {
  const name = userRoom.get(userId);
  if (!name) return;
  userRoom.delete(userId);
  const room = rooms.get(name);
  if (!room) return;
  room.members = room.members.filter(m => m.userId !== userId);
  if (room.members.length === 0) closeRoom(name);
}

export function roomStats() {
  return { openRooms: rooms.size, usersInRooms: userRoom.size };
}
