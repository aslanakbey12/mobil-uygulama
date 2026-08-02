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
import * as aiquota from "./aiquota.js";
import { moderateChat } from "./textsafety.js";
import { sendPush } from "./push.js";
import { rateLimited } from "./ratelimit.js";

// AI sohbet sınırları — maliyet + pedagoji (oturumun net bir sonu olsun).
const AI_MAX_TURNS = parseInt(process.env.AI_CHAT_MAX_TURNS || "22", 10);   // tur limiti → sonra ders özeti
const AI_MIN_GAP_MS = parseInt(process.env.AI_CHAT_MIN_GAP_MS || "1500", 10); // spam koruması
const INVITE_TTL_MIN = parseInt(process.env.INVITE_TTL_MIN || "30", 10);   // oda daveti ömrü (dk)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;   // DM filtre enjeksiyonuna karşı

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
import { getRoom, roomStats, leaveRoom, createHostedRoom, getRoomByCode, addMember, createAiRoom, onRoomClose } from "./rooms.js";

// Logger: istek URL'lerindeki token/access_token query paramlarını REDAKTE et.
// (WS ve klip indirme token'ı query ile geçiyor → düz loglanırsa kısa ömürlü de olsa sızar.)
const app = Fastify({
  logger: {
    serializers: {
      req(req) {
        const url = String(req.url || "").replace(/([?&](?:token|access_token)=)[^&]*/gi, "$1[REDACTED]");
        return { method: req.method, url, hostname: req.hostname, remoteAddress: req.ip };
      },
    },
  },
});

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
        .catch(() => chatAI.fallbackOpener(room.focusWords, room.ai.name))   // AI yoksa boş odaya düşme
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
    // GÜVENLİK: yalnız getUserId'ye güven. Strict modda bu, doğrulanmamış query userId'ye
    // DÜŞMEZ (eski `|| req.query.userId` yedeği AUTH_STRICT'i baypas edip kimlik taklidine izin veriyordu).
    const userId = getUserId(req);
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
        const raw = String(msg.text).slice(0, 500).trim();
        if (!raw) return;
        // İçerik güvenliği: küfür maskele; ağır uygunsuzlukta mesajı hiç iletme.
        const modres = moderateChat(raw);
        if (modres.blocked) { sockets.push(userId, { type: "chat_blocked", reason: "Mesaj topluluk kurallarına uymadığı için gönderilmedi." }); return; }
        const text = modres.clean;
        const payload = { type: "chat", from: userId, name: me.name, text, ts: Date.now() };
        for (const m of room.members) sockets.push(m.userId, payload);
        // AI odasıysa: geçmişi güncelle + AI yanıtı üret, "yazıyor…" göster, sonra push
        if (room.ai && chatAI.chatConfigured()) {
          room.aiHistory = room.aiHistory || [];
          room.aiHistory.push({ mine: true, text });
          room.aiTurns = (room.aiTurns || 0) + 1;

          // TUR LİMİTİ: sohbet sonsuza kadar sürmesin. Hem maliyet kontrolü hem PEDAGOJİ —
          // oturumun net bir sonu olur, kullanıcı enerjisi yüksekken biter ve ders özeti
          // (recap) ödül gibi gelir. Limit dolunca kapanış mesajı + özet sinyali gönderilir.
          if (room.aiTurns > AI_MAX_TURNS) {
            sockets.push(userId, { type: "typing_stop" });
            sockets.push(userId, {
              type: "chat", from: room.ai.id, name: room.ai.name, ai: true, ts: Date.now(),
              text: "That was a great conversation! Let's stop here and look at what you did well. 👏",
            });
            sockets.push(userId, { type: "ai_session_end", reason: "turn_limit" });
            return;
          }

          // Hız sınırı: script/spam ile saniyede onlarca AI çağrısı yapılmasın.
          // (/ws global IP limitinden muaf olduğu için bu koruma burada gerekli.)
          // NOT: Bu yol da artık SESSİZ değil — kullanıcı neden cevap gelmediğini görür.
          const nowMs = Date.now();
          if (room.aiLastCall && nowMs - room.aiLastCall < AI_MIN_GAP_MS) {
            room.aiTurns = Math.max(0, room.aiTurns - 1);   // sayılmayan mesaj turu yakmasın
            sockets.push(userId, { type: "typing_stop" });
            sockets.push(userId, {
              type: "chat", from: room.ai.id, name: room.ai.name, ai: true, ts: Date.now(),
              text: "One moment — I'm still reading your last message! 🙂",
            });
            return;
          }
          room.aiLastCall = nowMs;

          // Günlük AI kotası aşıldıysa yanıt üretme (maliyet koruması) ama kullanıcıyı
          // sessizlikte bırakma — ne olduğunu söyle.
          if (!aiquota.underAiCap(userId)) {
            room.aiTurns = Math.max(0, room.aiTurns - 1);
            sockets.push(userId, { type: "typing_stop" });
            sockets.push(userId, {
              type: "chat", from: room.ai.id, name: room.ai.name, ai: true, ts: Date.now(),
              text: "We've practiced a lot today! Let's continue tomorrow. 👋",
            });
            sockets.push(userId, { type: "ai_session_end", reason: "quota" });
            return;
          }
          sockets.push(userId, { type: "typing", name: room.ai.name });

          // Cevabı GARANTİ et: model boş dönerse/hata verirse yerel yedek gönderilir.
          // Eskiden bu yollarda yalnızca "typing_stop" gidiyordu → kullanıcı "yazıyor…"
          // görüp sonra hiçbir şey almıyordu ve sohbet sessizce ölüyordu.
          const sendReply = ({ reply, suggestions, fallback }) => {
            if (!getRoom(room.name)) return;              // oda kapandı → geç
            if (fallback) room.aiTurns = Math.max(0, room.aiTurns - 1);  // başarısız tur sayılmasın
            else {
              aiquota.bumpAi(userId);                     // kota SADECE başarılı cevapta yanar
              room.aiHistory.push({ mine: false, text: reply });
              if (room.aiHistory.length > 20) room.aiHistory = room.aiHistory.slice(-20);
            }
            sockets.push(userId, { type: "typing_stop" });
            sockets.push(userId, {
              type: "chat", from: room.ai.id, name: room.ai.name, text: reply, ts: Date.now(), ai: true,
              suggestions,                                   // 💡 dokunulabilir cevap önerileri
              turnsLeft: Math.max(0, AI_MAX_TURNS - room.aiTurns),
            });
          };

          chatAI.generateReply(room.aiHistory, room.focusWords, room.level, room.ai.name)
            .then((r) => {
              if (r && r.reply) sendReply(r);
              else sendReply(chatAI.fallbackReply(room.focusWords, room.aiTurns));
            })
            .catch(() => sendReply(chatAI.fallbackReply(room.focusWords, room.aiTurns)));
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
          const me = room.members.find((m) => m.userId === userId);
          voiceroom.ensureMember(vr, { userId, name: me?.name });  // özel odada sonradan gelen sıraya eklensin
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

// CORS. Üretimde CORS_ORIGINS env'iyle origin kısıtlanır (ör. Netlify web adresi);
// ayarlanmazsa "*" (mobil uygulama zaten Origin başlığı göndermez).
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()).filter(Boolean);
app.addHook("onRequest", async (req, reply) => {
  const origin = req.headers.origin;
  let allow = "*";
  if (!CORS_ORIGINS.includes("*")) {
    allow = origin && CORS_ORIGINS.includes(origin) ? origin : CORS_ORIGINS[0];
    reply.header("Vary", "Origin");
  }
  reply.header("Access-Control-Allow-Origin", allow);
  reply.header("Access-Control-Allow-Headers", "content-type,authorization,x-user-id");
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { reply.code(204).send(); return; }
  // Global flood koruması (IP başına, cömert eşik). /health (warmup) ve /ws (yeniden bağlanma) muaf.
  const u = req.url || "";
  if (!u.startsWith("/health") && !u.startsWith("/ws")) {
    if (rateLimited(req.ip)) return reply.code(429).send({ error: "Çok fazla istek. Lütfen biraz sonra tekrar dene." });
  }
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
  league: league.leagueStats(),
  // Sistem geneli günlük YZ harcaması — freni izleyebilelim (kaç/tavan)
  ai: aiquota.globalUsage()
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
  if (!aiquota.underAiCap(userId)) return reply.code(429).send({ error: "Bugünlük AI hakkın doldu, yarın tekrar dene." });
  const { en, tr } = req.body || {};
  if (!en) return reply.code(400).send({ error: "kelime gerekli" });
  aiquota.bumpAi(userId);
  try {
    const mnemonic = await reading.generateMnemonic(String(en).slice(0, 40), String(tr || "").slice(0, 80));
    return { mnemonic };
  } catch (e) {
    return reply.code(502).send({ error: String(e.message || e) });
  }
});

// Kelime kartçığı çevirisi: İngilizce tanım + örnek cümle → Türkçe.
// Kullanıcı alıştırmada kartçığa dokununca Türkçesini görür. Sunucuda kalıcı önbellek →
// aynı kelime tüm kullanıcılar için bir kez çevrilir. Ayrı (yüksek) kota kullanır.
app.post("/word/translate", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  if (!reading.readingConfigured()) return reply.code(503).send({ error: "AI servisi yakında etkinleşecek." });
  if (!aiquota.underTranslateCap(userId)) return reply.code(429).send({ error: "Bugünlük çeviri hakkın doldu, yarın tekrar dene." });
  const { en, definition, example } = req.body || {};
  if (!en) return reply.code(400).send({ error: "kelime gerekli" });
  aiquota.bumpTranslate(userId);
  try {
    const tr = await reading.translateWordCard(String(en).slice(0, 40), definition, example);
    return { tr };
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
  return images.rateWordImage(String(en).slice(0, 60), String(url).slice(0, 500), !!up, userId);
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
  if (!aiquota.underAiCap(userId)) return reply.code(429).send({ error: "Bugünlük AI hakkın doldu, yarın tekrar dene." });
  const { en, tr, level, context } = req.body || {};
  if (!en) return reply.code(400).send({ error: "kelime gerekli" });
  aiquota.bumpAi(userId);
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
  const { en, tr, definition } = req.body || {};
  if (!en) return reply.code(400).send({ error: "kelime gerekli" });
  const word = String(en).slice(0, 40);
  try {
    // AI'ya bir kez sor: fotoğraflanabilir mi + doğru arama terimi ne?
    // (Önbellekli; AI yoksa/hata verirse eski davranışa — ham kelimeyle arama — düşülür.)
    let q = null;
    if (reading.readingConfigured()) {
      try {
        const iq = await reading.imageQueryFor(word, tr, definition);
        // Soyut/işlev kelimesi → alakasız foto göstermektense HİÇ gösterme.
        if (!iq.depictable) return { image: { photos: [], depictable: false } };
        q = iq.query;
      } catch (_) { /* AI erişilemedi → ham kelimeyle devam */ }
    }
    const image = await images.fetchWordImage(word, q);
    return { image: { ...image, depictable: true } };
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
  const clipId = voiceroom.putClip(buf, req.headers["content-type"] || "audio/m4a", roomName);
  const durationMs = parseInt(req.headers["x-duration-ms"] || "3000", 10);
  const vr = voiceroom.getVoiceRoom(roomName);
  const r = voiceroom.onClip(vr, userId, clipId, durationMs);
  if (r.error) return reply.code(409).send({ error: r.error });
  return { ok: true, clipId };
});

// Klibi indir (oynatmak için) — kısa ömürlü, tahmin edilemez id.
// GÜVENLİK: yalnız klibin ait olduğu odanın üyesi indirebilir (ses kaydı mahremiyeti).
// İstemci token'ı query ile geçer (?token= / ?userId=) → onRequest hook doğrular.
app.get("/voiceroom/clip/:id", async (req, reply) => {
  const c = voiceroom.getClip(req.params.id);
  if (!c) return reply.code(404).send({ error: "klip bulunamadı" });
  if (c.room) {
    const userId = getUserId(req);
    const room = getRoom(c.room);
    if (!userId || !room || !room.members.some((m) => m.userId === userId)) {
      return reply.code(403).send({ error: "erişim yok" });
    }
  }
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

// Kendi odanı kur (eşleştirme beklemeden), davet kodu al.
// Ücretsiz kullanıcı günde freeDailyLimit() oda kurabilir; premium sınırsız → arkadaşla oynama herkese açık.
app.post("/rooms/create", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const premium = await isPremium(userId);
  if (!premium && !canEnterRoom(userId)) {
    return reply.code(402).send({ error: "limit", message: `Ücretsiz planda günde ${freeDailyLimit()} oda kurabilirsin. Premium ile sınırsız.`, upgrade: true });
  }
  const { level, name, mode, pool } = req.body || {};
  const topic = pickTopic(level || "B1");
  // Oda kurulunca ORTAK kelime YOK (arkadaş henüz gelmedi) → focusWords boş.
  // Kuran kişinin havuzunu sakla; arkadaş katılınca kesişim hesaplanır.
  const room = createHostedRoom({ host: { userId, name }, level: level || "B1", topic, mode, focusWords: [] });
  room.hostPool = Array.isArray(pool) ? [...new Set(pool.filter(Boolean).map((x) => String(x).toLowerCase()))] : [];
  // Oyun modu: ızgara kelimeleri için havuz listesi (kuran + katılanların havuzları)
  room.memberPools = [{ userId, name, pool: Array.isArray(pool) ? pool : [] }];
  if (!premium) recordRoomEntry(userId);   // ücretsiz günlük oda sayacı
  return { room: { name: room.name, level: room.level, mode: room.mode, topic: room.topic, focusWords: [], code: room.code, members: room.members.map(m => ({ name: m.name })), size: room.members.length } };
});

// AI konuşma partneri odası (AÇIK): kullanıcının seçtiği kelimelerle AI sohbet başlatır.
const AI_BOT_NAMES = ["Alex", "Emma", "Leo", "Mia", "Sam", "Nora", "Kai", "Lucy"];
app.post("/rooms/ai", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  if (!chatAI.chatConfigured()) return reply.code(503).send({ error: "AI sohbet yakında etkinleşecek." });
  if (!aiquota.underAiCap(userId)) return reply.code(429).send({ error: "Bugünlük AI hakkın doldu, yarın tekrar dene." });
  aiquota.bumpAi(userId);
  const { level, name, words } = req.body || {};
  const focusWords = Array.isArray(words) ? [...new Set(words.filter(Boolean).map(String))].slice(0, 4) : [];
  const botName = AI_BOT_NAMES[Math.floor(Math.random() * AI_BOT_NAMES.length)];
  const room = createAiRoom({ user: { userId, name: name || "Sen" }, level: level || "B1", focusWords, botName });
  let opener = "";
  try { opener = await chatAI.generateOpener(focusWords, level || "B1", botName); }
  catch (_) { opener = chatAI.fallbackOpener(focusWords, botName); }
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
  if (!aiquota.underAiCap(userId)) return { recap: null };    // günlük AI kotası doldu → sessizce geç
  aiquota.bumpAi(userId);
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
  const { code, name, pool } = req.body || {};
  if (!code) return reply.code(400).send({ error: "code gerekli" });
  const room = getRoomByCode(code);
  if (!room) return reply.code(404).send({ error: "oda bulunamadı veya kapandı" });
  const res = addMember(room, { userId, name });
  if (!res.ok) return reply.code(409).send({ error: res.reason });
  // Arkadaş katıldı → GERÇEK ortak kelimeleri hesapla (kuran havuzu ∩ katılan havuzu)
  const joinPool = Array.isArray(pool) ? new Set(pool.filter(Boolean).map((x) => String(x).toLowerCase())) : new Set();
  const common = (room.hostPool || []).filter((w) => joinPool.has(w)).slice(0, 12);
  room.focusWords = common;
  // Oyun modu: katılanın havuzunu da ızgara için ekle
  if (room.mode === "game") { room.memberPools = room.memberPools || []; room.memberPools.push({ userId, name, pool: Array.isArray(pool) ? pool : [] }); }
  // Kuran kişiye WS ile bildir: ortak kelimeler + arkadaş katıldı → aktiviteye başla
  const cr = { name: room.name, level: room.level, mode: room.mode, topic: room.topic, focusWords: common, code: room.code, members: room.members.map(m => ({ name: m.name })), size: room.members.length };
  for (const m of room.members) {
    sockets.push(m.userId, { type: "room_focus", focusWords: common });
    if (m.userId !== userId) sockets.push(m.userId, { type: "room_start", room: cr }); // lobby'deki kurana
  }
  return { room: cr };
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

// Kullanıcı adı müsait mi? + müsait ÖNERİLER.
//
// NEDEN SUNUCUDA: profiles tablosunda RLS `auth.uid() = id` — istemci başkasının
// satırını okuyamaz, dolayısıyla "alınmış mı" sorusunu cevaplayamaz (her zaman
// "boş" görünür). Sunucu service-role ile RLS'i aştığı için doğru cevabı burası verir.
//
// Gerçek kullanıcı şikâyeti: 4 adımlık profil sihirbazını doldurup EN SONDA
// "kullanıcı adı alınmış" hatası alıyor ve başa atılıyordu. Artık daha ilk adımda
// öğreniyor ve önerilen boş adlardan birine tek dokunuşla geçebiliyor.
app.get("/profile/username-check", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const raw = String(req.query?.u || "").trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(raw)) {
    return { available: false, invalid: true, suggestions: [] };
  }
  const db = supa();
  if (!db) return { available: true, suggestions: [] };   // DB yoksa engelleme

  const lower = raw.toLowerCase();
  // Aday havuzu: istenen ad + sayılı/eklemeli varyantlar. Tek sorguda kontrol edilir.
  const cands = [raw];
  for (let i = 1; i <= 3; i++) cands.push(`${raw}${Math.floor(Math.random() * 90) + 10}`);
  cands.push(`${raw}_${new Date().getFullYear() % 100}`);
  cands.push(`${raw}_tr`);

  const { data } = await db.from("profiles").select("id, username").in("username", cands);
  const takenSet = new Set((data || []).map((r) => String(r.username || "").toLowerCase()));
  // Kendi adın "alınmış" sayılmaz (profilini güncelliyor olabilirsin)
  const mine = (data || []).find((r) => r.id === userId);
  if (mine && String(mine.username || "").toLowerCase() === lower) takenSet.delete(lower);

  const available = !takenSet.has(lower);
  const suggestions = available ? [] : cands.slice(1).filter((c) => !takenSet.has(c.toLowerCase())).slice(0, 3);
  return { available, suggestions };
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

// ── Arkadaşlık İSTEĞİ (kullanıcı adı + onay) ──────────────────────────
// Kullanıcı adıyla istek gönder. Karşı taraf zaten sana istek attıysa OTOMATİK kabul.
app.post("/friends/request", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return reply.code(503).send({ error: "Arkadaş sistemi yakında." });
  const uname = String(req.body?.username || "").trim();
  if (!uname) return reply.code(400).send({ error: "Kullanıcı adı gerekli." });
  // ilike ile büyük/küçük harf duyarsız; LIKE joker karakterlerini (% _ \) escape et.
  const esc = uname.replace(/([\\%_])/g, "\\$1");
  const { data: target } = await db.from("profiles").select("id,username,name").ilike("username", esc).maybeSingle();
  if (!target) return reply.code(404).send({ error: "Bu kullanıcı adı bulunamadı." });
  if (target.id === userId) return reply.code(400).send({ error: "Kendine istek gönderemezsin 🙂" });
  if (mod.areBlocked(userId, target.id)) return reply.code(403).send({ error: "Bu kullanıcıyla bağlantı kurulamıyor." });
  const { data: already } = await db.from("friendships").select("friend_id").eq("user_id", userId).eq("friend_id", target.id).maybeSingle();
  if (already) return reply.code(400).send({ error: "Zaten arkadaşsınız." });
  // Karşı taraf zaten sana istek attıysa → çift yönlü arkadaşlık + istekleri temizle
  const { data: reverse } = await db.from("friend_requests").select("id").eq("from_user", target.id).eq("to_user", userId).maybeSingle();
  if (reverse) {
    await db.from("friendships").upsert([
      { user_id: userId, friend_id: target.id },
      { user_id: target.id, friend_id: userId },
    ], { onConflict: "user_id,friend_id", ignoreDuplicates: true });
    await db.from("friend_requests").delete().eq("from_user", target.id).eq("to_user", userId);
    await db.from("friend_requests").delete().eq("from_user", userId).eq("to_user", target.id);
    return { accepted: true, friend: { id: target.id, name: target.name || target.username } };
  }
  await db.from("friend_requests").upsert({ from_user: userId, to_user: target.id }, { onConflict: "from_user,to_user", ignoreDuplicates: true });
  // Karşı tarafa push: "X sana arkadaşlık isteği gönderdi" (fire-and-forget)
  const { data: mp } = await db.from("profiles").select("name, username").eq("id", userId).maybeSingle();
  const myName = mp?.name || mp?.username || "Biri";
  sendPush(target.id, { title: "👋 Yeni arkadaşlık isteği", body: `${myName} sana arkadaşlık isteği gönderdi.`, data: { screen: "ChatTab" } });
  return { requested: true, to: { name: target.name || target.username } };
});

// Gelen (bekleyen) arkadaşlık istekleri
app.get("/friends/requests", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return { requests: [] };
  const { data: rows } = await db.from("friend_requests").select("from_user, created_at")
    .eq("to_user", userId).order("created_at", { ascending: false }).limit(50);
  const ids = (rows || []).map((r) => r.from_user);
  if (!ids.length) return { requests: [] };
  const { data: profs } = await db.from("profiles").select("id, name, username").in("id", ids);
  const byId = Object.fromEntries((profs || []).map((p) => [p.id, p]));
  return { requests: ids.map((id) => ({ id, name: byId[id]?.name || byId[id]?.username || "Kullanıcı" })) };
});

// İsteği kabul et → çift yönlü arkadaşlık
app.post("/friends/requests/accept", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return reply.code(503).send({ error: "Arkadaş sistemi yakında." });
  const fromId = String(req.body?.fromId || "");
  if (!fromId) return reply.code(400).send({ error: "fromId gerekli" });
  const { data: reqRow } = await db.from("friend_requests").select("id").eq("from_user", fromId).eq("to_user", userId).maybeSingle();
  if (!reqRow) return reply.code(404).send({ error: "İstek bulunamadı (geri çekilmiş olabilir)." });
  if (mod.areBlocked(userId, fromId)) return reply.code(403).send({ error: "Bu kullanıcıyla bağlantı kurulamıyor." });
  await db.from("friendships").upsert([
    { user_id: userId, friend_id: fromId },
    { user_id: fromId, friend_id: userId },
  ], { onConflict: "user_id,friend_id", ignoreDuplicates: true });
  await db.from("friend_requests").delete().eq("from_user", fromId).eq("to_user", userId);
  await db.from("friend_requests").delete().eq("from_user", userId).eq("to_user", fromId);
  const { data: p } = await db.from("profiles").select("name, username").eq("id", fromId).maybeSingle();
  // İsteği gönderene push: "X isteğini kabul etti"
  const { data: mp2 } = await db.from("profiles").select("name, username").eq("id", userId).maybeSingle();
  const myName2 = mp2?.name || mp2?.username || "Arkadaşın";
  sendPush(fromId, { title: "✅ Arkadaşlık kabul edildi", body: `${myName2} arkadaşlık isteğini kabul etti.`, data: { screen: "ChatTab" } });
  return { friend: { id: fromId, name: p?.name || p?.username || "Arkadaş" } };
});

// İsteği reddet (ya da gönderdiğin isteği geri çek)
app.post("/friends/requests/reject", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return { ok: true };
  const fromId = String(req.body?.fromId || "");
  if (fromId) {
    await db.from("friend_requests").delete().eq("from_user", fromId).eq("to_user", userId);   // gelen isteği reddet
    await db.from("friend_requests").delete().eq("from_user", userId).eq("to_user", fromId);   // gönderdiğini geri çek
  }
  return { ok: true };
});

// ── Push token kaydı (Expo Push) ──────────────────────────────────────
app.post("/push/register", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const token = String(req.body?.token || "").trim();
  if (!token.startsWith("ExponentPushToken")) return reply.code(400).send({ error: "geçersiz token" });
  const db = supa();
  if (!db) return { ok: true };
  await db.from("push_tokens").upsert({ user_id: userId, token, updated_at: new Date().toISOString() }, { onConflict: "user_id,token" });
  return { ok: true };
});

// ── İstemci çökme/hata raporu (hafif crash reporting — Sentry'ye kadar sunucu logu) ──
app.post("/client-error", async (req, reply) => {
  const userId = getUserId(req);
  const { message, stack, screen, version } = req.body || {};
  app.log.error({
    userId, screen: String(screen || "").slice(0, 60), version: String(version || "").slice(0, 20),
    message: String(message || "").slice(0, 500), stack: String(stack || "").slice(0, 2000),
  }, "client-error");
  return { ok: true };
});

// Aktiflik nabzı: kullanıcının ilerleme özetini yaz (arkadaşların "aktiflik" görünümü için).
// last_active her çağrıda now() olur → çevrimiçi/son görülme buradan hesaplanır.
app.post("/me/activity", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return { ok: false };
  const b = req.body || {};
  const clamp = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const nowIso = new Date().toISOString();
  await db.from("user_stats").upsert({
    user_id: userId,
    last_active: nowIso,
    streak: clamp(b.streak, 100000),
    xp: clamp(b.xp, 1e9),
    learned: clamp(b.learned, 1e6),
    updated_at: nowIso,
  }, { onConflict: "user_id" });
  return { ok: true };
});

// Arkadaş listesi (adları + aktiflik: son görülme, seri, XP, öğrenilen kelime)
app.get("/friends", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return { friends: [] };
  const { data: rows } = await db.from("friendships").select("friend_id").eq("user_id", userId);
  const ids = (rows || []).map(r => r.friend_id);
  if (!ids.length) return { friends: [] };
  // İsim kaynağı: profiles (name → username). Kullanıcı adı zaten benzersiz ve her hesapta var.
  // avatar: kullanıcının seçtiği emoji (bkz. db/11_avatar.sql). Sütun henüz eklenmemişse
  // sorgu hata verir → avatarsız sürüme düşülür, arkadaş listesi yine çalışır.
  let profs = null;
  try {
    const r = await db.from("profiles").select("id, name, username, avatar").in("id", ids);
    if (!r.error) profs = r.data;
  } catch (_) {}
  if (!profs) {
    const r2 = await db.from("profiles").select("id, name, username").in("id", ids);
    profs = r2.data;
  }
  const byId = Object.fromEntries((profs || []).map(p => [p.id, p]));
  // Aktiflik özeti (service-role → arkadaşların satırlarını okuyabiliriz)
  const { data: stats } = await db.from("user_stats").select("user_id, last_active, streak, xp, learned").in("user_id", ids);
  const statById = Object.fromEntries((stats || []).map(s => [s.user_id, s]));
  const friends = ids.map(id => {
    const st = statById[id] || {};
    return {
      id,
      name: byId[id]?.name || byId[id]?.username || "Arkadaş",
      avatar: byId[id]?.avatar || null,
      lastActive: st.last_active || null,
      streak: st.streak || 0,
      xp: st.xp || 0,
      learned: st.learned || 0,
    };
  });
  // En son aktif olan üstte
  friends.sort((a, b) => (Date.parse(b.lastActive) || 0) - (Date.parse(a.lastActive) || 0));
  return { friends };
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
  // YETKİ: sadece gerçek arkadaşa davet gönderilebilir (rastgele userId'lere davet spam'i engellenir).
  const { data: fr } = await db.from("friendships").select("friend_id").eq("user_id", userId).eq("friend_id", String(friendId)).maybeSingle();
  if (!fr) return reply.code(403).send({ error: "Sadece arkadaş listendekilere davet gönderebilirsin." });
  const m = mode === "voice" ? "voice" : "text";
  const topic = pickTopic(level || "B1");
  const room = createHostedRoom({ host: { userId, name: name || "Arkadaşın" }, level: level || "B1", topic, mode: m, focusWords: [] });
  await db.from("room_invites").insert({ to_user: friendId, from_name: name || "Arkadaşın", room_code: room.code, mode: m });
  sendPush(friendId, { title: "🎧 Oda daveti", body: `${name || "Arkadaşın"} seni İngilizce pratiğe davet etti.`, data: { screen: "ChatTab" } });
  return { room: { name: room.name, level: room.level, mode: room.mode, topic: room.topic, code: room.code, members: room.members.map(x => ({ name: x.name })), size: room.members.length } };
});

// ── ASENKRON ARKADAŞ MESAJLAŞMASI (DM) ───────────────────────────────────────
// Eşzamanlı "odama gel" daveti yerine kalıcı sohbet: arkadaş ne zaman açarsa okur.
// Yalnız gerçek arkadaşlar yazışabilir; her mesaj moderasyondan geçer.
async function areFriends(db, a, b) {
  const { data } = await db.from("friendships").select("friend_id").eq("user_id", a).eq("friend_id", b).maybeSingle();
  return !!data;
}

app.post("/dm/send", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return reply.code(503).send({ error: "Mesajlaşma yakında." });
  const to = String(req.body?.toUserId || "");
  const raw = String(req.body?.text || "").slice(0, 1000).trim();
  if (!to || !raw) return reply.code(400).send({ error: "alıcı ve mesaj gerekli" });
  if (to === userId) return reply.code(400).send({ error: "kendine mesaj gönderemezsin" });
  if (mod.areBlocked(userId, to)) return reply.code(403).send({ error: "Bu kullanıcıya mesaj gönderilemez." });
  if (!(await areFriends(db, userId, to))) return reply.code(403).send({ error: "Sadece arkadaşlarına mesaj gönderebilirsin." });

  // İçerik güvenliği: küfür maskele, ağır uygunsuzlukta hiç kaydetme.
  const m = moderateChat(raw);
  if (m.blocked) return reply.code(400).send({ error: "Mesaj topluluk kurallarına uymadığı için gönderilmedi." });

  const { data, error } = await db.from("dm_messages")
    .insert({ from_user: userId, to_user: to, text: m.clean })
    .select("id, from_user, to_user, text, created_at").single();
  if (error) return reply.code(500).send({ error: "Mesaj kaydedilemedi." });

  const { data: me } = await db.from("profiles").select("name, username").eq("id", userId).maybeSingle();
  const who = me?.name || me?.username || "Arkadaşın";
  sendPush(to, { title: `💬 ${who}`, body: m.clean.slice(0, 120), data: { screen: "ChatTab" } });
  return { message: data };
});

// İki kişi arasındaki sohbet dizisi (en yeniden eskiye çekip istemcide sıralanır).
app.get("/dm/thread", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return { messages: [] };
  const other = String(req.query?.withUserId || "");
  // GÜVENLİK: bu değer aşağıdaki .or() filtre METNİNE gömülüyor. Kullanıcı kontrollü olduğu
  // için doğrulanmadan geçerse PostgREST filtre söz dizimi enjekte edilebilir → UUID şartı.
  if (!UUID_RE.test(other)) return reply.code(400).send({ error: "geçersiz kullanıcı" });
  // Yalnız arkadaşının dizisini okuyabilirsin (yabancının mesajları görünmesin).
  if (!(await areFriends(db, userId, other))) return reply.code(403).send({ error: "Bu kişiyle arkadaş değilsin." });
  const { data } = await db.from("dm_messages")
    .select("id, from_user, to_user, text, created_at, read_at")
    .or(`and(from_user.eq.${userId},to_user.eq.${other}),and(from_user.eq.${other},to_user.eq.${userId})`)
    .order("created_at", { ascending: false }).limit(100);
  const messages = (data || []).reverse();
  // Karşıdan gelenleri okundu işaretle
  await db.from("dm_messages").update({ read_at: new Date().toISOString() })
    .eq("from_user", other).eq("to_user", userId).is("read_at", null);
  return { messages };
});

// Okunmamış mesaj sayıları (arkadaş listesinde rozet).
app.get("/dm/unread", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return { unread: {}, total: 0 };
  const { data } = await db.from("dm_messages")
    .select("from_user").eq("to_user", userId).is("read_at", null).limit(500);
  const unread = {};
  for (const r of data || []) unread[r.from_user] = (unread[r.from_user] || 0) + 1;
  return { unread, total: (data || []).length };
});

// Bekleyen davetler (son 3 dk) — Sosyal'de banner
app.get("/friends/invites", async (req, reply) => {
  const userId = getUserId(req);
  if (!userId) return reply.code(401).send({ error: "kimlik doğrulanamadı" });
  const db = supa();
  if (!db) return { invites: [] };
  // Davet ömrü 3 dk ÇOK KISAYDI: karşı taraf o anda uygulamada değilse davet sessizce
  // ölüyor, davet eden boş odada bekliyordu. 30 dk daha gerçekçi (bildirimi görüp
  // dönmeye zaman tanır). Kalıcı yazışma için asenkron DM var.
  const since = new Date(Date.now() - INVITE_TTL_MIN * 60 * 1000).toISOString();
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
  const rcToken = process.env.REVENUECAT_WEBHOOK_TOKEN;
  // FAIL-CLOSED: token yapılandırılmamışsa DA reddet. (Eskiden token yoksa kontrol atlanıyordu
  // → herkes app_user_id yollayıp kendine/başkasına premium yazabiliyordu.)
  if (!rcToken || auth !== `Bearer ${rcToken}`) {
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

// KALDIRILDI: /livekit/webhook
//
// Sesli Oda LiveKit ile DEĞİL, sıra tabanlı kayıtlı klip mimarisiyle çalışıyor
// (voiceroom.js + /voiceroom/clip + expo-av). LiveKit hiç yapılandırılmadı
// (/health → livekit:false) ve bu webhook hiçbir zaman çağrılmadı.
// Kimlik doğrulaması olmayan TEK uçtu (imza doğrulaması da yoktu): herkes POST
// atıp log şişirebiliyordu. Ölü + korumasız olduğu için kaldırıldı.
// Not: /token ucu duruyor — kimlik doğrulamalı ve zararsız; app tarafında
// api.token() tanımlı ama hiçbir yerden çağrılmıyor.

// Oda kapandığında oyun/ses odası bellek state'ini de temizle (sızıntı önlemi).
onRoomClose((name) => {
  try { game.endGame(name); } catch (e) {}
  try { voiceroom.endVoiceRoom(name); } catch (e) {}
});

const PORT = parseInt(process.env.PORT || "3000", 10);
mm.startSweeper();
mod.loadBlocks().catch(() => {});
app.listen({ port: PORT, host: "0.0.0.0" })
  .then(() => app.log.info(`Sunucu http://localhost:${PORT} üzerinde çalışıyor`))
  .catch((err) => { app.log.error(err); process.exit(1); });
