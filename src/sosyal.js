// Uykudaki sosyal bölümün sunucu yolları (bkz. server.js "SOSYAL BÖLÜM UYKUDA").
export const SOSYAL_ONEKLER = ["/rooms", "/friends", "/dm", "/matchmaking", "/report", "/token", "/voiceroom", "/league", "/block", "/chat/recap", "/ws"];
export const sosyalYolMu = (url) => {
  const yol = String(url || "").split("?")[0];
  return SOSYAL_ONEKLER.some((p) => yol === p || yol.startsWith(p + "/"));
};
