// İstekteki kullanıcıyı doğrula.
// Üretim: Authorization: Bearer <supabase-jwt> → token doğrulanır, kullanıcı = sub.
// Geliştirme (SUPABASE_JWT_SECRET yoksa): body.userId / ?userId / x-user-id kabul edilir.
import jwt from "jsonwebtoken";

export function getUserId(req) {
  const secret = process.env.SUPABASE_JWT_SECRET;
  const header = req.headers?.authorization || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : (req.query?.token || req.query?.access_token || null);

  if (secret) {
    if (!token) return null;
    try {
      const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
      return payload.sub || null;
    } catch (e) {
      return null;
    }
  }

  // Geliştirme yedeği
  return (req.body && req.body.userId) || req.query?.userId || req.headers["x-user-id"] || null;
}

export function authConfigured() {
  return Boolean(process.env.SUPABASE_JWT_SECRET);
}
