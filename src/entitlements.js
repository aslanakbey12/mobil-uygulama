// Premium yetki kontrolü. Kaynak: profiles.is_premium + premium_until (Supabase).
// DEV_PREMIUM=1 ile geliştirmede herkesi premium say.
import { supa } from "./supabase.js";

// ── ARIZA İLE "PREMIUM DEĞİL" AYNI ŞEY DEĞİL ────────────────────────────────
//
// Bu fonksiyon hatada `false` dönüyor ve bu DOĞRU (fail-closed: okuyamıyorsak
// izin vermeyiz). Ama bir bedeli var: ŞEMA HATASI da sessizce "premium değil"e
// dönüşüyor.
//
// Yaşandı: db/02_premium.sql hiç çalıştırılmamıştı, yani profiles.is_premium
// sütunu YOKTU. Sorgu her seferinde hata veriyor, catch `false` dönüyor ve
// hiç kimse premium olamıyordu — gerçek bir satın alma yapılsa bile, çünkü
// webhook'un setPremium'u da aynı olmayan sütuna yazmaya çalışıyordu. Yani
// para alınır, özellik açılmazdı. Hiçbir yerde tek satır uyarı yoktu.
//
// Artık hata LOG'a düşüyor. Davranış değişmiyor (yine false), ama arıza
// görünür oluyor. Bir kez uyarmak yeterli: her istekte yazmak Render loglarını
// boğar ve gürültü, sessizlik kadar kötüdür.
let semaUyarildi = false;
function semaUyar(e, nerede) {
  if (semaUyarildi) return;
  semaUyarildi = true;
  console.error(
    `[entitlements] ${nerede} okunamadı — premium HERKESTE KAPALI kalır. ` +
    `Muhtemel sebep: db/ altındaki göçler çalıştırılmamış (bkz. db/00_denetim.sql). ` +
    `Hata: ${e?.message || e}`
  );
}

export async function isPremium(userId) {
  if (process.env.DEV_PREMIUM === "1") return true;
  const s = supa();
  if (!s || !userId) return false;
  try {
    const { data, error } = await s.from("profiles").select("is_premium,premium_until").eq("id", userId).single();
    // Supabase hatayı FIRLATMIYOR, `error` alanında döndürüyor. Bu yüzden
    // sütun eksikliği catch'e hiç düşmüyordu; sessizliğin asıl sebebi buydu.
    if (error) { semaUyar(error, "profiles.is_premium"); return false; }
    if (!data || !data.is_premium) return false;
    if (data.premium_until && new Date(data.premium_until) < new Date()) return false;
    return true;
  } catch (e) {
    semaUyar(e, "profiles.is_premium");
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

// SATIN ALMA YAZILAMAZSA BUNU BİLMEK ZORUNDAYIZ.
//
// Burası RevenueCat webhook'unun tek yazma yolu. Eskiden hata tamamen
// yutuluyordu (`catch (e) {}`) — yani sütun yoksa ya da RLS engellerse,
// kullanıcı parayı öder, yazma sessizce başarısız olur ve kimsenin haberi
// olmazdı. Ödeme akışında sessiz başarısızlık, kabul edilebilir en kötü
// davranış: kaybı kullanıcı ödüyor, biz fark bile etmiyoruz.
//
// `true` döndürüyor ki çağıran (webhook) sonucu loglayabilsin.
export async function setPremium(userId, on, until = null) {
  const s = supa();
  if (!s || !userId) return false;
  try {
    const { error } = await s.from("profiles").upsert({ id: userId, is_premium: on, premium_until: until });
    if (error) {
      console.error(`[entitlements] PREMIUM YAZILAMADI (uid=${userId}, on=${on}): ${error.message}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[entitlements] PREMIUM YAZILAMADI (uid=${userId}, on=${on}): ${e?.message || e}`);
    return false;
  }
}
