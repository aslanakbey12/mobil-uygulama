// Premium yetki kontrolü. Kaynak: profiles.is_premium + premium_until (Supabase).
// DEV_PREMIUM=1 ile geliştirmede herkesi premium say.
import { supa } from "./supabase.js";

export async function isPremium(userId) {
  if (process.env.DEV_PREMIUM === "1") return true;
  const s = supa();
  if (!s || !userId) return false;
  try {
    const { data } = await s.from("profiles").select("is_premium,premium_until").eq("id", userId).single();
    if (!data || !data.is_premium) return false;
    if (data.premium_until && new Date(data.premium_until) < new Date()) return false;
    return true;
  } catch (e) {
    return false;
  }
}

export async function setPremium(userId, on, until = null) {
  const s = supa();
  if (!s || !userId) return;
  try {
    await s.from("profiles").upsert({ id: userId, is_premium: on, premium_until: until });
  } catch (e) {}
}
