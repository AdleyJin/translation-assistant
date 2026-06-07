const UI_HOST_ID = "ai-article-translator-ui-host";
const OVERLAY_ID = "ai-article-translator-overlay";
const SELECTION_BUTTON_ID = "ai-article-translator-selection-button";
const TIP_ID = "ai-article-translator-hover-tip";
const HIGHLIGHT_CLASS = "ait-page-highlight";

let selectionSnapshot = null;
let selectionUpdateTimer = 0;
let selectionUpdateTimerLate = 0;
let lastPointerPoint = null;
let pageAnalysisStarted = false;
let tipHideTimer = 0;

ensureTranslatorUi();

document.addEventListener("selectionchange", scheduleSelectionButtonUpdate, true);
document.addEventListener("mouseup", scheduleSelectionButtonUpdate, true);
document.addEventListener("pointerup", handlePointerUp, true);
document.addEventListener("touchend", scheduleSelectionButtonUpdate, true);
document.addEventListener("keyup", scheduleSelectionButtonUpdate, true);
document.addEventListener("scroll", scheduleSelectionButtonUpdate, { capture: true, passive: true });
document.addEventListener("pointerdown", handlePointerDown, true);
document.addEventListener("mousedown", handlePointerDown, true);

document.addEventListener("mouseover", handleHighlightMouseOver, true);
document.addEventListener("mouseout", handleHighlightMouseOut, true);
document.addEventListener("scroll", hideHighlightTip, { capture: true, passive: true });

schedulePageAnalysis();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_SELECTION") {
    sendResponse({ ok: true, text: window.getSelection().toString().trim() });
    return true;
  }

  if (message?.type === "SHOW_SELECTION_TRANSLATION") {
    showSelectionTranslation({
      translation: message.translation,
      vocabulary: message.vocabulary,
      grammar: message.grammar
    });
    sendResponse({ ok: true });
    return true;
  }

  return false;
});


function showSelectionTranslation(data) {
  const info = typeof data === "string" ? { translation: data } : (data || {});
  const { overlay } = ensureTranslatorUi();

  overlay.querySelector(".ait-overlay-result").textContent = info.translation || "";

  renderVocabulary(overlay, info.loading ? null : info.vocabulary);
  renderGrammar(overlay, info.loading ? null : info.grammar);

  overlay.hidden = false;
  overlay.removeAttribute("aria-hidden");
  positionOverlayNearSelection(overlay, selectionSnapshot?.rect);
}

const LEVEL_BADGE_LABELS = {
  basic:  "基础",
  cet4:   "CET-4",
  cet6:   "CET-6",
  kaoyan: "考研",
  tem4:   "TEM-4",
  ielts:  "雅思",
  toefl:  "托福",
  tem8:   "TEM-8",
  gre:    "GRE"
};

function renderVocabulary(overlay, vocabulary) {
  const section = overlay.querySelector(".ait-overlay-vocab");
  const body = section.querySelector(".ait-vocab-body");
  body.textContent = "";

  if (!Array.isArray(vocabulary) || vocabulary.length === 0) {
    section.hidden = true;
    return;
  }

  for (const item of vocabulary) {
    const wrap = document.createElement("div");
    wrap.className = "ait-vocab-item";

    const head = document.createElement("div");
    head.className = "ait-vocab-head";

    const word = document.createElement("span");
    word.className = "ait-vocab-word";
    word.textContent = item.word || "";
    head.appendChild(word);

    if (item.phonetic) {
      const phonetic = document.createElement("span");
      phonetic.className = "ait-vocab-phonetic";
      phonetic.textContent = `/${item.phonetic.replace(/^\/|\/$/g, "")}/`;
      head.appendChild(phonetic);
    }

    if (item.level && LEVEL_BADGE_LABELS[item.level]) {
      const badge = document.createElement("span");
      badge.className = `ait-vocab-badge ait-vocab-badge--${item.level}`;
      badge.textContent = LEVEL_BADGE_LABELS[item.level];
      head.appendChild(badge);
    }

    const audioButtons = document.createElement("span");
    audioButtons.className = "ait-vocab-audio";
    for (const [label, lang] of [["美", "en-US"], ["英", "en-GB"]]) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ait-vocab-audio-btn";
      btn.title = `${label}音`;
      btn.setAttribute("aria-label", `播放${label}音`);
      btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="11" height="11"><path d="M9.5 3.5a.5.5 0 0 0-.854-.354L5.293 6.5H2.5A1.5 1.5 0 0 0 1 8v4a1.5 1.5 0 0 0 1.5 1.5h2.793l3.353 3.354A.5.5 0 0 0 9.5 16.5V3.5zM12.56 6.44a.5.5 0 0 1 .707 0 6 6 0 0 1 0 8.484.5.5 0 1 1-.707-.707 5 5 0 0 0 0-7.07.5.5 0 0 1 0-.707zm-1.94 1.94a.5.5 0 0 1 .707 0 3.5 3.5 0 0 1 0 4.95.5.5 0 1 1-.707-.707 2.5 2.5 0 0 0 0-3.536.5.5 0 0 1 0-.707z"/></svg><span>${label}</span>`;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        speakWord(item.word, lang, btn);
      });
      audioButtons.appendChild(btn);
    }
    head.appendChild(audioButtons);

    wrap.appendChild(head);

    if (item.meaning) {
      const meaning = document.createElement("div");
      meaning.className = "ait-vocab-meaning";
      meaning.textContent = item.meaning;
      wrap.appendChild(meaning);
    }

    if (item.example) {
      const example = document.createElement("div");
      example.className = "ait-vocab-example";
      example.textContent = item.example;
      wrap.appendChild(example);
    }

    body.appendChild(wrap);
  }

  section.hidden = false;
}

function renderGrammar(overlay, grammar) {
  const section = overlay.querySelector(".ait-overlay-grammar");
  const body = section.querySelector(".ait-grammar-body");
  body.textContent = "";

  if (!Array.isArray(grammar) || grammar.length === 0) {
    section.hidden = true;
    return;
  }

  for (const item of grammar) {
    const wrap = document.createElement("div");
    wrap.className = "ait-grammar-item";

    if (item.point) {
      const point = document.createElement("div");
      point.className = "ait-grammar-point";
      point.textContent = item.point;
      wrap.appendChild(point);
    }

    if (item.explanation) {
      const explanation = document.createElement("div");
      explanation.className = "ait-grammar-explanation";
      explanation.textContent = item.explanation;
      wrap.appendChild(explanation);
    }

    body.appendChild(wrap);
  }

  section.hidden = false;
}

function scheduleSelectionButtonUpdate() {
  window.clearTimeout(selectionUpdateTimer);
  window.clearTimeout(selectionUpdateTimerLate);
  selectionUpdateTimer = window.setTimeout(updateSelectionButton, 80);
  selectionUpdateTimerLate = window.setTimeout(updateSelectionButton, 180);
}

function updateSelectionButton() {
  const snapshot = getSelectionSnapshot();

  if (!snapshot || isInsideTranslatorUi(snapshot.anchorNode)) {
    hideSelectionButton();
    return;
  }

  selectionSnapshot = snapshot;
  const { button } = ensureTranslatorUi();
  const x = clamp(snapshot.rect.left + snapshot.rect.width / 2, 24, window.innerWidth - 24);
  const y = clamp(snapshot.rect.bottom + 10, 24, window.innerHeight - 24);
  button.style.left = `${Math.round(x)}px`;
  button.style.top = `${Math.round(y)}px`;
  button.hidden = false;
  button.removeAttribute("aria-hidden");
}

function ensureTranslatorUi() {
  let host = document.getElementById(UI_HOST_ID);
  if (!host) {
    host = document.createElement("div");
    host.id = UI_HOST_ID;
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.pointerEvents = "none";
    host.style.zIndex = "2147483647";
    (document.body || document.documentElement).appendChild(host);
  }

  const root = host.shadowRoot || host.attachShadow({ mode: "open" });
  let button = root.getElementById(SELECTION_BUTTON_ID);
  let overlay = root.getElementById(OVERLAY_ID);
  let tip = root.getElementById(TIP_ID);

  if (!button || !overlay || !tip) {
    root.innerHTML = `
      <style>
        :host {
          all: initial;
        }

        #${SELECTION_BUTTON_ID} {
          align-items: center;
          background: #ffffff;
          border: 1px solid #ececec;
          border-radius: 16px;
          box-shadow: 0 8px 24px rgba(17, 24, 39, 0.14);
          box-sizing: border-box;
          color: #1f2329;
          cursor: pointer;
          display: inline-flex;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
          font-size: 14px;
          font-weight: 600;
          gap: 8px;
          justify-content: center;
          line-height: 1;
          margin: 0;
          padding: 8px 16px 8px 8px;
          pointer-events: auto;
          position: fixed;
          transform: translateX(-50%);
          transition: box-shadow 0.15s ease, transform 0.15s ease;
          white-space: nowrap;
          z-index: 2147483647;
        }

        #${SELECTION_BUTTON_ID}:hover {
          box-shadow: 0 10px 28px rgba(17, 24, 39, 0.2);
          transform: translateX(-50%) translateY(-1px);
        }

        #${SELECTION_BUTTON_ID} .ait-btn-icon {
          align-items: center;
          background: #ececec;
          border-radius: 6px;
          color: #4b5563;
          display: inline-flex;
          flex: none;
          height: 24px;
          justify-content: center;
          width: 24px;
        }

        #${SELECTION_BUTTON_ID} .ait-btn-label {
          display: inline-block;
          line-height: 1;
        }

        #${SELECTION_BUTTON_ID}[hidden],
        #${OVERLAY_ID}[hidden],
        #${TIP_ID}[hidden] {
          display: none;
        }

        #${OVERLAY_ID} {
          background: #ffffff;
          border: 1px solid #d8dde6;
          border-radius: 8px;
          box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2);
          box-sizing: border-box;
          color: #1f2937;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          max-height: min(520px, calc(100vh - 80px));
          max-width: min(520px, calc(100vw - 80px));
          overflow: auto;
          padding: 14px;
          pointer-events: auto;
          position: fixed;
          width: 420px;
          z-index: 2147483647;
        }

        .ait-overlay-header {
          align-items: center;
          display: flex;
          justify-content: space-between;
          margin-bottom: 10px;
        }

        .ait-overlay-header strong {
          font-size: 14px;
          font-weight: 700;
        }

        .ait-overlay-header button {
          align-items: center;
          background: transparent;
          border: 0;
          border-radius: 6px;
          color: #6b7280;
          cursor: pointer;
          display: inline-flex;
          font: inherit;
          font-size: 18px;
          font-weight: 400;
          height: 28px;
          justify-content: center;
          min-height: 28px;
          padding: 0;
          width: 28px;
        }

        .ait-overlay-header button:hover {
          background: #eceff4;
          color: #1f2937;
        }

        .ait-overlay-result {
          background: #eef4ff;
          border-radius: 6px;
          color: #172554;
          font-size: 14px;
          line-height: 1.55;
          padding: 10px;
          white-space: pre-wrap;
        }

        .ait-overlay-section {
          margin-top: 12px;
        }

        .ait-overlay-section[hidden] {
          display: none;
        }

        .ait-section-title {
          align-items: center;
          color: #1f2937;
          display: flex;
          font-size: 13px;
          font-weight: 700;
          gap: 6px;
          margin-bottom: 6px;
        }

        .ait-section-title::before {
          background: #2563eb;
          border-radius: 2px;
          content: "";
          display: inline-block;
          height: 14px;
          width: 3px;
        }

        .ait-vocab-item {
          background: #f8fafc;
          border: 1px solid #e5e9f0;
          border-radius: 6px;
          margin-bottom: 6px;
          padding: 8px 10px;
        }

        .ait-vocab-head {
          align-items: baseline;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .ait-vocab-word {
          color: #1d4ed8;
          font-size: 14px;
          font-weight: 700;
        }

        .ait-vocab-phonetic {
          color: #6b7280;
          font-size: 12px;
        }

        .ait-vocab-badge {
          border-radius: 3px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.3px;
          margin-left: auto;
          padding: 1px 5px;
        }
        .ait-vocab-badge--basic  { background: #f1f5f9; color: #64748b; }
        .ait-vocab-badge--cet4   { background: #dbeafe; color: #1d4ed8; }
        .ait-vocab-badge--cet6   { background: #ede9fe; color: #7c3aed; }
        .ait-vocab-badge--kaoyan { background: #fce7f3; color: #be185d; }
        .ait-vocab-badge--tem4   { background: #d1fae5; color: #065f46; }
        .ait-vocab-badge--ielts  { background: #fff7ed; color: #c2410c; }
        .ait-vocab-badge--toefl  { background: #ffedd5; color: #9a3412; }
        .ait-vocab-badge--tem8   { background: #fef3c7; color: #92400e; }
        .ait-vocab-badge--gre    { background: #fee2e2; color: #991b1b; }

        .ait-vocab-audio {
          display: flex;
          gap: 4px;
          margin-left: auto;
        }

        .ait-vocab-audio-btn {
          align-items: center;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 4px;
          color: #475569;
          cursor: pointer;
          display: inline-flex;
          font-size: 10px;
          gap: 2px;
          line-height: 1;
          padding: 2px 5px;
          transition: background 0.15s, color 0.15s;
          white-space: nowrap;
        }

        .ait-vocab-audio-btn:hover {
          background: #dbeafe;
          border-color: #93c5fd;
          color: #1d4ed8;
        }

        .ait-vocab-audio-btn.ait-speaking {
          background: #dbeafe;
          border-color: #3b82f6;
          color: #1d4ed8;
        }

        .ait-vocab-meaning {
          color: #1f2937;
          font-size: 13px;
          margin-top: 2px;
        }

        .ait-vocab-example {
          color: #6b7280;
          font-size: 12px;
          font-style: italic;
          margin-top: 3px;
        }

        .ait-grammar-item {
          background: #f8fafc;
          border: 1px solid #e5e9f0;
          border-radius: 6px;
          margin-bottom: 6px;
          padding: 8px 10px;
        }

        .ait-grammar-point {
          color: #1f2937;
          font-size: 13px;
          font-weight: 700;
          margin-bottom: 2px;
        }

        .ait-grammar-explanation {
          color: #374151;
          font-size: 13px;
          line-height: 1.5;
        }

        .ait-empty {
          color: #9ca3af;
          font-size: 12px;
        }

        #${TIP_ID} {
          background: #ffffff;
          border: 1px solid #e5e9f0;
          border-radius: 10px;
          box-shadow: 0 14px 38px rgba(15, 23, 42, 0.18);
          box-sizing: border-box;
          color: #1f2937;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
          max-width: 340px;
          padding: 10px 12px;
          pointer-events: auto;
          position: fixed;
          z-index: 2147483647;
        }

        .ait-tip-head {
          align-items: baseline;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .ait-tip-word {
          color: #1d4ed8;
          font-size: 15px;
          font-weight: 700;
        }

        .ait-tip-word--sentence {
          color: #1f2937;
          font-size: 13px;
          font-weight: 600;
          line-height: 1.5;
        }

        .ait-tip-phonetic {
          color: #6b7280;
          font-size: 12px;
          align-items: center;
          display: flex;
          gap: 6px;
          margin-top: 2px;
        }

        .ait-tip-audio-btn {
          align-items: center;
          background: #f1f5f9;
          border: 1px solid #e2e8f0;
          border-radius: 4px;
          color: #475569;
          cursor: pointer;
          display: inline-flex;
          font-size: 10px;
          gap: 2px;
          line-height: 1;
          padding: 2px 5px;
          pointer-events: auto;
          transition: background 0.15s, color 0.15s;
          white-space: nowrap;
        }

        .ait-tip-audio-btn:hover {
          background: #dbeafe;
          border-color: #93c5fd;
          color: #1d4ed8;
        }

        .ait-tip-audio-btn.ait-speaking {
          background: #dbeafe;
          border-color: #3b82f6;
          color: #1d4ed8;
        }

        .ait-tip-badge {
          border-radius: 3px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.3px;
          margin-left: auto;
          padding: 1px 5px;
        }

        .ait-tip-badge[hidden],
        .ait-tip-phonetic[hidden],
        .ait-tip-meaning[hidden] {
          display: none;
        }

        .ait-tip-meaning {
          color: #374151;
          font-size: 13px;
          line-height: 1.55;
          margin-top: 6px;
        }

        .ait-tip-pos {
          color: #9ca3af;
          font-size: 11px;
          font-style: italic;
          margin-right: 4px;
        }

        #ait-scan-btn {
          align-items: center;
          background: #ffffff;
          border: 1px solid #ececec;
          border-radius: 12px;
          box-shadow: 0 4px 16px rgba(17, 24, 39, 0.12);
          box-sizing: border-box;
          color: #1f2329;
          cursor: pointer;
          display: inline-flex;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
          font-size: 13px;
          font-weight: 500;
          gap: 6px;
          padding: 7px 14px 7px 8px;
          pointer-events: auto;
          position: fixed;
          right: 20px;
          bottom: 24px;
          transition: box-shadow 0.15s, transform 0.15s;
          white-space: nowrap;
          z-index: 2147483647;
        }

        #ait-scan-btn:hover {
          box-shadow: 0 6px 20px rgba(17, 24, 39, 0.18);
          transform: translateY(-1px);
        }

        #ait-scan-btn .ait-scan-icon {
          align-items: center;
          background: #ececec;
          border-radius: 6px;
          color: #4b5563;
          display: inline-flex;
          flex: none;
          height: 24px;
          justify-content: center;
          width: 24px;
        }

        #ait-scan-btn[hidden] {
          display: none;
        }
      </style>
      <button id="${SELECTION_BUTTON_ID}" type="button" title="翻译选中文本" aria-label="翻译选中文本" hidden aria-hidden="true">
        <span class="ait-btn-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m5 8 6 6"/>
            <path d="m4 14 6-6 2-3"/>
            <path d="M2 5h12"/>
            <path d="M7 2h1"/>
            <path d="m22 22-5-10-5 10"/>
            <path d="M14 18h6"/>
          </svg>
        </span>
        <span class="ait-btn-label">翻译</span>
      </button>
      <div id="${TIP_ID}" hidden aria-hidden="true">
        <div class="ait-tip-head">
          <span class="ait-tip-word"></span>
          <span class="ait-tip-badge" hidden></span>
        </div>
        <div class="ait-tip-phonetic" hidden>
          <span class="ait-tip-phonetic-text"></span>
          <button type="button" class="ait-tip-audio-btn" title="美音" aria-label="播放美音">
            <svg viewBox="0 0 20 20" fill="currentColor" width="10" height="10"><path d="M9.5 3.5a.5.5 0 0 0-.854-.354L5.293 6.5H2.5A1.5 1.5 0 0 0 1 8v4a1.5 1.5 0 0 0 1.5 1.5h2.793l3.353 3.354A.5.5 0 0 0 9.5 16.5V3.5zM12.56 6.44a.5.5 0 0 1 .707 0 6 6 0 0 1 0 8.484.5.5 0 1 1-.707-.707 5 5 0 0 0 0-7.07.5.5 0 0 1 0-.707zm-1.94 1.94a.5.5 0 0 1 .707 0 3.5 3.5 0 0 1 0 4.95.5.5 0 1 1-.707-.707 2.5 2.5 0 0 0 0-3.536.5.5 0 0 1 0-.707z"/></svg>
            <span>美</span>
          </button>
        </div>
        <div class="ait-tip-meaning" hidden></div>
      </div>
      <button id="ait-scan-btn" type="button" title="扫描页面重点单词" aria-label="扫描页面重点单词" hidden>
        <span class="ait-scan-icon">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
        </span>
        <span>扫描单词</span>
      </button>
      <div id="${OVERLAY_ID}" hidden aria-hidden="true">
        <div class="ait-overlay-header">
          <strong>AI 翻译</strong>
          <button class="ait-overlay-close" type="button" aria-label="关闭翻译">×</button>
        </div>
        <div class="ait-overlay-result"></div>
        <div class="ait-overlay-section ait-overlay-vocab" hidden>
          <div class="ait-section-title">重点单词</div>
          <div class="ait-vocab-body"></div>
        </div>
        <div class="ait-overlay-section ait-overlay-grammar" hidden>
          <div class="ait-section-title">重点语法知识</div>
          <div class="ait-grammar-body"></div>
        </div>
      </div>
    `;

    button = root.getElementById(SELECTION_BUTTON_ID);
    overlay = root.getElementById(OVERLAY_ID);
    tip = root.getElementById(TIP_ID);
    const scanBtn = root.getElementById("ait-scan-btn");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("pointerdown", (event) => event.preventDefault());
    button.addEventListener("click", translateSelectionFromButton);
    overlay.querySelector(".ait-overlay-close").addEventListener("click", hideSelectionOverlay);
    tip.addEventListener("mouseleave", () => {
      window.clearTimeout(tipHideTimer);
      tipHideTimer = window.setTimeout(hideHighlightTip, 120);
    });
    tip.addEventListener("mouseenter", () => {
      window.clearTimeout(tipHideTimer);
    });
    scanBtn.addEventListener("click", () => {
      scanBtn.hidden = true;
      runPageAnalysis();
    });
  }

  return { host, root, button, overlay, tip, scanBtn: root.getElementById("ait-scan-btn") };
}

async function translateSelectionFromButton(event) {
  event.preventDefault();
  event.stopPropagation();

  const snapshot = getSelectionSnapshot() || selectionSnapshot;
  if (!snapshot?.text) {
    hideSelectionButton();
    return;
  }

  selectionSnapshot = snapshot;
  hideSelectionButton();
  showSelectionTranslation({ translation: "翻译中...", loading: true });

  try {
    const result = await chrome.runtime.sendMessage({
      type: "TRANSLATE_TEXT",
      text: snapshot.text
    });

    if (!result?.ok) {
      throw new Error(result?.error || "翻译失败");
    }

    showSelectionTranslation({
      translation: result.translation,
      vocabulary: result.vocabulary,
      grammar: result.grammar
    });
  } catch (error) {
    const msg = isContextInvalidated(error)
      ? "扩展已更新，请刷新页面后重试。"
      : `翻译失败：${error.message}`;
    showSelectionTranslation({ translation: msg });
  }
}

function getSelectionSnapshot() {
  const inputSnapshot = getInputSelectionSnapshot();
  if (inputSnapshot) {
    return inputSnapshot;
  }

  const selection = window.getSelection();
  const text = selection?.toString().trim();

  if (!selection || !text || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (range.collapsed) {
    return null;
  }

  const rect = getUsefulRangeRect(range);
  if (!rect) {
    return null;
  }

  return {
    text,
    rect,
    anchorNode: selection.anchorNode
  };
}

function getUsefulRangeRect(range) {
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0);

  if (rects.length) {
    return rects[rects.length - 1];
  }

  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function getInputSelectionSnapshot() {
  const element = document.activeElement;
  const isTextControl = element instanceof HTMLTextAreaElement
    || element instanceof HTMLInputElement && /^(text|search|url|tel|email|password)$/i.test(element.type || "text");

  if (!isTextControl || element.selectionStart === element.selectionEnd) {
    return null;
  }

  const text = element.value.slice(element.selectionStart, element.selectionEnd).trim();
  if (!text) {
    return null;
  }

  return {
    text,
    rect: element.getBoundingClientRect(),
    anchorNode: element
  };
}

function positionOverlayNearSelection(overlay, rect) {
  const fallback = {
    left: lastPointerPoint?.x || window.innerWidth - 436,
    top: 16,
    width: 420,
    height: 0,
    bottom: lastPointerPoint?.y || 16
  };
  const anchor = rect || fallback;
  const MARGIN = 40;
  const overlayWidth = Math.min(420, window.innerWidth - MARGIN * 2);

  overlay.style.width = `${overlayWidth}px`;
  const left = clamp(anchor.left, MARGIN, window.innerWidth - overlayWidth - MARGIN);

  const overlayHeight = overlay.offsetHeight || 220;
  const belowTop = anchor.bottom + MARGIN;
  const aboveTop = anchor.top - overlayHeight - MARGIN;

  let top;
  if (belowTop + overlayHeight <= window.innerHeight - MARGIN) {
    top = belowTop;
  } else if (aboveTop >= MARGIN) {
    top = aboveTop;
  } else {
    top = clamp(belowTop, MARGIN, window.innerHeight - overlayHeight - MARGIN);
  }

  overlay.style.left = `${Math.round(left)}px`;
  overlay.style.right = "auto";
  overlay.style.top = `${Math.round(top)}px`;
}

function hideSelectionButton() {
  const button = ensureTranslatorUi().button;
  if (button) {
    button.hidden = true;
    button.setAttribute("aria-hidden", "true");
  }
}

function hideSelectionOverlay() {
  const overlay = ensureTranslatorUi().overlay;
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
}

function handlePointerUp(event) {
  lastPointerPoint = {
    x: event.clientX,
    y: event.clientY
  };
  scheduleSelectionButtonUpdate();
}

function handlePointerDown(event) {
  const path = event.composedPath?.() || [];
  const target = event.target;
  const clickedTranslatorUi = path.some((node) => node instanceof Element && node.id === UI_HOST_ID)
    || target instanceof Element && target.closest(`#${UI_HOST_ID}`);

  if (clickedTranslatorUi) {
    return;
  }

  hideSelectionButton();
}

function isInsideTranslatorUi(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return Boolean(element?.closest?.(`#${UI_HOST_ID}`));
}


function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isContextInvalidated(error) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("extension context invalidated")
    || msg.includes("context invalidated")
    || msg.includes("receiving end does not exist");
}

// ---------------------------------------------------------------------------
// Pronunciation — Free Dictionary API (real recordings) + TTS fallback
// ---------------------------------------------------------------------------

// In-memory cache: normalised word → { us: url|null, uk: url|null }
const pronunciationCache = new Map();
let currentAudio = null;

async function fetchPronunciationUrls(word) {
  if (pronunciationCache.has(word)) return pronunciationCache.get(word);

  let result = { us: null, uk: null };
  try {
    const res = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (res.ok) {
      const data = await res.json();
      const phonetics = data[0]?.phonetics ?? [];

      for (const p of phonetics) {
        if (!p.audio) continue;
        const url = p.audio.startsWith("//") ? `https:${p.audio}` : p.audio;
        const lower = url.toLowerCase();
        if (!result.uk && (lower.includes("-uk.") || lower.includes("-gb."))) result.uk = url;
        if (!result.us && lower.includes("-us.")) result.us = url;
      }

      // Some entries only have one accent recorded — share it as fallback
      if (!result.us && !result.uk) {
        const any = phonetics.find((p) => p.audio)?.audio;
        if (any) {
          const url = any.startsWith("//") ? `https:${any}` : any;
          result.us = url;
          result.uk = url;
        }
      } else {
        if (!result.us) result.us = result.uk;
        if (!result.uk) result.uk = result.us;
      }
    }
  } catch {
    // Network error or timeout — fall back to gstatic / TTS
  }

  // For any accent still missing, try Google Dictionary audio (gstatic).
  // These are real studio recordings; if the file doesn't exist the Audio
  // element will fire "error" and speakWord() will fall back to TTS.
  const gBase = `https://ssl.gstatic.com/dictionary/static/sounds/20200429/${word}--_`;
  if (!result.us) result.us = `${gBase}us_1.mp3`;
  if (!result.uk) result.uk = `${gBase}gb_1.mp3`;

  pronunciationCache.set(word, result);
  return result;
}

function stopCurrentAudio() {
  window.speechSynthesis?.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }
}

async function speakWord(word, lang, triggerBtn) {
  if (!word) return;

  const cleanWord = word.split("/")[0].trim();

  if (triggerBtn?.classList.contains("ait-speaking")) {
    stopCurrentAudio();
    triggerBtn.classList.remove("ait-speaking");
    return;
  }

  // Stop whatever is playing before starting a new utterance
  stopCurrentAudio();

  triggerBtn?.classList.add("ait-speaking");

  const urls = await fetchPronunciationUrls(cleanWord.toLowerCase());
  const audioUrl = lang === "en-US" ? urls.us : urls.uk;

  if (audioUrl) {
    const audio = new Audio(audioUrl);
    currentAudio = audio;
    const done = () => {
      triggerBtn?.classList.remove("ait-speaking");
      if (currentAudio === audio) currentAudio = null;
    };
    audio.addEventListener("ended", done, { once: true });
    audio.addEventListener("error", () => {
      done();
      speakWithTTS(cleanWord, lang, triggerBtn);
    }, { once: true });
    audio.play().catch(() => {
      done();
      speakWithTTS(cleanWord, lang, triggerBtn);
    });
  } else {
    speakWithTTS(cleanWord, lang, triggerBtn);
  }
}

function speakWithTTS(word, lang, triggerBtn) {
  if (!window.speechSynthesis) {
    triggerBtn?.classList.remove("ait-speaking");
    return;
  }
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = lang;
  utterance.rate = 0.85;
  utterance.onend = () => triggerBtn?.classList.remove("ait-speaking");
  utterance.onerror = () => triggerBtn?.classList.remove("ait-speaking");
  window.speechSynthesis.speak(utterance);
}

// ---------------------------------------------------------------------------
// Page analysis — underline key words / sentences for the learner's level
// and show an explanation tooltip on hover.
// ---------------------------------------------------------------------------

function schedulePageAnalysis() {
  if (pageAnalysisStarted) return;
  if (!/^https?:$/.test(location.protocol)) return;
  pageAnalysisStarted = true;

  chrome.storage.local.get({ autoHighlight: true }, (result) => {
    if (chrome.runtime.lastError) return;
    if (result.autoHighlight !== false) {
      // Auto mode: scan after content settles.
      window.setTimeout(runPageAnalysis, 1200);
    } else {
      // Manual mode: show scan button.
      window.setTimeout(() => {
        const { scanBtn } = ensureTranslatorUi();
        if (scanBtn) scanBtn.hidden = false;
      }, 600);
    }
  });
}

function runPageAnalysis() {
  const root = findMainContentRoot();
  if (!root) return;

  const text = (root.innerText || "").trim();
  if (text.length < 80) return;

  let response;
  try {
    chrome.runtime.sendMessage({ type: "ANALYZE_PAGE", text }, (resp) => {
      if (chrome.runtime.lastError) return;
      if (!resp?.ok) return;
      applyHighlights(root, resp.words);
    });
  } catch {
    // Extension context invalidated, etc. — silently skip.
  }
  void response;
}

function findMainContentRoot() {
  let best = null;
  let bestLen = 0;

  document.querySelectorAll("article, main, [role=main]").forEach((el) => {
    if (el.closest(`#${UI_HOST_ID}`)) return;
    const len = (el.innerText || "").length;
    if (len > bestLen) {
      best = el;
      bestLen = len;
    }
  });

  if (best && bestLen > 200) {
    return best;
  }
  return document.body || null;
}

function applyHighlights(root, words) {
  if (!root) return;

  const matchers = [];
  const seen = new Set();

  for (const item of words || []) {
    const key = item.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const matcher = buildHighlightMatcher(item.word, {
      word: item.word,
      phonetic: item.phonetic,
      meaning: item.meaning,
      pos: item.pos || "",
      level: item.level
    });
    if (matcher) matchers.push(matcher);
  }

  if (!matchers.length) return;

  // Each matcher only fires once (first occurrence across all text nodes).
  const nodes = collectHighlightTextNodes(root);
  for (const node of nodes) {
    highlightTextNode(node, matchers);
  }
}

function buildHighlightMatcher(rawString, data) {
  const str = String(rawString || "").trim();
  if (!str) return null;

  const escaped = str
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  if (!escaped) return null;

  const pattern = `(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`;

  try {
    // `matched` flag: once this matcher fires once across all text nodes, it is done.
    return { regex: new RegExp(pattern, "gi"), data, matched: false };
  } catch {
    return null;
  }
}

function collectHighlightTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || !node.nodeValue.trim()) {
        return NodeFilter.FILTER_REJECT;
      }
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|CODE|PRE|KBD|SAMP)$/.test(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`#${UI_HOST_ID}`)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`.${HIGHLIGHT_CLASS}`)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  let current;
  while ((current = walker.nextNode())) {
    nodes.push(current);
  }
  return nodes;
}

function highlightTextNode(node, matchers) {
  const text = node.nodeValue;
  const ranges = [];

  for (const matcher of matchers) {
    if (matcher.matched) continue;
    matcher.regex.lastIndex = 0;
    const match = matcher.regex.exec(text);
    if (!match) continue;
    const length = match[0].length;
    if (length === 0) continue;
    ranges.push({
      start: match.index,
      end: match.index + length,
      len: length,
      matcher
    });
  }

  if (!ranges.length) return;

  // Earliest first; for ties prefer the longer match.
  ranges.sort((a, b) => a.start - b.start || b.len - a.len);

  // Resolve overlaps: each position claimed by the first (earliest/longest) range.
  const chosen = [];
  let lastEnd = -1;
  for (const range of ranges) {
    if (range.start >= lastEnd) {
      chosen.push(range);
      lastEnd = range.end;
    }
  }

  if (!chosen.length) return;

  // Mark chosen matchers as done so they won't fire again in subsequent nodes.
  for (const range of chosen) {
    range.matcher.matched = true;
  }

  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const range of chosen) {
    if (range.start > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, range.start)));
    }
    fragment.appendChild(createHighlightSpan(text.slice(range.start, range.end), range.matcher.data));
    cursor = range.end;
  }
  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)));
  }

  node.parentNode.replaceChild(fragment, node);
}

function createHighlightSpan(text, data) {
  const span = document.createElement("span");
  span.className = HIGHLIGHT_CLASS;
  span.textContent = text;
  span.dataset.aitLevel = data.level || "";
  span.dataset.aitMeaning = data.meaning || "";
  span.dataset.aitWord = data.word || text;
  span.dataset.aitPhonetic = data.phonetic || "";
  span.dataset.aitPos = data.pos || "";

  span.style.setProperty("text-decoration", "underline", "important");
  span.style.setProperty("text-decoration-color", "#FFC013", "important");
  span.style.setProperty("text-decoration-thickness", "2px", "important");
  span.style.setProperty("text-underline-offset", "3px", "important");
  span.style.setProperty("text-decoration-skip-ink", "none", "important");
  span.style.setProperty("cursor", "help", "important");
  return span;
}

function handleHighlightMouseOver(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const span = target.closest?.(`.${HIGHLIGHT_CLASS}`);
  if (!span) return;
  window.clearTimeout(tipHideTimer);
  showHighlightTip(span);
}

function handleHighlightMouseOut(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (!target.closest?.(`.${HIGHLIGHT_CLASS}`)) return;
  // If the mouse is moving into the tip itself, keep it open.
  const { tip } = ensureTranslatorUi();
  const related = event.relatedTarget;
  if (tip && related instanceof Node && tip.contains(related)) return;
  window.clearTimeout(tipHideTimer);
  tipHideTimer = window.setTimeout(hideHighlightTip, 120);
}

function showHighlightTip(span) {
  const { tip } = ensureTranslatorUi();
  if (!tip) return;

  const level = span.dataset.aitLevel;
  const meaning = span.dataset.aitMeaning;
  const partOfSpeech = span.dataset.aitPos;

  const wordEl = tip.querySelector(".ait-tip-word");
  const phoneticWrap = tip.querySelector(".ait-tip-phonetic");
  const phoneticText = tip.querySelector(".ait-tip-phonetic-text");
  const audioBtn = tip.querySelector(".ait-tip-audio-btn");
  const badgeEl = tip.querySelector(".ait-tip-badge");
  const meaningEl = tip.querySelector(".ait-tip-meaning");

  const word = span.dataset.aitWord || span.textContent;
  wordEl.textContent = word;
  wordEl.className = "ait-tip-word";

  const phonetic = span.dataset.aitPhonetic;
  if (phonetic) {
    phoneticText.textContent = `/${phonetic.replace(/^\/|\/$/g, "")}/`;
    phoneticWrap.hidden = false;
    audioBtn.onclick = (e) => {
      e.stopPropagation();
      speakWord(word, "en-US", audioBtn);
    };
  } else {
    phoneticWrap.hidden = true;
  }

  if (level && LEVEL_BADGE_LABELS[level]) {
    badgeEl.textContent = LEVEL_BADGE_LABELS[level];
    badgeEl.className = `ait-tip-badge ait-vocab-badge--${level}`;
    badgeEl.hidden = false;
  } else {
    badgeEl.hidden = true;
  }

  if (meaning) {
    meaningEl.hidden = false;
    meaningEl.textContent = "";
    if (partOfSpeech) {
      const posEl = document.createElement("span");
      posEl.className = "ait-tip-pos";
      posEl.textContent = partOfSpeech + ".";
      meaningEl.appendChild(posEl);
    }
    meaningEl.appendChild(document.createTextNode(meaning));
  } else {
    meaningEl.hidden = true;
  }

  tip.hidden = false;
  tip.removeAttribute("aria-hidden");
  positionTipNearElement(tip, span.getBoundingClientRect());
}

function positionTipNearElement(tip, rect) {
  const MARGIN = 12;
  const maxWidth = Math.min(340, window.innerWidth - MARGIN * 2);
  tip.style.maxWidth = `${maxWidth}px`;

  const tipWidth = tip.offsetWidth || maxWidth;
  const tipHeight = tip.offsetHeight || 80;

  let left = rect.left + rect.width / 2 - tipWidth / 2;
  left = clamp(left, MARGIN, window.innerWidth - tipWidth - MARGIN);

  let top = rect.bottom + 8;
  if (top + tipHeight > window.innerHeight - MARGIN) {
    top = rect.top - tipHeight - 8;
  }
  top = clamp(top, MARGIN, window.innerHeight - tipHeight - MARGIN);

  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function hideHighlightTip() {
  const tip = ensureTranslatorUi().tip;
  if (tip) {
    tip.hidden = true;
    tip.setAttribute("aria-hidden", "true");
  }
}
