// AI konuşma partneri (AÇIK — kullanıcı AI ile eşleştiğini bilir). Öğrencinin
// çalıştığı kelimeler üzerine, seviyesine uygun, teşvik edici sohbet eder ve
// öğrenciyi konuşturmak için sorular sorar. Gemini (reading.js model-yedekli).
import { geminiText, readingConfigured } from "./reading.js";

export const chatConfigured = () => readingConfigured();

// Sohbet açılışı: hedef kelimelerle doğal, kısa bir selam + ilk soru.
export async function generateOpener(words, level, botName) {
  const lvl = ["A1", "A2", "B1", "B2", "C1", "C2"].includes(level) ? level : "B1";
  const ws = (words || []).slice(0, 4).join(", ");
  const prompt = `You are "${botName}", a friendly English conversation partner for a Turkish learner at CEFR level ${lvl}.
Start a natural, warm 1-on-1 chat about a topic that naturally involves these words: ${ws || "everyday life"}.
Write ONE short opening message (max 30 words) at ${lvl} level: a friendly greeting + a topic + ONE simple question to get them talking. Sound like a real person, casual and encouraging. Plain text only, no quotes.`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 120, thinkingConfig: { thinkingBudget: 0 } } };
  const txt = (await geminiText(body, { timeout: 18000, tries: 2 })).trim().replace(/^["'“”]+|["'“”]+$/g, "");
  return txt.slice(0, 300);
}

// Sohbet yanıtı: geçmişe göre, seviyeye uygun, öğrenciyi konuşturan kısa cevap.
export async function generateReply(history, words, level, botName) {
  const lvl = ["A1", "A2", "B1", "B2", "C1", "C2"].includes(level) ? level : "B1";
  const ws = (words || []).slice(0, 4).join(", ");
  const convo = (history || []).slice(-8).map((m) => `${m.mine ? "Learner" : botName}: ${m.text}`).join("\n");
  const prompt = `You are "${botName}", a friendly English conversation partner for a Turkish learner at CEFR level ${lvl}. This is a casual 1-on-1 practice chat.
Focus words the learner is studying: ${ws || "everyday topics"}.
Rules:
- Reply in natural, encouraging English at ${lvl} level (simple, clear).
- Keep it SHORT (1-2 sentences, max ~30 words).
- Usually end with a question to keep the learner talking.
- Gently weave in a focus word when it fits naturally (don't force).
- If the learner makes a small mistake, model the correct form naturally without lecturing.
- Sound like a real friendly person. Plain text only.

Conversation so far:
${convo}

Write ${botName}'s next reply now:`;
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.9, maxOutputTokens: 120, thinkingConfig: { thinkingBudget: 0 } } };
  const txt = (await geminiText(body, { timeout: 18000, tries: 2 })).trim().replace(/^["'“”]+|["'“”]+$/g, "");
  return txt.slice(0, 400);
}
