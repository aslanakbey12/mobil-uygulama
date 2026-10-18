// SUNUCUNUN KENDİ SÖZLÜĞÜ (18 Eki 2026): en → [Türkçe anlam, İngilizce tanım].
//
// NEDEN: /word/example ve /word/image, istemcinin gönderdiği "tr"/"definition"
// metnini modele veriyor ve sonucu KELİME BAZINDA herkes için saklıyordu. İstemci
// metni değiştirilebilir; istem enjeksiyonuyla bir kelimeye uygunsuz cümle ya da
// görsel yazdırılıp bütün kullanıcılara gösterilebiliyordu (güvenlik denetimi,
// 18 Eki). Artık sözlükteki kelimeler için istemci metni YOK SAYILIYOR; sözlükte
// olmayan kelimenin sonucu paylaşılan önbelleğe yazılmıyor.
//
// Kaynak: app/src/data/words.json. Kelime veritabanı değişince yeniden üret:
//   node -e "const w=require('../app/src/data/words.json');const o={};for(const x of w){if(!x.en)continue;const k=x.en.toLowerCase().trim();if(o[k])continue;o[k]=[String(x.tr||'').slice(0,80),String(x.definition||'').slice(0,160)];}require('fs').writeFileSync('src/data/sozluk.json',JSON.stringify(o))"
// (server klasöründen çalıştır.)
import { readFileSync } from "node:fs";

let SOZLUK = {};
try {
  SOZLUK = JSON.parse(readFileSync(new URL("./data/sozluk.json", import.meta.url), "utf8"));
} catch (e) {
  console.error("[sozluk] yüklenemedi — paylaşılan önbelleğe hiçbir YZ sonucu yazılmayacak:", e.message);
}

export function sozlukte(en) {
  const k = SOZLUK[String(en || "").toLowerCase().trim()];
  return k ? { tr: k[0], definition: k[1] } : null;
}

export const sozlukBoyutu = () => Object.keys(SOZLUK).length;
