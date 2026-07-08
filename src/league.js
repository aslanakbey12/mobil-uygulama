// Haftalık XP ligi (MVP: bellek içi + botlar). Üretimde Postgres/Supabase'e taşınır.
// Kullanıcı haftalık XP'siyle divizyonundaki ~30 kişilik pod'da sıralanır.
// Hafta sonunda üst PROMOTE yükselir, alt RELEGATE düşer. Botlar pod'u doldurur.
const DIVISIONS = ["Bronz", "Gümüş", "Altın", "Safir", "Elmas"];
const POD_SIZE = 30;
const PROMOTE = 7;   // üst 7 bir üst divizyona
const RELEGATE = 5;  // alt 5 bir alt divizyona

// userId -> { name, division, weeklyXp, weekKey, lastRank }
const users = new Map();

const BOT_NAMES = [
  "Deniz", "Ada", "Ela", "Kaan", "Mira", "Efe", "Zeynep", "Arda", "Nil", "Poyraz",
  "Selin", "Kerem", "Duru", "Aras", "İpek", "Bora", "Ceren", "Ege", "Lara", "Toprak",
  "Yağmur", "Sarp", "Derin", "Aylin", "Umut", "Melis", "Cana", "Naz", "Ozan", "Elif",
];

function weekKey(d = new Date()) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // Pazartesi=0
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - day);
  return date.toISOString().slice(0, 10);
}
function msToNextWeek() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - day + 7);
  return monday.getTime() - now.getTime();
}
// Deterministik pseudo-random (seed string -> 0..1) — botlar hafta boyunca sabit.
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
// Divizyona göre bot listesi (yüksek divizyon = daha yüksek XP tabanı).
function bots(division, wk, count) {
  const out = [];
  const base = 180 + division * 240;
  for (let i = 0; i < count; i++) {
    const r = seeded(`${wk}|${division}|xp|${i}`);
    const name = BOT_NAMES[Math.floor(seeded(`${wk}|${division}|nm|${i}`) * BOT_NAMES.length)];
    const xp = Math.round(base * (0.25 + r * 1.6));
    out.push({ id: `bot_${division}_${i}`, name, xp, me: false });
  }
  return out;
}

export function sync({ userId, name, weeklyXp, level }) {
  const wk = weekKey();
  let u = users.get(userId);
  if (!u) u = { name: name || "Sen", division: 0, weeklyXp: 0, weekKey: wk, lastRank: 0 };

  // Yeni hafta: geçen haftaki sıralamaya göre terfi/tenzil, sonra sıfırla
  if (u.weekKey !== wk) {
    if (u.lastRank && u.lastRank <= PROMOTE) u.division = Math.min(DIVISIONS.length - 1, u.division + 1);
    else if (u.lastRank && u.lastRank > POD_SIZE - RELEGATE) u.division = Math.max(0, u.division - 1);
    u.weekKey = wk; u.weeklyXp = 0; u.lastRank = 0;
  }
  u.name = name || u.name;
  u.weeklyXp = Math.max(u.weeklyXp, Number(weeklyXp) || 0);
  users.set(userId, u);

  // Pod: aynı divizyondaki gerçek kullanıcılar + botlarla POD_SIZE'a tamamla
  const real = [...users.entries()]
    .filter(([, x]) => x.division === u.division && x.weekKey === wk)
    .map(([id, x]) => ({ id, name: x.name, xp: x.weeklyXp, me: id === userId }));
  const botList = bots(u.division, wk, Math.max(0, POD_SIZE - real.length));
  const board = [...real, ...botList].sort((a, b) => b.xp - a.xp);
  const rank = board.findIndex(x => x.me) + 1;
  u.lastRank = rank;

  return {
    division: DIVISIONS[u.division],
    divisionIndex: u.division,
    divisions: DIVISIONS,
    rank,
    weeklyXp: u.weeklyXp,
    msLeft: msToNextWeek(),
    podSize: board.length,
    promote: u.division < DIVISIONS.length - 1 ? PROMOTE : 0,
    relegate: u.division > 0 ? RELEGATE : 0,
    board: board.map((x, i) => ({ rank: i + 1, name: x.name, xp: x.xp, me: !!x.me })),
  };
}

export function leagueStats() { return { leagueUsers: users.size }; }
