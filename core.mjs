export const MAX_PDF_BYTES = 75 * 1024 * 1024;

const PLAIN_LANGUAGE_RULES = [
  [/\bin order to\b/gi, "to"],
  [/\butili[sz](?:e|es|ed|ing)\b/gi, "use"],
  [/\bfacilitat(?:e|es|ed|ing)\b/gi, "help"],
  [/\bsubsequently\b/gi, "then"],
  [/\bfurthermore\b|\bmoreover\b/gi, "also"],
  [/\bnotwithstanding\b/gi, "despite"],
  [/\bapproximately\b/gi, "about"],
  [/\bcommence(?:s|d)?\b/gi, "start"],
  [/\bterminate(?:s|d)?\b/gi, "end"],
  [/\bpurchase(?:s|d)?\b/gi, "buy"],
  [/\bprior to\b/gi, "before"],
  [/\bwith regard to\b|\bin relation to\b/gi, "about"],
  [/\bdue to the fact that\b/gi, "because"],
  [/\ba majority of\b/gi, "most"],
  [/\bin the event that\b/gi, "if"],
  [/\bhas the ability to\b/gi, "can"],
  [/\bat this point in time\b/gi, "now"],
];

export function normalizePageText(items = []) {
  let text = "";

  for (const item of items) {
    if (!item || typeof item.str !== "string") continue;
    const value = item.str.trim();
    if (value) {
      if (text && !/[\s\n-]$/.test(text)) text += " ";
      text += value;
    }
    text += item.hasEOL ? "\n" : " ";
  }

  return text
    .replace(/([\p{L}])-[ \t]*\n[ \t]*([\p{Ll}])/gu, "$1$2")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function segmentIntoSentences(text, locale = "en") {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return [];

  if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
    try {
      const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
      return [...segmenter.segment(clean)]
        .map(({ segment }) => segment.trim())
        .filter((sentence) => sentence.length > 1);
    } catch {
      // Fall through for invalid or unsupported locale identifiers.
    }
  }

  return (clean.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) ?? [clean])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 1);
}

export function createReaderEntries(pages, locale = "en") {
  return pages.flatMap((page) =>
    segmentIntoSentences(page.text, locale).map((text) => ({
      text,
      pageNumber: page.pageNumber,
    })),
  );
}

export function plainLanguageSummary(text) {
  const original = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!original) return "There is no text to clarify.";

  let simplified = original;
  for (const [pattern, replacement] of PLAIN_LANGUAGE_RULES) {
    simplified = simplified.replace(pattern, replacement);
  }

  simplified = simplified
    .replace(/^It (?:is|should be) (?:important|worthwhile) to note that\s*/i, "")
    .replace(/^It can be (?:seen|observed) that\s*/i, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

  if (!/[.!?]$/.test(simplified)) simplified += ".";
  return simplified === original ? `In simple terms: ${simplified}` : simplified;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  const precision = value >= 10 ? 0 : 1;
  return `${value.toFixed(precision)} ${unit}`;
}

export function estimateReadingMinutes(entries, wordsPerMinute = 180) {
  const words = entries.reduce((total, entry) => {
    const count = entry.text.trim() ? entry.text.trim().split(/\s+/).length : 0;
    return total + count;
  }, 0);
  return Math.max(1, Math.ceil(words / wordsPerMinute));
}

export function validatePdfFile(file) {
  if (!file) return "No file was selected.";
  const name = String(file.name ?? "");
  const type = String(file.type ?? "").toLowerCase();
  const looksLikePdf = type === "application/pdf" || name.toLowerCase().endsWith(".pdf");
  if (!looksLikePdf) return "Choose a PDF file ending in .pdf.";
  if (Number(file.size) > MAX_PDF_BYTES) return "This PDF is larger than 75 MB. Choose a smaller file.";
  if (Number(file.size) === 0) return "This PDF is empty.";
  return null;
}
