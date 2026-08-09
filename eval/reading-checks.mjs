// OKUMA PARÇASI DENETİMLERİ.
//
// Hepsi deterministik: model kullanmıyor, saniyeler sürüyor. Bunlar istemde
// AÇIKÇA söz verdiğimiz şeyler — bir söz tutulmuyorsa üslubu tartışmanın anlamı
// yok. Öznel kalite (metin ilgi çekici mi, doğal mı) hâlâ okumayı gerektiriyor.
//
// Kelime sayarken Türkçe/İngilizce fark etmeksizin harf dizilerine ayırıyoruz;
// regex'te \w kullanmıyoruz çünkü JavaScript'in \w sınıfı ı/ş/ğ/ö/ü/ç tanımıyor
// ve koç denetimlerinde bu tam olarak "çalışıyor görünüp hiçbir şey yapmama"ya
// yol açmıştı.
const belirtec = (s) => String(s).toLowerCase().split(/[^a-zçğıöşü]+/i).filter(Boolean);

export function denetleParca(vaka, p) {
  const b = vaka.bekle || {};
  const hedef = vaka.girdi.words || [];
  const bilinen = vaka.girdi.opts?.knownSample || [];
  const out = [];
  const ekle = (ad, gecti, detay = "") => out.push({ ad, gecti, detay });

  if (!p || typeof p !== "object") { ekle("parça üretildi", false, "boş"); return out; }

  // ── YAPI ────────────────────────────────────────────────────────────────
  const metin = String(p.passage || "");
  ekle("başlık var", String(p.title || "").trim().length > 0);
  ekle("parça var", metin.trim().length > 0);

  const sorular = Array.isArray(p.questions) ? p.questions : [];
  ekle("3 soru", sorular.length === 3, `${sorular.length}`);
  const bozukSoru = sorular.filter((q) =>
    !String(q?.q || "").trim() ||
    !Array.isArray(q?.options) || q.options.length !== 4 ||
    q.options.some((o) => !String(o || "").trim()) ||
    !Number.isInteger(q?.answer) || q.answer < 0 || q.answer > 3);
  ekle("sorular geçerli (4 şık + doğru indeks)", bozukSoru.length === 0, `${bozukSoru.length} bozuk`);

  const sozluk = Array.isArray(p.glossary) ? p.glossary : [];
  ekle("sözlükçe 6-8 madde", sozluk.length >= 6 && sozluk.length <= 8, `${sozluk.length}`);
  const eksikAlan = sozluk.filter((g) => !String(g?.en || "").trim() || !String(g?.tr || "").trim());
  ekle("sözlükçe maddeleri tam", eksikAlan.length === 0, `${eksikAlan.length} eksik`);

  // ── ÖĞRETME İŞİ ─────────────────────────────────────────────────────────
  const kelimeler = belirtec(metin);

  if (b.uzunluk) {
    const n = metin.trim().split(/\s+/).filter(Boolean).length;
    const [alt, ust] = b.uzunluk;
    // %15 tolerans: istem "about" diyor, birkaç kelime sapma kusur değil.
    // Ama flash-lite'ın 92/130 sapması bu toleransın çok dışındaydı.
    ekle(`uzunluk ~${alt}-${ust}`, n >= alt * 0.85 && n <= ust * 1.15, `${n} kelime`);
  }

  if (b.tekrar) {
    const [alt, ust] = b.tekrar;
    for (const h of hedef) {
      const kok = h.toLowerCase();
      // Çekimli biçimler sayılır: istem "varied forms allowed" diyor.
      const k = kelimeler.filter((w) => w.startsWith(kok.slice(0, Math.max(4, kok.length - 2)))).length;
      ekle(`"${h}" ${alt}-${ust} kez`, k >= alt && k <= ust, `${k} kez`);
    }
  }

  // SÖZLÜKÇE HEDEF KELİMELERİ İÇERMELİ — parçanın öğretmeye çalıştığı şey onlar.
  const sozlukKelime = sozluk.map((g) => String(g.en || "").toLowerCase().trim());
  const eksikHedef = hedef.filter((h) => !sozlukKelime.some((s) => s.startsWith(h.toLowerCase().slice(0, 4))));
  ekle("hedef kelimeler sözlükçede", eksikHedef.length === 0, eksikHedef.join(", "));

  // BİLİNEN KELİME SÖZLÜKÇEYE GİRMEMELİ.
  // Gerçek olay: flash-lite'ın 6 maddesinden 3'ü kullanıcının zaten bildiği
  // kelimelerdi (although, improve, recent) — üstelik onları isteme "biliyor"
  // diye biz vermiştik. Bu, parçanın öğretme kapasitesinin yarısını çöpe atmak.
  if (bilinen.length) {
    const bosa = sozlukKelime.filter((s) => bilinen.some((k) => k.toLowerCase() === s));
    ekle("sözlükçede boşa madde yok", bosa.length === 0, bosa.join(", "));
  }

  // Parça İNGİLİZCE olmalı — Türkçe sızması seviye ayarını da bozar.
  const trHarf = (metin.match(/[çğıöşüÇĞİÖŞÜ]/g) || []).length;
  ekle("parça İngilizce", trHarf <= 2, trHarf ? `${trHarf} Türkçe harf` : "");

  // Sorular parçaya dayanmalı: soru metninde geçen anahtar bir kelime parçada da olmalı.
  if (sorular.length) {
    const kopuk = sorular.filter((q) => {
      const qk = belirtec(q.q).filter((w) => w.length > 4);
      return qk.length > 0 && !qk.some((w) => kelimeler.includes(w));
    });
    ekle("sorular parçaya dayanıyor", kopuk.length === 0, `${kopuk.length} kopuk soru`);
  }

  if (b.temaKelimeleri) {
    const varMi = b.temaKelimeleri.some((t) => kelimeler.includes(t));
    ekle("verilen temaya sadık", varMi, varMi ? "" : "temadan hiç iz yok");
  }

  return out;
}
