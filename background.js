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

const PROVIDER_LABELS = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  "qwen-cn": "通义千问中国站",
  "qwen-intl": "通义千问国际站",
  custom: "自定义 API"
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

// ---------------------------------------------------------------------------
// Local word lists — CET-4 / CET-6 / 考研 (bundled JSON files)
// These levels use word lists as the single source of truth for vocabulary
// selection and level determination. No LLM involvement for word picking.
// IELTS / TOEFL / GRE / TEM have no official word list → LLM-classified.
// ---------------------------------------------------------------------------

// Levels backed by a local word list.
const WORDLIST_LEVELS = new Set(["cet4", "cet6", "kaoyan"]);

// Part-of-speech tags that are never worth highlighting (function words).
const SKIP_POS = new Set(["prep.", "conj.", "art.", "pron.", "int.", "num."]);

// High-frequency function words and elementary basics that slip through
// POS filtering (e.g. tagged as adv./n./v. but universally known).
const STOP_WORDS = new Set([
  // articles & determiners
  "a","an","the","this","that","these","those","some","any","all","both",
  "each","every","either","neither","no","other","another","such","what",
  "which","whose","few","many","much","more","most","less","least","own",
  // personal / relative / interrogative pronouns
  "i","me","my","myself","we","us","our","ours","ourselves",
  "you","your","yours","yourself","yourselves",
  "he","him","his","himself","she","her","hers","herself",
  "it","its","itself","they","them","their","theirs","themselves",
  "who","whom","whose","which","that","what","whatever","whoever",
  // prepositions & particles
  "in","on","at","by","for","of","to","with","from","as","into",
  "about","above","after","before","behind","below","between","beyond",
  "during","except","inside","near","off","out","outside","over",
  "past","since","through","throughout","till","under","until","up",
  "upon","via","within","without","along","among","around","across",
  "against","along","onto","per","plus","down","than","toward","towards",
  // conjunctions
  "and","but","or","nor","so","yet","for","although","because","since",
  "while","when","where","if","unless","until","though","whether","after",
  "before","once","now","than","that","as","both","either","neither",
  // auxiliaries & common verbs
  "be","am","is","are","was","were","been","being",
  "have","has","had","having","do","does","did","done","doing",
  "will","would","shall","should","may","might","can","could","must",
  "need","dare","ought","get","got","gotten","go","goes","went","gone",
  "come","came","say","said","make","made","take","took","know","knew",
  "see","saw","think","thought","look","looked","want","give","gave",
  "use","used","find","found","tell","told","ask","asked","seem","seemed",
  "feel","felt","try","tried","leave","left","call","called","keep","kept",
  "let","put","mean","meant","become","became","show","showed",
  "hear","heard","play","run","ran","move","moved","live","lived",
  "happen","happened","hold","held","turn","turned","start","started",
  "bring","brought","write","wrote","read","open","walk","sit","sat",
  "stand","stood","lose","lost","pay","paid","meet","met","set","cut",
  "buy","bought","wait","lie","lay","fall","fell","send","sent",
  "build","built","grow","grew","draw","drew","break","broke",
  // numbers & basic quantity words
  "one","two","three","four","five","six","seven","eight","nine","ten",
  "zero","first","second","third","last","next","only","just","once","twice",
  // common adverbs (location/time/degree)
  "here","there","where","when","why","how","now","then","already","still",
  "yet","soon","just","also","too","very","quite","rather","almost","always",
  "never","often","sometimes","usually","really","back","even","again",
  "not","no","yes","well","so","up","down","away","off","out","ever",
  // basic adjectives universally known
  "good","bad","big","small","large","little","long","short","high","low",
  "old","new","young","great","right","wrong","same","different","own",
  "next","last","early","late","hard","easy","free","full","open","close",
  "true","false","real","far","near","sure","clear","able","ready","other"
]);

let _wordSetsPromise = null;

// wordSets shape: { cet4: {word: {m, p}}, cet6: {...}, kaoyan: {...} }
function getWordSets() {
  if (_wordSetsPromise) return _wordSetsPromise;
  _wordSetsPromise = Promise.all([
    fetch(chrome.runtime.getURL("wordlist/cet4.json")).then((r) => r.json()),
    fetch(chrome.runtime.getURL("wordlist/cet6.json")).then((r) => r.json()),
    fetch(chrome.runtime.getURL("wordlist/kaoyan.json")).then((r) => r.json())
  ])
    .then(([cet4, cet6, kaoyan]) => ({ cet4, cet6, kaoyan }))
    .catch(() => ({ cet4: {}, cet6: {}, kaoyan: {} }));
  return _wordSetsPromise;
}

// Common surface-form variants so lookup tolerates inflections.
function _stemVariants(word) {
  const variants = new Set();
  if (word.endsWith("ing")) {
    const base = word.slice(0, -3);
    variants.add(base);
    variants.add(base + "e");
  }
  if (word.endsWith("ed")) {
    const base = word.slice(0, -2);
    variants.add(base);
    variants.add(base + "e");
    variants.add(word.slice(0, -1));
  }
  if (word.endsWith("ies")) variants.add(word.slice(0, -3) + "y");
  if (word.endsWith("es") && !word.endsWith("ies")) variants.add(word.slice(0, -2));
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("es")) variants.add(word.slice(0, -1));
  if (word.endsWith("ly")) variants.add(word.slice(0, -2));
  if (word.endsWith("er")) { variants.add(word.slice(0, -2)); variants.add(word.slice(0, -2) + "e"); }
  if (word.endsWith("est")) { variants.add(word.slice(0, -3)); variants.add(word.slice(0, -3) + "e"); }
  return [...variants].filter((v) => v.length > 2);
}

// Returns { level, meaning, pos } for a word, or null if not found.
// Returns { level, meaning, pos, key } where key is the matched word-list entry,
// or null if not found. key is used for deduplication across inflected forms.
function lookupWordInfo(word, wordSets) {
  if (!word || !wordSets) return null;
  const candidates = [word.toLowerCase().trim()];
  const firstToken = candidates[0].split(/[\s\u2013\u2014-]/)[0];
  if (firstToken && firstToken !== candidates[0]) candidates.push(firstToken);

  for (const w of candidates) {
    if (!w) continue;
    for (const v of [w, ..._stemVariants(w)]) {
      if (wordSets.cet4[v])   return { level: "cet4",   meaning: wordSets.cet4[v].m,   pos: wordSets.cet4[v].p,   key: v };
      if (wordSets.cet6[v])   return { level: "cet6",   meaning: wordSets.cet6[v].m,   pos: wordSets.cet6[v].p,   key: v };
      if (wordSets.kaoyan[v]) return { level: "kaoyan", meaning: wordSets.kaoyan[v].m, pos: wordSets.kaoyan[v].p, key: v };
    }
  }
  return null;
}

// Scan plain text against word lists; returns all words at/above userLevel.
// Deduplicates by word-list key so inflected forms (task/tasks, rare/rarely)
// only produce one entry — the first surface form encountered in the text.
function scanTextWithWordList(text, wordSets, englishLevel) {
  const userRank = LEVEL_RANK[englishLevel] ?? LEVEL_RANK.cet4;
  const tokens = text.match(/[a-zA-Z\u2019''-]+/g) || [];
  const seenSurface = new Set(); // skip exact duplicates quickly
  const seenKeys = new Set();    // deduplicate by word-list key (covers inflections)
  const results = [];

  for (const token of tokens) {
    const lower = token.toLowerCase().replace(/['']/g, "'");
    if (seenSurface.has(lower) || lower.length < 2) continue;
    seenSurface.add(lower);

    // Filter stop words and pure function-word POS before word-list lookup.
    if (STOP_WORDS.has(lower)) continue;

    const info = lookupWordInfo(lower, wordSets);
    if (!info) continue;
    if (SKIP_POS.has(info.pos)) continue;
    if ((LEVEL_RANK[info.level] ?? LEVEL_RANK.cet4) < userRank) continue;
    if (seenKeys.has(info.key)) continue;
    seenKeys.add(info.key);

    results.push({
      word: token,
      phonetic: "",
      pos: info.pos || "",
      meaning: info.meaning || "",
      level: info.level
    });
  }
  return results;
}


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

// Translation for selected text. Word scanning is handled only by page analysis.
async function translateRich(text, targetLanguage) {
  const cleanText = String(text || "").trim();
  if (!cleanText) {
    return { translation: "", grammar: [] };
  }

  const settings = await getSettings();
  const language = targetLanguage || settings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;
  const englishLevel = settings.englishLevel || DEFAULT_SETTINGS.englishLevel;
  const levelLabel = ENGLISH_LEVEL_LABELS[englishLevel] || ENGLISH_LEVEL_LABELS.cet4;

  const cacheKey = getCacheKey(cleanText, language, englishLevel);
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const userPromptParts = [
    `The learner's English level is: ${levelLabel}.`,
    `Translate ALL of the following text into ${language}, preserving every sentence and paragraph.`,
    "",
    "Return ONLY a JSON object with exactly this shape:",
    "{",
    '  "translation": "complete translation of the ENTIRE input — every sentence, every paragraph, nothing omitted",',
    '  "grammar": [{"point": "语法点名称", "explanation": "中文讲解，结合原文"}]',
    "}",
    "",
    "Rules:",
    "- The translation field MUST contain the translation of every single sentence in the input. Do NOT translate only the first line or heading."
  ];

  userPromptParts.push(
    "- Choose 0-3 grammar points worth learning at this level.",
    "- If the text is too simple and has nothing noteworthy, use empty arrays.",
    "- All meanings and explanations MUST be written in Chinese.",
    "",
    "Text:",
    cleanText
  );

  const content = await chatCompletion(settings, [
    {
      role: "system",
      content: "You are a professional translator. Respond ONLY with a single valid JSON object. Do not use markdown code fences."
    },
    { role: "user", content: userPromptParts.join("\n") }
  ]);

  const result = parseTranslationOnly(content);

  cacheSet(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Page analysis — find key vocabulary & sentences in the page body text
// tailored to the learner's English level. Returns { words, sentences }.
// ---------------------------------------------------------------------------

const pageAnalysisCache = new Map();

async function analyzePage(text) {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleanText) return { words: [], sentences: [] };

  const settings = await getSettings();
  const englishLevel = settings.englishLevel || DEFAULT_SETTINGS.englishLevel;

  // Word-list path: scan text directly, no LLM, no character limit, no word count limit.
  if (WORDLIST_LEVELS.has(englishLevel)) {
    const cacheKey = `wl:${englishLevel}:${cleanText.slice(0, 200)}`;
    const cached = pageAnalysisCache.get(cacheKey);
    if (cached) return cached;

    const wordSets = await getWordSets();
    const words = scanTextWithWordList(cleanText, wordSets, englishLevel);
    const result = { words, sentences: [] };
    if (pageAnalysisCache.size >= TRANSLATION_CACHE_MAX) {
      pageAnalysisCache.delete(pageAnalysisCache.keys().next().value);
    }
    pageAnalysisCache.set(cacheKey, result);
    return result;
  }

  // LLM path for levels without a local word list (IELTS / TOEFL / GRE / TEM).
  const levelLabel = ENGLISH_LEVEL_LABELS[englishLevel] || ENGLISH_LEVEL_LABELS.cet4;
  const language = settings.targetLanguage || DEFAULT_SETTINGS.targetLanguage;
  const llmText = cleanText.slice(0, 6000);

  const cacheKey = getCacheKey(llmText, language, `page:${englishLevel}`);
  const cached = pageAnalysisCache.get(cacheKey);
  if (cached) return cached;

  const content = await chatCompletion(settings, [
    {
      role: "system",
      content: "You are an English tutor for Chinese learners. Scan the text and pick vocabulary worth studying. Respond ONLY with a single valid JSON object. Do not use markdown code fences."
    },
    {
      role: "user",
      content: [
        `The learner's English level is: ${levelLabel}.`,
        "From the text below, pick KEY words/phrases worth learning at this level.",
        "",
        "Return ONLY a JSON object with exactly this shape:",
        "{",
        '  "words": [{"word": "exact verbatim word/phrase from the text", "phonetic": "IPA or empty", "pos": "n./v./adj./adv. etc.", "meaning": "中文释义", "level": "difficulty tag"}],',
        '  "sentences": [{"sentence": "full sentence verbatim from text", "meaning": "中文翻译", "level": "difficulty tag"}]',
        "}",
        "",
        "Rules:",
        "- No limit on word count — include all words worth learning at this level.",
        "- Copy words EXACTLY as they appear (same casing, punctuation) so they can be found by string search.",
        "- Each item MUST have a level tag: basic | cet4 | cet6 | kaoyan | tem4 | ielts | toefl | tem8 | gre",
        "- All meanings MUST be written in Chinese.",
        "",
        "Text:",
        llmText
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

// Parse raw LLM JSON — used only for the LLM path (non-word-list levels).
function _parseJson(raw) {
  const unfenced = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(unfenced); } catch { /* fall through */ }
  const m = unfenced.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  return null;
}

// Parses { translation, grammar } from LLM response (word-list translation path).
function parseTranslationOnly(content) {
  const parsed = _parseJson(content);
  const translation = String(parsed?.translation || "").trim();
  if (!translation) throw new Error("模型返回了空翻译结果。");
  const grammar = Array.isArray(parsed?.grammar)
    ? parsed.grammar
        .filter((item) => item && (item.point || item.explanation))
        .map((item) => ({ point: String(item.point || "").trim(), explanation: String(item.explanation || "").trim() }))
    : [];
  return { translation, grammar };
}

// Parses LLM page-analysis response for non-word-list levels (IELTS/TOEFL/GRE/TEM).
function parsePageAnalysis(content, englishLevel) {
  const parsed = _parseJson(content);
  if (!parsed || typeof parsed !== "object") return { words: [], sentences: [] };

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
    : [];

  return { words, sentences };
}

// Low-level chat completion call with 30s timeout and back-off on 429 / 5xx.
async function chatCompletion(settings, messages, attempt = 0) {
  if (!settings.apiKey) {
    throw new Error("请先在插件设置中填写 API Key。");
  }

  const endpoint = buildChatCompletionsEndpoint(settings);
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
    throw new Error(formatApiError(settings, response.status, detail));
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

function formatApiError(settings, status, detail) {
  const providerLabel = PROVIDER_LABELS[settings.provider] || settings.provider || "API";
  const message = String(detail || "未知 API 错误");
  const lowerMessage = message.toLowerCase();
  const looksLikeAuthError = status === 401
    || lowerMessage.includes("authentication")
    || (lowerMessage.includes("api key") && lowerMessage.includes("invalid"));

  if (!looksLikeAuthError) {
    return message;
  }

  const maskedKey = maskApiKey(settings.apiKey);
  const endpoint = buildChatCompletionsEndpoint(settings);

  if (settings.provider === "deepseek") {
    return [
      `DeepSeek 认证失败。当前扩展实际发送的 API Key 尾号是 ${maskedKey}。`,
      "请确认它是在 platform.deepseek.com 创建的 API Key；如果你刚填写的新 key 尾号不同，请在插件设置页重新保存，然后到 chrome://extensions 重载插件。",
      `请求地址：${endpoint}`,
      `原始错误：${message}`
    ].join(" ");
  }

  return [
    `${providerLabel} 认证失败。当前扩展实际发送的 API Key 尾号是 ${maskedKey}。`,
    `请求地址：${endpoint}`,
    `原始错误：${message}`
  ].join(" ");
}

function maskApiKey(apiKey) {
  const cleanKey = String(apiKey || "").trim();
  if (!cleanKey) {
    return "空";
  }
  return `****${cleanKey.slice(-4)}`;
}

function buildChatCompletionsEndpoint(settingsOrBaseUrl) {
  const settings = typeof settingsOrBaseUrl === "object"
    ? settingsOrBaseUrl
    : { baseUrl: settingsOrBaseUrl };
  const normalized = normalizeBaseUrl(settings.baseUrl);
  if (normalized.endsWith("/v1") || normalized.endsWith("/compatible-mode/v1")) {
    return `${normalized}/chat/completions`;
  }

  if (normalized.endsWith("/chat/completions")) {
    return normalized;
  }

  if (settings.provider === "deepseek" && isDeepSeekApiBase(normalized)) {
    return `${normalized}/chat/completions`;
  }

  return `${normalized}/v1/chat/completions`;
}

function isDeepSeekApiBase(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return url.hostname === "api.deepseek.com";
  } catch {
    return false;
  }
}
