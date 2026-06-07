const DEFAULT_SETTINGS = {
  provider: "openai",
  apiKey: "",
  baseUrl: "https://api.openai.com",
  model: "gpt-4o-mini",
  targetLanguage: "中文",
  maxConcurrent: 2,
  englishLevel: "cet4",
  autoHighlight: true
};

const ENGLISH_LEVEL_LABELS = {
  cet4: "大学英语四级 (CET-4)",
  cet6: "大学英语六级 (CET-6)",
  tem4: "英语专业四级 (TEM-4)",
  tem8: "英语专业八级 (TEM-8)",
  kaoyan: "考研英语",
  ielts: "雅思 (IELTS)",
  toefl: "托福 (TOEFL)",
  gre: "GRE"
};

// Difficulty hierarchy: higher number = harder level.
// Words at/above the user's level are worth showing; easier words are skipped.
const LEVEL_RANK = {
  basic:  0,
  cet4:   1,
  cet6:   2,
  kaoyan: 3,
  tem4:   3,
  ielts:  4,
  toefl:  4,
  tem8:   5,
  gre:    6
};


chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "translate-selection" || !tab?.id || !info.selectionText) {
    return;
  }

  try {
    const rich = await translateRich(info.selectionText);
    await sendTabMessage(tab.id, {
      type: "SHOW_SELECTION_TRANSLATION",
      translation: rich.translation,
      vocabulary: rich.vocabulary,
      grammar: rich.grammar
    });
  } catch (error) {
    await sendTabMessage(tab.id, {
      type: "SHOW_SELECTION_TRANSLATION",
      translation: `翻译失败：${error.message}`,
      error: true
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "TRANSLATE_TEXT") {
    translateRich(message.text, message.targetLanguage)
      .then((rich) => sendResponse({ ok: true, ...rich }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "ANALYZE_PAGE") {
    analyzePage(message.text)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_SETTINGS") {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSettings() {
  const saved = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    baseUrl: normalizeBaseUrl(saved.baseUrl || DEFAULT_SETTINGS.baseUrl)
  };
}

// ---------------------------------------------------------------------------
// Translation cache — avoids redundant API calls for identical requests
// ---------------------------------------------------------------------------

const TRANSLATION_CACHE_MAX = 60;
const translationCache = new Map();

function getCacheKey(text, language, englishLevel) {
  return `${text}\x00${language}\x00${englishLevel}`;
}

function cacheGet(key) {
  const entry = translationCache.get(key);
  if (!entry) return null;
  // Move to end (most-recently-used)
  translationCache.delete(key);
  translationCache.set(key, entry);
  return entry;
}

function cacheSet(key, value) {
  if (translationCache.has(key)) {
    translationCache.delete(key);
  } else if (translationCache.size >= TRANSLATION_CACHE_MAX) {
    // Evict the oldest entry
    translationCache.delete(translationCache.keys().next().value);
  }
  translationCache.set(key, value);
}

// ---------------------------------------------------------------------------
// Translation — with 30s timeout and exponential back-off on 429 / 5xx
// ---------------------------------------------------------------------------

// Rich translation for selection: returns { translation, vocabulary, grammar }
// tailored to the user's configured English level.
async function translateRich(text, targetLanguage) {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    return { translation: "", vocabulary: [], grammar: [] };
  }

  const settings = await getSettings();
  const language = targetLanguage || settings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;
  const englishLevel = settings.englishLevel || DEFAULT_SETTINGS.englishLevel;
  const levelLabel = ENGLISH_LEVEL_LABELS[englishLevel] || ENGLISH_LEVEL_LABELS.cet4;

  const cacheKey = getCacheKey(cleanText, language, englishLevel);
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const content = await chatCompletion(settings, [
    {
      role: "system",
      content: [
        "You are a professional translator and an English tutor for Chinese learners.",
        "You translate text and extract learning points based on the learner's English level.",
        "Respond ONLY with a single valid JSON object. Do not use markdown code fences."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `The learner's English level is: ${levelLabel}.`,
        `Translate ALL of the following text into ${language}, preserving every sentence and paragraph.`,
        "Then extract up to 12 vocabulary items from the text that are worth learning.",
        "For each word, also assign a difficulty level tag.",
        "",
        "Return ONLY a JSON object with exactly this shape:",
        '{',
        '  "translation": "complete translation of the ENTIRE input — every sentence, every paragraph, nothing omitted",',
        '  "vocabulary": [{"word": "word/phrase from the text", "phonetic": "IPA or empty", "meaning": "中文释义", "example": "原文中的用法或简短例句", "level": "difficulty tag"}],',
        '  "grammar": [{"point": "语法点名称", "explanation": "中文讲解，结合原文"}]',
        '}',
        "",
        "Rules:",
        "- The translation field MUST contain the translation of every single sentence in the input. Do NOT translate only the first line or heading.",
        "- Extract up to 12 vocabulary items. Include words across different difficulty levels so they can be filtered client-side.",
        "- Each vocabulary item MUST have a \"level\" field. Assign EXACTLY one of these tags:",
        "  \"basic\" = elementary/middle-school words (e.g. beautiful, run, house)",
        "  \"cet4\"  = college English band-4 vocabulary",
        "  \"cet6\"  = college English band-6 vocabulary",
        "  \"kaoyan\" = postgraduate entrance exam vocabulary",
        "  \"tem4\"  = English major band-4 vocabulary",
        "  \"ielts\" = IELTS academic vocabulary",
        "  \"toefl\" = TOEFL vocabulary",
        "  \"tem8\"  = English major band-8 vocabulary",
        "  \"gre\"   = GRE vocabulary",
        "- Choose 0-3 grammar points worth learning at this level.",
        "- If the text is too simple and has nothing noteworthy, use empty arrays.",
        "- All meanings and explanations MUST be written in Chinese.",
        "",
        "Text:",
        cleanText
      ].join("\n")
    }
  ]);

  const result = parseRichContent(content, englishLevel);
  cacheSet(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Page analysis — find key vocabulary & sentences in the page body text
// tailored to the learner's English level. Returns { words, sentences }.
// ---------------------------------------------------------------------------

const PAGE_ANALYSIS_MAX_CHARS = 6000;
const pageAnalysisCache = new Map();

async function analyzePage(text) {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim().slice(0, PAGE_ANALYSIS_MAX_CHARS);
  if (!cleanText) {
    return { words: [], sentences: [] };
  }

  const settings = await getSettings();
  const englishLevel = settings.englishLevel || DEFAULT_SETTINGS.englishLevel;
  const levelLabel = ENGLISH_LEVEL_LABELS[englishLevel] || ENGLISH_LEVEL_LABELS.cet4;
  const language = settings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;

  const cacheKey = getCacheKey(cleanText, language, `page:${englishLevel}`);
  const cached = pageAnalysisCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const content = await chatCompletion(settings, [
    {
      role: "system",
      content: [
        "You are an English tutor for Chinese learners.",
        "You scan English text and pick out the words and sentences that are worth studying at the learner's level.",
        "Respond ONLY with a single valid JSON object. Do not use markdown code fences."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `The learner's English level is: ${levelLabel}.`,
        "From the text below, pick the KEY words/phrases and the KEY (difficult or valuable) sentences worth learning at this level.",
        "",
        "Return ONLY a JSON object with exactly this shape:",
        "{",
        '  "words": [{"word": "exact word/phrase copied verbatim from the text", "phonetic": "IPA or empty", "pos": "part of speech abbreviation e.g. n./v./adj./adv./prep.", "meaning": "中文释义", "level": "difficulty tag"}],',
        '  "sentences": [{"sentence": "a full sentence copied VERBATIM from the text", "meaning": "中文翻译", "level": "difficulty tag"}]',
        "}",
        "",
        "Rules:",
        "- Pick up to 12 words and up to 5 sentences.",
        "- The \"word\" and \"sentence\" fields MUST be copied EXACTLY (verbatim, same casing and punctuation) from the text so they can be located by string search. Do NOT paraphrase or normalise them.",
        "- Each item MUST have a \"level\" field. Assign EXACTLY one of these tags:",
        '  "basic" = elementary/middle-school words',
        '  "cet4"  = college English band-4 vocabulary',
        '  "cet6"  = college English band-6 vocabulary',
        '  "kaoyan" = postgraduate entrance exam vocabulary',
        '  "tem4"  = English major band-4 vocabulary',
        '  "ielts" = IELTS academic vocabulary',
        '  "toefl" = TOEFL vocabulary',
        '  "tem8"  = English major band-8 vocabulary',
        '  "gre"   = GRE vocabulary',
        "- Prefer words/sentences at or above the learner's level. Skip trivial ones.",
        "- All meanings MUST be written in Chinese.",
        "- If nothing is noteworthy, use empty arrays.",
        "",
        "Text:",
        cleanText
      ].join("\n")
    }
  ]);

  const result = parsePageAnalysis(content, englishLevel);
  if (pageAnalysisCache.size >= TRANSLATION_CACHE_MAX) {
    pageAnalysisCache.delete(pageAnalysisCache.keys().next().value);
  }
  pageAnalysisCache.set(cacheKey, result);
  return result;
}

function parsePageAnalysis(content, englishLevel) {
  const raw = String(content || "").trim();
  if (!raw) {
    return { words: [], sentences: [] };
  }

  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsed = null;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    const match = unfenced.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return { words: [], sentences: [] };
  }

  const userRank = LEVEL_RANK[englishLevel] ?? LEVEL_RANK.cet4;

  const words = Array.isArray(parsed.words)
    ? parsed.words
        .filter((item) => item && item.word)
        .map((item) => ({
          word: String(item.word || "").trim(),
          phonetic: String(item.phonetic || "").trim(),
          pos: String(item.pos || "").trim(),
          meaning: String(item.meaning || "").trim(),
          level: String(item.level || "").trim().toLowerCase()
        }))
        .filter((item) => item.word && (LEVEL_RANK[item.level] ?? LEVEL_RANK.cet4) >= userRank)
        .slice(0, 12)
    : [];

  const sentences = Array.isArray(parsed.sentences)
    ? parsed.sentences
        .filter((item) => item && item.sentence)
        .map((item) => ({
          sentence: String(item.sentence || "").trim(),
          meaning: String(item.meaning || "").trim(),
          level: String(item.level || "").trim().toLowerCase()
        }))
        .filter((item) => item.sentence.length > 0)
        .slice(0, 5)
    : [];

  return { words, sentences };
}

function parseRichContent(content, englishLevel) {
  const raw = String(content || "").trim();
  if (!raw) {
    throw new Error("模型返回了空翻译结果。");
  }

  // Strip optional ```json ... ``` fences some models add despite instructions
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsed = null;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    // Try to salvage the first {...} block
    const match = unfenced.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
  }

  if (!parsed || typeof parsed !== "object") {
    // Fall back to treating the whole response as the translation
    return { translation: raw, vocabulary: [], grammar: [] };
  }

  const translation = String(parsed.translation || "").trim();
  if (!translation) {
    throw new Error("模型返回了空翻译结果。");
  }

  // Determine the minimum rank required to show a word.
  // Words below the user's level are considered already known and are hidden.
  const userRank = LEVEL_RANK[englishLevel] ?? LEVEL_RANK.cet4;

  const vocabulary = Array.isArray(parsed.vocabulary)
    ? parsed.vocabulary
        .filter((item) => item && (item.word || item.meaning))
        .map((item) => ({
          word: String(item.word || "").trim(),
          phonetic: String(item.phonetic || "").trim(),
          meaning: String(item.meaning || "").trim(),
          example: String(item.example || "").trim(),
          level: String(item.level || "").trim().toLowerCase()
        }))
        .filter((item) => {
          // Keep words whose difficulty is at or above the user's level.
          // Words with an unrecognised tag default to cet4 rank (shown to all but GRE users).
          const wordRank = LEVEL_RANK[item.level] ?? LEVEL_RANK.cet4;
          return wordRank >= userRank;
        })
        .slice(0, 6)
    : [];

  const grammar = Array.isArray(parsed.grammar)
    ? parsed.grammar
        .filter((item) => item && (item.point || item.explanation))
        .map((item) => ({
          point: String(item.point || "").trim(),
          explanation: String(item.explanation || "").trim()
        }))
    : [];

  return { translation, vocabulary, grammar };
}

// Low-level chat completion call with 30s timeout and back-off on 429 / 5xx.
async function chatCompletion(settings, messages, attempt = 0) {
  if (!settings.apiKey) {
    throw new Error("请先在插件设置中填写 API Key。");
  }

  const endpoint = buildChatCompletionsEndpoint(settings.baseUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        messages
      }),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw new Error("请求超时，请检查网络连接或 API 地址。");
    }
    throw error;
  }
  clearTimeout(timeoutId);

  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    const delay = Math.min(1_000 * 2 ** attempt, 10_000);
    await sleep(delay);
    return chatCompletion(settings, messages, attempt + 1);
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = payload?.error?.message || response.statusText || "未知 API 错误";
    throw new Error(detail);
  }

  return payload?.choices?.[0]?.message?.content || "";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    if (chrome.runtime.lastError) {
      console.warn("AI Translator could not reset context menus:", chrome.runtime.lastError.message);
    }

    chrome.contextMenus.create({
      id: "translate-selection",
      title: "翻译选中文本",
      contexts: ["selection"]
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn("AI Translator could not create context menu:", chrome.runtime.lastError.message);
      }
    });
  });
}

// All messages to content script target frame 0 (main document) to avoid
// broadcasting to iframes now that all_frames is disabled.
function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn("AI Translator could not message this tab:", chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

function buildChatCompletionsEndpoint(baseUrl) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (normalized.endsWith("/v1") || normalized.endsWith("/compatible-mode/v1")) {
    return `${normalized}/chat/completions`;
  }

  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }

  return `${normalized}/v1/chat/completions`;
}
