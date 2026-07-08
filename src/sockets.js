// Kullanıcı -> WebSocket kaydı. Anlık bildirim (eşleşme, odadan çıkarılma) için.
const sockets = new Map(); // userId -> ws

export function register(userId, ws) {
  sockets.set(userId, ws);
}

export function unregister(userId, ws) {
  if (!ws || sockets.get(userId) === ws) sockets.delete(userId);
}

export function push(userId, obj) {
  const ws = sockets.get(userId);
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (e) {}
  }
}

export function online(userId) {
  const ws = sockets.get(userId);
  return Boolean(ws && ws.readyState === 1);
}

export function count() {
  return sockets.size;
}
