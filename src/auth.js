// İstekteki kullanıcıyı doğrula.
// Üretim: Authorization: Bearer <supabase-jwt> (ES256, asimetrik) → JWKS ile doğrulanır, kullanıcı = sub.
// Doğrulama async olduğundan server.js'te onRequest hook token'ı doğrulayıp req.authUserId'ye yazar;
// getUserId sync kalır (req.authUserId'yi okur). SUPABASE_URL yoksa: geliştirme yedeği (x-user-id vb.).
import { createRemoteJWKSet, jwtVerify } from "jose";

const SB_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const STRICT = process.env.AUTH_STRICT === "1"; // 1 → doğrulanmamış header'a GÜVENME (tam kilit)
const JWKS = SB_URL ? createRemoteJWKSet(new URL(SB_URL + "/auth/v1/.well-known/jwks.json")) : null;

// Supabase erişim token'ını (ES256) JWKS ile doğrula → kullanıcı id (sub) ya da null.
export async function verifyToken(token) {
  if (!JWKS || !token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS);
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
