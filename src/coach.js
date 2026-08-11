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
import { geminiText, readingConfigured, extractJson, repairJson } from "./reading.js";
import { supa } from "./supabase.js";

export const coachConfigured = () => readingConfigured();

// GÜVENLİ AYRIŞTIRMA. Model çıktısı bütçe dolunca CÜMLE ORTASINDA kesilebilir
// ve JSON.parse "Unterminated string" ile patlar (gerçek olay). Okuma tarafında
// bunun için yazılmış repairJson zaten vardı ama koç yollarında kullanılmıyordu:
// yarım kalan son öğe atılır, gerisi kurtarılır.
export function parseJson(txt) {
  const clean = extractJson(txt);
  try { return JSON.parse(clean); } catch (_) { /* onarmayı dene */ }
  try { return repairJson(clean); } catch (_) { /* o da olmadı */ }
  // Onarım da başaramadıysa (kesilme ilk alanın ortasındaysa kurtarılacak tam
  // öğe yoktur) kullanıcıya ayrıştırıcının teknik metnini GÖSTERME. "Unterminated
  // string in JSON at position 40" bir son kullanıcı için hiçbir şey ifade etmiyor
  // ve ne yapacağını da söylemiyor.
  throw new Error("Koç şu an cevap üretemedi, tekrar dener misin?");
}

// Koç için tercih edilen model. Ayarlanabilir bırakıldı: model isimleri değişiyor
// ve kilitli bir isim, model emekliye ayrılınca koçu sessizce bozardı.
const COACH_MODEL = process.env.COACH_MODEL || "gemini-pro-latest";
// Haftalık rapor için ayrı model — koçun yapışkan modeline düşmesin (bkz. weeklyReport).
const REPORT_MODEL = process.env.REPORT_MODEL || "gemini-flash-lite-latest";

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

// RAPORUN HAFTASI = TAMAMLANMIŞ son hafta, içinde bulunulan hafta DEĞİL.
//
// Eskiden rapor sürmekte olan haftayı anlatıyordu ve bu iki hatayı birden
// üretiyordu:
//
//   1. Rakamlar hep eksikti. Pazartesi sabahı raporunu açan herkes "bu hafta
//      hiç çalışmamışsın" değerlendirmesi alıyordu — doğru ama işe yaramaz.
//   2. Daha kötüsü, rapor hafta anahtarına göre önbelleğe alındığı için o eksik
//      değerlendirme PAZARA KADAR ekranda kalıyordu. Kullanıcı cuma günü
//      açtığında üstte "38 yeni kelime" yazarken başlıkta hâlâ "henüz
//      başlamamışsın" duruyordu. Rapor kendi ekranındaki rakamla çelişiyordu.
//
// Ayrıca `trend` alanı donmuş anlık görüntüleri kıyaslıyordu: geçen haftanın
// perşembe fotoğrafı ile bu haftanın pazartesi fotoğrafı. Model uydurmuyordu,
// yanlış veriyi biz veriyorduk.
//
// Bitmiş hafta hem TAM hem de gerçekten değişmez — yani önbelleğe almak artık
// bir uzlaşma değil, doğru davranış.
export function raporHaftasi(now = new Date()) {
  return weekKey(new Date(new Date(now).getTime() - 7 * 86400000));
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

// Raporu VE dayandığı rakamları sakla. Rakamlar olmadan gelecek hafta
// karşılaştırma yapılamıyordu (bkz. db/19_report_stats.sql).
async function saveReport(userId, wk, report, stats) {
  const db = supa();
  if (!db || !userId) return;
  try {
    await db.from("coach_reports").upsert({ user_id: userId, week: wk, report, stats: stats || null, created_at: new Date().toISOString() });
  } catch (_) { /* yazamamak raporu geçersiz kılmaz — sadece haftaya yeniden üretilir */ }
}

// ÖNCEKİ haftanın rakamları. "Bir önceki hafta" değil "bundan önceki EN SON
// rapor": kullanıcı bir hafta hiç girmemişse o hafta rapor da üretilmemiştir ve
// katı bir "geçen pazartesi" sorgusu boş döner. Kıyas kaybolacağına iki hafta
// öncesiyle yapılsın — koç kaç hafta önce olduğunu da söyleyebilsin diye
// haftayı birlikte döndürüyoruz.
async function loadPrevStats(userId, wk) {
  const db = supa();
  if (!db || !userId) return null;
  try {
    const { data, error } = await db.from("coach_reports")
      .select("week, stats").eq("user_id", userId).lt("week", wk)
      .order("week", { ascending: false }).limit(1).maybeSingle();
    if (error || !data?.stats) return null;
    return { week: data.week, stats: data.stats };
  } catch (_) { return null; }
}

// SON HAFTALARIN RAKAMLARI — beceri grafiği ve trend çizgisi için.
// İstemci tek haftanın verisine sahip; geçmişi sunucu tutuyor (coach_reports).
export async function loadHistory(userId, wk, n = 8) {
  const db = supa();
  if (!db || !userId) return [];
  try {
    const { data, error } = await db.from("coach_reports")
      .select("week, stats").eq("user_id", userId).lte("week", wk)
      .order("week", { ascending: false }).limit(n);
    if (error || !Array.isArray(data)) return [];
    return data.filter((r) => r.stats).map((r) => ({ week: r.week, stats: r.stats })).reverse();
  } catch (_) { return []; }
}

// AKRAN KIYASI — aynı seviyedeki kullanıcıların ortalaması.
//
// ASGARİ GRUP ŞARTI kritik ve iki sebebi var. Küçük grupta ortalama gürültüdür
// (üç kişilik "ortalama" hiçbir şey söylemez), ve daha önemlisi GİZLİLİK: az
// kişilik bir havuzda kullanıcı kendi katkısını çıkarıp diğerini tahmin
// edebilir. Eşiğin altında bu blok HİÇ üretilmiyor — özellik kullanıcı sayısı
// büyüyene kadar kendiliğinden kapalı kalır.
const AKRAN_ESIK = 30;

export async function loadPeer(wk, level) {
  const db = supa();
  if (!db || !level) return null;
  try {
    const { data, error } = await db.from("coach_reports")
      .select("stats").eq("week", wk).limit(500);
    if (error || !Array.isArray(data)) return null;
    const ayni = data
      .map((r) => r.stats)
      .filter((s) => s && s.level === level && Number.isFinite(Number(s.activeDays)));
    if (ayni.length < AKRAN_ESIK) return null;
    const ort = (alan) => {
      const v = ayni.map((s) => Number(s[alan]) || 0);
      return Math.round(v.reduce((t, x) => t + x, 0) / v.length);
    };
    return { n: ayni.length, activeDays: ort("activeDays"), learned: ort("learnedThisWeek") };
  } catch (_) { return null; }
}

// Profil özeti + haftanın rakamlarından rapor üret.
//
// GÜVENLİK: `profile` istemciden geliyor ama SERBEST METİN DEĞİL — istemci onu
// sabit listelerden üretiyor (core/learnerprofile.js) ve kimlik bilgisi içermiyor.
// Yine de burada uzunluk kırpması yapıyoruz: şişmiş bir profil hem maliyeti
// artırır hem de istemin geri kalanını bastırabilir.
export async function weeklyReport({ profile, stats, prev = null, behaviour = "" }) {
  const pf = String(profile || "").slice(0, 900);
  const s = stats || {};
  const dav = String(behaviour || "").slice(0, 500);

  // GEÇEN HAFTAYLA KIYAS. İnsanı hareket ettiren şey mutlak sayı değil YÖN.
  // "40 kelime öğrendin" tek başına bir şey ifade etmiyor; "geçen hafta 25'ti"
  // eklendiğinde cümle bambaşka oluyor. Gerileme için daha da önemli: kullanıcı
  // yavaşladığını kendisi fark etmez, koçun söylemesi gerekir.
  //
  // İLK HAFTA BLOK HİÇ KONULMUYOR — kıyaslanacak veri yokken model uydurur ve
  // "geçen haftaya göre daha iyisin" gibi asılsız bir cümle güveni yıkar.
  const p = prev?.stats;
  const kiyas = p ? [
    "",
    `THE WEEK BEFORE (week of ${prev.week}) — compare against it:`,
    `  words learned: ${Number(p.learnedThisWeek) || 0}  (reported week: ${Number(s.learnedThisWeek) || 0})`,
    `  study days: ${Number(p.activeDays) || 0}/7  (reported week: ${Number(s.activeDays) || 0}/7)`,
    `  words slipped back: ${Number(p.lapsedThisWeek) || 0}  (reported week: ${Number(s.lapsedThisWeek) || 0})`,
    'You MUST fill the "trend" field using these numbers. Do not flatter: if they',
    "slowed down, say so plainly and make that the gap.",
  ].join("\n") : "";

  const sayilar = [
    `words learned: ${Number(s.learnedThisWeek) || 0}`,
    `words that slipped back: ${Number(s.lapsedThisWeek) || 0}`,
    `study days: ${Number(s.activeDays) || 0}/7`,
    // KAPSAM ŞU ANKİ durum, geçen haftanın değil — geriye dönük hesaplanamıyor.
    // Modele bunu açıkça söylüyoruz, yoksa "geçen hafta %41'e çıkmışsın" gibi
    // dayanağı olmayan bir cümle kurar.
    `text coverage RIGHT NOW (not a last-week figure): ~${Number(s.coverage) || 0}%`,
    // PLAN İLERLEMESİ — döngüyü kapatan bilgi. Rapor, koçun verdiği planın ne
    // kadarının yapıldığını görmezse "geçen hafta konuştuklarımız ne oldu"
    // sorusu cevapsız kalır ve plan ciddiyetini kaybeder.
    // GERİLEYEN KELİMELERİN ADLARI. Sayı ("9 kelime geriledi") bir ölçüm;
    // adlar bir TEŞHİS imkânı — koç ortak yanı görüp adlandırabilir ("üçü de
    // soyut fiil"). Sayı hiçbir şey yaptırmıyor, ad yaptırıyor.
    Array.isArray(s.lapsedWords) && s.lapsedWords.length
      ? `which words slipped (most-forgotten first): ${s.lapsedWords.slice(0, 6).map((w) => String(w).slice(0, 24)).join(", ")}`
      : "",
    // GÜN DESENİ. "2/7 gün" dağınık mı hafta sonuna mı yığılmış, göstermiyor.
    // Desen görünce koç somut bir şey önerebilir; sayı görünce ancak "daha çok
    // çalış" diyebilir ki bu tavsiye değil temenni.
    s.dayPattern ? `daily activity, oldest to newest: ${String(s.dayPattern).slice(0, 120)}` : "",
    s.planGoal ? `their goal: "${String(s.planGoal).slice(0, 80)}"` : "no goal set yet",
    s.planTotal ? `plan steps completed: ${Number(s.planDone) || 0}/${Number(s.planTotal)}` : "",
  ].filter(Boolean).join("\n");

  const prompt = `You are a warm, direct English coach for a Turkish learner.
Write their WEEKLY REPORT. Be specific and honest — never generic praise.

The week being reported is FINISHED. Write about it in the past tense ("geçen
hafta"), never as if it were still running — do not say "bu hafta henüz" or
suggest they still have time to fix it. The plan you give is for the week they
are in NOW.

LEARNER PROFILE:
${pf}

LAST WEEK (completed):
${sayilar}
${kiyas}
${dav ? `\nWHAT THEY ACTUALLY DID (activity log):\n${dav}\n` : ""}
Write in TURKISH. Return ONLY JSON:
{
  "headline": "one sentence, max 12 words, what this week really was",
  "trend": ${p
    ? '"ONE sentence comparing the reported week to the week before it, naming BOTH numbers (e.g. \'Bir önceki hafta 25 kelime, geçen hafta 40.\'). Required."'
    : '"" (no earlier report exists — leave it EMPTY and never imply a direction: do not write \'düştü\', \'arttı\', \'yavaşladın\'. You have nothing to compare against and guessing would be a lie about their own data.)'},
  "win": "one specific thing they did well (reference a real number)",
  "gap": "the ONE thing holding them back most, stated plainly and kindly",
  "focus": "one word: the skill this week's plan targets",
  "steps": [ { "kind": "one of the kinds below", "label": "Turkish, imperative, max 6 words" } ]
}

STEPS — this is the plan, and every step must be startable inside the app.
Give exactly 3 steps, ordered: the first one is what they should do TODAY.
Use ONLY these kinds:
${Object.entries(ACTIONS).map(([k, v]) => `  ${k} — ${v}`).join("\n")}

The plan used to be written twice — once as prose, once as buttons — and the two
could disagree. Now there is ONE plan and each step is a button. A step nobody
can press is advice, not coaching, so never describe an action that is not one of
the kinds above.
Rules: no empty encouragement. If the numbers are weak, say so gently but clearly.
If you were given the words that slipped, NAME them and say what they have in
common if anything — that is a diagnosis, and a count is not.
If the daily activity pattern shows where their week actually goes (all weekend,
nothing on weekdays, a long gap), say it and let your plan work WITH that pattern
instead of asking them to become a different person.
Reference their actual weak words or skill gap when relevant. Speak to them as "sen".
If they have a goal and a plan, ALWAYS mention how far they got with it — that is
the whole point of having a coach. If they did none of the plan, say it kindly
but do not pretend it did not happen.`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.6, maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 } },
  };
  // MODELİ SABİTLE. Rapor `prefer` kullanmıyordu, yani zincirin YAPIŞKAN modeline
  // düşüyordu: koç sohbeti pro'yu ısıttığı anda haftalık rapor da pro'da çalışıyor
  // ve 1024 düşünme token'ı harcıyordu (lite'ta aynı iş 0). Rapor kısa ve yapısal
  // bir özet; pahalı modelin katkısı yok. Ücretsiz kullanıcıya da verdiğimiz için
  // hacmi yüksek — sabitlemek gerekiyor.
  const txt = await geminiText(body, { timeout: 20000, tries: 2, prefer: REPORT_MODEL });
  const parsed = parseJson(txt);
  // Modelden gelen yapıyı DOĞRULA: eksik alan arayüzü boş bırakır, uzun metin
  // tasarımı bozar. Modele güvenip doğrudan göstermek, kontrolü ona vermek olur.
  return {
    headline: String(parsed.headline || "").slice(0, 120),
    // Kıyas verisi yokken model yön UYDURMASIN diye burada da kesiyoruz:
    // istemde "boş bırak" yazsa da tek savunma istem olmamalı.
    trend: prev?.stats ? String(parsed.trend || "").slice(0, 200) : "",
    win: String(parsed.win || "").slice(0, 300),
    gap: String(parsed.gap || "").slice(0, 300),
    focus: String(parsed.focus || "").slice(0, 20),
    // TEK PLAN, HER ADIMI BİR EYLEM. Aynı beyaz liste: model buradan başka bir
    // adım uyduramaz — ürettiği metin navigasyona dönüşüyorsa doğrulanmadan
    // kullanılamaz. sanitizeActions bilinmeyen türü sessizce düşürür.
    steps: sanitizeActions(parsed.steps),
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
  if (!db || !userId) return { messages: [], updatedAt: null, notes: null, noteMark: 0 };
  try {
    const { data, error } = await db.from("coach_chats")
      .select("messages, updated_at, notes, note_mark").eq("user_id", userId).maybeSingle();
    if (error || !data) return { messages: [], updatedAt: null, notes: null, noteMark: 0 };
    return {
      messages: Array.isArray(data.messages) ? data.messages : [],
      updatedAt: data.updated_at,
      notes: data.notes || null,
      noteMark: Number(data.note_mark) || 0,
    };
  } catch (_) { return { messages: [], updatedAt: null, notes: null, noteMark: 0 }; }
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

// ── KOÇUN NOTLARI (db/17_coach_notes.sql) ───────────────────────────────────
//
// Sohbet geçmişinden FARKLI bir şey: geçmiş "ne konuşuldu", not "bu kişi nasıl
// biri". Biri olay kaydı, diğeri yargı. Koç her mesajda kullanıcıyı sıfırdan
// okuyup kanaat oluşturuyordu; artık birikmiş bir kanaati var.
const NOTE_EVERY = 6;    // kaç yeni mesajda bir not güncellensin

// Notları GÜNCELLE (sıfırdan yazma). Eskiyi verip "değiştir/ekle/çıkar" demek,
// her seferinde baştan yazdırmaktan farklı: gözlem birikir, çelişen eski gözlem
// düşer. Baştan yazsaydık koçun hafızası her seans sıfırlanırdı — çözmeye
// çalıştığımız sorunun aynısı.
export async function updateNotes({ notes, history }) {
  const son = (Array.isArray(history) ? history : []).slice(-20)
    .map((m) => `${m.mine ? "Learner" : "Coach"}: ${String(m.text || "").slice(0, 200)}`).join("\n");
  if (!son) return null;

  const mevcut = notes?.observations?.length
    ? `EXISTING NOTES:\n${notes.observations.map((o) => `- ${o}`).join("\n")}\nWhat works: ${notes.whatWorks || "—"}`
    : "EXISTING NOTES: none yet.";

  const prompt = `You are an English coach keeping PRIVATE notes about a learner, like a real
coach would between sessions. These notes are for YOU, not shown to the learner.

${mevcut}

RECENT CONVERSATION:
${son}

Update your notes. Write in TURKISH.

What belongs in notes: how this person BEHAVES and what works with them.
  Good: "tarih vermekten kaçınıyor", "söz veriyor ama yapmıyor",
        "meydan okumaya iyi tepki veriyor", "sabah çalışıyor"
  Bad (do NOT write these): what they know, their level, word counts —
  you already get that from the app data. Notes are about the PERSON.

Rules:
- Keep at most 6 observations. Drop ones that are now contradicted or stale.
- Each observation max 12 words, concrete, based on something they actually said or did.
- If the conversation gave you nothing new, return the existing notes unchanged.
- Never invent. If you have no basis for a judgement, leave it out.

Return ONLY JSON:
{ "observations": ["…"], "whatWorks": "one short sentence about how to motivate them, or empty" }`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 1500, thinkingConfig: { thinkingBudget: 0 } },
  };
  const txt = await geminiText(body, { timeout: 20000, tries: 1, prefer: COACH_MODEL });
  const p = parseJson(txt);
  const obs = (Array.isArray(p.observations) ? p.observations : [])
    .map((o) => String(o).slice(0, 90)).filter(Boolean).slice(0, 6);
  if (!obs.length) return null;
  return { observations: obs, whatWorks: String(p.whatWorks || "").slice(0, 160), updatedAt: new Date().toISOString() };
}

// Notlar yeterince yeni mesaj birikince güncellenir. Her cevapta üretmek
// gereksiz maliyet ve gecikme olurdu.
export function notesDue(messageCount, noteMark) {
  return messageCount - (Number(noteMark) || 0) >= NOTE_EVERY;
}

export async function saveNotes(userId, notes, mark) {
  const db = supa();
  if (!db || !userId || !notes) return;
  try {
    await db.from("coach_chats").update({ notes, note_mark: mark }).eq("user_id", userId);
  } catch (_) { /* not yazamamak sohbeti bozmaz — sonraki turda tekrar denenir */ }
}

// Son mesajdan bu yana geçen süre → seans sınırı. Ayrı "seans" kaydı tutmuyoruz;
// koçluk ilişkisi sürekli, aradaki boşluk zamandan anlaşılır. Bu sayede koç
// "üç gündür yoksun" diyebiliyor — ki bir koçu koç yapan şey bu.
function aradanGecen(updatedAt) {
  if (!updatedAt) return null;
  const gun = Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000);
  return Number.isFinite(gun) && gun >= 0 ? gun : null;
}

export async function coachReply({ profile, behaviour, plan, history, first, gapDays = null, notes = null }) {
  const pf = String(profile || "").slice(0, 900);
  // NE YAPTIĞI. profile ne BİLDİĞİNİ anlatıyor; bu ne YAPTIĞINI. İkisi ayrı
  // bloklar çünkü koçun onlara farklı davranması gerekiyor: bilgi teşhis içindir,
  // davranış hesap sormak içindir. (bkz. app/src/core/learnerprofile.js)
  const dav = String(behaviour || "").slice(0, 600);
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
  // AŞAMA OTURUMA GÖRE, TOPLAM GEÇMİŞE GÖRE DEĞİL.
  //
  // Önce aşama o güne kadarki TÜM kullanıcı mesajlarından hesaplanıyordu ve iki
  // yönde birden bozuktu:
  //   - 5 mesajı geçen kullanıcı KALICI olarak PLAN aşamasında kalıyordu. Altı ay
  //     sonra yeni bir hedefle gelse ("artık iş değil, sınav için lazım") koç
  //     dinlemeye dönemiyor, doğrudan plan yapmaya geçiyordu. Gerçek bir koç yeni
  //     bir hedef duyunca yeniden dinlemeye başlar.
  //   - Tersi de vardı: az mesajlı ama PLANI OLAN kullanıcıda aşama ANLAMA çıkıyor
  //     ve o aşamada eylem vermek yasak; koç tam gereken anda butonu koyamıyordu.
  //
  // Oturum sınırı: son mesajdan 6 saatten uzun bir boşluk. Damga yoksa (eski
  // kayıtlar) tüm geçmiş tek oturum sayılır — eski davranış, sessiz bozulma yok.
  const OTURUM_ARASI = 6 * 3600 * 1000;
  let baslangic = 0;
  for (let i = hepsi.length - 1; i > 0; i--) {
    const a = Date.parse(hepsi[i]?.at || "");
    const b = Date.parse(hepsi[i - 1]?.at || "");
    if (Number.isFinite(a) && Number.isFinite(b) && a - b > OTURUM_ARASI) { baslangic = i; break; }
  }
  const oturum = hepsi.slice(baslangic);
  const tur = oturum.filter((m) => m.mine).length;
  const asama = tur === 0 ? "TANIŞMA" : tur < 3 ? "ANLAMA" : tur < 5 ? "TEŞHİS" : "PLAN";
  // PLANI OLAN kullanıcıda erken aşamalarda da eylem serbest. Plan zaten üzerinde
  // anlaşılmış bir taahhüt; "önce dinle" kuralı yeni tanışmak için var, hatırlatma
  // için değil. Aksi halde koç "okuma adımın bekliyor" deyip butonu koyamıyordu.
  const planVar = !!plan?.goal && (plan.steps || []).some((s) => !s.done);

  // GEÇMİŞ SEANSLAR. Koç yalnızca son 10 mesajı görmemeli — o kadarı "bu
  // seansta ne konuştuk" demek. Daha eskisi "seni tanıyorum" demek, ve bir koçu
  // koç yapan fark tam olarak bu. Eski kısım özet olarak veriliyor: tamamını
  // göndermek hem maliyeti hem gecikmeyi büyütür, hem de modelin dikkatini dağıtır.
  // KOÇUN KENDİ NOTLARI — istemin en başında. "Bu kişi ne biliyor" verisi
  // zaten var; bu, "bu kişi nasıl biri" sorusunun cevabı ve koçu sohbet
  // botundan ayıran şey.
  const not = notes?.observations?.length
    ? [
        "YOUR PRIVATE NOTES ABOUT THIS PERSON (from earlier sessions).",
        "Use them to shape how you talk to them. NEVER quote them back — that would be creepy.",
        // ÖLÇÜM: hem Gemini pro hem DeepSeek notu OKUYUP mazereti kabullendi ve konu
        // değiştirdi — yani tam da notun uyardığı şeyi yaptı. Notu saklamak yetmiyor;
        // ne YAPILACAĞINI söylemek gerekiyor.
        "These notes are instructions for your behaviour, not background reading.",
        "If a note says they dodge something, do not let them dodge it this time — kindly but",
        "concretely. When they give you an excuse, accept it in one clause and then ask for a",
        "specific commitment: a day, a time, or one small step they will actually do.",
        ...notes.observations.map((o) => `- ${o}`),
        notes.whatWorks ? `What works with them: ${notes.whatWorks}` : "",
      ].filter(Boolean).join("\n")
    : "";

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
${dav ? `
WHAT THEY ACTUALLY DID (activity log — facts, not their account of it):
${dav}

This log is the single thing a generic chatbot can never have. Use it:
- Refer to it concretely when it matters ("okuma dedik, üç gündür açmadın").
- NEVER open with a contradiction. Do not write "ama/oysa/halbuki ... girmişsin".
  Confronting someone with their own log makes them feel watched and caught, and
  they stop coming back — which costs us the learner, not just the session.
  The shape is: accept what they said, state the fact flatly beside it, then ask
  what makes that step hard. Like this:
    "Anlıyorum. Bu hafta dört gün buradaydın ama okuma adımına sıra gelmemiş —
     onu zorlaştıran ne?"
  Notice: no accusation, and the question is about the OBSTACLE, not the excuse.
- Never read the log out as a list. It is there to make your questions land.` : ""}

${not}

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
${planVar ? "They already have a plan with unfinished steps: you MAY offer ONE action for the next step. The plan is an agreement you both made; ignoring it while asking questions makes it look forgotten. This permission does NOT soften anything else: if they just gave you an excuse, the notes rule still applies — accept it in one clause, then ask for a specific commitment (a day, a time, or one small step)." : "Still NO actions. You are building understanding."}`
  : asama === "TEŞHİS" ? `Now reflect: tell them what you see in their data and connect it to what
they told you. Be specific ("kelimeleri tanıyorsun ama kuramıyorsun" style). Ask whether
this matches how they feel. You may offer AT MOST 1 action if it fits naturally.`
  : `Now propose a plan TOGETHER. Summarise the goal in their own words, suggest 2-3 concrete
steps and ask for confirmation. Offer the actions that match those steps.`}

HOW TO SPEAK:
- Warm, direct, human. Never robotic, never a bulleted lecture.
- Ask ONE question at a time — a coach does not interrogate, and two questions at once
  makes people answer only the easy one. Joining two asks with "ve" is still two questions.
  (An either/or question — "X mi, yoksa Y mi?" — counts as ONE and is welcome.)
- Reference their REAL data; that is what makes you their coach and not a chatbot.
- COPY SKILL NAMES EXACTLY as they appear in the data above. If it says "eşleştirme %82",
  never turn that into another word. Attaching a real number to the wrong skill — or to
  their job, their hobby, anything not in the data — is worse than saying nothing: they
  will see that you got their own data wrong and stop believing the rest.
- If they have a CURRENT PLAN, you must acknowledge where it stands before moving on.
  A plan nobody mentions is a plan nobody follows.
- Never repeat a question they already answered.

AVAILABLE ACTIONS (you may ONLY use these kinds, and ONLY when the stage allows):
${Object.entries(ACTIONS).map(([k, v]) => `  ${k} — ${v}`).join("\n")}

Conversation so far:
${konusma || "(none yet — you speak first)"}

Return ONLY JSON:
{
  "reply": "Turkish. HARD LIMITS: at most 4 sentences, and EXACTLY ONE question mark in the entire message. Count before you answer.",
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
    generationConfig: { responseMimeType: "application/json", temperature: 0.75, maxOutputTokens: 3200, thinkingConfig: { thinkingBudget: 0 } },
  };
  const txt = await geminiText(body, { timeout: 28000, tries: 2, prefer: COACH_MODEL });
  const parsed = parseJson(txt);
  return {
    reply: String(parsed.reply || "").slice(0, 400),
    actions: sanitizeActions(parsed.actions),
    plan: sanitizePlan(parsed.plan),
  };
}

// Uçtan uca: kayıtlı varsa onu ver, yoksa üret + kaydet.
//
// HAFTA = BİTMİŞ HAFTA (raporHaftasi). İstemci de rakamları o pencere için
// hesaplıyor; ikisi ayrışırsa rapor yine kendi rakamlarıyla çelişir.
export async function getOrCreateReport(userId, { profile, stats, behaviour }) {
  const wk = raporHaftasi();
  // GEÇMİŞ VE AKRAN her zaman taze getiriliyor — rapor önbellekten gelse bile.
  // Rapor metni hafta boyunca sabit kalmalı (yoksa kullanıcı her açtığında
  // farklı bir "plan" görür), ama grafik ve akran ortalaması sabit kalmak
  // zorunda değil; onları dondurmak kullanıcıya eski veriyi göstermek olurdu.
  const [history, peer] = await Promise.all([
    loadHistory(userId, wk),
    loadPeer(wk, stats?.level),
  ]);
  const kayitli = await loadReport(userId, wk);
  if (kayitli) return { report: kayitli, week: wk, cached: true, history, peer };
  const prev = await loadPrevStats(userId, wk);

  // HİÇ VERİ YOKSA RAPOR ÜRETME.
  //
  // Yeni kullanıcının arkasında tamamlanmış bir hafta yok. O boşluğu bir
  // raporla doldurmak, hakkında hiçbir şey bilmediğimiz birine "bu hafta şöyle
  // geçti" demek olur — ürünün tek satmaya çalıştığı şey ONU TANIDIĞIMIZ iken
  // ilk izlenim uydurma bir değerlendirme olurdu.
  //
  // Ama YALNIZCA gerçekten yeni olana. Daha önce raporu olan biri geçen hafta
  // hiç girmediyse rapor ÜRETİLİYOR: koçun söylemesi gereken şey tam olarak
  // budur, susmak değil.
  const bosHafta = !Number(stats?.activeDays) && !Number(stats?.learnedThisWeek);
  if (bosHafta && !prev) {
    return { report: null, pending: true, week: wk, cached: false, history, peer };
  }

  const report = await weeklyReport({ profile, stats, prev, behaviour });
  await saveReport(userId, wk, report, stats);
  // Bu haftanın kaydı yeni yazıldı; grafikte de görünsün.
  return { report, week: wk, cached: false, history: [...history.filter((h) => h.week !== wk), { week: wk, stats }], peer };
}
