// Moderasyon — güvenlik açısından kritik: engelleme çift yönlü çalışmalı,
// rapor eşiği FARKLI kişilerden gelmeli (tek kişi spam'leyerek birini attıramamalı).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

process.env.REPORT_EJECT_THRESHOLD = "3";
const mod = await import("../src/moderation.js");
const mm = await import("../src/matchmaking.js");

const uid = (p) => p + "_" + Math.random().toString(36).slice(2, 8);

describe("moderation — engelleme", () => {
  test("engelleme ÇİFT YÖNLÜ çalışır", () => {
    const a = uid("a"), b = uid("b");
    assert.equal(mod.areBlocked(a, b), false);
    mod.block(a, b);
    assert.equal(mod.areBlocked(a, b), true, "engelleyen yönünde");
    assert.equal(mod.areBlocked(b, a), true, "engellenen yönünde de — eşleşmemeliler");
  });

  test("ilgisiz kullanıcılar etkilenmez", () => {
    const a = uid("a"), b = uid("b"), c = uid("c");
    mod.block(a, b);
    assert.equal(mod.areBlocked(a, c), false);
    assert.equal(mod.areBlocked(b, c), false);
  });
});

describe("moderation — rapor eşiği", () => {
  test("AYNI kişi defalarca rapor etse bile eşik dolmaz", () => {
    const room = "oda_" + Math.random(), hedef = uid("t"), raporcu = uid("r");
    for (let i = 0; i < 10; i++) mod.report({ reporterId: raporcu, targetId: hedef, roomName: room, reason: "spam" });
    assert.equal(mod.shouldEject(room, hedef), false,
      "tek kişi tekrar tekrar rapor ederek birini attıramamalı");
  });

  test("FARKLI kişilerden eşik kadar rapor gelince çıkarılır", () => {
    const room = "oda_" + Math.random(), hedef = uid("t");
    mod.report({ reporterId: uid("r1"), targetId: hedef, roomName: room });
    mod.report({ reporterId: uid("r2"), targetId: hedef, roomName: room });
    assert.equal(mod.shouldEject(room, hedef), false, "2 rapor yetmemeli");
    mod.report({ reporterId: uid("r3"), targetId: hedef, roomName: room });
    assert.equal(mod.shouldEject(room, hedef), true, "3 farklı raporcu eşiği doldurmalı");
  });

  test("raporlar ODA bazında ayrı sayılır", () => {
    const hedef = uid("t"), o1 = "o1_" + Math.random(), o2 = "o2_" + Math.random();
    for (let i = 0; i < 3; i++) mod.report({ reporterId: uid("r"), targetId: hedef, roomName: o1 });
    assert.equal(mod.shouldEject(o1, hedef), true);
    assert.equal(mod.shouldEject(o2, hedef), false, "başka odaya taşınmamalı");
  });

  test("clearRoomReports sayacı sıfırlar", () => {
    const room = "oda_" + Math.random(), hedef = uid("t");
    for (let i = 0; i < 3; i++) mod.report({ reporterId: uid("r"), targetId: hedef, roomName: room });
    assert.equal(mod.shouldEject(room, hedef), true);
    mod.clearRoomReports(room, hedef);
    assert.equal(mod.shouldEject(room, hedef), false);
  });

  test("odasız rapor çıkarma tetiklemez", () => {
    const hedef = uid("t");
    mod.report({ reporterId: uid("r"), targetId: hedef });
    assert.equal(mod.shouldEject(null, hedef), false);
    assert.equal(mod.shouldEject("", hedef), false);
  });
});

describe("matchmaking — kuyruk", () => {
  test("katılan kullanıcı kuyrukta görünür, ayrılınca çıkar", () => {
    const u = uid("m");
    mm.join({ userId: u, name: "Test", level: "B1", mode: "text", pool: ["a", "b"] });
    assert.ok(mm.status(u), "kuyrukta olmalı");
    mm.leave(u);
    const st = mm.status(u);
    assert.ok(!st || st.status !== "waiting", "ayrıldıktan sonra beklemede olmamalı");
  });

  test("queueStats sayısal ve tutarlı döner", () => {
    const s = mm.queueStats();
    assert.equal(typeof s, "object");
    for (const v of Object.values(s)) assert.ok(typeof v === "number" || typeof v === "object");
  });

  test("bilinmeyen kullanıcının ayrılması çökmez", () => {
    assert.doesNotThrow(() => mm.leave("hicvaroulmayan_" + Math.random()));
  });
});
