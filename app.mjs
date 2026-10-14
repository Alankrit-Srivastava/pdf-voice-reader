import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.min.mjs";
import {
  createReaderEntries,
  estimateReadingMinutes,
  formatBytes,
  normalizePageText,
  plainLanguageSummary,
  validatePdfFile,
} from "./core.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs";

const $ = (id) => document.getElementById(id);
const elements = {
  welcomeView: $("welcomeView"),
  loadingView: $("loadingView"),
  readerView: $("readerView"),
  errorView: $("errorView"),
  fileInput: $("fileInput"),
  dropZone: $("dropZone"),
  btnSample: $("btnSample"),
  btnCancelLoad: $("btnCancelLoad"),
  btnNewPdf: $("btnNewPdf"),
  btnRetry: $("btnRetry"),
  btnErrorSample: $("btnErrorSample"),
  btnPrev: $("btnPrev"),
  btnPlay: $("btnPlay"),
  btnNext: $("btnNext"),
  btnFocusMode: $("btnFocusMode"),
  btnAutoExplain: $("btnAutoExplain"),
  voiceSelect: $("voiceSelect"),
  speedSelect: $("speedSelect"),
  sentenceRange: $("sentenceRange"),
  readingPane: $("readingPane"),
  documentTitle: $("documentTitle"),
  documentMeta: $("documentMeta"),
  sentenceCounter: $("sentenceCounter"),
  pageCounter: $("pageCounter"),
  loadingDetail: $("loadingDetail"),
  loadingBar: $("loadingBar"),
  errorMessage: $("errorMessage"),
  statusMessage: $("statusMessage"),
  reader: $("reader"),
};

const synth = window.speechSynthesis;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const settingsKey = "clarity-reader-settings-v1";

let entries = [];
let pageCount = 0;
let currentIndex = 0;
let voices = [];
let isPlaying = false;
let isPaused = false;
let hasCompleted = false;
let focusMode = false;
let autoExplain = false;
let playbackToken = 0;
let loadingToken = 0;
let loadingTask = null;
let antigravityAvailable = false;
const explanationCache = new Map();

function showView(viewName) {
  for (const name of ["welcomeView", "loadingView", "readerView", "errorView"]) {
    elements[name].hidden = name !== viewName;
  }
}

function announce(message) {
  elements.statusMessage.textContent = "";
  window.setTimeout(() => {
    elements.statusMessage.textContent = message;
  }, 20);
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey) ?? "{}");
    if (saved.speed) elements.speedSelect.value = String(saved.speed);
    focusMode = Boolean(saved.focusMode);
    autoExplain = Boolean(saved.autoExplain);
    return saved.voice ?? "";
  } catch {
    return "";
  }
}

function saveSettings() {
  try {
    localStorage.setItem(
      settingsKey,
      JSON.stringify({
        speed: Number(elements.speedSelect.value),
        voice: elements.voiceSelect.value,
        focusMode,
        autoExplain,
      }),
    );
  } catch {
    // Reading still works when browser storage is unavailable.
  }
}

const preferredVoice = loadSettings();

function setToggleState(button, active) {
  button.setAttribute("aria-pressed", String(active));
}

function syncPreferenceUI() {
  document.body.classList.toggle("focus-mode", focusMode);
  setToggleState(elements.btnFocusMode, focusMode);
  setToggleState(elements.btnAutoExplain, autoExplain);
}

function populateVoices() {
  if (!synth) return;
  const previous = elements.voiceSelect.value || preferredVoice;
  voices = synth.getVoices().sort((a, b) => {
    const locale = navigator.language.toLowerCase();
    const aMatches = a.lang.toLowerCase().startsWith(locale.split("-")[0]);
    const bMatches = b.lang.toLowerCase().startsWith(locale.split("-")[0]);
    if (aMatches !== bMatches) return aMatches ? -1 : 1;
    if (a.default !== b.default) return a.default ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  elements.voiceSelect.replaceChildren();
  if (!voices.length) {
    const option = new Option("System default", "");
    elements.voiceSelect.add(option);
    return;
  }

  for (const voice of voices) {
    const value = `${voice.name}::${voice.lang}`;
    const label = `${voice.name} · ${voice.lang}${voice.default ? " · Default" : ""}`;
    elements.voiceSelect.add(new Option(label, value));
  }

  const hasPrevious = [...elements.voiceSelect.options].some((option) => option.value === previous);
  if (hasPrevious) elements.voiceSelect.value = previous;
}

function selectedVoice() {
  const [name, lang] = elements.voiceSelect.value.split("::");
  return voices.find((voice) => voice.name === name && voice.lang === lang) ?? null;
}

function updatePlaybackUI() {
  const activelySpeaking = isPlaying && !isPaused;
  elements.btnPlay.classList.toggle("is-playing", activelySpeaking);
  elements.btnPlay.setAttribute("aria-pressed", String(activelySpeaking));
  elements.btnPlay.setAttribute("aria-label", activelySpeaking ? "Pause document" : "Play document");
  elements.btnPlay.querySelector("span").textContent = activelySpeaking ? "Pause" : isPaused ? "Resume" : "Play";
  elements.btnPrev.disabled = !entries.length || currentIndex <= 0;
  elements.btnNext.disabled = !entries.length || currentIndex >= entries.length - 1;
}

function updateReaderPosition() {
  if (!entries.length) return;
  const entry = entries[currentIndex];
  elements.sentenceCounter.textContent = `${currentIndex + 1} / ${entries.length}`;
  elements.pageCounter.textContent = `${entry.pageNumber} / ${pageCount}`;
  elements.sentenceRange.value = String(currentIndex + 1);
  updatePlaybackUI();
}

function highlightSentence(index, shouldScroll = true) {
  if (index < 0 || index >= entries.length) return;
  currentIndex = index;
  for (const active of elements.readingPane.querySelectorAll(".sentence.active")) {
    active.classList.remove("active");
    active.removeAttribute("aria-current");
  }
  const sentence = $(`sentence-${index}`);
  if (sentence) {
    sentence.classList.add("active");
    sentence.setAttribute("aria-current", "true");
    if (shouldScroll) {
      sentence.scrollIntoView({
        behavior: prefersReducedMotion.matches ? "auto" : "smooth",
        block: "center",
      });
    }
  }
  updateReaderPosition();
}

function renderExplanation(index, result, visible = true) {
  const drawer = $(`explanation-${index}`);
  const button = $(`explain-${index}`);
  if (!drawer || !button) return "";

  const heading = document.createElement("strong");
  heading.textContent = result.provider === "Antigravity" ? "Antigravity explanation" : "Local plain-language version";
  const text = document.createElement("span");
  text.textContent = result.text;
  drawer.replaceChildren(heading, text);

  drawer.hidden = !visible;
  drawer.classList.toggle("visible", visible);
  button.setAttribute("aria-expanded", String(visible));
  button.textContent = visible ? "Hide clarification" : "Clarify";
  return drawer.querySelector("span")?.textContent ?? "";
}

async function getExplanation(index) {
  if (explanationCache.has(index)) return explanationCache.get(index);

  const fallback = {
    text: plainLanguageSummary(entries[index].text),
    provider: "Local helper",
  };

  if (!antigravityAvailable) {
    explanationCache.set(index, fallback);
    return fallback;
  }

  try {
    const response = await fetch("/api/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: entries[index].text,
        pageNumber: entries[index].pageNumber,
        previous: entries[index - 1]?.text ?? "",
        next: entries[index + 1]?.text ?? "",
      }),
    });
    const payload = await response.json();
    if (!response.ok || typeof payload.explanation !== "string") {
      throw new Error(payload.error || "Antigravity did not return an explanation.");
    }
    const result = { text: payload.explanation.trim(), provider: "Antigravity" };
    explanationCache.set(index, result);
    return result;
  } catch (error) {
    console.warn("Antigravity explanation unavailable; using local helper.", error);
    antigravityAvailable = false;
    announce("Antigravity is unavailable, so the local plain-language helper was used.");
    explanationCache.set(index, fallback);
    return fallback;
  }
}

function renderEntries() {
  const fragment = document.createDocumentFragment();
  let previousPage = 0;

  entries.forEach((entry, index) => {
    if (entry.pageNumber !== previousPage) {
      const divider = document.createElement("div");
      divider.className = "page-divider";
      divider.textContent = `Page ${entry.pageNumber}`;
      divider.setAttribute("role", "separator");
      fragment.append(divider);
      previousPage = entry.pageNumber;
    }

    const block = document.createElement("div");
    block.className = "sentence-block";

    const sentence = document.createElement("button");
    sentence.type = "button";
    sentence.className = "sentence";
    sentence.id = `sentence-${index}`;
    sentence.setAttribute("aria-label", `Sentence ${index + 1}, page ${entry.pageNumber}. ${entry.text}`);

    const text = document.createElement("span");
    text.className = "sentence-text";
    text.textContent = entry.text;
    const number = document.createElement("span");
    number.className = "sentence-number";
    number.textContent = String(index + 1).padStart(2, "0");
    number.setAttribute("aria-hidden", "true");
    sentence.append(text, number);

    const explain = document.createElement("button");
    explain.type = "button";
    explain.className = "explain-button";
    explain.id = `explain-${index}`;
    explain.textContent = "Explain";
    explain.setAttribute("aria-expanded", "false");
    explain.setAttribute("aria-controls", `explanation-${index}`);

    const drawer = document.createElement("div");
    drawer.className = "explanation";
    drawer.id = `explanation-${index}`;
    drawer.hidden = true;

    sentence.addEventListener("click", () => moveTo(index));
    explain.addEventListener("click", async () => {
      const willOpen = explain.getAttribute("aria-expanded") !== "true";
      if (!willOpen) {
        renderExplanation(index, explanationCache.get(index) ?? { text: "", provider: "Local helper" }, false);
        return;
      }
      explain.disabled = true;
      explain.textContent = antigravityAvailable ? "Asking AI…" : "Clarifying…";
      const result = await getExplanation(index);
      const explanation = renderExplanation(index, result, true);
      explain.disabled = false;
      highlightSentence(index, false);
      if (willOpen && !isPlaying) speakStandalone(explanation);
    });

    block.append(sentence, explain, drawer);
    fragment.append(block);
  });

  elements.readingPane.replaceChildren(fragment);
}

function utter(text, token) {
  return new Promise((resolve) => {
    if (!synth || token !== playbackToken) return resolve(false);
    const speech = new SpeechSynthesisUtterance(text);
    const voice = selectedVoice();
    if (voice) speech.voice = voice;
    speech.rate = Number(elements.speedSelect.value);
    speech.onend = () => resolve(token === playbackToken);
    speech.onerror = (event) => {
      const expected = event.error === "canceled" || event.error === "interrupted";
      if (!expected && token === playbackToken) announce(`Speech stopped: ${event.error || "voice error"}.`);
      resolve(false);
    };
    synth.speak(speech);
  });
}

async function speakCurrent(token) {
  if (!isPlaying || token !== playbackToken) return;
  if (currentIndex >= entries.length) {
    isPlaying = false;
    isPaused = false;
    hasCompleted = true;
    currentIndex = entries.length - 1;
    updatePlaybackUI();
    announce("Document complete. Press Play to begin again.");
    return;
  }

  highlightSentence(currentIndex);
  const spokenParts = [entries[currentIndex].text];
  if (autoExplain) {
    const result = await getExplanation(currentIndex);
    if (!isPlaying || token !== playbackToken) return;
    const explanation = renderExplanation(currentIndex, result, true);
    spokenParts.push(`${result.provider === "Antigravity" ? "Antigravity explanation" : "Plain-language version"}. ${explanation}`);
  }

  for (const part of spokenParts) {
    const finished = await utter(part, token);
    if (!finished || !isPlaying || token !== playbackToken) return;
  }

  currentIndex += 1;
  speakCurrent(token);
}

function startPlayback() {
  if (!entries.length || !synth) return;
  if (hasCompleted || currentIndex >= entries.length) {
    currentIndex = 0;
    hasCompleted = false;
  }
  isPlaying = true;
  isPaused = false;
  playbackToken += 1;
  synth.cancel();
  updatePlaybackUI();
  announce(`Reading sentence ${currentIndex + 1} of ${entries.length}.`);
  speakCurrent(playbackToken);
}

function pausePlayback() {
  if (!synth || !isPlaying || isPaused) return;
  synth.pause();
  isPaused = true;
  updatePlaybackUI();
  announce("Reading paused.");
}

function resumePlayback() {
  if (!synth || !isPlaying || !isPaused) return;
  synth.resume();
  isPaused = false;
  updatePlaybackUI();
  announce("Reading resumed.");
}

function stopPlayback() {
  playbackToken += 1;
  isPlaying = false;
  isPaused = false;
  hasCompleted = false;
  if (synth) {
    synth.resume();
    synth.cancel();
  }
  updatePlaybackUI();
}

function togglePlayback() {
  if (!synth) {
    announce("Text-to-speech is not available in this browser.");
    return;
  }
  if (isPlaying && !isPaused) pausePlayback();
  else if (isPlaying && isPaused) resumePlayback();
  else startPlayback();
}

function moveTo(index) {
  const nextIndex = Math.max(0, Math.min(index, entries.length - 1));
  const shouldContinue = isPlaying;
  playbackToken += 1;
  if (synth) {
    synth.resume();
    synth.cancel();
  }
  isPaused = false;
  hasCompleted = false;
  highlightSentence(nextIndex);
  announce(`Sentence ${nextIndex + 1} of ${entries.length}, page ${entries[nextIndex].pageNumber}.`);
  if (shouldContinue) {
    isPlaying = true;
    speakCurrent(playbackToken);
  } else {
    isPlaying = false;
    updatePlaybackUI();
  }
}

function speakStandalone(text) {
  if (!synth || !text) return;
  playbackToken += 1;
  synth.resume();
  synth.cancel();
  isPlaying = false;
  isPaused = false;
  updatePlaybackUI();
  utter(text, playbackToken);
}

function resetReader() {
  stopPlayback();
  loadingToken += 1;
  loadingTask?.destroy();
  loadingTask = null;
  entries = [];
  explanationCache.clear();
  pageCount = 0;
  currentIndex = 0;
  elements.readingPane.replaceChildren();
  elements.fileInput.value = "";
  elements.statusMessage.textContent = "";
  showView("welcomeView");
  elements.dropZone.focus();
}

function showError(message) {
  stopPlayback();
  elements.errorMessage.textContent = message;
  showView("errorView");
  elements.btnRetry.focus();
}

function describePdfError(error) {
  const message = String(error?.message ?? error ?? "");
  if (/password/i.test(message)) return "This PDF is password protected. Unlock it and try again.";
  if (/invalid pdf|missing pdf|format/i.test(message)) return "This file does not appear to be a valid, readable PDF.";
  if (/no readable text/i.test(message)) return message;
  if (/network|fetch/i.test(message)) return "The sample could not be loaded. Check the local server and try again.";
  return "The document could not be read. It may be damaged or use an unsupported PDF feature.";
}

async function processPdf(file) {
  const validationError = validatePdfFile(file);
  if (validationError) return showError(validationError);

  stopPlayback();
  const token = ++loadingToken;
  showView("loadingView");
  elements.loadingBar.style.width = "8%";
  elements.loadingDetail.textContent = `Opening ${file.name} securely on this device.`;

  try {
    const buffer = await file.arrayBuffer();
    if (token !== loadingToken) return;

    const activeLoadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    loadingTask = activeLoadingTask;
    activeLoadingTask.onProgress = ({ loaded, total }) => {
      if (token !== loadingToken || !total) return;
      const percent = Math.min(25, Math.max(8, Math.round((loaded / total) * 25)));
      elements.loadingBar.style.width = `${percent}%`;
    };

    const pdf = await activeLoadingTask.promise;
    pageCount = pdf.numPages;
    const pages = [];
    let metadata = null;
    try {
      metadata = await pdf.getMetadata();
    } catch {
      // Metadata is optional and often absent.
    }

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      if (token !== loadingToken) return;
      elements.loadingDetail.textContent = `Reading page ${pageNumber} of ${pageCount}…`;
      elements.loadingBar.style.width = `${25 + Math.round((pageNumber / pageCount) * 68)}%`;
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push({ pageNumber, text: normalizePageText(content.items) });
      page.cleanup();
    }

    entries = createReaderEntries(pages, navigator.language || "en");
    if (!entries.length) {
      throw new Error("No readable text was found. This may be a scanned PDF; OCR support is not included yet.");
    }

    currentIndex = 0;
    explanationCache.clear();
    hasCompleted = false;
    const rawMetadataTitle = metadata?.info?.Title?.trim() ?? "";
    const metadataTitle = /^(untitled|document)$/i.test(rawMetadataTitle) ? "" : rawMetadataTitle;
    const fileTitle = file.name.replace(/\.pdf$/i, "");
    elements.documentTitle.textContent = metadataTitle || fileTitle || "Untitled document";
    elements.documentMeta.textContent = `${pageCount} ${pageCount === 1 ? "page" : "pages"} · ${formatBytes(file.size)} · about ${estimateReadingMinutes(entries)} min`;
    elements.sentenceRange.max = String(entries.length);
    elements.sentenceRange.value = "1";
    renderEntries();
    elements.loadingBar.style.width = "100%";
    showView("readerView");
    highlightSentence(0, false);
    announce(`${entries.length} sentences ready across ${pageCount} ${pageCount === 1 ? "page" : "pages"}.`);
    elements.reader.focus({ preventScroll: true });
    await activeLoadingTask.destroy();
    if (loadingTask === activeLoadingTask) loadingTask = null;
  } catch (error) {
    if (token !== loadingToken) return;
    console.error("PDF processing failed", error);
    loadingTask = null;
    showError(describePdfError(error));
  }
}

async function openSample() {
  showView("loadingView");
  elements.loadingDetail.textContent = "Opening the sample document.";
  try {
    const response = await fetch("./output/pdf/clarity_reader_sample.pdf");
    if (!response.ok) throw new Error(`Fetch failed with ${response.status}`);
    const blob = await response.blob();
    await processPdf(new File([blob], "Clarity Reader sample.pdf", { type: "application/pdf" }));
  } catch (error) {
    showError(describePdfError(error));
  }
}

elements.dropZone.addEventListener("click", () => elements.fileInput.click());
elements.dropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  elements.dropZone.classList.add("dragover");
});
elements.dropZone.addEventListener("dragleave", () => elements.dropZone.classList.remove("dragover"));
elements.dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropZone.classList.remove("dragover");
  const [file] = event.dataTransfer.files;
  if (file) processPdf(file);
});
elements.fileInput.addEventListener("change", () => {
  const [file] = elements.fileInput.files;
  if (file) processPdf(file);
});

elements.btnSample.addEventListener("click", openSample);
elements.btnErrorSample.addEventListener("click", openSample);
elements.btnRetry.addEventListener("click", resetReader);
elements.btnNewPdf.addEventListener("click", resetReader);
elements.btnCancelLoad.addEventListener("click", resetReader);
elements.btnPlay.addEventListener("click", togglePlayback);
elements.btnPrev.addEventListener("click", () => moveTo(currentIndex - 1));
elements.btnNext.addEventListener("click", () => moveTo(currentIndex + 1));
elements.sentenceRange.addEventListener("input", () => moveTo(Number(elements.sentenceRange.value) - 1));

elements.btnFocusMode.addEventListener("click", () => {
  focusMode = !focusMode;
  syncPreferenceUI();
  saveSettings();
  announce(`Focus mode ${focusMode ? "on" : "off"}.`);
});

elements.btnAutoExplain.addEventListener("click", () => {
  autoExplain = !autoExplain;
  syncPreferenceUI();
  saveSettings();
  announce(`Auto-clarify ${autoExplain ? "on" : "off"}.`);
});

elements.voiceSelect.addEventListener("change", saveSettings);
elements.speedSelect.addEventListener("change", () => {
  saveSettings();
  if (isPlaying) moveTo(currentIndex);
});

window.addEventListener("keydown", (event) => {
  if (elements.readerView.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
  const interactive = event.target.closest("button, select, input, textarea, a");
  if (interactive) return;

  if (event.code === "Space") {
    event.preventDefault();
    togglePlayback();
  } else if (event.code === "ArrowLeft") {
    event.preventDefault();
    moveTo(currentIndex - 1);
  } else if (event.code === "ArrowRight") {
    event.preventDefault();
    moveTo(currentIndex + 1);
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault();
    elements.btnFocusMode.click();
  }
});

window.addEventListener("beforeunload", () => synth?.cancel());

if (synth) {
  populateVoices();
  synth.addEventListener("voiceschanged", populateVoices);
} else {
  elements.btnPlay.disabled = true;
  elements.voiceSelect.disabled = true;
  elements.voiceSelect.replaceChildren(new Option("Speech unavailable", ""));
}

syncPreferenceUI();
updatePlaybackUI();
showView("welcomeView");

fetch("/api/status")
  .then((response) => (response.ok ? response.json() : null))
  .then((status) => {
    antigravityAvailable = Boolean(status?.antigravity);
    elements.btnAutoExplain.title = antigravityAvailable
      ? "Ask Antigravity to explain each sentence after it is read"
      : "Antigravity is not configured; local clarification will be used";
  })
  .catch(() => {
    antigravityAvailable = false;
  });
