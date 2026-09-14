// Okuma kotası — kademeye duyarlı olmalı.
//
// Bu kota bir kez ÜRÜNDEN KOPMUŞTU: tek sayıydı (20) ve premium'a bakmıyordu.
// Paywall "sınırsız okuma parçası (ücretsizde günde 1)" diye satıyordu ama
// gerçekte herkes 20 alıyordu — yani ücretsiz kullanıcı vaat edilenin 20 katını,
// premium ise "sınırsız" denen yerde bir tavanı alıyordu. Vaat iki yönde birden
// yanlıştı ve Play'in yanıltıcı abonelik politikasına giriyordu.
//
// Buradaki testler kotanın kademeye duyarlı KALMASINI garanti eder.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.READING_DAILY_CAP = "3";
process.env.READING_DAILY_CAP_PREMIUM = "30";

const reading = await import("../src/reading.js");

const uid = () => "u_" + Math.random().toString(36).slice(2, 10);

describe("okuma kotası — kademe", () => {
  test("premium tavanı ücretsizden YÜKSEK (paywall'ın sattığı fark gerçek)", () => {
    assert.ok(reading.dailyCapFor(true) > reading.dailyCapFor(false),
      "premium ile ücretsiz aynı tavanı alıyorsa satılacak bir fark yok");
  });

  test("ücretsiz kullanıcı kendi tavanında durur", () => {
    const u = uid();
    const cap = reading.dailyCapFor(false);
    for (let i = 0; i < cap; i++) {
      assert.equal(reading.underDailyCap(u, false), true, `${i + 1}. parça verilmeliydi`);
      reading.bumpDaily(u);
    }
    assert.equal(reading.underDailyCap(u, false), false, "tavan aşıldığı halde izin verdi");
  });

  test("AYNI kullanıcı premium olunca devam edebilir", () => {
    // Ücretsiz tavanı doldurmuş biri abone olduğunda hemen faydayı görmeli;
    // "yarın gel" demek satın alma anını cezalandırırdı.
    const u = uid();
    for (let i = 0; i < reading.dailyCapFor(false); i++) reading.bumpDaily(u);
    assert.equal(reading.underDailyCap(u, false), false);
    assert.equal(reading.underDailyCap(u, true), true, "premium'a geçince hak açılmalı");
  });

  test("remainingToday kullanıma göre azalır ve negatife düşmez", () => {
    const u = uid();
    assert.equal(reading.remainingToday(u, false), reading.dailyCapFor(false));
    reading.bumpDaily(u);
    assert.equal(reading.remainingToday(u, false), reading.dailyCapFor(false) - 1);
    for (let i = 0; i < 50; i++) reading.bumpDaily(u);
    assert.equal(reading.remainingToday(u, false), 0, "negatif kalan gösterilmemeli");
  });

  test("kademe belirtilmezse ÜCRETSİZ varsayılır (kaza eseri bedava premium yok)", () => {
    const u = uid();
    for (let i = 0; i < reading.dailyCapFor(false); i++) reading.bumpDaily(u);
    assert.equal(reading.underDailyCap(u), false);
  });
});

// ── KALICILIK ─────────────────────────────────────────────────────────────────
// Sayaç eskiden reading.js içinde ayrı bir bellek-içi Map'ti; aiquota'nın
// yükle/yaz döngüsünün dışında kaldığı için Render her uyanışta hakkı yeniden
// veriyordu. Artık aiquota'nın 'reading' türü: flush'a girer, load'dan gelir.
const q = await import("../src/aiquota.js");
describe("okuma kotası — kalıcılık", () => {
  test("bumpDaily aiquota'nın 'reading' sayacını artırır (flush'a girecek olan bu)", () => {
    const u = uid();
    reading.bumpDaily(u);
    reading.bumpDaily(u);
    assert.equal(q.readingUsedToday(u), 2);
    assert.equal(reading.remainingToday(u, true), reading.dailyCapFor(true) - 2);
  });
});
