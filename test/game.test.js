// Kelime Casusu — kazanma/kaybetme koşulları ve sıra kuralları.
// Bu mantık 194 satır ve test edilmemişti; bir hata oyunu YANLIŞ takıma
// kazandırır ya da oyunu kilitler. Saf fonksiyonlar → doğrudan test edilebilir.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createGame, giveClue, guess, endGame, getGame } from "../src/game.js";

// createGame bir "room" bekliyor: üyeler + kelime havuzu
function mkRoom(name = "r" + Math.random()) {
  // createGame `memberPools` bekliyor (her üyenin kelime havuzu) — ızgara bundan kurulur.
  const pool = Array.from({ length: 30 }, (_, i) => "word" + i);
  const members = [
    { userId: "r_spy", name: "RedSpy" },
    { userId: "r_op",  name: "RedOp" },
    { userId: "b_spy", name: "BlueSpy" },
    { userId: "b_op",  name: "BlueOp" },
  ];
  return { name, members, memberPools: members.map((m) => ({ userId: m.userId, pool })), level: "B1" };
}

// Belirli role sahip ilk AÇILMAMIŞ hücrenin indeksini bul
const findCell = (g, role) => g.grid.findIndex((c) => c.role === role && !c.revealed);

describe("createGame", () => {
  test("ızgara ve takımlar kurulur", () => {
    const g = createGame(mkRoom());
    assert.ok(g.grid.length > 0, "ızgara boş olmamalı");
    assert.equal(g.status, "playing");
    assert.ok(g.teams.red.spymaster, "kırmızı şef atanmalı");
    assert.ok(g.teams.blue.spymaster, "mavi şef atanmalı");
    assert.ok(g.counts.red > 0 && g.counts.blue > 0);
  });

  test("tam olarak BİR suikastçı vardır", () => {
    const g = createGame(mkRoom());
    assert.equal(g.grid.filter((c) => c.role === "assassin").length, 1);
  });
});

describe("giveClue — sıra kuralları", () => {
  test("sırası olmayan şef ipucu veremez", () => {
    const g = createGame(mkRoom());
    const other = g.turn === "red" ? "blue" : "red";
    const r = giveClue(g, g.teams[other].spymaster, "test", 2);
    assert.ok(r.error, "sırası olmayan reddedilmeliydi");
  });

  test("boş ipucu reddedilir", () => {
    const g = createGame(mkRoom());
    assert.ok(giveClue(g, g.teams[g.turn].spymaster, "   ", 2).error);
  });

  test("sayı 1-9 aralığına kırpılır", () => {
    const g = createGame(mkRoom());
    giveClue(g, g.teams[g.turn].spymaster, "test", 99);
    assert.equal(g.clue.number, 9);
    const g2 = createGame(mkRoom());
    giveClue(g2, g2.teams[g2.turn].spymaster, "test", -5);
    assert.equal(g2.clue.number, 1);
  });

  test("ipucu verilince faz 'guess'e geçer", () => {
    const g = createGame(mkRoom());
    giveClue(g, g.teams[g.turn].spymaster, "test", 2);
    assert.equal(g.phase, "guess");
  });
});

describe("guess — kart açma sonuçları", () => {
  function ready() {
    const g = createGame(mkRoom());
    giveClue(g, g.teams[g.turn].spymaster, "ipucu", 3);
    return g;
  }
  const opOf = (g, team) => g.teams[team].operatives[0];

  test("ipucu YOKKEN tahmin edilemez", () => {
    const g = createGame(mkRoom());
    assert.ok(guess(g, opOf(g, g.turn), 0).error);
  });

  test("şef tahmin edemez", () => {
    const g = ready();
    assert.ok(guess(g, g.teams[g.turn].spymaster, findCell(g, g.turn)).error);
  });

  test("SUİKASTÇI seçilirse RAKİP kazanır — anında", () => {
    const g = ready();
    const turn = g.turn, rakip = turn === "red" ? "blue" : "red";
    const r = guess(g, opOf(g, turn), findCell(g, "assassin"));
    assert.equal(r.result, "assassin");
    assert.equal(g.status, rakip + "_won");
  });

  test("kendi ajanını bulunca sayaç artar, sıra DEVAM eder", () => {
    const g = ready();
    const turn = g.turn;
    const r = guess(g, opOf(g, turn), findCell(g, turn));
    assert.equal(r.result, "agent");
    assert.equal(g.found[turn], 1);
    assert.equal(g.turn, turn, "doğru tahminde sıra değişmemeli");
  });

  test("tarafsız kart seçilince sıra RAKİBE geçer", () => {
    const g = ready();
    const turn = g.turn;
    const idx = findCell(g, "neutral");
    if (idx < 0) return;                       // tarafsız yoksa test anlamsız
    const r = guess(g, opOf(g, turn), idx);
    assert.equal(r.result, "neutral");
    assert.notEqual(g.turn, turn, "sıra rakibe geçmeliydi");
  });

  test("tüm ajanları bulan takım KAZANIR", () => {
    // İpucu sayısı 9 verilir: takım her doğru tahminde sırayı KORUR
    // (remaining 0'a inmediği sürece endTurn çağrılmaz), böylece tek turda
    // tüm ajanlar bulunabilir ve kazanma koşulu izole test edilir.
    const g = createGame(mkRoom());
    const turn = g.turn;
    giveClue(g, g.teams[turn].spymaster, "ipucu", 9);
    const op = opOf(g, turn);
    for (let i = 0; i < g.counts[turn]; i++) {
      const idx = findCell(g, turn);
      if (idx < 0) break;
      const r = guess(g, op, idx);
      assert.ok(!r.error, `${i}. tahmin reddedildi: ${r.error}`);
    }
    assert.equal(g.found[turn], g.counts[turn], "tüm ajanlar bulunmalıydı");
    assert.equal(g.status, turn + "_won");
  });

  test("açılmış kart tekrar açılamaz", () => {
    const g = ready();
    const idx = findCell(g, g.turn);
    guess(g, opOf(g, g.turn), idx);
    assert.ok(guess(g, opOf(g, g.turn), idx).error);
  });

  test("oyun bitince tahmin kabul edilmez", () => {
    const g = ready();
    guess(g, opOf(g, g.turn), findCell(g, "assassin"));   // suikastçı → oyun biter
    assert.ok(guess(g, opOf(g, "red"), 0).error);
  });
});

describe("endGame", () => {
  test("oyun bellekten silinir (sızıntı olmasın)", () => {
    const room = mkRoom("silinecek");
    createGame(room);
    assert.ok(getGame("silinecek"));
    endGame("silinecek");
    assert.equal(getGame("silinecek"), null);
  });
});
