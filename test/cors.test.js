// CORS ORIGIN EŞLEŞTİRME.
//
// İki sebeple test edilmesi gereken bir kod:
//
// 1. GÜVENLİK SINIRI. Gevşek yazılmış bir joker, saldırganın kendi sayfasından
//    bu API'ye tarayıcı üzerinden istek atabilmesi demek. Hata sessiz: yanlış
//    izin verilen bir origin hiçbir uyarı üretmez, sadece çalışır.
// 2. ARIZASI TEŞHİS EDİLEMİYOR. Origin eşleşmediğinde tarayıcı isteği tamamen
//    iptal ediyor ve JS'e yalnızca "failed to fetch" düşüyor — uygulama bunu
//    "internet yok" diye gösteriyor. Yani yanlış CORS, kullanıcıya tamamen
//    alakasız bir hata olarak görünüyor. (Web sürümünde bir kez tam olarak
//    böyle oldu: yeni Netlify adresi izin listesinde yoktu.)
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { originIzinli } from "../src/cors.js";

const kur = (liste) => (o) => originIzinli(liste, o);

describe("CORS origin eşleştirme", () => {
  test("birebir adres geçer, başkası geçmez", () => {
    const izin = kur(["https://a.netlify.app"]);
    assert.equal(izin("https://a.netlify.app"), true);
    assert.equal(izin("https://b.netlify.app"), false);
  });

  test("joker alt alan her dağıtımı kapsar", () => {
    const izin = kur(["https://*.netlify.app"]);
    assert.equal(izin("https://adorable-llama-463991.netlify.app"), true);
    assert.equal(izin("https://astounding-cheesecake-d34daf.netlify.app"), true);
    // Netlify'ın kendi önizleme adresleri çok seviyeli olabiliyor.
    assert.equal(izin("https://deploy-preview-3--site.netlify.app"), true);
  });

  test("joker kök alanın KENDİSİNİ eşleştirmez", () => {
    assert.equal(kur(["https://*.netlify.app"])("https://netlify.app"), false);
  });

  test("izinli kökü kendi adına gömen adres eşleşmez", () => {
    const izin = kur(["https://*.netlify.app"]);
    assert.equal(izin("https://netlify.app.kotu.com"), false);
    assert.equal(izin("https://kotu.com/x.netlify.app"), false);
  });

  test("şema değiştirilemez", () => {
    assert.equal(kur(["https://*.netlify.app"])("http://a.netlify.app"), false);
  });

  test("birden çok kural birlikte çalışır", () => {
    const izin = kur(["https://*.netlify.app", "https://liveda.app"]);
    assert.equal(izin("https://liveda.app"), true);
    assert.equal(izin("https://x.netlify.app"), true);
    assert.equal(izin("https://baska.com"), false);
  });

  test("Origin başlığı yoksa eşleşme yok (mobil bu yoldan geçmiyor)", () => {
    assert.equal(kur(["https://*.netlify.app"])(""), false);
    assert.equal(kur(["https://*.netlify.app"])(undefined), false);
  });
});

// ── SONDAKİ "/" ──────────────────────────────────────────────────────────────
//
// GERÇEK OLAY: CORS_ORIGINS'e adresler "https://...netlify.app/" biçiminde
// girilmişti. Origin'de asla yol bölümü olmadığı için hiçbiri eşleşmedi ve
// tarayıcı bütün istekleri iptal etti. Kullanıcıya "internet bağlantısı yok ya
// da sunucuya ulaşılamıyor" göründü — sebebi tek bir karakterdi.
describe("sondaki / ayarı bozmuyor", () => {
  test("ayarda / olsa da eşleşiyor", () => {
    const izin = kur(["https://liveda.netlify.app/"]);
    assert.equal(izin("https://liveda.netlify.app"), true);
  });

  test("birden fazla / ve boşluk da temizleniyor", () => {
    const izin = kur(["  https://liveda.netlify.app//  "]);
    assert.equal(izin("https://liveda.netlify.app"), true);
  });

  test("jokerde de çalışıyor", () => {
    const izin = kur(["https://*.netlify.app/"]);
    assert.equal(izin("https://liveda.netlify.app"), true);
  });

  // GÜVENLİK GEVŞEMİYOR: kırpma yalnızca sondaki eğik çizgiyi alıyor, farklı
  // bir hostu eşleştirmiyor. Bunu yazmasaydım kırpmanın kapıyı açıp açmadığı
  // ölçülmemiş olurdu.
  test("başka host yine reddediliyor", () => {
    const izin = kur(["https://liveda.netlify.app/"]);
    assert.equal(izin("https://kotu.com"), false);
    assert.equal(izin("https://liveda.netlify.app.kotu.com"), false);
    assert.equal(izin("http://liveda.netlify.app"), false);   // şema farklı
  });

  test("yol içeren sahte origin reddediliyor", () => {
    const izin = kur(["https://*.netlify.app/"]);
    assert.equal(izin("https://kotu.com/x.netlify.app"), false);
  });
});
