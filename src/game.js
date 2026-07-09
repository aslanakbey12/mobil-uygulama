// Kelime Dedektifi — Klasik Codenames (2 takım: kırmızı/mavi, sabit roller, kelime+sayı ipucu).
// Izgara üyelerin BİLDİĞİ kelimelerden kurulur. Her takımda 1 spymaster (renkleri görür, ipucu verir)
// + operative(ler) (kartları açar). Roller TÜM OYUN boyunca sabittir.
// AI yok → bot operative kendi ajanını açar, bot spymaster jeton ipucu verir (kelime AI/insanla anlam kazanır).
const games = new Map();
const OTHER = { red: "blue", blue: "red" };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Üyelerin havuzlarından ızgara kelimeleri: grubun en iyi bildiği (toplam ağırlık) kelimeler.
function buildGridWords(memberPools, size) {
  const score = new Map();
  for (const pool of memberPools) for (const item of (pool || [])) {
    const en = typeof item === "string" ? item : item.en;
    const w = typeof item === "string" ? 1 : (item.w || 0);
    if (!en) continue;
    score.set(en, (score.get(en) || 0) + w);
  }
  const words = [...new Set([...score.entries()].sort((a, b) => b[1] - a[1]).map(([en]) => en))];
  return shuffle(words.slice(0, size));
}

export function createGame(room) {
  const pools = (room.memberPools || []).map(m => m.pool);
  const words = buildGridWords(pools, 25);
  const n = words.length;
  const redCount = Math.max(2, Math.round(n * 0.34));  // başlayan takım (25 → ~8-9)
  const blueCount = Math.max(1, redCount - 1);
  const neutral = Math.max(0, n - redCount - blueCount - 1);

  const roleBag = shuffle([
    ...Array(redCount).fill("red"),
    ...Array(blueCount).fill("blue"),
    ...Array(1).fill("assassin"),
    ...Array(neutral).fill("neutral"),
  ]);
  const grid = words.map((en, i) => ({ en, role: roleBag[i] || "neutral", revealed: false, revealedBy: null }));

  // Takımlar: insan(lar) kırmızıda (başlayan takım) spymaster; kalanları 2v2 böl.
  const members = shuffle([...(room.members || [])]);
  const humans = members.filter(m => !m.bot);
  const bots = members.filter(m => m.bot);
  const red = [], blue = [];
  if (humans[0]) red.push(humans[0]);
  for (const m of [...humans.slice(1), ...bots]) (red.length <= blue.length ? red : blue).push(m);

  const spymasterOf = (team) => (team.find(m => !m.bot) || team[0]);
  const rS = spymasterOf(red), bS = spymasterOf(blue);
  const teams = {
    red:  { spymaster: rS.userId, operatives: red.filter(m => m.userId !== rS.userId).map(m => m.userId) },
    blue: { spymaster: bS.userId, operatives: blue.filter(m => m.userId !== bS.userId).map(m => m.userId) },
  };

  const game = {
    room: room.name,
    bots: new Set(members.filter(m => m.bot).map(m => m.userId)),
    names: Object.fromEntries(members.map(m => [m.userId, m.name])),
    grid, teams,
    counts: { red: redCount, blue: blueCount },
    found: { red: 0, blue: 0 },
    turn: "red",          // kırmızı (insan takımı) başlar
    phase: "clue",        // "clue" (spymaster ipucu bekleniyor) | "guess"
    clue: null,           // { word, number, team, remaining }
    status: "playing",    // playing | red_won | blue_won
    log: [],
  };
  games.set(room.name, game);
  return game;
}

export function getGame(roomName) { return games.get(roomName) || null; }
export function endGame(roomName) { games.delete(roomName); }

function teamOf(game, userId) {
  const t = game.teams;
  if (t.red.spymaster === userId || t.red.operatives.includes(userId)) return "red";
  if (t.blue.spymaster === userId || t.blue.operatives.includes(userId)) return "blue";
  return null;
}
function isSpymaster(game, userId) { return game.teams.red.spymaster === userId || game.teams.blue.spymaster === userId; }
function endTurn(game) { game.turn = OTHER[game.turn]; game.phase = "clue"; game.clue = null; }

// Spymaster ipucu verir: kelime + sayı.
export function giveClue(game, userId, word, number) {
  if (!game || game.status !== "playing") return { error: "oyun aktif değil" };
  if (game.phase !== "clue") return { error: "şu an ipucu verilemez" };
  if (game.teams[game.turn].spymaster !== userId) return { error: "sıra sende değil" };
  const w = String(word || "").trim().slice(0, 24);
  const num = Math.max(1, Math.min(9, parseInt(number, 10) || 1));
  if (!w) return { error: "ipucu boş olamaz" };
  game.clue = { word: w, number: num, team: game.turn, remaining: num };
  game.phase = "guess";
  return { ok: true };
}

// Operative kart açar.
export function guess(game, userId, index) {
  if (!game || game.status !== "playing") return { error: "oyun aktif değil" };
  if (game.phase !== "guess" || !game.clue) return { error: "önce ipucu bekleniyor" };
  if (teamOf(game, userId) !== game.turn) return { error: "sıra sende değil" };
  if (isSpymaster(game, userId)) return { error: "spymaster tahmin edemez" };
  const cell = game.grid[index];
  if (!cell || cell.revealed) return { error: "geçersiz kart" };

  cell.revealed = true;
  const turn = game.turn;
  let result;
  if (cell.role === "assassin") {
    cell.revealedBy = "assassin"; game.status = OTHER[turn] + "_won"; result = "assassin";
  } else if (cell.role === turn) {
    cell.revealedBy = turn; game.found[turn]++; result = "agent";
    if (game.found[turn] >= game.counts[turn]) game.status = turn + "_won";
    else { game.clue.remaining--; if (game.clue.remaining <= 0) endTurn(game); }
  } else if (cell.role === OTHER[turn]) {
    cell.revealedBy = OTHER[turn]; game.found[OTHER[turn]]++; result = "enemy";
    if (game.found[OTHER[turn]] >= game.counts[OTHER[turn]]) game.status = OTHER[turn] + "_won";
    else endTurn(game);
  } else {
    cell.revealedBy = "neutral"; result = "neutral"; endTurn(game);
  }
  game.log = [{ en: cell.en, by: turn, result }, ...game.log].slice(0, 6);
  return { ok: true, result };
}

// Bot adımı (AI yok): TEK aksiyon. Sunucu gecikmeyle döngüler.
export function botTick(game) {
  if (!game || game.status !== "playing") return { acted: false };
  const turn = game.turn;
  const spy = game.teams[turn].spymaster;
  const op = game.teams[turn].operatives[0];

  if (game.phase === "clue") {
    if (game.bots.has(spy)) {
      const left = game.counts[turn] - game.found[turn];
      const number = Math.max(1, Math.min(3, left));
      game.clue = { word: "🤖 ipucu", number, team: turn, remaining: number };
      game.phase = "guess";
      return { acted: true };
    }
    return { acted: false }; // insan spymaster ipucu versin
  }

  // phase guess: operative bot ise tahmin etsin
  if (op && game.bots.has(op)) {
    const cells = game.grid.map((c, i) => ({ c, i }));
    const own = cells.filter(x => !x.c.revealed && x.c.role === turn);
    const neutrals = cells.filter(x => !x.c.revealed && x.c.role === "neutral");
    let pick;
    if (own.length && (Math.random() > 0.18 || !neutrals.length)) pick = own[Math.floor(Math.random() * own.length)];
    else if (neutrals.length) pick = neutrals[Math.floor(Math.random() * neutrals.length)];
    else if (own.length) pick = own[0];
    if (pick) { const r = guess(game, op, pick.i); return { acted: !r.error }; }
  }
  return { acted: false };
}

// Kişiye özel durum. Spymaster tüm renkleri görür; diğerleri yalnız açılan kartları.
export function stateFor(game, userId) {
  const team = teamOf(game, userId);
  const spy = isSpymaster(game, userId);
  return {
    room: game.room,
    grid: game.grid.map((c, i) => ({
      index: i, en: c.en, revealed: c.revealed,
      role: (spy || c.revealed) ? c.role : null,
      revealedBy: c.revealedBy,
    })),
    yourTeam: team,
    youAreSpymaster: spy,
    turn: game.turn,
    phase: game.phase,
    clue: game.clue ? { word: game.clue.word, number: game.clue.number, team: game.clue.team } : null,
    score: { red: { found: game.found.red, total: game.counts.red }, blue: { found: game.found.blue, total: game.counts.blue } },
    canGiveClue: game.status === "playing" && team === game.turn && spy && game.phase === "clue",
    turnSpymaster: game.names[game.teams[game.turn].spymaster] || "",
    status: game.status,
    log: game.log,
  };
}
