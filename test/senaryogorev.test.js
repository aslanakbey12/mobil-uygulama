// CANLI GÖREV TAKİBİ.
//
// Prova bugüne kadar skorunu ancak çıkışta, karnede söylüyordu — yani
// kullanıcı hedefi tutturup tutturmadığını düzeltemeyeceği anda öğreniyordu.
// Artık her yapay zekâ cevabıyla birlikte "son mesajınla hangi görevi
// bitirdin" sorusu da soruluyor ve cevabı istemciye `done` olarak gidiyor.
//
// BURADA KİLİTLENEN ÜÇ ŞEY:
//   1. Görev id'leri istemcidekiyle AYNI (app: src/core/scenariotasks.js).
//      Ayrışırsa tik sessizce hiç gelmez — hata vermeden bozulan bir özellik.
//   2. İsteme yalnızca KALAN görevler giriyor (verilmiş tik geri alınamasın).
//   3. Hepsi bitince karakter sahneyi kapatmaya yönlendiriliyor.
import { test, describe, mock } from "node:test";
import assert from "node:assert/strict";

let sonIstem = "";
let sahteCevap = { reply: "ok", suggestions: [] };
mock.module("../src/reading.js", {
  exports: {
    readingConfigured: () => true,
    UTIL_MODEL: "test",
    extractJson: (t) => t,
    geminiText: async (body) => {
      sonIstem = body.contents[0].parts[0].text;
      return JSON.stringify(sahteCevap);
    },
  },
});

const { generateReply, resolveMode, SCENARIO_GOREV } = await import("../src/chat_ai.js");

// İstemcideki SCENARIO_TASKS'in id aynası. Elle yazılı: burayı güncellemeden
// öbür tarafı değiştirmek testi düşürsün istiyoruz — sessiz ayrışma olmasın.
const ISTEMCI_IDLERI = {
  interview:  ["intro", "example", "ask"],
  meeting:    ["opinion", "react", "propose"],
  shopping:   ["describe", "price", "problem"],
  restaurant: ["order", "prefer", "bill"],
  airport:    ["checkin", "bag", "gate"],
  doctor:     ["symptom", "when", "question"],
  hotel:      ["book", "problem", "request"],
  smalltalk:  ["self", "ask", "follow"],
};

const konusma = [{ mine: false, text: "Where are you flying today?" }, { mine: true, text: "I fly to London." }];

describe("görev tablosu", () => {
  test("id'ler istemcidekiyle birebir aynı", () => {
    assert.deepEqual(Object.keys(SCENARIO_GOREV).sort(), Object.keys(ISTEMCI_IDLERI).sort());
    for (const [senaryo, idler] of Object.entries(ISTEMCI_IDLERI)) {
      assert.deepEqual(SCENARIO_GOREV[senaryo].map((g) => g.id), idler, senaryo);
    }
  });

  test("her görevin modele verilecek İngilizce tanımı var", () => {
    for (const [senaryo, liste] of Object.entries(SCENARIO_GOREV)) {
      for (const g of liste) {
        assert.ok(g.en && g.en.length > 10, `${senaryo}.${g.id} tanımsız`);
      }
    }
  });

  test("resolveMode senaryo modunda görevleri taşıyor", () => {
    const ctx = resolveMode({ mode: "scenario", scenario: "airport" });
    assert.equal(ctx.mode, "scenario");
    assert.deepEqual(ctx.gorev.map((g) => g.id), ["checkin", "bag", "gate"]);
  });

  test("koç modunda görev yok — istem şişmesin", () => {
    assert.equal(resolveMode({}).gorev, undefined);
  });
});

describe("cevap istemi", () => {
  const ctx = () => resolveMode({ mode: "scenario", scenario: "airport" });

  test("kalan görevler isteme giriyor, biten girmiyor", async () => {
    sahteCevap = { reply: "Gate 22.", suggestions: [], done: [] };
    await generateReply(konusma, [], "B1", "Bot", ctx(), ["checkin"]);
    assert.ok(sonIstem.includes("MISSION TRACKING"), "görev takibi istemde yok");
    assert.ok(!sonIstem.includes("checkin:"), "biten görev hâlâ soruluyor");
    assert.ok(sonIstem.includes("bag:") && sonIstem.includes("gate:"));
  });

  test("hepsi bitince karakter sahneyi kapatmaya yönlendiriliyor", async () => {
    sahteCevap = { reply: "Have a good flight!", suggestions: [] };
    await generateReply(konusma, [], "B1", "Bot", ctx(), ["checkin", "bag", "gate"]);
    assert.ok(sonIstem.includes("REHEARSAL IS COMPLETE"), "kapanış yönergesi yok");
    assert.ok(!sonIstem.includes("MISSION TRACKING"), "kalan görev yokken takip sorulmamalı");
  });

  test("senaryo dışı sohbette görev takibi hiç sorulmuyor", async () => {
    sahteCevap = { reply: "Nice!", suggestions: [] };
    await generateReply(konusma, ["apple"], "B1", "Bot", resolveMode({}), []);
    assert.ok(!sonIstem.includes("MISSION TRACKING"));
    assert.ok(!sonIstem.includes("REHEARSAL IS COMPLETE"));
  });
});

describe("model cevabının süzülmesi", () => {
  const ctx = () => resolveMode({ mode: "scenario", scenario: "airport" });

  test("gerçek görev id'leri geçiyor", async () => {
    sahteCevap = { reply: "Ok.", suggestions: [], done: ["bag"] };
    const r = await generateReply(konusma, [], "B1", "Bot", ctx(), []);
    assert.deepEqual(r.done, ["bag"]);
  });

  test("uydurulan id atılıyor — tik yalnızca bilinen göreve verilir", async () => {
    sahteCevap = { reply: "Ok.", suggestions: [], done: ["bag", "uydurma", "passport"] };
    const r = await generateReply(konusma, [], "B1", "Bot", ctx(), []);
    assert.deepEqual(r.done, ["bag"]);
  });

  test("zaten verilmiş tik ikinci kez dönmüyor", async () => {
    sahteCevap = { reply: "Ok.", suggestions: [], done: ["checkin"] };
    const r = await generateReply(konusma, [], "B1", "Bot", ctx(), ["checkin"]);
    assert.deepEqual(r.done, []);
  });

  test("done alanı hiç gelmezse boş dizi", async () => {
    sahteCevap = { reply: "Ok.", suggestions: [] };
    const r = await generateReply(konusma, [], "B1", "Bot", ctx(), []);
    assert.deepEqual(r.done, []);
  });
});
