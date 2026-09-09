// KALICI ÖRNEK CÜMLE ÖNBELLEĞİ.
//
// Örnek cümle sessiz ama büyük bir kalem: Alıştırma'da HER kelimede çağrılıyor.
// 10.000 kullanıcılı modelde ayda ~63.000 çağrı (bkz. app/scripts/maliyet.mjs).
// Önbelleği yalnızca bellekteydi — süreç her yeniden başladığında siliniyordu,
// tıpkı okuma parçasında ölçtüğümüz gibi (%21 isabet). Oysa anahtar kişisel
// değil, yani parça gibi PAYLAŞILABİLİRDİ ve paylaşılmıyordu.
//
// KALICI OLMANIN BEDELİ: anahtar da kalıcı oluyor. Bağlam serbest metin olarak
// anahtara girseydi, her çağrıda benzersiz bir bağlam gönderen bir istemci
// önbelleği işe yaramaz hale getirir ve her seferinde bize PARA ÖDETİRDİ.
// Bu yüzden bağlam kapalı bir listeden doğrulanıyor; testlerin yarısı orada.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-anahtari";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

const db = { rows: new Map(), islem: [] };
const sahte = {
  from(tablo) {
    const q = { tablo, _esit: {} };
    q.select = () => q; q.eq = (k, v) => { q._esit[k] = v; return q; };
    q.maybeSingle = async () => {
      db.islem.push(`select ${tablo}`);
      const v = db.rows.get(q._esit.key);
      return { data: v ? { example: v } : null, error: null };
    };
    q.upsert = async (r) => {
      db.islem.push(`upsert ${tablo}`);
      db.rows.set(r.key, r.example);
      return { error: null };
    };
    return q;
  },
  rpc: async () => ({ error: null }),
};

// Model çağrısı sayılıyor: "önbellekten geldi" iddiasının tek kanıtı, modele
// HİÇ gidilmemiş olması. Sayaç olmadan test, cümlenin nereden geldiğini
// ayırt edemezdi.
let modelCagrisi = 0;
mock.module("../src/supabase.js", { exports: { supa: () => sahte, supaConfigured: () => true } });
mock.module("../src/llm.js", {
  exports: {
    activeProvider: () => "test",
    callModel: async () => {
      modelCagrisi++;
      return { ok: true, finishReason: "STOP", text: '{"en":"A quick test sentence.","tr":"Hızlı bir test cümlesi."}' };
    },
  },
});

const reading = await import("../src/reading.js");

// ── BAĞLAM KAPALI LİSTE ────────────────────────────────────────────────────
describe("bağlam doğrulanıyor", () => {
  test("bilinen bağlamlar geçiyor", () => {
    for (const b of ["teknoloji", "seyahat", "günlük hayat", "sınav", "dizi ve film"]) {
      assert.equal(reading.baglamCoz(b), b);
    }
  });

  test("TANINMAYAN bağlam 'günlük hayat'a düşüyor — önbellek zehirlenmesi böyle kapanıyor", () => {
    // Asıl senaryo bu: istemci her çağrıda rastgele bir dize gönderirse her
    // çağrı ıska olur, tablo şişer ve her cümle yeniden ÜRETİLİR (para).
    assert.equal(reading.baglamCoz("rastgele-" + Math.random()), "günlük hayat");
    assert.equal(reading.baglamCoz("<script>"), "günlük hayat");
    assert.equal(reading.baglamCoz(""), "günlük hayat");
    assert.equal(reading.baglamCoz(null), "günlük hayat");
    assert.equal(reading.baglamCoz(undefined), "günlük hayat");
  });

  test("büyük harf ve boşluk normalleşiyor — aynı bağlam iki anahtar üretmesin", () => {
    assert.equal(reading.baglamCoz("  Teknoloji "), "teknoloji");
    assert.equal(reading.baglamCoz("SEYAHAT"), "seyahat");
  });

  test("liste İSTEMCİYLE aynı olmak zorunda", () => {
    // app/src/core/store.js: INTEREST_LABEL (12) ∪ MOTIVE_LABEL (6, ikisi
    // ortak) = 16. Orada yeni bir ilgi alanı eklenip buraya eklenmezse cümleler
    // sessizce "günlük hayat"a düşer — hata vermez, kişiselleştirme kaybolur.
    // Sayının pinlenmesi o sessiz kaymayı sesli hale getiriyor.
    assert.equal(reading.BAGLAMLAR.size, 16);
  });
});

// ── KALICI KATMAN ──────────────────────────────────────────────────────────
describe("cümle süreçler arasında yaşıyor", () => {
  test("DB'deki cümle MODELE GİTMEDEN dönüyor", async () => {
    db.rows.clear(); db.islem.length = 0; modelCagrisi = 0;
    // Başka bir kullanıcının (ya da önceki sürecin) ürettiği cümle:
    db.rows.set("acquire|B1|teknoloji", { en: "Onceki surec.", tr: "Önceki süreç." });

    const r = await reading.generateExample("acquire", "edinmek", "B1", "teknoloji");
    assert.equal(r.en, "Onceki surec.");
    assert.equal(modelCagrisi, 0, "önbellekten gelmeliydi — modele gidilmiş");
  });

  test("üretilen cümle KALICI katmana yazılıyor", async () => {
    db.rows.clear(); db.islem.length = 0; modelCagrisi = 0;

    const r = await reading.generateExample("thorough", "titiz", "B2", "bilim");
    assert.equal(r.en, "A quick test sentence.");
    assert.equal(modelCagrisi, 1, "boş önbellekte model çağrılmalıydı");
    // Yazma beklenmiyor (cümle hemen dönüyor) — bir tık bekleyip bakıyoruz.
    await new Promise((r2) => setTimeout(r2, 10));
    assert.ok(db.islem.includes("upsert example_cache"), "kalıcı katmana yazılmadı");
    assert.ok(db.rows.has("thorough|B2|bilim"), "anahtar yanlış kurulmuş");
  });

  test("aynı kelime + aynı seviye + FARKLI bağlam ayrı anahtar", async () => {
    // Kişiselleştirmenin tamamı buradan geliyor; anahtar bağlamı düşürseydi
    // herkese aynı cümle giderdi.
    db.rows.clear(); modelCagrisi = 0;
    await reading.generateExample("balance", "denge", "B1", "spor");
    await reading.generateExample("balance", "denge", "B1", "yemek");
    assert.equal(modelCagrisi, 2);
    await new Promise((r2) => setTimeout(r2, 10));
    assert.ok(db.rows.has("balance|B1|spor"));
    assert.ok(db.rows.has("balance|B1|yemek"));
  });

  test("DB okuması patlarsa cümle YİNE üretiliyor — önbellek bir hızlandırma", async () => {
    db.rows.clear(); modelCagrisi = 0;
    const eski = sahte.from;
    sahte.from = () => { throw new Error("DB düştü"); };
    try {
      const r = await reading.generateExample("resilient", "dayanıklı", "B2", "sağlık");
      assert.equal(r.en, "A quick test sentence.");
    } finally { sahte.from = eski; }
  });
});
