// KALICI OKUMA ÖNBELLEĞİ.
//
// Okuma, YZ faturamızın en büyük kalemi. Önbellek bellek içi 500 girişlik bir
// Map'ti ve her yeniden başlatmada siliniyordu — ölçülen isabet %21. Kalıcı
// ortak önbellekle %69, 6. ayda %93.
//
// KALICI OLMANIN BEDELİ: kötü parça da kalıcı oluyor. Oy sayaçları bellekteydi
// ve yeniden başlatmada sıfırlanıyordu; 3 olumsuz oy eşiğine hiç ulaşılamıyordu.
// Önbellek geçiciyken bunun bedeli sınırlıydı. Kalıcıyken "kötü parça sonsuza
// kadar herkese servis edilir" demek. Bu testler o iki şeyi birlikte korur.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-anahtari";
process.env.SUPABASE_URL = process.env.SUPABASE_URL || "https://test.supabase.co";
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "test-service-key";

import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

// Sahte Supabase: gerçek ağ yok, ama ÇAĞRILAN işlemleri kaydeder.
const db = { rows: new Map(), oylar: new Map(), islem: [] };
const sahte = {
  from(tablo) {
    const q = { tablo, _esit: {} };
    q.select = () => q; q.eq = (k, v) => { q._esit[k] = v; return q; };
    q.maybeSingle = async () => {
      db.islem.push(`select ${tablo}`);
      if (tablo === "reading_cache") {
        const v = db.rows.get(q._esit.key);
        return { data: v ? { passage: v } : null, error: null };
      }
      const v = db.oylar.get(q._esit.ref);
      return { data: v || null, error: null };
    };
    q.upsert = async (r) => { db.islem.push(`upsert ${tablo}`);
      if (tablo === "reading_cache") db.rows.set(r.key, r.passage);
      else db.oylar.set(r.ref, { up: r.up, down: r.down });
      return { error: null }; };
    q.delete = () => ({ eq: async (k, v) => { db.islem.push(`delete ${tablo}`); db.rows.delete(v); return { error: null }; } });
    return q;
  },
  rpc: async () => ({ error: null }),
};

// ESM dışa aktarımları salt-okunur; modülün kendisini taklit et.
mock.module("../src/supabase.js", { exports: { supa: () => sahte, supaConfigured: () => true } });

const reading = await import("../src/reading.js");

describe("oy sayaçları KALICI", () => {
  test("yeniden başlatmadan sonra sayaç DB'den devam eder — eşik gerçekten yakalanır", async () => {
    db.oylar.clear(); db.rows.clear();
    const key = "B1||acquire";
    db.rows.set(key, { passage: "x", questions: [{}] });
    db.oylar.set(key, { up: 0, down: 2 });   // önceki süreçte 2 olumsuz oy alınmış

    // Süreç yeni başladı: bellekte hiçbir şey yok. Eski kodda bu oy 1. sayılırdı
    // ve eşiğe ASLA ulaşılamazdı.
    const r = await reading.rateReading(key, false);
    assert.equal(r.replaced, true, "3. olumsuz oy eşiği tetiklemeliydi");
  });

  test("eşiğe gelince KALICI önbellekten de silinir", async () => {
    db.oylar.clear(); db.rows.clear(); db.islem.length = 0;
    const key = "B1||thorough";
    db.rows.set(key, { passage: "kötü parça", questions: [{}] });
    db.oylar.set(key, { up: 0, down: 2 });

    await reading.rateReading(key, false);
    assert.equal(db.rows.has(key), false, "kötü parça DB'de kalırsa herkese servis edilmeye devam eder");
    assert.ok(db.islem.includes("delete reading_cache"), "kalıcı katmandan silme çağrısı yapılmalı");
  });

  test("olumlu oylar baskınsa silinmez", async () => {
    db.oylar.clear(); db.rows.clear();
    const key = "B1||reluctant";
    db.rows.set(key, { passage: "iyi parça", questions: [{}] });
    db.oylar.set(key, { up: 5, down: 2 });
    const r = await reading.rateReading(key, false);   // down=3 ama up=5
    assert.equal(r.replaced, false);
    assert.equal(db.rows.has(key), true);
  });
});

describe("çıktı bütçesi", () => {
  test("okuma çıktı tavanı %20 kısıldı (3500 -> 2800)", async () => {
    const src = await import("node:fs").then((m) => m.readFileSync("src/reading.js", "utf8"));
    assert.match(src, /maxOutputTokens:\s*2800/, "okuma çıktı tavanı 2800 olmalı");
    assert.doesNotMatch(src, /maxOutputTokens:\s*3500/, "eski 3500 tavanı kalmamalı");
  });
});
