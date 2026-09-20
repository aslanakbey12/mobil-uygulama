// İstekteki kullanıcıyı doğrula.
// Üretim: Authorization: Bearer <supabase-jwt> (ES256, asimetrik) → JWKS ile doğrulanır, kullanıcı = sub.
// Doğrulama async olduğundan server.js'te onRequest hook token'ı doğrulayıp req.authUserId'ye yazar;
// getUserId sync kalır (req.authUserId'yi okur). SUPABASE_URL yoksa: geliştirme yedeği (x-user-id vb.).
import { createRemoteJWKSet, jwtVerify } from "jose";

const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
// KİLİT VARSAYILAN (20 Eyl 2026). Eskiden yalnız AUTH_STRICT=1 iken kilitliydi;
// env eksik/yanlış kalırsa body.userId ve x-user-id doğrulanmadan kabul
// ediliyordu — tek koruma render.yaml'dı. Şimdi açıkça "0" denmedikçe kilitli,
// üretimde açık bırakılmışsa süreç hiç ayağa kalkmıyor.
const STRICT = process.env.AUTH_STRICT !== "0";
const JWKS = SB_URL ? createRemoteJWKSet(new URL(SB_URL + "/auth/v1/.well-known/jwks.json")) : null;
if (SB_URL && !STRICT && process.env.NODE_ENV === "production") {
  console.error("AUTH_STRICT=0 üretimde yasak: doğrulanmamış kimlik kabul edilirdi.");
  process.exit(1);
}

// Supabase erişim token'ını (ES256) JWKS ile doğrula → kullanıcı id (sub) ya da null.
export async function verifyToken(token) {
  if (!JWKS || !token) return null;
  try {
    // iss/aud/alg sabit: JWKS'e ileride başka bir anahtar (ör. HS256 legacy)
    // eklenirse bile yalnız Supabase'in ES256 erişim token'ı geçer.
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: SB_URL + "/auth/v1", audience: "authenticated", algorithms: ["ES256"],
    });
    return payload.sub || null;
  } catch (e) {
    return null;
  }
}

// Bearer başlığından veya query'den token çıkar (WS query ile bağlanır).
export function tokenFromReq(req) {
  const h = req.headers?.authorization || "";
  if (h.startsWith("Bearer ")) return h.slice(7);
  return req.query?.token || req.query?.access_token || null;
}

// Kullanıcı id: önce doğrulanmış kimlik (hook'tan), sonra (STRICT değilse) dev yedeği.
export function getUserId(req) {
  if (req.authUserId) return req.authUserId;
  if (STRICT && SB_URL) return null; // tam güvenli modda header'a güvenme
  return (req.body && req.body.userId) || req.query?.userId || req.headers["x-user-id"] || null;
}

export function authConfigured() {
  return Boolean(SB_URL);
}
