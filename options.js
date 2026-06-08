const DEFAULT_SETTINGS = {
  provider: "openai",
  apiKey: "",
  baseUrl: "https://api.openai.com",
  model: "gpt-4o-mini",
  targetLanguage: "中文",
  maxConcurrent: 2
};

const PROVIDER_PRESETS = {
  openai: {
    baseUrl: "https://api.openai.com",
    model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"]
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"]
  },
  "qwen-cn": {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"]
  },
  "qwen-intl": {
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"]
  },
  custom: {
    baseUrl: "",
    model: "",
    models: []
  }
};

const fields = {
  provider: document.getElementById("provider"),
  apiKey: document.getElementById("apiKey"),
  baseUrl: document.getElementById("baseUrl"),
  model: document.getElementById("model"),
  targetLanguage: document.getElementById("targetLanguage"),
  maxConcurrent: document.getElementById("maxConcurrent")
};

const statusNode = document.getElementById("status");
const modelPresets = document.getElementById("modelPresets");

document.getElementById("save").addEventListener("click", saveSettings);
document.getElementById("closeOptions").addEventListener("click", closeOptions);
fields.provider.addEventListener("change", applyProviderPreset);
loadSettings();

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);

  for (const [key, input] of Object.entries(fields)) {
    input.value = settings[key] ?? DEFAULT_SETTINGS[key];
  }

  renderModelPresets(fields.provider.value);
}

async function saveSettings() {
  const maxConcurrent = Math.min(Math.max(Number(fields.maxConcurrent.value) || 2, 1), 4);

  await chrome.storage.local.set({
    provider: fields.provider.value,
    apiKey: fields.apiKey.value.trim(),
    baseUrl: normalizeBaseUrl(fields.baseUrl.value || DEFAULT_SETTINGS.baseUrl),
    model: fields.model.value.trim() || DEFAULT_SETTINGS.model,
    targetLanguage: fields.targetLanguage.value.trim() || DEFAULT_SETTINGS.targetLanguage,
    maxConcurrent
  });

  fields.maxConcurrent.value = String(maxConcurrent);
  statusNode.textContent = "设置已保存";
  setTimeout(() => {
    statusNode.textContent = "";
  }, 1800);
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function applyProviderPreset() {
  const provider = fields.provider.value;
  const preset = PROVIDER_PRESETS[provider];
  renderModelPresets(provider);

  if (!preset || provider === "custom") {
    return;
  }

  fields.baseUrl.value = preset.baseUrl;
  fields.model.value = preset.model;
}

function renderModelPresets(provider) {
  const models = PROVIDER_PRESETS[provider]?.models || [];
  modelPresets.innerHTML = "";

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    modelPresets.appendChild(option);
  }
}

function closeOptions() {
  window.close();

  window.setTimeout(() => {
    if (history.length > 1) {
      history.back();
    }
  }, 120);
}
