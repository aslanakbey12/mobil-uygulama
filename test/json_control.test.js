// DİZE İÇİNDEKİ HAM KONTROL KARAKTERİ.
//
// GERÇEK OLAY: okuma parçası üretimi bazı isteklerde "Okuma oluşturulamadı" ile
// düşüyordu. Çıktı EKSİK DEĞİLDİ — finishReason=STOP, 3472 karakter tam JSON.
// Model paragraf arasına kaçırılmamış bir satır sonu koymuştu:
//   Bad control character in string literal in JSON at position 502
//
// repairJson bunu kurtaramaz: o KESİLME için yazıldı (sondan kırpıp geçerli
// kapanış arar), burada ise bozukluk ortada ve son zaten sağlam. Bu iki arızayı
// birbirine karıştırmak, düzeltilmiş sanıp aynı hatayı yaşamaya devam etmekti.
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test";

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const { extractJson, escapeControls } = await import("../src/reading.js");

describe("dize içi kontrol karakteri", () => {
  test("ham satır sonu kaçırılır ve JSON ayrıştırılabilir olur", () => {
    const bozuk = '{"passage": "Birinci paragraf.\nİkinci paragraf.", "title": "X"}';
    assert.throws(() => JSON.parse(bozuk), /control character/i);
    const o = JSON.parse(extractJson(bozuk));
    assert.equal(o.passage, "Birinci paragraf.\nİkinci paragraf.");
    assert.equal(o.title, "X");
  });

  test("tab ve satır başı da kaçırılır", () => {
    const o = JSON.parse(extractJson('{"a": "x\ty", "b": "p\rq"}'));
    assert.equal(o.a, "x\ty");
    assert.equal(o.b, "p\rq");
  });

  test("dize DIŞINDAKİ satır sonlarına dokunulmaz (JSON'da geçerli)", () => {
    const duzgun = '{\n  "a": 1,\n  "b": 2\n}';
    assert.deepEqual(JSON.parse(extractJson(duzgun)), { a: 1, b: 2 });
  });

  test("ZATEN KAÇIRILMIŞ diziler bozulmaz", () => {
    // \n iki karakterdir (ters bölü + n) ve dokunulmamalı; ters bölü takibi
    // yapılmazsa bu tür girdiler ikinci kez kaçırılıp metni bozardı.
    const o = JSON.parse(extractJson('{"a": "satir1\nsatir2", "b": "tirnak: \\" bitti"}'));
    assert.equal(o.a, "satir1\nsatir2");
    assert.equal(o.b, 'tirnak: " bitti');
  });

  test("kaçırılmış tırnak dizeyi yanlışlıkla kapatmaz", () => {
    // `\"` görüp dizeyi kapattığını sanan bir uygulama, sonraki gerçek satır
    // sonlarını "dize dışı" sayıp kaçırmaz ve hata devam ederdi.
    const bozuk = '{"a": "o \\"tam\\" dedi\nsonra sustu"}';
    const o = JSON.parse(extractJson(bozuk));
    assert.equal(o.a, 'o "tam" dedi\nsonra sustu');
  });

  test("escapeControls saf metinde bozulma yapmaz", () => {
    const t = '{"a":"normal metin, ünlü harfler: çğıöşü"}';
    assert.equal(escapeControls(t), t);
  });
});
