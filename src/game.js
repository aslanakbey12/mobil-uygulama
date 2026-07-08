// Kelime Dedektifi — Codenames + cümle ipucu (ko-op, MVP).
// Izgara, üyelerin BİLDİĞİ kelimelerden kurulur (ağırlıklı). Sırayla bir "anlatıcı"
// hedef kelimeyi İngilizce cümleyle anlatır (kelimeyi söyleyemez), takım ızgaradan seçer.
const games = new Map(); // roomName -> game

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Üyelerin havuzlarından ızgara kelimeleri: grubun en iyi bildiği (toplam ağırlık) kelimeler.
function buildGridWords(memberPools, size) {
  const score = new Map();
  for (const pool of memberPools) {
    for (const item of (pool || [])) {
      const en = typeof item === "string" ? item : item.en;
      const w = typeof item === "string" ? 1 : (item.w || 0);
      if (!en) continue;
      score.set(en, (score.get(en) || 0) + w);
    }
  }
  const words = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([en]) => en);
  return shuffle([...new Set(words)].slice(0, size));
}

// room.memberPools: [{ userId, name, pool:[{en,w}] }]
export function createGame(room) {
  const pools = (room.memberPools || []).map(m => m.pool);
  const wanted = 25;                                   // 5x5 hedef
  const words = buildGridWords(pools, wanted);
  const n = words.length;
  const targetsTotal = Math.max(3, Math.round(n * 0.36)); // ~9/25
  const idx = shuffle(words.map((_, i) => i));

  const roles = words.map(() => "neutral");
  let t = 0;
  for (const i of idx) { if (t < targetsTotal) { roles[i] = "target"; t++; } }
  for (const i of idx) { if (roles[i] === "neutral") { roles[i] = "assassin"; break; } } // 1 suikastçı

  const order = shuffle((room.members || []).map(m => m.userId));
  const game = {
    room: room.name,
    grid: words.map((en, i) => ({ en, role: roles[i], revealed: false })),
    order,
    describerIdx: 0,
    clue: null,                    // { text }
    targetsTotal,
    found: 0,
    mistakes: 0,
    maxMistakes: 4,
    status: "playing",             // playing | won | lost
    log: [],                       // son olaylar (kısa)
  };
  games.set(room.name, game);
  return game;
}

export function getGame(roomName) { return games.get(roomName) || null; }
export function endGame(roomName) { games.delete(roomName); }

export function describerId(game) { return game.order[game.describerIdx] || null; }

export function giveClue(game, userId, text) {
  if (!game || game.status !== "playing") return { error: "oyun aktif değil" };
  if (describerId(game) !== userId) return { error: "sıra sende değil" };
  const t = String(text || "").trim().slice(0, 200);
  if (!t) return { error: "ipucu boş olamaz" };
  game.clue = { text: t };
  return { ok: true };
}

export function guess(game, userId, index) {
  if (!game || game.status !== "playing") return { error: "oyun aktif değil" };
  if (describerId(game) === userId) return { error: "anlatıcı tahmin edemez" };
  if (!game.clue) return { error: "önce ipucu bekleniyor" };
  const cell = game.grid[index];
  if (!cell || cell.revealed) return { error: "geçersiz kart" };

  cell.revealed = true;
  let result;
  if (cell.role === "assassin") { game.status = "lost"; result = "assassin"; }
  else if (cell.role === "target") {
    game.found++; result = "target";
    if (game.found >= game.targetsTotal) game.status = "won";
  } else {
    game.mistakes++; result = "neutral";
    if (game.mistakes >= game.maxMistakes) game.status = "lost";
  }
  game.log = [{ en: cell.en, result }, ...game.log].slice(0, 6);

  // Basit tur: her tahminden sonra ipucu sıfırlanır, anlatıcı değişir.
  game.clue = null;
  if (game.status === "playing") game.describerIdx = (game.describerIdx + 1) % game.order.length;
  return { ok: true, result, index, en: cell.en, role: cell.role };
}

// Kişiye özel durum: rol bilgisi yalnız anlatıcıya (ve açılmış kartlarda herkese).
export function stateFor(game, userId, names = {}) {
  const isDescriber = describerId(game) === userId;
  return {
    room: game.room,
    grid: game.grid.map((c, i) => ({
      index: i, en: c.en, revealed: c.revealed,
      role: (isDescriber || c.revealed) ? c.role : null,
    })),
    describerId: describerId(game),
    describerName: names[describerId(game)] || "Anlatıcı",
    youAreDescriber: isDescriber,
    clue: game.clue,
    targetsTotal: game.targetsTotal,
    found: game.found,
    mistakes: game.mistakes,
    maxMistakes: game.maxMistakes,
    status: game.status,
    log: game.log,
  };
}
