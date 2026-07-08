// Ücretsiz kullanıcılar için günlük oda limiti (bellek içi sayaç).
// Premium kullanıcılar limitsiz. Ölçekte Redis/Postgres'e taşınır.
const FREE_DAILY_ROOMS = parseInt(process.env.FREE_DAILY_ROOMS || "2", 10);

const counts = new Map(); // userId -> { day, n }

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function roomsUsedToday(userId) {
  const c = counts.get(userId);
  return c && c.day === today() ? c.n : 0;
}

export function canEnterRoom(userId) {
  return roomsUsedToday(userId) < FREE_DAILY_ROOMS;
}

export function recordRoomEntry(userId) {
  const d = today();
  const c = counts.get(userId);
  if (c && c.day === d) c.n++;
  else counts.set(userId, { day: d, n: 1 });
}

export function freeDailyLimit() {
  return FREE_DAILY_ROOMS;
}
