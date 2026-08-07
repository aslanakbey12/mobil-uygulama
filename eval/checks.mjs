// KOÇ CEVABININ DENETİMLERİ.
//
// Bunların hepsi DETERMİNİSTİK: model kullanmıyor, saniyeler sürüyor, ve aynı
// girdiye hep aynı cevabı veriyor. Öznel kalite için ayrıca yargıç var (judge.mjs),
// ama önce bunlar — çünkü istemde AÇIKÇA söz verdiğimiz şeyler bunlar ve bir söz
// tutulmuyorsa öznel kaliteyi tartışmanın anlamı yok.
//
// Her denetim { ad, gecti, detay } döndürür.
import { ACTIONS } from "../src/coach.js";

// Türkçe'ye özgü karakterler + sık kullanılan ekler/kelimeler. Tek bir sinyale
// güvenmiyoruz: "Ok." gibi kısa bir cevap her iki dilde de geçerli görünebilir.
const TR_IPUCU = /[çğıöşüÇĞİÖŞÜ]|\b(bir|için|senin|seni|sana|ama|çok|nasıl|neden|hangi|var|yok|değil|gibi|daha|kadar)\b/i;
const EN_IPUCU = /\b(the|your|you|and|with|that|this|what|how|why|which|have|will|would|should)\b/gi;

function cumleSay(s) {
  return String(s).split(/[.!?…]+/).map((x) => x.trim()).filter((x) => x.length > 1).length;
}
function soruSay(s) {
  return (String(s).match(/\?/g) || []).length;
}
// "3 kelime üst üste aynı" → notu aynen geri söylemiş sayılır. Tam eşleşme aramak
// yetmez: model notu hafifçe yeniden yazıp yine ele verebilir.
function ucluOrtak(a, b) {
  const k = (s) => String(s).toLowerCase().replace(/[^a-zçğıöşü0-9\s]/gi, " ").split(/\s+/).filter((w) => w.length > 2);
  const A = k(a), B = new Set();
  const bk = k(b);
  for (let i = 0; i + 2 < bk.length; i++) B.add(bk[i] + " " + bk[i + 1] + " " + bk[i + 2]);
  for (let i = 0; i + 2 < A.length; i++) if (B.has(A[i] + " " + A[i + 1] + " " + A[i + 2])) return A[i] + " " + A[i + 1] + " " + A[i + 2];
  return null;
}

export function denetle(vaka, cevap) {
  const b = vaka.bekle || {};
  const reply = String(cevap?.reply || "");
  const actions = Array.isArray(cevap?.actions) ? cevap.actions : [];
  const plan = cevap?.plan || null;
  const out = [];
  const ekle = (ad, gecti, detay = "") => out.push({ ad, gecti, detay });

  // ── HER VAKADA GEÇERLİ ────────────────────────────────────────────────────
  ekle("cevap boş değil", reply.trim().length > 0);

  // İstem: "2-4 sentences". 5'e tolerans yok — koçun uzun konuşması tam da
  // "sohbet botu gibi" olmasının işareti ve bunu bilerek yasakladık.
  const c = cumleSay(reply);
  ekle("2-4 cümle", c >= 2 && c <= 4, `${c} cümle`);

  // İstem: "Ask ONE question at a time — a coach does not interrogate."
  if (b.tekSoru !== false) {
    const s = soruSay(reply);
    ekle("tek soru", s <= 1, `${s} soru işareti`);
  }

  // Eylem türleri beyaz listeden olmalı (güvenlik + istemci yönlendirmesi buna bağlı)
  const bilinmeyen = actions.filter((a) => !ACTIONS[a?.kind]).map((a) => a?.kind);
  ekle("eylem türleri geçerli", bilinmeyen.length === 0, bilinmeyen.join(", "));

  // İstem: "label: Turkish button text, max 5 words"
  const uzunEtiket = actions.filter((a) => String(a?.label || "").trim().split(/\s+/).length > 5);
  ekle("eylem etiketi ≤5 kelime", uzunEtiket.length === 0, uzunEtiket.map((a) => a.label).join(" | "));

  // ── VAKAYA ÖZGÜ ───────────────────────────────────────────────────────────
  if (b.eylemYok) ekle("eylem YOK (aşama izin vermiyor)", actions.length === 0, `${actions.length} eylem`);
  if (b.planYok) ekle("plan YOK (aşama izin vermiyor)", !plan, plan ? JSON.stringify(plan).slice(0, 60) : "");
  if (b.enFazlaEylem != null) ekle(`en fazla ${b.enFazlaEylem} eylem`, actions.length <= b.enFazlaEylem, `${actions.length}`);
  if (b.enAzEylem != null) ekle(`en az ${b.enAzEylem} eylem`, actions.length >= b.enAzEylem, `${actions.length}`);

  if (b.turkce) {
    const trSkor = TR_IPUCU.test(reply);
    const enSkor = (reply.match(EN_IPUCU) || []).length;
    ekle("Türkçe konuşuyor", trSkor && enSkor < 4, `tr=${trSkor} en_kelime=${enSkor}`);
  }

  // İstem: "Say ONE concrete thing you already see in their data".
  // Profildeki gerçek bir sayı ya da gerçek bir zayıf kelime geçmeli.
  if (b.veriyeAtif) {
    const pf = String(vaka.girdi.profile || "");
    const sayilar = (pf.match(/\d+/g) || []).filter((n) => n.length > 1);
    const zayif = (pf.match(/Weak: ([^.]+)/)?.[1] || "").split(",").map((w) => w.trim()).filter(Boolean);
    const sayiVar = sayilar.some((n) => reply.includes(n));
    const kelimeVar = zayif.some((w) => reply.toLowerCase().includes(w.toLowerCase()));
    ekle("gerçek veriye atıf", sayiVar || kelimeVar, sayiVar ? "sayı" : kelimeVar ? "kelime" : "hiçbiri");
  }

  // İstem: "NEVER quote them back — that would be creepy."
  if (b.notlariAynenSoyleme) {
    const nots = vaka.girdi.notes?.observations || [];
    let ihlal = null;
    for (const n of nots) { const ortak = ucluOrtak(n, reply); if (ortak) { ihlal = `"${ortak}"`; break; } }
    ekle("notları aynen söylemiyor", !ihlal, ihlal || "");
  }

  // GERÇEK HATA: dönen kullanıcıya her seferinde yeniden tanıtıyordu.
  if (b.kendiniTanitma) {
    const kalip = /(ben senin (kişisel )?koçun|ben .{0,12}koç|tanış(alım|ma)|merhaba, ben|kendimi tanıtay)/i;
    const m = reply.match(kalip);
    ekle("kendini yeniden tanıtmıyor", !m, m ? m[0] : "");
  }

  // Veri yokken sayı UYDURMAMALI — güveni en hızlı yıkan şey budur.
  if (b.uydurmaSayi) {
    const pf = String(vaka.girdi.profile || "");
    const uydurma = (reply.match(/%?\d+/g) || [])
      .map((x) => x.replace("%", ""))
      .filter((n) => n.length > 1 && !pf.includes(n));
    ekle("olmayan sayı uydurmuyor", uydurma.length === 0, uydurma.join(", "));
  }

  // İstem metni ya da sistem talimatı sızmamalı.
  if (b.istemSizmasi) {
    const kalip = /(SESSION STAGE|AVAILABLE ACTIONS|Return ONLY JSON|You are this learner|PRIVATE NOTES|CURRENT PLAN)/i;
    const m = reply.match(kalip);
    ekle("istem sızmıyor", !m, m ? m[0] : "");
  }

  if (b.gecerliEylem && actions.length) {
    const hepsiEtiketli = actions.every((a) => String(a?.label || "").trim().length > 0);
    ekle("eylemlerin etiketi var", hepsiEtiketli);
  }

  return out;
}
