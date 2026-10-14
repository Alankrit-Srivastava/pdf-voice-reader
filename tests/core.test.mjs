import test from "node:test";
import assert from "node:assert/strict";

import {
  createReaderEntries,
  estimateReadingMinutes,
  formatBytes,
  normalizePageText,
  plainLanguageSummary,
  segmentIntoSentences,
  validatePdfFile,
} from "../core.mjs";

test("normalizes PDF text items and repairs soft line hyphenation", () => {
  const text = normalizePageText([
    { str: "A compli-", hasEOL: true },
    { str: "cated sentence.", hasEOL: true },
    { str: "Next line.", hasEOL: false },
  ]);
  assert.equal(text, "A complicated sentence. Next line.");
});

test("segments sentences and preserves punctuation", () => {
  assert.deepEqual(segmentIntoSentences("First sentence. Second question?"), [
    "First sentence.",
    "Second question?",
  ]);
});

test("creates entries with their source page", () => {
  assert.deepEqual(
    createReaderEntries([
      { pageNumber: 1, text: "Page one." },
      { pageNumber: 2, text: "Page two! Another sentence." },
    ]),
    [
      { pageNumber: 1, text: "Page one." },
      { pageNumber: 2, text: "Page two!" },
      { pageNumber: 2, text: "Another sentence." },
    ],
  );
});

test("plain-language helper applies transparent deterministic replacements", () => {
  assert.equal(
    plainLanguageSummary("In order to facilitate the process, utilize this form."),
    "to help the process, use this form.",
  );
});

test("formats file sizes", () => {
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(5 * 1024 * 1024), "5.0 MB");
});

test("estimates at least one minute", () => {
  assert.equal(estimateReadingMinutes([{ text: "A short sentence." }]), 1);
});

test("validates PDF type, size, and empty files", () => {
  assert.equal(validatePdfFile({ name: "notes.txt", type: "text/plain", size: 100 }), "Choose a PDF file ending in .pdf.");
  assert.equal(validatePdfFile({ name: "empty.pdf", type: "application/pdf", size: 0 }), "This PDF is empty.");
  assert.equal(validatePdfFile({ name: "valid.pdf", type: "application/pdf", size: 100 }), null);
});
