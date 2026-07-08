// Sesli tartışma odaları — eşleştirme + LiveKit token + moderasyon servisi.
// Kimlik: Supabase JWT (üretim) ya da dev yedeği (userId body/query/header).
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import * as mm from "./matchmaking.js";
import * as mod from "./moderation.js";
import * as sockets from "./sockets.js";
import * as league from "./league.js";
import * as game from "./game.js";
import { mintToken, livekitConfigured } from "./token.js";
import { getUserId, authConfigured } from "./auth.js";
import { supaConfigured, supa } from "./supabase.js";
import { isPremium, setPremium } from "./entitlements.js";
import { canEnterRoom, recordRoomEntry, roomsUsedToday, freeDailyLimit } from "./quota.js";
import { pickTopic } from "./topics.js";
import { getRoom, roomStats, leaveRoom, createHostedRoom, getRoomByCode, addMember } from "./rooms.js";

const app = Fastify({ logger: true });

// WebSocket eklentisi (anlık eşleşme + odadan çıkarma bildirimi)
app.register(websocket);

function clientRoom(room) {
  return {
    name: room.name, level: room.level, mode: room.mode || "voice", topic: room.topic,
    focusWords: room.focusWords || [],
    members: room.members.map((m) => ({ name: m.name })), size: room.members.length
  };
}

// Kelime Dedektifi: odadaki herkese kişiye özel oyun durumunu yayınla (roller gizli)
function broadcastGame(room) {
  const g = game.getGame(room.name);
  if (!g) return;
  const names = {};
  for (const m of room.members) names[m.userId] = m.name;
  for (const m of room.members) sockets.push(m.userId, { type: "game", state: game.stateFor(g, m.userId, names) });
}

// Oda kurulunca eşleşen herkese anlık "matched" bildir (+ oyun modunda oyunu kur)
mm.onMatch((room) => {
  if (room.mode === "game") game.createGame(room);
  for (const m of room.members) sockets.push(m.userId, { type: "matched", room: clientRoom(room) });
  if (room.mode === "game") broadcastGame(room);
});

// WebSocket rotası: istemci ?userId=&token= ile bağlanır, push alır
// (@fastify/websocket v10: handler'ın ilk argümanı doğrudan soket)
app.register(async function (appWs) {
  appWs.get("/ws", { websocket: true }, (socket, req) => {
    const userId = getUserId(req) || req.query?.userId;
    if (!userId) { try { socket.close(); } catch (e) {} return; }
    sockets.register(userId, socket);
    socket.on("close", () => sockets.unregister(userId, socket));
    socket.on("message", (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (!msg || !msg.roomName) return;
      const room = getRoom(msg.roomName);
      if (!room || !room.members.some((m) => m.userId === userId)) return;

      // Yazılı oda sohbeti → odadaki herkese yayınla
      if (msg.type === "chat" && room.mode === "text" && typeof msg.text === "string") {
        const me = room.members.find((m) => m.userId === userId);
        const text = String(msg.text).slice(0, 500).trim();
        if (!text) return;
        const payload = { type: "chat", from: userId, name: me.name, text, ts: Date.now() };
        for (const m of room.members) sockets.push(m.userId, payload);
        return;
      }

      // Kelime Dedektifi
      if (room.mode === "game") {
        if (msg.type === "game_join") {
          let g = game.getGame(room.name) || game.createGame(room);
          const names = {}; for (const m of room.members) names[m.userId] = m.name;
          sockets.push(userId, { type: "game", state: game.stateFor(g, userId, names) });
          return;
        }
        const g = game.getGame(room.name);
        if (!g) return;
        let r;
        if (msg.type === "game_clue") r = game.giveClue(g, userId, msg.text);
        else if (msg.type === "game_guess") r = game.guess(g, userId, msg.index);
        else return;
        if (r && r.error) { sockets.push(userId, { type: "game_error", error: r.error }); return; }
        broadcastGame(room);
        return;
      }
    });
  });
});

// Basit CORS (MVP). Üretimde origin'i kısıtla.
app.addHook("onRequest", async (req, reply) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Headers", "content-type,authorization,x-user-id");
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") reply.code(204).send();
});

app.get("/health", async () => ({
  ok: true,
  auth: authConfigured(),
  supabase: supaConfigured(),
  livekit: livekitConfigured(),
  queues: mm.queueStats(),
  rooms: roomStats(),
  sockets: sockets.count(),
  moderation: mod.moderationStats(),
  league: league.leagueStats()
}));

// Haftalık lig: kullanıcının haftalık XP'sini bildir, pod sıralamasını al
app.post("/league/sync", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const { name, weeklyXp, level } = req.body || {};
  return league.sync({ userId, name, weeklyXp, level });
});

// Kuyruğa katıl
app.post("/matchmaking/join", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const { name, level, ageConfirmed, mode, pool } = req.body || {};
  if (ageConfirmed !== true) return reply.code(403).send({ error: "Odalar için 16+ yaş onayı gerekir" });
  return mm.join({ userId, name, level: level || "B1", mode, pool });
});

// Durum
app.get("/matchmaking/status", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  return mm.status(userId);
});

// Kuyruktan ayrıl
app.post("/matchmaking/leave", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  mm.leave(userId);
  return { ok: true };
});

// LiveKit token (oda üyeliği + freemium kota doğrulanır)
app.post("/token", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const { name, roomName } = req.body || {};
  if (!roomName) return reply.code(400).send({ error: "roomName gerekli" });
  const room = getRoom(roomName);
  if (!room) return reply.code(404).send({ error: "oda bulunamadı" });
  if (!room.members.some((m) => m.userId === userId)) return reply.code(403).send({ error: "bu odaya erişim yok" });

  // Freemium: ücretsiz kullanıcı günlük oda limitine takılır
  const premium = await isPremium(userId);
  if (!premium && !canEnterRoom(userId)) {
    return reply.code(402).send({ error: "limit", message: `Ücretsiz planda günde ${freeDailyLimit()} oda. Premium ile sınırsız.`, upgrade: true });
  }

  try {
    const out = await mintToken({ identity: userId, name, roomName });
    if (!premium) recordRoomEntry(userId);
    return out;
  } catch (e) {
    return reply.code(500).send({ error: String(e.message || e) });
  }
});

// Odadan ayrıl
app.post("/rooms/leave", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  leaveRoom(userId);
  return { ok: true };
});

// Bildir (eşik aşılırsa kullanıcı odadan çıkarılır)
app.post("/report", async (req, reply) => {
  const reporterId = getUserId(req);
  if (!reporterId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const { targetId, roomName, reason } = req.body || {};
  if (!targetId) return reply.code(400).send({ error: "targetId gerekli" });
  const count = mod.report({ reporterId, targetId, roomName, reason });
  app.log.warn({ reporterId, targetId, roomName, reason }, "report");

  // Otomatik moderasyon: aynı odada birden çok kişi bildirdiyse çıkar
  if (roomName && mod.shouldEject(roomName, targetId)) {
    leaveRoom(targetId);
    mod.clearRoomReports(roomName, targetId);
    sockets.push(targetId, { type: "ejected", reason: "topluluk kurallarının ihlali bildirildi" });
    app.log.warn({ targetId, roomName }, "auto-eject");
  }
  return { ok: true, count };
});

// Engelle
app.post("/block", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const { targetId } = req.body || {};
  if (!targetId) return reply.code(400).send({ error: "targetId gerekli" });
  mod.block(userId, targetId);
  return { ok: true };
});

// Kullanıcının yetkisi (istemci paywall/limit gösterimi için)
app.get("/me/entitlement", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const premium = await isPremium(userId);
  return { premium, roomsUsedToday: roomsUsedToday(userId), freeDailyLimit: freeDailyLimit() };
});

// Premium: kendi odanı kur (eşleştirme beklemeden), davet kodu al
app.post("/rooms/create", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  if (!(await isPremium(userId))) return reply.code(402).send({ error: "premium", message: "Oda kurmak premium gerektirir.", upgrade: true });
  const { level, name, mode, pool } = req.body || {};
  const topic = pickTopic(level || "B1");
  const focusWords = Array.isArray(pool) ? pool.slice(0, 12) : [];
  const room = createHostedRoom({ host: { userId, name }, level: level || "B1", topic, mode, focusWords });
  return { room: { name: room.name, level: room.level, mode: room.mode, topic: room.topic, focusWords: room.focusWords, code: room.code, members: room.members.map(m => ({ name: m.name })), size: room.members.length } };
});

// Davet koduyla odaya katıl (ücretsiz kullanıcılar da katılabilir)
app.post("/rooms/join", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const { code, name } = req.body || {};
  if (!code) return reply.code(400).send({ error: "code gerekli" });
  const room = getRoomByCode(code);
  if (!room) return reply.code(404).send({ error: "oda bulunamadı veya kapandı" });
  const res = addMember(room, { userId, name });
  if (!res.ok) return reply.code(409).send({ error: res.reason });
  return { room: { name: room.name, level: room.level, topic: room.topic, members: room.members.map(m => ({ name: m.name })), size: room.members.length } };
});

// RevenueCat webhook → premium durumunu güncelle
// (RevenueCat'te app_user_id = Supabase user id olacak şekilde ayarla)
app.post("/webhooks/revenuecat", async (req, reply) => {
  const auth = req.headers["authorization"];
  if (process.env.REVENUECAT_WEBHOOK_TOKEN && auth !== `Bearer ${process.env.REVENUECAT_WEBHOOK_TOKEN}`) {
    return reply.code(401).send({ error: "yetkisiz" });
  }
  const ev = req.body?.event || {};
  const uid = ev.app_user_id;
  const ACTIVE = ["INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION", "NON_RENEWING_PURCHASE"];
  const INACTIVE = ["EXPIRATION", "CANCELLATION", "SUBSCRIPTION_PAUSED", "BILLING_ISSUE"];
  if (uid) {
    if (ACTIVE.includes(ev.type)) await setPremium(uid, true, ev.expiration_at_ms ? new Date(ev.expiration_at_ms).toISOString() : null);
    else if (INACTIVE.includes(ev.type)) await setPremium(uid, false, null);
  }
  app.log.info({ type: ev.type, uid }, "revenuecat webhook");
  return reply.code(200).send({ received: true });
});

// Hesabı sil (Apple 5.1.1 zorunlu). Supabase kullanıcısı + bağlı veriler (FK cascade) silinir.
app.post("/account/delete", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  mm.leave(userId);
  leaveRoom(userId);
  const s = supa();
  if (s) {
    try { await s.auth.admin.deleteUser(userId); }
    catch (e) { return reply.code(500).send({ error: String(e.message || e) }); }
  }
  return { ok: true };
});

// LiveKit webhook
app.post("/livekit/webhook", async (req, reply) => {
  const event = req.body || {};
  app.log.info({ type: event.event, room: event.room?.name, participant: event.participant?.identity }, "livekit webhook");
  return reply.code(200).send({ received: true });
});

const PORT = parseInt(process.env.PORT || "3000", 10);
mm.startSweeper();
mod.loadBlocks().catch(() => {});
app.listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`Sunucu http://localhost:${PORT} üzerinde çalışıyor`))
  .catch((err) => { app.log.error(err); process.exit(1); });
