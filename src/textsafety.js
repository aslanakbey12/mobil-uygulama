// Basit sohbet içerik filtresi (TR + EN). Amaç: odalarda küfür/hakaret/uygunsuzluğu
// maskelemek ya da ağır durumlarda mesajı düşürmek. Kapsamlı bir moderasyon değil —
// reaktif rapor/engelle sistemini (moderation.js) tamamlayan proaktif bir katman.
// Not: liste kasıtlı olarak kısa/çekirdek tutuldu; zamanla genişletilebilir.

// Normalize: küçük harf, leetspeak, tekrar eden harf ve boşluk/nokta ile kaçışları çöz.
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[0@]/g, "o").replace(/1|!|\|/g, "i").replace(/3/g, "e").replace(/4/g, "a").replace(/5/g, "s").replace(/7/g, "t")
    .replace(/[^a-zçğıöşü\s]/g, " ")   // harf-dışını boşluğa çevir (a.m.k, s*ktir vb. ayrışır)
    .replace(/(.)\1{2,}/g, "$1$1")     // aaaa → aa
    .replace(/\s+/g, " ")
    .trim();
}

// Çekirdek engelli kökler (kelime köküne göre eşleşir). Türkçe + İngilizce en yaygınlar.
const BAD_ROOTS = [
  // TR
  "amk", "amcik", "amina", "aminakoyayim", "orospu", "pust", "pezevenk", "gavat",
  "yarrak", "yarra", "sik", "siktir", "sikeyim", "gotveren", "gotlek", "ibne", "piç",
  "oç", "oc", "kahpe", "sürtük", "surtuk", "gerizekali", "salak", "aptal", "mal",
  // EN
  "fuck", "fuk", "shit", "bitch", "asshole", "dick", "pussy", "cunt", "bastard",
  "slut", "whore", "faggot", "nigger", "retard",
];
// Tek başına çok kısa/çakışan kökleri kelime-sınırıyla eşle (sik → "psikoloji" false-positive olmasın).
const WORD_BOUNDED = new Set(["sik", "oc", "oç", "mal", "sic", "dick", "sik"]);

const rootRe = BAD_ROOTS.filter((r) => !WORD_BOUNDED.has(r)).map((r) => r);

// Bir kelimenin kökü engelli mi?
function isBadToken(tok) {
  if (WORD_BOUNDED.has(tok)) return true;
  for (const r of rootRe) if (tok.includes(r)) return true;
  return false;
}

// Ham metni denetle → { clean, blocked, hits }
// - blocked: mesaj hiç iletilmemeli (kelimelerin çoğu ya da tamamı uygunsuz)
// - clean: maskeleme uygulanmış metin (tekil küfürler *** olur)
export function moderateChat(text) {
  const raw = String(text || "");
  const tokens = raw.split(/(\s+)/); // boşlukları koru
  let hits = 0, words = 0;
  const out = tokens.map((t) => {
    if (/^\s+$/.test(t) || !t) return t;
    words++;
    const norm = normalize(t);
    if (norm && isBadToken(norm)) { hits++; return "*".repeat(Math.min(t.length, 6)); }
    return t;
  });
  const clean = out.join("");
  // Mesajın yarısından fazlası ya da 3+ küfür → tamamen düşür (spam/saldırı).
  const blocked = hits >= 3 || (words > 0 && hits / words > 0.5);
  return { clean, blocked, hits };
}
