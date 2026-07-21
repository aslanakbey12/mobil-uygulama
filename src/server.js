// Sesli tartışma odaları — eşleştirme + LiveKit token + moderasyon servisi.
// Kimlik: Supabase JWT (üretim) ya da dev yedeği (userId body/query/header).
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import * as mm from "./matchmaking.js";
import * as mod from "./moderation.js";
import * as sockets from "./sockets.js";
import * as league from "./league.js";
import * as game from "./game.js";
import * as voiceroom from "./voiceroom.js";
import * as reading from "./reading.js";
import * as images from "./images.js";
import * as chatAI from "./chat_ai.js";

// Sesli tur odası klipleri ikili (binary) gelir — Fastify'a parser tanıt
voiceroom.setBroadcaster((roomName, members, payload) => {
  for (const m of members) sockets.push(m.userId, payload);
});
import { mintToken, livekitConfigured } from "./token.js";
import { getUserId, authConfigured, verifyToken, tokenFromReq } from "./auth.js";
import { supaConfigured, supa } from "./supabase.js";
import { isPremium, setPremium } from "./entitlements.js";
import { canEnterRoom, recordRoomEntry, roomsUsedToday, freeDailyLimit } from "./quota.js";
import { pickTopic } from "./topics.js";
import { getRoom, roomStats, leaveRoom, createHostedRoom, getRoomByCode, addMember, createAiRoom } from "./rooms.js";

const app = Fastify({ logger: true });

// WebSocket eklentisi (anlık eşleşme + odadan çıkarma bildirimi)
app.register(websocket);

// Sesli klip yüklemesi için ikili (binary) gövde ayrıştırıcı
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (req, body, done) => done(null, body));
app.addContentTypeParser(/^audio\//, { parseAs: "buffer" }, (req, body, done) => done(null, body));

// Her istekte Supabase token'ını (varsa) doğrula → req.authUserId. getUserId bunu okur.
app.addHook("onRequest", async (req) => {
  const t = tokenFromReq(req);
  if (t) req.authUserId = await verifyToken(t);
});

function clientRoom(room) {
  return {
    name: room.name, level: room.level, mode: room.mode || "voice", topic: room.topic,
    focusWords: room.focusWords || [],
    ai: room.ai ? { name: room.ai.name } : undefined,
    members: room.members.map((m) => ({ name: m.name })), size: room.members.length
  };
}

// Kelime Casusu: odadaki herkese kişiye özel oyun durumunu yayınla (roller gizli)
function broadcastGame(room) {
  const g = game.getGame(room.name);
  if (!g) return;
  const names = {};
  for (const m of room.members) names[m.userId] = m.name;
  for (const m of room.members) sockets.push(m.userId, { type: "game", state: game.stateFor(g, m.userId, names) });
}

// Sesli tur odası durumunu odadaki herkese yayınla
function broadcastVoice(room) {
  const vr = voiceroom.getVoiceRoom(room.name);
  if (!vr) return;
  for (const m of room.members) sockets.push(m.userId, { type: "vr_state", state: voiceroom.stateFor(vr) });
}

// Oyun botlarını sürükle: bot anlatıcıysa ipucu versin, insan ipucundan sonra bot tahmin etsin.
function driveGameBots(room) {
  const step = () => {
    const g = game.getGame(room.name);
    if (!g || g.status !== "playing") return;
    const r = game.botTick(g);
    if (r && r.acted) { broadcastGame(room); setTimeout(step, 1500); }
  };
  setTimeout(step, 1500);
}

// Yazılı odada bot(lar) canlandırma mesajı atsın (oda ölü durmasın).
const BOT_LINES = ["Hi! Ready to practice? 🙂", "Let's discuss the topic in English!", "What do you think about it?"];
function seedBotChat(room) {
  const bots = room.members.filter((m) => m.bot);
  bots.slice(0, 2).forEach((bot, i) => {
    setTimeout(() => {
      const cur = getRoom(room.name);
      if (!cur || !cur.members.some((m) => m.userId === bot.userId)) return;
      const payload = { type: "chat", from: bot.userId, name: bot.name, text: BOT_LINES[i % BOT_LINES.length], ts: Date.now() };
      for (const m of cur.members) sockets.push(m.userId, payload);
    }, 1600 + i * 2600);
  });
}

// Oda kurulunca eşleşen herkese anlık "matched" bildir (+ moda göre kur & botları sürükle)
mm.onMatch((room) => {
  // Yazılı odada bot varsa (gerçek eşleşme bulunamadı) → gerçek AI sohbetine çevir
  if (room.mode === "text") {
    const bot = room.members.find((m) => m.bot);
    if (bot && chatAI.chatConfigured()) {
      room.ai = { name: bot.name, id: bot.userId };
      room.aiHistory = [];
    }
  }
  if (room.mode === "game") game.createGame(room);
  if (room.mode === "voice") voiceroom.createVoiceRoom(room);
  for (const m of room.members) sockets.push(m.userId, { type: "matched", room: clientRoom(room) });
  if (room.mode === "game") { broadcastGame(room); driveGameBots(room); }
  if (room.mode === "voice") { broadcastVoice(room); voiceroom.maybeBotTurn(voiceroom.getVoiceRoom(room.name)); }
  if (room.mode === "text") {
    if (room.ai) {
      const human = room.members.find((m) => !m.bot);
      chatAI.generateOpener(room.focusWords, room.level, room.ai.name)
        .then((op) => {
          if (!op || !getRoom(room.name) || !human) return;
          room.aiHistory.push({ mine: false, text: op });
          sockets.push(human.userId, { type: "chat", from: room.ai.id, name: room.ai.name, text: op, ts: Date.now(), ai: true });
        })
        .catch(() => {});
    } else {
      seedBotChat(room);  // AI yapılandırılmamışsa eski hazır mesajlar (yazılıda artık bot yok → no-op)
    }
  }
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
        // AI odasıysa: geçmişi güncelle + AI yanıtı üret, "yazıyor…" göster, sonra push
        if (room.ai && chatAI.chatConfigured()) {
          room.aiHistory = room.aiHistory || [];
          room.aiHistory.push({ mine: true, text });
          sockets.push(userId, { type: "typing", name: room.ai.name });
          chatAI.generateReply(room.aiHistory, room.focusWords, room.level, room.ai.name)
            .then((reply) => {
              if (!reply || !getRoom(room.name)) return; // oda kapandıysa geç
              room.aiHistory.push({ mine: false, text: reply });
              if (room.aiHistory.length > 20) room.aiHistory = room.aiHistory.slice(-20);
              sockets.push(userId, { type: "chat", from: room.ai.id, name: room.ai.name, text: reply, ts: Date.now(), ai: true });
            })
            .catch(() => sockets.push(userId, { type: "typing_stop" }));
        }
        return;
      }

      // Kelime Casusu
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
        if (msg.type === "game_clue") r = game.giveClue(g, userId, msg.word, msg.number);
        else if (msg.type === "game_guess") r = game.guess(g, userId, msg.index);
        else return;
        if (r && r.error) { sockets.push(userId, { type: "game_error", error: r.error }); return; }
        broadcastGame(room);
        driveGameBots(room); // insan aksiyonundan sonra botlar oynasın
        return;
      }

      // Sesli tur odası
      if (room.mode === "voice") {
        const vr = voiceroom.getVoiceRoom(room.name) || voiceroom.createVoiceRoom(room);
        if (msg.type === "vr_join") {
          sockets.push(userId, { type: "vr_state", state: voiceroom.stateFor(vr) });
          return;
        }
        if (msg.type === "vr_pass") {
          const r = voiceroom.passTurn(vr, userId);
          if (r && r.error) sockets.push(userId, { type: "vr_error", error: r.error });
          return;
        }
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
  reading: reading.readingConfigured(),
  queues: mm.queueStats(),
  rooms: roomStats(),
  sockets: sockets.count(),
  moderation: mod.moderationStats(),
  league: league.leagueStats()
}));

// Okuma: kullanıcının öğrenme kelimelerinden seviyesine uygun parça + sorular üret
app.post("/reading/generate", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  if (!reading.readingConfigured()) return reply.code(503).send({ error: "Okuma servisi yakında etkinleşecek." });
  if (!reading.underDailyCap(userId)) return reply.code(429).send({ error: "Bugünlük okuma hakkın doldu, yarın tekrar dene." });
  const { level, words, knownSample, topic } = req.body || {};
  const list = Array.isArray(words) ? [...new Set(words.filter(Boolean).map(String))].slice(0, 8) : [];
  const known = Array.isArray(knownSample) ? knownSample.filter(Boolean).map(String).slice(0, 15) : [];
  const theme = String(topic || "").slice(0, 60);
  if (list.length < 1) return reply.code(400).send({ error: "Yeterli kelime yok. Önce Kelimeler'de birkaç kelime çalış." });
  try {
    const passage = await reading.generatePassage(level || "B1", list, { knownSample: known, topic: theme });
    reading.bumpDaily(userId);
    return { passage };
  } catch (e) {
    return reply.code(502).send({ error: String(e.message || e) });
  }
});

// Hafıza kancası: bir kelime için akılda tutmayı kolaylaştıran kısa Türkçe ipucu üret
app.post("/word/mnemonic", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  if (!reading.readingConfigured()) return reply.code(503).send({ error: "AI servisi yakında etkinleşecek." });
  const { en, tr } = req.body || {};
  if (!en) return reply.code(400).send({ error: "kelime gerekli" });
  try {
    const mnemonic = await reading.generateMnemonic(String(en).slice(0, 40), String(tr || "").slice(0, 80));
    return { mnemonic };
  } catch (e) {
    return reply.code(502).send({ error: String(e.message || e) });
  }
});

// Kelime fotoğrafı oyu (👍/👎) — beğenilen foto herkes için öne çıkar, beğenilmeyen elenir
app.post("/word/image/rate", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const { en, url, up } = req.body || {};
  if (!en || !url) return reply.code(400).send({ error: "en ve url gerekli" });
  return images.rateWordImage(String(en).slice(0, 60), String(url).slice(0, 500), !!up);
});

// Okuma kalite geri bildirimi (👍/👎) — çok olumsuz alan parça önbellekten silinir
app.post("/reading/rate", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const { key, up } = req.body || {};
  if (!key) return reply.code(400).send({ error: "key gerekli" });
  const r = reading.rateReading(String(key).slice(0, 160), !!up);
  return { ok: true, ...r };
});

// Kişiselleştirilmiş örnek cümle (seviye + ilgi/motive bağlamına göre; profil-önbellekli)
app.post("/word/example", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  if (!reading.readingConfigured()) return reply.code(503).send({ error: "AI servisi yakında etkinleşecek." });
  const { en, tr, level, context } = req.body || {};
  if (!en) return reply.code(400).send({ error: "kelime gerekli" });
  try {
    const example = await reading.generateExample(String(en).slice(0, 40), String(tr || "").slice(0, 80), String(level || "B1"), String(context || "").slice(0, 40));
    return { example };
  } catch (e) {
    return reply.code(502).send({ error: String(e.message || e) });
  }
});

// Kelime görseli (Pexels) — dual coding. Kelime bazında önbellekli.
app.post("/word/image", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  if (!images.imagesConfigured()) return reply.code(503).send({ error: "Görsel servisi yakında." });
  const { en } = req.body || {};
  if (!en) return reply.code(400).send({ error: "kelime gerekli" });
  try {
    const image = await images.fetchWordImage(String(en).slice(0, 40));
    return { image };
  } catch (e) {
    return reply.code(502).send({ error: String(e.message || e) });
  }
});

// Haftalık lig: kullanıcının haftalık XP'sini bildir, pod sıralamasını al
app.post("/league/sync", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const { name, weeklyXp, level } = req.body || {};
  return league.sync({ userId, name, weeklyXp, level });
});

// Sesli tur odası: sıra gelen konuşan klibini yükler → herkese oynatılır, sıra döner
app.post("/voiceroom/clip", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const roomName = req.query?.room;
  const room = getRoom(roomName);
  if (!room || room.mode !== "voice") return reply.code(404).send({ error: "oda bulunamadı" });
  if (!room.members.some((m) => m.userId === userId)) return reply.code(403).send({ error: "erişim yok" });
  const buf = req.body;
  if (!buf || !buf.length) return reply.code(400).send({ error: "ses verisi yok" });
  const clipId = voiceroom.putClip(buf, req.headers["content-type"] || "audio/m4a");
  const durationMs = parseInt(req.headers["x-duration-ms"] || "3000", 10);
  const vr = voiceroom.getVoiceRoom(roomName);
  const r = voiceroom.onClip(vr, userId, clipId, durationMs);
  if (r.error) return reply.code(409).send({ error: r.error });
  return { ok: true, clipId };
});

// Klibi indir (oynatmak için) — kısa ömürlü, tahmin edilemez id
app.get("/voiceroom/clip/:id", async (req, reply) => {
  const c = voiceroom.getClip(req.params.id);
  if (!c) return reply.code(404).send({ error: "klip bulunamadı" });
  reply.header("content-type", c.contentType);
  reply.header("cache-control", "no-store");
  return reply.send(c.buf);
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

// AI konuşma partneri odası (AÇIK): kullanıcının seçtiği kelimelerle AI sohbet başlatır.
const AI_BOT_NAMES = ["Alex", "Emma", "Leo", "Mia", "Sam", "Nora", "Kai", "Lucy"];
app.post("/rooms/ai", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  if (!chatAI.chatConfigured()) return reply.code(503).send({ error: "AI sohbet yakında etkinleşecek." });
  const { level, name, words } = req.body || {};
  const focusWords = Array.isArray(words) ? [...new Set(words.filter(Boolean).map(String))].slice(0, 4) : [];
  const botName = AI_BOT_NAMES[Math.floor(Math.random() * AI_BOT_NAMES.length)];
  const room = createAiRoom({ user: { userId, name: name || "Sen" }, level: level || "B1", focusWords, botName });
  let opener = "";
  try { opener = await chatAI.generateOpener(focusWords, level || "B1", botName); } catch (_) {}
  room.aiHistory = opener ? [{ mine: false, text: opener }] : [];
  return {
    room: { name: room.name, level: room.level, mode: "text", focusWords: room.focusWords, ai: { name: botName }, members: [{ name: name || "Sen" }], size: 1 },
    opener: opener ? { name: botName, text: opener } : null,
  };
});

// Sohbet sonrası ders özeti (AI): kullanılan hedef kelimeler + düzeltmeler + övgü
app.post("/chat/recap", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  if (!chatAI.chatConfigured()) return { recap: null };
  const { messages, words, level } = req.body || {};
  const msgs = Array.isArray(messages) ? messages.slice(-20) : [];
  if (!msgs.some((m) => m && m.mine)) return { recap: null }; // öğrenci hiç yazmamış
  try {
    const recap = await chatAI.generateRecap(msgs, Array.isArray(words) ? words : [], String(level || "B1"));
    return { recap };
  } catch (e) {
    return { recap: null }; // özet üretilemedi → çıkışı bloklama, sessizce geç
  }
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

// ── 👥 Arkadaş sistemi (basit kodla-ekle; onay yok) ──────────────────
function genFriendCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // karışan harfler (I/O/0/1) yok
  let s = ""; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

// Kalıcı arkadaş kodunu al/oluştur (+ görünen adı güncelle)
app.post("/friends/code", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return reply.code(503).send({ error: "Arkadaş sistemi yakında." });
  const name = String(req.body?.name || "").slice(0, 40);
  const { data: ex } = await db.from("friend_codes").select("code").eq("user_id", userId).maybeSingle();
  if (ex?.code) { await db.from("friend_codes").update({ name }).eq("user_id", userId); return { code: ex.code, name }; }
  let code;
  for (let i = 0; i < 8; i++) {
    code = genFriendCode();
    const { data: taken } = await db.from("friend_codes").select("user_id").eq("code", code).maybeSingle();
    if (!taken) break;
  }
  await db.from("friend_codes").insert({ user_id: userId, code, name });
  return { code, name };
});

// Kodla arkadaş ekle (çift yönlü yazılır)
app.post("/friends/add", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return reply.code(503).send({ error: "Arkadaş sistemi yakında." });
  const code = String(req.body?.code || "").trim().toUpperCase();
  if (!code) return reply.code(400).send({ error: "kod gerekli" });
  const { data: fc } = await db.from("friend_codes").select("user_id, name").eq("code", code).maybeSingle();
  if (!fc) return reply.code(404).send({ error: "Bu kod bulunamadı." });
  if (fc.user_id === userId) return reply.code(400).send({ error: "Kendini ekleyemezsin 🙂" });
  if (mod.areBlocked(userId, fc.user_id)) return reply.code(403).send({ error: "Bu kullanıcıyla bağlantı kurulamıyor." });
  await db.from("friendships").upsert([
    { user_id: userId, friend_id: fc.user_id },
    { user_id: fc.user_id, friend_id: userId },
  ], { onConflict: "user_id,friend_id", ignoreDuplicates: true });
  return { friend: { id: fc.user_id, name: fc.name || "Arkadaş" } };
});

// Arkadaş listesi (adlarıyla)
app.get("/friends", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return { friends: [] };
  const { data: rows } = await db.from("friendships").select("friend_id").eq("user_id", userId);
  const ids = (rows || []).map(r => r.friend_id);
  if (!ids.length) return { friends: [] };
  const { data: names } = await db.from("friend_codes").select("user_id, name").in("user_id", ids);
  const nameOf = Object.fromEntries((names || []).map(n => [n.user_id, n.name]));
  return { friends: ids.map(id => ({ id, name: nameOf[id] || "Arkadaş" })) };
});

// Arkadaşı çıkar (çift yönlü)
app.post("/friends/remove", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return reply.code(503).send({ error: "yok" });
  const fid = String(req.body?.friendId || "");
  if (!fid) return reply.code(400).send({ error: "friendId gerekli" });
  await db.from("friendships").delete().eq("user_id", userId).eq("friend_id", fid);
  await db.from("friendships").delete().eq("user_id", fid).eq("friend_id", userId);
  return { ok: true };
});

// Arkadaşı engelle: arkadaşlığı sil + kalıcı engel (davet/ekleme/eşleşme kapanır)
app.post("/friends/block", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const fid = String(req.body?.friendId || "");
  if (!fid) return reply.code(400).send({ error: "friendId gerekli" });
  mod.block(userId, fid);   // kalıcı engel (bellek + blocks tablosu) — areBlocked her yerde kontrol eder
  const db = supa();
  if (db) {
    await db.from("friendships").delete().eq("user_id", userId).eq("friend_id", fid);
    await db.from("friendships").delete().eq("user_id", fid).eq("friend_id", userId);
  }
  return { ok: true };
});

// Arkadaşı odaya davet et: oda kur + davet kaydı (karşı taraf Sosyal'de görür)
app.post("/friends/invite", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return reply.code(503).send({ error: "Arkadaş sistemi yakında." });
  const { friendId, name, level, mode } = req.body || {};
  if (!friendId) return reply.code(400).send({ error: "friendId gerekli" });
  if (mod.areBlocked(userId, friendId)) return reply.code(403).send({ error: "Bu kullanıcıya davet gönderilemez." });
  const m = mode === "voice" ? "voice" : "text";
  const topic = pickTopic(level || "B1");
  const room = createHostedRoom({ host: { userId, name: name || "Arkadaşın" }, level: level || "B1", topic, mode: m, focusWords: [] });
  await db.from("room_invites").insert({ to_user: friendId, from_name: name || "Arkadaşın", room_code: room.code, mode: m });
  return { room: { name: room.name, level: room.level, mode: room.mode, topic: room.topic, code: room.code, members: room.members.map(x => ({ name: x.name })), size: room.members.length } };
});

// Bekleyen davetler (son 3 dk) — Sosyal'de banner
app.get("/friends/invites", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return { invites: [] };
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  const { data } = await db.from("room_invites").select("id, from_name, room_code, mode")
    .eq("to_user", userId).gt("created_at", since).order("created_at", { ascending: false }).limit(5);
  return { invites: data || [] };
});

// Daveti temizle (katılınca/reddedince)
app.post("/friends/invites/clear", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return { ok: true };
  const id = req.body?.id;
  if (id) await db.from("room_invites").delete().eq("id", id).eq("to_user", userId);
  else await db.from("room_invites").delete().eq("to_user", userId);
  return { ok: true };
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
