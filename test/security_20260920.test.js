// 20 Eyl 2026 GÜVENLİK DENETİMİ — koruyucu testler.
// Her biri bir bulguya karşılık: kimlik varsayılanı, hata sızıntısı, girdi sınırları.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const SRC = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");

test("kimlik: AUTH_STRICT belirtilmezse KİLİTLİ (fail-closed)", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  delete process.env.AUTH_STRICT;
  const auth = await import("../src/auth.js?strict=" + Date.now());
  const req = { headers: { "x-user-id": "saldirgan" }, body: { userId: "saldirgan" }, query: {} };
  assert.equal(auth.getUserId(req), null);
});

test("YZ 502 cevapları sağlayıcı hata metnini taşımıyor", () => {
  assert.equal((SRC.match(/code\(502\)\.send\(\{ error: String\(e\.message/g) || []).length, 0);
  assert.ok(SRC.includes("app.setErrorHandler("));
});

test("başkasına görünen adlar temizAd'dan geçiyor", () => {
  for (const rota of ["/league/sync", "/matchmaking/join", "/rooms/create", "/rooms/join", "/rooms/ai", "/friends/invite"]) {
    const i = SRC.indexOf(`app.post("${rota}"`);
    assert.ok(i > 0, rota);
    const govde = SRC.slice(i, SRC.indexOf("\napp.", i + 10));
    assert.ok(govde.includes("temizAd("), rota + " temizAd yok");
  }
});

test("/report ve /block yalnız UUID hedef alıyor; klip sıra kontrolü saklamadan önce", () => {
  const rep = SRC.slice(SRC.indexOf('app.post("/report"'), SRC.indexOf('app.post("/block"'));
  assert.ok(rep.includes("UUID_RE.test(String(targetId"));
  assert.ok(!rep.includes("roomName, reason }, \"report\")"), "sebep metni loga yazılmamalı");
  const clip = SRC.slice(SRC.indexOf('app.post("/voiceroom/clip"'), SRC.indexOf('app.get("/voiceroom/clip/:id"'));
  assert.ok(clip.indexOf("currentSpeaker(vr) !== userId") < clip.indexOf("voiceroom.putClip("));
});

test("koç sohbeti sunucu bayrağı olmadan 404", () => {
  const koc = SRC.slice(SRC.indexOf('app.post("/coach/chat"'), SRC.indexOf('app.get("/coach/history"'));
  assert.ok(koc.includes('process.env.COACH_CHAT_OPEN !== "1"'));
});
