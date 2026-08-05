// Sunucu tarafında SIFIR test vardı. Bu iki modül en riskli olanlar:
//  · aiquota — parayı koruyan fren (yeni yazıldı: kalıcılık + bellek temizliği)
//  · ratelimit — kötüye kullanım koruması (yeni: kullanıcı başına YZ sınırı)
//
// Node 20'nin YERLEŞİK test koşucusu kullanılır → yeni bağımlılık yok.
// Çalıştır: npm test
import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.AI_DAILY_CAP = "5";
process.env.AI_TRANSLATE_DAILY_CAP = "8";
process.env.AI_GLOBAL_DAILY_CAP = "20";
process.env.AI_RL_MAX = "3";

const q = await import("../src/aiquota.js");
const rl = await import("../src/ratelimit.js");

describe("aiquota — kullanıcı kotası", () => {
  test("tavana kadar izin verir, sonra keser", () => {
    const u = "u_cap_" + Math.random();
    for (let i = 0; i < 5; i++) {
      assert.equal(q.underAiCap(u), true, `${i}. istek geçmeliydi`);
      q.bumpAi(u);
    }
    assert.equal(q.underAiCap(u), false, "6. istek KESİLMELİYDİ");
  });

  test("kullanıcılar birbirinin kotasını yemez", () => {
    const a = "u_a_" + Math.random(), b = "u_b_" + Math.random();
    for (let i = 0; i < 5; i++) q.bumpAi(a);
    assert.equal(q.underAiCap(a), false);
    assert.equal(q.underAiCap(b), true, "b kullanıcısı a'dan etkilenmemeli");
  });

  test("çeviri kotası AYRI sayılır", () => {
    const u = "u_tr_" + Math.random();
    for (let i = 0; i < 5; i++) q.bumpAi(u);
    assert.equal(q.underAiCap(u), false, "ai kotası dolmalı");
    assert.equal(q.underTranslateCap(u), true, "çeviri kotası ayrı olmalı");
  });

  test("kimliksiz istek reddedilir", () => {
    assert.equal(q.underAiCap(null), false);
    assert.equal(q.underAiCap(""), false);
  });
});

describe("aiquota — küresel fren", () => {
  test("sistem tavanı dolunca HERKES kesilir", () => {
    // Tavan 20; yukarıdaki testler zaten bir miktar harcadı, kalanı doldur.
    let guard = 0;
    while (q.underGlobalCap() && guard++ < 200) q.bumpGlobal(1);
    const yeni = "u_yeni_" + Math.random();
    assert.equal(q.underGlobalCap(), false, "küresel tavan dolmalıydı");
    assert.equal(q.underAiCap(yeni), false, "tavan dolunca TEMİZ kullanıcı da kesilmeli");
    assert.equal(q.underTranslateCap(yeni), false, "çeviri de kesilmeli");
  });

  test("globalUsage tutarlı rapor verir", () => {
    const g = q.globalUsage();
    assert.equal(typeof g.used, "number");
    assert.equal(g.cap, 20);
    assert.match(g.day, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(g.used >= g.cap, "tavan aşılmış olmalı");
  });
});

describe("ratelimit — kullanıcı başına YZ sınırı", () => {
  test("dakikadaki sınırı aşınca keser", () => {
    const u = "rl_" + Math.random();
    assert.equal(rl.aiRateLimited(u), false);
    assert.equal(rl.aiRateLimited(u), false);
    assert.equal(rl.aiRateLimited(u), false);
    assert.equal(rl.aiRateLimited(u), true, "4. istek sınırı aşmalıydı");
  });

  test("kullanıcılar birbirini etkilemez", () => {
    const a = "rl_a_" + Math.random(), b = "rl_b_" + Math.random();
    for (let i = 0; i < 4; i++) rl.aiRateLimited(a);
    assert.equal(rl.aiRateLimited(a), true);
    assert.equal(rl.aiRateLimited(b), false, "b kullanıcısı serbest olmalı");
  });

  test("kimliksiz çağrı sınırlanmaz (IP sınırı ayrı katman)", () => {
    assert.equal(rl.aiRateLimited(null), false);
  });
});

describe("ratelimit — IP sınırı", () => {
  test("IP yoksa sınırlamaz", () => {
    assert.equal(rl.rateLimited(null), false);
    assert.equal(rl.rateLimited(""), false);
  });

  test("aynı IP'den yoğun istek sonunda kesilir", () => {
    const ip = "10.0.0." + Math.floor(Math.random() * 250);
    let blocked = false;
    for (let i = 0; i < 500; i++) if (rl.rateLimited(ip)) { blocked = true; break; }
    assert.equal(blocked, true, "yoğun istek eninde sonunda kesilmeliydi");
  });
});
