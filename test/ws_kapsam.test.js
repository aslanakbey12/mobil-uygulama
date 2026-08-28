// WEBSOCKET İŞLEYİCİSİNDE `reply` KULLANILAMAZ.
//
// NEDEN BU TEST VAR: canlıda şu satır duruyordu —
//     if (aiRateLimited(userId)) return reply.code(429).send({ ... });
// HTTP uçlarından WS `socket.on("message")` geri çağrısının içine olduğu gibi
// kopyalanmıştı. Orada `reply` diye bir bağ yok; sınır aşılınca ReferenceError
// fırlıyor, yakalayıcı olmadığı için Node süreci ölüyor ve sunucu HERKES için
// kapanıyordu. Kötü niyet de gerekmiyordu: üstteki 1,5 sn'lik aralık kapısı
// dakikada 40 mesaja izin veriyor, sınır ise 20 — hızlı yazan sıradan bir
// kullanıcı 21. mesajda sunucuyu düşürüyordu.
//
// Sözdizimi denetimi bunu YAKALAMAZ (geçerli JavaScript), testler de yakalamaz
// (o yol hiç çalıştırılmıyor). O yüzden kaynağın kendisine bakıyoruz.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const kaynak = fs.readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const satirlar = kaynak.split(/\r?\n/);

// socket.on("message", ...) gövdesinin sınırlarını süslü parantez sayarak bul.
function wsGovdesi() {
  const bas = satirlar.findIndex((s) => s.includes('socket.on("message"'));
  assert.ok(bas >= 0, 'socket.on("message") bulunamadı — dosya yeniden düzenlenmiş olabilir');
  let derinlik = 0;
  for (let i = bas; i < satirlar.length; i++) {
    for (const ch of satirlar[i]) {
      if (ch === "{") derinlik++;
      else if (ch === "}") derinlik--;
    }
    if (i > bas && derinlik <= 0) return { bas, son: i };
  }
  throw new Error("ws gövdesinin sonu bulunamadı");
}

test("ws mesaj işleyicisinde `reply` kullanılmıyor", () => {
  const { bas, son } = wsGovdesi();
  const suclular = [];
  for (let i = bas; i <= son; i++) {
    // yorum satırlarını atla — bu hatayı ANLATAN yorumlar var
    const s = satirlar[i].replace(/\/\/.*$/, "");
    if (/\breply\s*\./.test(s)) suclular.push(`${i + 1}: ${satirlar[i].trim()}`);
  }
  assert.deepEqual(
    suclular, [],
    "WS geri çağrısında `reply` yok; oradan yanıt vermek için sockets.push kullan:\n" + suclular.join("\n")
  );
});

test("ws mesaj işleyicisi try/catch ile sarılı", () => {
  const { bas, son } = wsGovdesi();
  const govde = satirlar.slice(bas, son + 1);
  assert.ok(
    /^\s*try\s*\{\s*$/.test(govde[1] || ""),
    "işleyicinin ilk satırı `try {` olmalı — tek kullanıcının mesajı sunucuyu düşürmemeli"
  );
  assert.ok(
    govde.some((s) => /catch\s*\(/.test(s)),
    "işleyicide catch bloğu yok"
  );
});

test("hız sınırı aşıldığında kullanıcı sessizlikte bırakılmıyor", () => {
  const { bas, son } = wsGovdesi();
  const govde = satirlar.slice(bas, son + 1).join("\n");
  const i = govde.indexOf("aiRateLimited(userId)");
  assert.ok(i > 0, "ws gövdesinde aiRateLimited kontrolü yok — hız sınırı kalkmış");
  // Kontrolden sonraki 12 satırda kullanıcıya bir şey gönderiliyor olmalı.
  const sonrasi = govde.slice(i).split("\n").slice(0, 12).join("\n");
  assert.match(sonrasi, /sockets\.push\(/, "sınır aşımında kullanıcıya haber verilmiyor");
});
