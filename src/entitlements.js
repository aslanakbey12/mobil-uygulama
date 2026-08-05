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

// Sosyal odalar 16+ (gizlilik politikası §5'te YAZILI bir taahhüt).
//
// NEDEN İSTEMCİYE SORULMUYOR: eskiden istemci gövdede `ageConfirmed: true`
// gönderiyordu ve sunucu ona güveniyordu. Beş çağrı yerinin hepsi bu değeri
// SABİT true yazdığı için kapı hiç kapanmıyordu — yaşını 13 giren kullanıcı
// odalara giriyordu. Üstelik istemcinin gönderdiği bir boolean'a yetkilendirme
// dayandırmak, x-user-id sahteciliğiyle aynı hata sınıfı: doğrusu, sunucunun
// zaten elinin altında olan profiles.age_confirmed'i KENDİSİNİN okuması.
//
// HATA DURUMUNDA KAPALI (fail-closed): okuyamıyorsak izin vermeyiz. Riski yok —
// AUTH_STRICT zaten Supabase'siz kimlik doğrulatmıyor, yani Supabase erişilemezse
// buraya hiç gelinemiyor.
export async function isAgeConfirmed(userId) {
  const s = supa();
  if (!s || !userId) return false;
  try {
    const { data } = await s.from("profiles").select("age_confirmed").eq("id", userId).maybeSingle();
    return data?.age_confirmed === true;
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
