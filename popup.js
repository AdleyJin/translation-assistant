const targetLanguageInput = document.getElementById("targetLanguage");
const englishLevelSelect = document.getElementById("englishLevel");
const autoHighlightCheckbox = document.getElementById("autoHighlight");
const autoHighlightLabel = document.getElementById("autoHighlightLabel");

initPopup();

targetLanguageInput.addEventListener("change", saveSettings);
englishLevelSelect.addEventListener("change", saveSettings);
autoHighlightCheckbox.addEventListener("change", () => {
  updateToggleLabel(autoHighlightCheckbox.checked);
  saveSettings();
});

async function initPopup() {
  const settings = await chrome.storage.local.get({
    targetLanguage: "中文",
    englishLevel: "cet4",
    autoHighlight: true
  });
  targetLanguageInput.value = settings.targetLanguage || "中文";
  englishLevelSelect.value = settings.englishLevel || "cet4";
  autoHighlightCheckbox.checked = settings.autoHighlight !== false;
  updateToggleLabel(autoHighlightCheckbox.checked);
}

function updateToggleLabel(checked) {
  autoHighlightLabel.textContent = checked ? "开启" : "关闭";
}

async function saveSettings() {
  await chrome.storage.local.set({
    targetLanguage: targetLanguageInput.value.trim() || "中文",
    englishLevel: englishLevelSelect.value || "cet4",
    autoHighlight: autoHighlightCheckbox.checked
  });
}
