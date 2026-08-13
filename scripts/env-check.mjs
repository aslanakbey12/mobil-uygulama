#!/usr/bin/env node
// .env.example, KODUN OKUDUĞU her değişkeni kapsıyor mu?
//
// ── NEDEN VAR ───────────────────────────────────────────────────────────────
// Örnek dosya bir süre 44 değişkenin 14'ünü listeliyordu ve üstelik
// `.gitignore`'daki `.env.*` kuralı yüzünden hiç commit edilmemişti. Yani
// kurulumu yapanın elinde hiçbir zaman eksiksiz bir kontrol listesi olmadı.
//
// Bedeli üretimde ödendi ve ikisi de SESSİZ arızalardı:
//   · REVENUECAT_WEBHOOK_TOKEN Render'da yoktu → webhook her isteği 401'le
//     reddediyordu; satın alma alınsa bile premium açılmayacaktı.
//   · AUTH_STRICT yoktu → sunucu doğrulanmamış x-user-id başlığına güveniyordu.
//
// İkisi de "bir gün fark ederiz" türü değil: biri para kaybettirir, diğeri
// veri sızdırır. Listeyi elle güncel tutmaya güvenmek yerine ölçüyoruz.
//
// Kullanım: npm run env:check
import fs from "node:fs";
import path from "node:path";

const kod = new Map();   // DEĞİŞKEN -> onu okuyan dosyalar
for (const f of fs.readdirSync("src").filter((x) => x.endsWith(".js"))) {
  const s = fs.readFileSync(path.join("src", f), "utf8");
  for (const m of s.matchAll(/process\.env\.([A-Z_0-9]+)/g)) {
    if (!kod.has(m[1])) kod.set(m[1], new Set());
    kod.get(m[1]).add(f);
  }
}

if (!fs.existsSync(".env.example")) {
  console.error("✗ .env.example yok — kurulum kontrol listesi olmadan kimse doğru kuramaz.");
  process.exit(1);
}
const ornek = new Set(
  [...fs.readFileSync(".env.example", "utf8").matchAll(/^([A-Z_0-9]+)=/gm)].map((m) => m[1])
);

const eksik = [...kod.keys()].filter((k) => !ornek.has(k)).sort();
// Kodda okunmayan kayıt da sorun: var olmayan bir ayarı belgelemek, okuyanı
// yanlış yönlendirir (SUPABASE_JWT_SECRET tam olarak böyleydi — JWKS'e
// geçilmişti ama örnek dosya hâlâ onu istiyordu).
const olu = [...ornek].filter((k) => !kod.has(k)).sort();

for (const k of eksik) {
  console.error(`✗ ${k} — kodda okunuyor (${[...kod.get(k)].join(", ")}) ama .env.example'da YOK`);
}
for (const k of olu) {
  console.error(`✗ ${k} — .env.example'da var ama kod hiç okumuyor (ölü kayıt)`);
}

if (eksik.length || olu.length) {
  console.error(`\n${eksik.length + olu.length} sorun. .env.example'ı güncelle.`);
  process.exit(1);
}
console.log(`✓ .env.example eksiksiz — kodun okuduğu ${kod.size} değişkenin tamamı listede.`);
