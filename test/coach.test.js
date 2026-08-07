// Haftalık koç raporu — hafta anahtarı ve önbellek sözleşmesi.
//
// Raporun hafta boyunca DEĞİŞMEMESİ ürün açısından kritik: kullanıcı her
// açtığında farklı bir "plan" görseydi planın ciddiyetine inanmazdı. Gerçek bir
// koç da haftanın ortasında fikrini değiştirmez. weekKey() bu sözleşmenin
// dayanağı — yanlış hesaplarsa rapor gün ortasında değişir.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { weekKey, ACTIONS, notesDue } = await import("../src/coach.js");

describe("hafta anahtarı", () => {
  test("haftanın HER GÜNÜ aynı pazartesiyi verir", () => {
    // 2026-08-03 pazartesi. O haftanın 7 günü de aynı anahtarı vermeli.
    const pazartesi = "2026-08-03";
    for (let i = 0; i < 7; i++) {
      const d = new Date(`${pazartesi}T12:00:00Z`);
      d.setDate(d.getDate() + i);
      assert.equal(weekKey(d), pazartesi, `${d.toISOString().slice(0, 10)} yanlış haftaya düştü`);
    }
  });

  test("PAZAR, bir sonraki haftaya kaymaz", () => {
    // Klasik hata: getDay() pazar için 0 döner, çıkarma yapılmazsa pazar
    // kendi haftasının pazartesisi yerine ertesi haftaya düşer.
    assert.equal(weekKey(new Date("2026-08-09T23:00:00Z")), "2026-08-03");
  });

  test("PAZARTESİ yeni haftayı başlatır", () => {
    assert.equal(weekKey(new Date("2026-08-10T00:30:00Z")), "2026-08-10");
  });

  test("ardışık haftalar tam 7 gün ayrı", () => {
    const a = new Date(weekKey(new Date("2026-08-05T12:00:00Z")));
    const b = new Date(weekKey(new Date("2026-08-12T12:00:00Z")));
    assert.equal((b - a) / 86400000, 7);
  });

  test("YYYY-MM-DD biçiminde döner (veritabanı date sütunu)", () => {
    assert.match(weekKey(new Date("2026-08-05T12:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── Koç eylemleri: modelin ürettiği metin NAVİGASYONA dönüşüyor ─────────────
// Bu, güvenlik açısından en hassas nokta. Model "kind" alanına ne yazarsa
// istemci ona göre bir ekrana gidiyor. Doğrulanmazsa model uydurduğu bir
// hedefe yönlendirebilir ya da beklenmedik bir yere düşürebilir.
// resolveMode'daki beyaz liste mantığının aynısı.
describe("koç eylemleri", () => {
  test("bilinen eylem türleri katalogda", () => {
    for (const k of ["swipe", "practice", "reading", "scenario", "grammar", "friends", "social"]) {
      assert.ok(ACTIONS[k], `${k} katalogda yok`);
    }
  });

  test("katalog SADECE uygulamada karşılığı olan yerleri içerir", () => {
    // Tür EKLEYEN istemcide karşılığını açmak, tür KALDIRAN istemciden de
    // silmek zorunda. Bu test o sözleşmeyi iki yönde de hatırlatır.
    // 7 (wordchat kaldırıldı: o mod sohbetten ibaretti, hem koçla hem
    // senaryoyla örtüşüyordu; kaldırılınca bu test uyardı — istenen davranış).
    assert.equal(Object.keys(ACTIONS).length, 7);
  });

  test("eylem açıklamaları BOŞ olamaz — model neyi seçtiğini bilmeli", () => {
    for (const [k, v] of Object.entries(ACTIONS)) {
      assert.ok(typeof v === "string" && v.length > 10, `${k} açıklaması yetersiz`);
    }
  });
});

// ── Koçun notları ───────────────────────────────────────────────────────────
// Koç her mesajda kullanıcıyı sıfırdan okuyup kanaat oluşturuyordu. Notlar
// "bu kişi nasıl biri" sorusunun kalıcı cevabı — sohbet geçmişinden farklı bir
// şey (geçmiş olay kaydı, not yargı).
//
// notesDue() maliyeti belirliyor: her cevapta not üretmek gereksiz bir YZ
// çağrısı olurdu. Bu testler eşiğin sessizce kaymasını engeller.
describe("koç notları — güncelleme eşiği", () => {
  test("yeni sohbette daha not üretilmez", () => {
    assert.equal(notesDue(0, 0), false);
    assert.equal(notesDue(2, 0), false);
  });

  test("yeterli mesaj birikince üretilir", () => {
    assert.equal(notesDue(6, 0), true);
    assert.equal(notesDue(9, 0), true);
  });

  test("not yazıldıktan sonra sayaç SIFIRLANIR — her mesajda tekrar üretmez", () => {
    // Asıl maliyet tuzağı burada: mark güncellenmezse 6. mesajdan sonra
    // HER cevapta not üretilirdi.
    assert.equal(notesDue(8, 6), false);
    assert.equal(notesDue(11, 6), false);
    assert.equal(notesDue(12, 6), true);
  });

  test("bozuk mark değeri çökmez, 0 sayılır", () => {
    assert.equal(notesDue(6, null), true);
    assert.equal(notesDue(6, undefined), true);
    assert.equal(notesDue(3, "abc"), false);
  });
});
