// Sunucu tarafı Supabase istemcisi (service-role; RLS'i aşar).
// Yapılandırılmamışsa null döner → her şey bellek içi çalışmaya devam eder (geliştirme).
import { createClient } from "@supabase/supabase-js";

let client = null;

export function supaConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

export function supa() {
  if (client) return client;
  if (!supaConfigured()) return null;
  client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return client;
}
