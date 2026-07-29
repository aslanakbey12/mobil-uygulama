// Expo Push bildirimleri. Kullanıcının cihaz token'larını push_tokens tablosundan alıp
// Expo Push API'sine yollar. Token/Supabase yoksa sessizce no-op (özellik kademeli açılır).
import { supa } from "./supabase.js";

export async function sendPush(userId, { title, body, data } = {}) {
  try {
    const db = supa();
    if (!db || !userId) return;
    const { data: rows } = await db.from("push_tokens").select("token").eq("user_id", userId);
    const tokens = (rows || [])
      .map((r) => r.token)
      .filter((t) => typeof t === "string" && t.startsWith("ExponentPushToken"));
    if (!tokens.length) return;
    const messages = tokens.map((to) => ({
      to, title, body, data: data || {}, sound: "default", priority: "high", channelId: "daily-reminder",
    }));
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json" },
      body: JSON.stringify(messages),
    });
  } catch (e) { /* sessiz — bildirim başarısızlığı akışı bozmasın */ }
}
