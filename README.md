# AI Article Translator MVP

A Chrome Manifest V3 extension that translates web articles and selected text with an OpenAI-compatible chat completions API.

## Features

- Translate the main article on the current page.
- Insert translated paragraphs below the original text for bilingual reading.
- Translate selected text from the popup or the right-click context menu.
- Show a floating translate button near selected text, then open the translation popup near the selection.
- Configure provider presets, API key, base URL, model, target language, and paragraph concurrency.
- Compatible with OpenAI-style `/v1/chat/completions` providers.

## Load In Chrome

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this folder:
   `/Users/adley/Documents/Codex/翻译助手`

## Configure

Open the extension settings and fill in:

- API Key: your model provider key.
- Provider: OpenAI, DeepSeek, Tongyi Qianwen, or a custom OpenAI-compatible endpoint.
- Base URL: auto-filled for built-in providers.
- Model: auto-filled from provider presets, and still editable.
- Default target language: for example `中文`.
- Paragraph concurrency: `1` to `4`.

Built-in provider presets:

- OpenAI: `https://api.openai.com`, default model `gpt-4o-mini`.
- DeepSeek: `https://api.deepseek.com`, default model `deepseek-v4-flash`.
- 通义千问 中国站: `https://dashscope.aliyuncs.com/compatible-mode/v1`, default model `qwen-plus`.
- 通义千问 国际站: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`, default model `qwen-plus`.

API keys are stored in `chrome.storage.local`.

## Selection Translation

Select text on a web page. A small floating translate button appears near the selection. Click it to translate the selected text and show the result next to the selected area.

## MVP Notes

- Article extraction uses common containers like `article`, `main`, and paragraph-density fallback.
- Translation is paragraph-based and intentionally conservative.
- Refreshing the page restores the original page.
- Some restricted Chrome pages and browser internal pages cannot run content scripts.
