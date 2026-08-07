// GRAMER DERSİ — sohbet DEĞİL.
//
// KULLANICI GERİ BİLDİRİMİ: "ai sekmesinde koç dışındaki şeyler hep aynı sohbet
// odası; gramerde bana sohbetin üstünde birkaç kelime veriyor. Kullanıcı para
// verdiğine değecek, bu şekilde olmaz."
//
// Haklıydı ve hata net: Senaryo, Gramer ve Kelime Sohbeti'nin ÜÇÜ DE aynı
// TextRoom ekranına gidiyordu. Sadece istem farklıydı — yani üç ayrı özellik
// değil, tek özelliğin üç kostümü. Rakipleri "persona değil işlev" diye
// eleştirip aynı şeyi yapmışız.
//
// Gramer sohbet olamaz çünkü gramer öğrenmek KURAL + ALIŞTIRMA + GERİ BİLDİRİM
// ister. Bu modül dersi üretir: kısa kural, kullanıcının gerçekten yaptığı
// hatadan örnek, ve puanlanan alıştırmalar. Sonuç ölçülebilir — kullanıcı
// "öğrendim" diyebilir, ki sohbetten çıkarken diyemiyordu.
import { geminiText, readingConfigured, extractJson } from "./reading.js";

export const lessonConfigured = () => readingConfigured();

// Türkçe konuşanın takıldığı konular. İstemciyle aynı id'ler (AiGrammarScreen).
// Beyaz liste: id doğrudan isteme girmiyor, buradaki açıklamaya çevriliyor.
const TOPICS = {
  articles:     { name: "articles (a / an / the)", note: "Turkish has no articles, so learners drop them entirely." },
  perfect:      { name: "present perfect vs past simple", note: "Turkish has no direct equivalent; learners say 'I am living here since 2020'." },
  phrasal:      { name: "common phrasal verbs", note: "No equivalent structure in Turkish; knowing each word separately does not give the meaning." },
  prepositions: { name: "prepositions of time and place (in / on / at)", note: "Do not map cleanly onto Turkish case suffixes." },
  tenses:       { name: "past simple vs past continuous", note: "Learners mix them and produce 'I was go'." },
  conditionals: { name: "conditional sentences (if-clauses)", note: "Learners say 'If I will go'." },
};

export function topicKnown(id) { return !!TOPICS[id]; }

export async function grammarLesson({ topic, level, weakWords }) {
  const t = TOPICS[topic];
  if (!t) throw new Error("bilinmeyen konu");
  const lvl = ["A1", "A2", "B1", "B2", "C1", "C2"].includes(level) ? level : "B1";
  // Kullanıcının kendi kelimeleri örneklere girsin — ders "genel" değil "senin" olsun.
  const ws = (Array.isArray(weakWords) ? weakWords : []).filter(Boolean).slice(0, 5).join(", ");

  const prompt = `You are an English teacher writing a SHORT, PRACTICAL grammar lesson in TURKISH
for a Turkish learner at CEFR ${lvl}.

TOPIC: ${t.name}
WHY IT IS HARD FOR THEM: ${t.note}
${ws ? `Use these words the learner is currently studying in your examples where natural: ${ws}` : ""}

Write:
1) "rule": the rule in TURKISH, max 3 short sentences. Plain language, no jargon.
2) "examples": 3 items, each showing a WRONG sentence a Turkish speaker would write,
   the CORRECT version, and a one-line TURKISH explanation of the difference.
3) "exercises": 5 multiple-choice questions at ${lvl} level testing THIS topic.
   Each: an English sentence with a blank (___), 4 options, the correct index,
   and a short TURKISH explanation of why.

Return ONLY JSON:
{
  "rule": "…",
  "examples": [ { "wrong": "…", "right": "…", "why": "…" } ],
  "exercises": [ { "q": "She is ___ engineer.", "options": ["a","an","the","—"], "answer": 1, "why": "…" } ]
}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.5, maxOutputTokens: 2200, thinkingConfig: { thinkingBudget: 0 } },
  };
  const txt = await geminiText(body, { timeout: 30000, tries: 2 });
  const p = JSON.parse(extractJson(txt));

  // MODELİN ÇIKTISINI DOĞRULA. Bozuk bir soru (şıkkı eksik, cevabı aralık dışı)
  // kullanıcıya çözülemeyen bir alıştırma olarak gider ve dersi çöpe çevirir.
  // Onarmak yerine ELEMEK doğrusu: yanlış bir soru, eksik sorudan kötüdür.
  const examples = (Array.isArray(p.examples) ? p.examples : []).slice(0, 3)
    .map((e) => ({
      wrong: String(e?.wrong || "").slice(0, 160),
      right: String(e?.right || "").slice(0, 160),
      why: String(e?.why || "").slice(0, 200),
    }))
    .filter((e) => e.wrong && e.right);

  const exercises = (Array.isArray(p.exercises) ? p.exercises : []).slice(0, 6)
    .map((x) => ({
      q: String(x?.q || "").slice(0, 200),
      options: (Array.isArray(x?.options) ? x.options : []).slice(0, 4).map((o) => String(o).slice(0, 60)),
      answer: Number(x?.answer),
      why: String(x?.why || "").slice(0, 220),
    }))
    .filter((x) => x.q && x.options.length === 4 && Number.isInteger(x.answer) && x.answer >= 0 && x.answer < 4);

  if (!exercises.length) throw new Error("Ders üretilemedi, tekrar dener misin?");
  return { rule: String(p.rule || "").slice(0, 500), examples, exercises };
}
