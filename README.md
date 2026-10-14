# Clarity Reader

Repository: [Alankrit-Srivastava/pdf-voice-reader](https://github.com/Alankrit-Srivastava/pdf-voice-reader)  
Portfolio: [alankrit-srivastava.github.io](https://alankrit-srivastava.github.io)

Clarity Reader is a local-first PDF voice reader. It extracts PDF text in the browser, breaks it into sentences, reads each sentence aloud with the browser's installed voices, and keeps the current sentence in view.

For difficult passages, the app can use Google's Antigravity SDK to generate a short contextual explanation. If Antigravity is not configured, a transparent rule-based local helper remains available.

## What it includes

- Local PDF parsing with PDF.js 6.4.299
- Locale-aware sentence splitting with `Intl.Segmenter`
- Synchronized sentence highlighting and page references
- Real play, pause, resume, seek, and restart behavior
- Voice and speed preferences saved in the browser
- Focus mode and keyboard shortcuts
- Optional Antigravity explanations with surrounding-sentence context
- Safe DOM rendering: imported PDF text is never injected as HTML
- Responsive layout and accessible status announcements

## Run it

The module-based web app must be served over HTTP. The Python launcher starts a loopback-only server and opens the default browser:

```powershell
python .\ai_pdf_voice_reader.py --ui
```

To choose a fixed port or avoid opening a browser:

```powershell
python .\ai_pdf_voice_reader.py --port 8080 --no-browser
```

The app processes the PDF locally. It does not upload the complete file.

## Enable Antigravity explanations

Install the Python dependencies and set a Gemini API key in the environment before launching:

```powershell
python -m pip install -r .\requirements.txt
$env:GEMINI_API_KEY = "your-key"
python .\ai_pdf_voice_reader.py --ui
```

The key stays in the Python process and is never sent to the browser. When a user requests an explanation, only the selected sentence and its immediately adjacent sentences are sent to Antigravity. Do not hard-code the key in this repository.

## Controls

- `Space`: play or pause while focus is in the reader
- `Left Arrow` / `Right Arrow`: previous or next sentence
- `F`: toggle focus mode
- Select a sentence to jump to it
- Select **Explain** to hear and reveal an explanation

## Command-line inspection

You can inspect extraction without starting the UI:

```powershell
python .\ai_pdf_voice_reader.py --pdf .\output\pdf\clarity_reader_sample.pdf --limit 10
```

## Tests

The core text pipeline has no JavaScript package dependencies:

```powershell
npm test
python -m py_compile .\ai_pdf_voice_reader.py
```

## Current limitations

- Image-only/scanned PDFs require OCR, which is not yet bundled.
- Available speech voices and voice quality depend on the browser and operating system.
- Antigravity explanations require network access, the SDK, and a valid API key.
- PDF extraction quality depends on the document's embedded text order.
