// HAFTALIK KOÇ RAPORU.
//
// NEDEN VAR: Kullanıcı "bu uygulamaya para vermeliyim" hissini bir özellik
// listesinden değil, ürünün ONU ANLADIĞINI görmesinden alır. Gerçek bir
// öğretmen yoklama yapar: "bu hafta şunu yaptın, şurada takıldın, haftaya
// planın bu". Bunu yapabilmemizin sebebi, kullanıcının 8671 kelimede tek tek
// nerede olduğunu bilmemiz — genel bir sohbet botunun asla sahip olmadığı veri.
//
// MALİYET: haftada TEK çağrı. Ölçtük: ~1500 girdi + ~500 çıktı token, yani
// kullanıcı başına ayda birkaç kuruş. Algılanan değeri ise en yüksek olan şey.
// Bu yüzden ücretsiz kullanıcıya da veriyoruz: güveni kuran şey bu, ve güven
// olmadan ödeme olmuyor.
import { geminiText, readingConfigured, extractJson } from "./reading.js";
import { supa } from "./supabase.js";

export const coachConfigured = () => readingConfigured();

// Haftanın anahtarı (pazartesi). Aynı hafta içinde tekrar istenirse kayıtlı
// rapor döner — hem maliyet hem tutarlılık için (rapor hafta boyunca değişmemeli,
// yoksa kullanıcı her açtığında farklı bir "plan" görür ve güven kaybeder).
// BAŞTAN SONA UTC. İlk yazışımda gün hesabı YEREL (getDay/setDate), biçimlendirme
// ise UTC (toISOString) idi. Saat dilimi kayması olan yerde bu ikisi çelişiyor:
// UTC+3'te pazartesi 01:00, UTC'de hâlâ pazar 22:00 → anahtar bir hafta geriye
// düşüyordu. Test yakaladı. Karışık kullanmak yerine tek zaman ekseninde kal:
// sunucu zaten UTC'de çalışıyor ve UTC her makinede aynı sonucu verir.
export function weekKey(now = new Date()) {
  const d = new Date(now);
  const gun = (d.getUTCDay() + 6) % 7;        // pazartesi = 0
  d.setUTCDate(d.getUTCDate() - gun);
  return d.toISOString().slice(0, 10);
}

// Kayıtlı raporu getir (varsa).
export async function loadReport(userId, wk) {
  const db = supa();
  if (!db || !userId) return null;
  try {
    const { data, error } = await db.from("coach_reports")
      .select("report").eq("user_id", userId).eq("week", wk).maybeSingle();
    if (error || !data) return null;
    return data.report || null;
  } catch (_) { return null; }
}

async function saveReport(userId, wk, report) {
  const db = supa();
  if (!db || !userId) return;
  try {
    await db.from("coach_reports").upsert({ user_id: userId, week: wk, report, created_at: new Date().toISOString() });
  } catch (_) { /* yazamamak raporu geçersiz kılmaz — sadece haftaya yeniden üretilir */ }
}

// Profil özeti + haftanın rakamlarından rapor üret.
//
// GÜVENLİK: `profile` istemciden geliyor ama SERBEST METİN DEĞİL — istemci onu
// sabit listelerden üretiyor (core/learnerprofile.js) ve kimlik bilgisi içermiyor.
// Yine de burada uzunluk kırpması yapıyoruz: şişmiş bir profil hem maliyeti
// artırır hem de istemin geri kalanını bastırabilir.
export async function weeklyReport({ profile, stats }) {
  const pf = String(profile || "").slice(0, 900);
  const s = stats || {};
  const sayilar = [
    `words learned this week: ${Number(s.learnedThisWeek) || 0}`,
    `words that slipped back: ${Number(s.lapsedThisWeek) || 0}`,
    `study days this week: ${Number(s.activeDays) || 0}/7`,
    `text coverage: ~${Number(s.coverage) || 0}%`,
  ].join("\n");

  const prompt = `You are a warm, direct English coach for a Turkish learner.
Write their WEEKLY REPORT. Be specific and honest — never generic praise.

LEARNER PROFILE:
${pf}

THIS WEEK:
${sayilar}

Write in TURKISH. Return ONLY JSON:
{
  "headline": "one sentence, max 12 words, what this week really was",
  "win": "one specific thing they did well (reference a real number)",
  "gap": "the ONE thing holding them back most, stated plainly and kindly",
  "plan": ["3 concrete actions for next week, each max 10 words, imperative"]
}
Rules: no empty encouragement. If the numbers are weak, say so gently but clearly.
Reference their actual weak words or skill gap when relevant. Speak to them as "sen".`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.6, maxOutputTokens: 500, thinkingConfig: { thinkingBudget: 0 } },
  };
  const txt = await geminiText(body, { timeout: 20000, tries: 2 });
  const parsed = JSON.parse(extractJson(txt));
  // Modelden gelen yapıyı DOĞRULA: eksik alan arayüzü boş bırakır, uzun metin
  // tasarımı bozar. Modele güvenip doğrudan göstermek, kontrolü ona vermek olur.
  return {
    headline: String(parsed.headline || "").slice(0, 120),
    win: String(parsed.win || "").slice(0, 300),
    gap: String(parsed.gap || "").slice(0, 300),
    plan: (Array.isArray(parsed.plan) ? parsed.plan : []).slice(0, 3).map((x) => String(x).slice(0, 120)),
  };
}

// ── KOÇ SOHBETİ ─────────────────────────────────────────────────────────────
//
// Koç bir sohbet arkadaşı DEĞİL. Amacı muhabbet değil, kullanıcıyı 3-5 mesajda
// DOĞRU İŞE yönlendirmek. Serbest sohbet olsaydı beğenmediğimiz şeye dönerdi:
// hoş vakit, sıfır sonuç.
//
// Yönlendirme "şuraya git" demekle olmuyor — öyle diyen her sistem kullanıcıyı
// kaybeder. Koçun cevabı EYLEM taşıyor: istemci bunları buton olarak çiziyor,
// kullanıcı basınca iş sohbetin içinden başlıyor.
//
// EYLEMLER YZ MODLARIYLA SINIRLI DEĞİL. Koç tüm uygulamanın yönlendiricisi:
// "kelime kaydır", "arkadaş edin" de diyebilmeli. Kullanıcının ihtiyacı bazen
// bir YZ özelliği değil, zaten var olan bir bölüm.
//
// GÜVENLİK: model bu listeden BAŞKA bir eylem uyduramaz. resolveMode'daki
// beyaz liste mantığının aynısı — modelin ürettiği metin navigasyona
// dönüşüyorsa, o metin doğrulanmadan kullanılamaz.
export const ACTIONS = {
  swipe:    "Kelimeler bölümünde yeni kelime keşfet",
  practice: "Alıştırma turu yap (SRS tekrarları)",
  reading:  "Seviyene uygun bir okuma parçası oku",
  scenario: "Senaryo provası yap (mülakat, market, doktor…)",
  grammar:  "Gramer konusu çalış (a/the, present perfect, phrasal verb…)",
  wordchat: "Kelime Koçu ile takıldığın kelimeler üzerine sohbet et",
  friends:  "Arkadaş ekle (birlikte pratik için)",
  social:   "Gerçek biriyle pratik yap (yazılı/sesli oda, oyun)",
};

// Modelin döndürdüğü eylemleri temizle. Bilinmeyen tür → düşer.
function sanitizeActions(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const a of arr.slice(0, 3)) {
    const kind = String(a?.kind || "");
    if (!ACTIONS[kind]) continue;                     // beyaz liste
    out.push({
      kind,
      label: String(a?.label || "").slice(0, 60) || kind,
      ref: String(a?.ref || "").slice(0, 40) || null, // senaryo/gramer alt seçimi
    });
  }
  return out;
}

// Modelin önerdiği plan güncellemesini temizle. Serbest metin alanları KIRPILIR;
// adımların türü yine beyaz listeden geçer.
function sanitizePlan(p) {
  if (!p || typeof p !== "object") return null;
  const adimlar = (Array.isArray(p.steps) ? p.steps : [])
    .filter((s) => ACTIONS[String(s?.kind || "")])
    .slice(0, 5)
    .map((s) => ({
      kind: String(s.kind),
      ref: String(s.ref || "").slice(0, 40) || null,
      label: String(s.label || "").slice(0, 80),
      done: false,
    }));
  if (!adimlar.length) return null;
  return {
    goal: String(p.goal || "").slice(0, 80),
    deadline: String(p.deadline || "").slice(0, 20),
    focus: String(p.focus || "").slice(0, 20),
    steps: adimlar,
  };
}

export async function coachReply({ profile, plan, history, first }) {
  const pf = String(profile || "").slice(0, 900);
  const konusma = (Array.isArray(history) ? history : []).slice(-10)
    .map((m) => `${m.mine ? "Learner" : "Coach"}: ${String(m.text || "").slice(0, 300)}`)
    .join("\n");
  const mevcutPlan = plan
    ? `CURRENT PLAN: goal="${plan.goal}" deadline="${plan.deadline}" focus="${plan.focus}"\nSteps: ${(plan.steps || []).map((s) => `${s.kind}${s.done ? "(done)" : ""}`).join(", ")}`
    : "CURRENT PLAN: none yet.";

  const prompt = `You are the learner's personal English coach inside a vocabulary app.
You know this learner's real data. Speak TURKISH. Be warm but BRIEF.

${pf}

${mevcutPlan}

YOUR JOB — this is not small talk:
${first
    ? "This is your FIRST conversation. Greet warmly, and find out WHY they are learning English and what their goal is (exam? work? travel?). You may take a few more messages here — this matters."
    : "Get to the point within 3-5 messages, then direct them to a concrete action."}
- Reference their REAL data (weak words, skill gap) — that is what makes you their coach.
- End almost every message with either a question OR actions.
- Never suggest more than 3 actions at once.

AVAILABLE ACTIONS (you may ONLY use these kinds):
${Object.entries(ACTIONS).map(([k, v]) => `  ${k} — ${v}`).join("\n")}

Conversation so far:
${konusma || "(none yet)"}

Return ONLY JSON:
{
  "reply": "your message in Turkish, max 45 words",
  "actions": [ { "kind": "one of the kinds above", "label": "Turkish button text, max 5 words", "ref": "optional sub-choice like 'interview' or 'articles'" } ],
  "plan": null or { "goal": "...", "deadline": "...", "focus": "...", "steps": [ { "kind": "...", "ref": "...", "label": "..." } ] }
}
Set "plan" ONLY when you have enough information to commit to one (usually after the goal is clear). Otherwise null.`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.7, maxOutputTokens: 450, thinkingConfig: { thinkingBudget: 0 } },
  };
  const txt = await geminiText(body, { timeout: 18000, tries: 2 });
  const parsed = JSON.parse(extractJson(txt));
  return {
    reply: String(parsed.reply || "").slice(0, 400),
    actions: sanitizeActions(parsed.actions),
    plan: sanitizePlan(parsed.plan),
  };
}

// Uçtan uca: kayıtlı varsa onu ver, yoksa üret + kaydet.
export async function getOrCreateReport(userId, { profile, stats }) {
  const wk = weekKey();
  const kayitli = await loadReport(userId, wk);
  if (kayitli) return { report: kayitli, week: wk, cached: true };
  const report = await weeklyReport({ profile, stats });
  await saveReport(userId, wk, report);
  return { report, week: wk, cached: false };
}
