// req.ip sahte X-Forwarded-For ile değiştirilemesin (denetim 18 Eki).
// Zincir canlıdan ölçüldü: <sahte…>, <gerçek>, <Cloudflare>, <10.x Render>; soket 127.0.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.SUPABASE_URL ||= "http://127.0.0.1:9";
const { app } = await import("../src/server.js");

const ipNe = async (xff) => (await app.inject({ method: "GET", url: "/health?xff=1", headers: { "x-forwarded-for": xff } })).json().ip;

test("sahte başlık gerçek IP'nin yerine geçmiyor", async () => {
  assert.equal(await ipNe("1.2.3.4,88.242.219.67, 104.22.72.28, 10.199.47.2"), "88.242.219.67");
  assert.equal(await ipNe("9.9.9.9, 8.8.8.8, 88.242.219.67, 162.158.41.142, 10.193.170.19"), "88.242.219.67");
});

test("sahtesiz istek de aynı IP'yi veriyor", async () => {
  assert.equal(await ipNe("88.242.219.67, 162.158.41.142, 10.193.170.19"), "88.242.219.67");
});

test("Render araya bir iç vekil daha koysa da doğru", async () => {
  assert.equal(await ipNe("1.2.3.4, 88.242.219.67, 104.22.72.28, 10.0.0.5, 10.199.47.2"), "88.242.219.67");
});
