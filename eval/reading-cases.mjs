// OKUMA PARÇASI ALTIN KÜMESİ.
//
// Koç kümesinden ayrı, çünkü iş de ayrı: koç Türkçe konuşup yönlendiriyor, okuma
// ise SIKI KURALLARLA İngilizce metin üretiyor. Bir modelin birinde iyi olması
// diğerinde iyi olacağı anlamına gelmiyor.
//
// Bu kümenin varlık sebebi somut bir olay: Gemini flash-lite %70 ucuzdu ve
// "yeterli görünüyordu", ama elle okuyunca her ölçütte kaldığı çıktı — parça
// 92 kelime (istenen 130-170), her hedef kelime yalnızca BİR kez (istenen 2-4),
// sözlükçenin yarısı kullanıcının zaten bildiği kelimeler. Fiyat tablosu bunu
// göstermiyordu; ölçüm gösterdi.
//
// Kullanıcının "bildiği kelimeler" listesi bilerek gerçekçi: sözlükçeye bunlardan
// koymak, öğrenciye zaten bildiğini öğretmeye çalışmak demek — parçanın öğretme
// kapasitesinin bir kısmını çöpe atmak.

const BILINEN = [
  "improve", "decision", "although", "recent", "provide",
  "however", "increase", "particular", "consider", "available",
];

export const READING_CASES = [
  {
    id: "b1-uc-kelime",
    baslik: "B1 · 3 hedef kelime · bilinen kelime örneğiyle",
    girdi: { level: "B1", words: ["acquire", "thorough", "reluctant"], opts: { knownSample: BILINEN } },
    bekle: { uzunluk: [130, 170], tekrar: [2, 4] },
  },
  {
    id: "b1-tek-kelime",
    baslik: "B1 · tek hedef kelime (ücretsiz kullanıcının aldığı hal)",
    girdi: { level: "B1", words: ["deliberate"], opts: { knownSample: BILINEN } },
    bekle: { uzunluk: [130, 170], tekrar: [2, 4] },
  },
  {
    id: "a2-kolay",
    baslik: "A2 · kısa parça — seviyeye uyum",
    girdi: { level: "A2", words: ["borrow", "arrive"], opts: { knownSample: BILINEN } },
    bekle: { uzunluk: [90, 120], tekrar: [2, 4] },
  },
  {
    id: "c1-zor",
    baslik: "C1 · uzun parça",
    girdi: { level: "C1", words: ["scrutiny", "mitigate", "prevalent"], opts: { knownSample: BILINEN } },
    bekle: { uzunluk: [170, 210], tekrar: [2, 4] },
  },
  {
    id: "temali",
    baslik: "B1 · tema verilmiş — konuya sadık kalmalı",
    girdi: { level: "B1", words: ["coherent", "ambiguous"], opts: { knownSample: BILINEN, topic: "space travel" } },
    bekle: { uzunluk: [130, 170], tekrar: [2, 4], temaKelimeleri: ["space", "planet", "star", "astronaut", "rocket", "orbit", "moon", "galaxy", "mars", "launch"] },
  },
  {
    id: "bilinen-yok",
    baslik: "B1 · bilinen kelime örneği YOK — yine de çalışmalı",
    girdi: { level: "B1", words: ["endeavor", "sustain"], opts: {} },
    bekle: { uzunluk: [130, 170], tekrar: [2, 4] },
  },
];

export { BILINEN };
