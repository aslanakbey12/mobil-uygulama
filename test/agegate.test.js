// Sosyal odaların 16+ yaş kapısı.
//
// Bu kapı bir kez ZATEN kırılmıştı: sunucu, istemcinin gövdede gönderdiği
// `ageConfirmed` boolean'ına güveniyordu ve istemcinin beş çağrı yerinin hepsi
// sabit `true` yazıyordu → kapı hiç kapanmadı, 13 yaşındaki kullanıcı odalara
// girdi. Gizlilik politikamız §5'te bunun aksini TAAHHÜT ediyor.
//
// Buradaki testler o hatanın geri gelmesini engeller. En kritik olanı
// "hata durumunda KAPALI": Supabase okunamıyorsa izin VERMEMELİYİZ.
// Bu davranış sessizce "açık"a dönerse kapı yine işlevsiz kalır.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

// Supabase yapılandırılmamış ortam → supa() null döner.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;

const { isAgeConfirmed } = await import("../src/entitlements.js");

describe("yaş kapısı (16+)", () => {
  test("Supabase yoksa İZİN VERMEZ (fail-closed)", async () => {
    // Fail-open olsaydı, veritabanı erişilemez olduğunda kapı tamamen açılırdı.
    assert.equal(await isAgeConfirmed("bir-kullanici-id"), false);
  });

  test("kullanıcı kimliği yoksa izin vermez", async () => {
    assert.equal(await isAgeConfirmed(null), false);
    assert.equal(await isAgeConfirmed(undefined), false);
    assert.equal(await isAgeConfirmed(""), false);
  });

  test("istemciden gelen hiçbir değer sonucu DEĞİŞTİREMEZ", async () => {
    // Fonksiyonun imzası yalnızca userId alır: gövdeden gelen bir "ageConfirmed"
    // buraya sızamaz. İmza genişletilirse bu test kırılır ve sebebi sorulur.
    assert.equal(isAgeConfirmed.length, 1);
  });
});
