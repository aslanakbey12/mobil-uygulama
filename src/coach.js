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

// Koç için tercih edilen model. Ayarlanabilir bırakıldı: model isimleri değişiyor
// ve kilitli bir isim, model emekliye ayrılınca koçu sessizce bozardı.
const COACH_MODEL = process.env.COACH_MODEL || "gemini-pro-latest";

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
    // PLAN İLERLEMESİ — döngüyü kapatan bilgi. Rapor, koçun verdiği planın ne
    // kadarının yapıldığını görmezse "geçen hafta konuştuklarımız ne oldu"
    // sorusu cevapsız kalır ve plan ciddiyetini kaybeder.
    s.planGoal ? `their goal: "${String(s.planGoal).slice(0, 80)}"` : "no goal set yet",
    s.planTotal ? `plan steps completed: ${Number(s.planDone) || 0}/${Number(s.planTotal)}` : "",
  ].filter(Boolean).join("\n");

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
Reference their actual weak words or skill gap when relevant. Speak to them as "sen".
If they have a goal and a plan, ALWAYS mention how far they got with it — that is
the whole point of having a coach. If they did none of the plan, say it kindly
but do not pretend it did not happen.`;

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
  grammar:  "Gramer dersi al: kural + örnekler + puanlanan alıştırma",
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

// ── SOHBET HAFIZASI (db/16_coach_chats.sql) ─────────────────────────────────
// Geçmiş artık SUNUCUDA. Eskiden istemci her istekte kendi geçmişini
// gönderiyordu; bu üç şeyi birden bozuyordu: ekran kapanınca sohbet yok
// oluyordu, ikinci cihazda hiç yoktu, ve kimse kaliteyi göremiyordu.
const CHAT_CAP = 80;   // saklanan mesaj sayısı — sohbet sınırsız büyümesin

export async function loadChat(userId) {
  const db = supa();
  if (!db || !userId) return { messages: [], updatedAt: null };
  try {
    const { data, error } = await db.from("coach_chats")
      .select("messages, updated_at").eq("user_id", userId).maybeSingle();
    if (error || !data) return { messages: [], updatedAt: null };
    return { messages: Array.isArray(data.messages) ? data.messages : [], updatedAt: data.updated_at };
  } catch (_) { return { messages: [], updatedAt: null }; }
}

export async function saveChat(userId, messages) {
  const db = supa();
  if (!db || !userId) return;
  try {
    await db.from("coach_chats").upsert({
      user_id: userId,
      messages: messages.slice(-CHAT_CAP),
      updated_at: new Date().toISOString(),
    });
  } catch (_) { /* yazamamak cevabı geçersiz kılmaz; sadece o mesaj hatırlanmaz */ }
}

// Son mesajdan bu yana geçen süre → seans sınırı. Ayrı "seans" kaydı tutmuyoruz;
// koçluk ilişkisi sürekli, aradaki boşluk zamandan anlaşılır. Bu sayede koç
// "üç gündür yoksun" diyebiliyor — ki bir koçu koç yapan şey bu.
function aradanGecen(updatedAt) {
  if (!updatedAt) return null;
  const gun = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
  return Number.isFinite(gun) && gun >= 0 ? gun : null;
}

export async function coachReply({ profile, plan, history, first, gapDays = null }) {
  const pf = String(profile || "").slice(0, 900);
  const konusma = (Array.isArray(history) ? history : []).slice(-10)
    .map((m) => `${m.mine ? "Learner" : "Coach"}: ${String(m.text || "").slice(0, 300)}`)
    .join("\n");
  const mevcutPlan = plan
    ? `CURRENT PLAN: goal="${plan.goal}" deadline="${plan.deadline}" focus="${plan.focus}"\nSteps: ${(plan.steps || []).map((s) => `${s.kind}${s.done ? "(done)" : ""}`).join(", ")}`
    : "CURRENT PLAN: none yet.";

  // Mesaj sayısı → seansın hangi aşamasında olduğumuz.
  // Kullanıcı geri bildirimi: "girdim, ilk mesajdan beni bir yere yönlendiriyor,
  // saçma." Haklıydı — eski istem "3-5 mesajda yönlendir" diyordu ve model bunu
  // "hemen yönlendir" diye uyguluyordu. Gerçek bir koç önce ANLAR, sonra yönlendirir.
  const hepsi = Array.isArray(history) ? history : [];
  const tur = hepsi.filter((m) => m.mine).length;
  const asama = tur === 0 ? "TANIŞMA" : tur < 3 ? "ANLAMA" : tur < 5 ? "TEŞHİS" : "PLAN";

  // GEÇMİŞ SEANSLAR. Koç yalnızca son 10 mesajı görmemeli — o kadarı "bu
  // seansta ne konuştuk" demek. Daha eskisi "seni tanıyorum" demek, ve bir koçu
  // koç yapan fark tam olarak bu. Eski kısım özet olarak veriliyor: tamamını
  // göndermek hem maliyeti hem gecikmeyi büyütür, hem de modelin dikkatini dağıtır.
  const eski = hepsi.slice(0, -10);
  const gecmis = eski.length
    ? `EARLIER SESSIONS (older context, ${eski.length} messages):\n${eski.slice(-16)
        .map((m) => `${m.mine ? "Learner" : "Coach"}: ${String(m.text || "").slice(0, 140)}`).join("\n")}`
    : "";
  const ara = gapDays == null ? ""
    : gapDays >= 1
      ? `They were last here ${gapDays} day(s) ago. Acknowledge the gap naturally — do NOT re-introduce yourself, you already know each other.`
      : "They were here earlier today. Continue naturally, do not restart.";

  const prompt = `You are this learner's personal English coach. Speak TURKISH, address them as "sen".
This is a COACHING SESSION, not a chatbot. A real coach listens first, understands the
person, reflects back what they see, and only then proposes a plan — together.

WHAT YOU KNOW ABOUT THEM (real data from the app):
${pf}

${mevcutPlan}
${gecmis}
${ara}

SESSION STAGE: ${asama}
${asama === "TANIŞMA" ? (eski.length ? `Open a NEW session with someone you already know. Do NOT introduce yourself again.
Reference something concrete from your earlier sessions (their goal, something they said,
or whether they did what you agreed). Then ask how it went. NO actions yet.` : `Open the session. Introduce yourself briefly as their coach. Say ONE concrete
thing you already see in their data (a real number or a real weak word) so they feel known.
Then ask ONE open question about what they want from English.
DO NOT suggest any action yet. DO NOT return any actions. This is hello.`)
  : asama === "ANLAMA" ? `Keep listening. Ask about their goal, deadline, where they use English,
what they find hardest. React to what they actually said — do not change the subject.
Still NO actions. You are building understanding.`
  : asama === "TEŞHİS" ? `Now reflect: tell them what you see in their data and connect it to what
they told you. Be specific ("kelimeleri tanıyorsun ama kuramıyorsun" style). Ask whether
this matches how they feel. You may offer AT MOST 1 action if it fits naturally.`
  : `Now propose a plan TOGETHER. Summarise the goal in their own words, suggest 2-3 concrete
steps and ask for confirmation. Offer the actions that match those steps.`}

HOW TO SPEAK:
- Warm, direct, human. Never robotic, never a bulleted lecture.
- 2-4 sentences. Ask ONE question at a time — a coach does not interrogate.
- Reference their REAL data; that is what makes you their coach and not a chatbot.
- Never repeat a question they already answered.

AVAILABLE ACTIONS (you may ONLY use these kinds, and ONLY when the stage allows):
${Object.entries(ACTIONS).map(([k, v]) => `  ${k} — ${v}`).join("\n")}

Conversation so far:
${konusma || "(none yet — you speak first)"}

Return ONLY JSON:
{
  "reply": "your message in Turkish, 2-4 sentences",
  "actions": [ { "kind": "one of the kinds above", "label": "Turkish button text, max 5 words", "ref": "optional sub-choice like 'interview' or 'articles'" } ],
  "plan": null or { "goal": "...", "deadline": "...", "focus": "...", "steps": [ { "kind": "...", "ref": "...", "label": "..." } ] }
}
Return "actions": [] unless the stage above allows them.
Set "plan" ONLY at the PLAN stage, and only once the goal is genuinely clear. Otherwise null.`;

  // KOÇTA KALİTE > HIZ.
  // Diğer yerlerde flash kullanıyoruz çünkü hız önemli (sohbet ritmi, görsel
  // arama). Koç ise ürünün ödeme zemini: kullanıcının "bu beni anlıyor"
  // demesi buna bağlı. O yüzden güçlü modeli TERCİH ediyoruz — zincir hâlâ
  // devrede, model cevap veremezse flash'a düşer ve sohbet ölmez.
  // thinkingConfig YOK: pro modelleri thinkingBudget:0'ı reddediyor (bkz. bodyFor).
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.75, maxOutputTokens: 600 },
  };
  const txt = await geminiText(body, { timeout: 28000, tries: 2, prefer: COACH_MODEL });
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
