# Export SAMS Developer & Operations Book to PDF

Companion to `docs/README-RUNBOOK-PDF.md` for the deep troubleshooting book.

**Source:** `docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md`

## Option 1 — VS Code / Cursor (easiest)

1. Open `docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md`
2. Open Markdown preview (Ctrl+Shift+V)
3. Print → **Save as PDF**

## Option 2 — GitHub

1. Push repo to GitHub
2. Open `docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md` on github.com
3. Print page → Save as PDF

## Option 3 — Pandoc (on VPS or PC with pandoc installed)

```bash
cd /var/www/sams
pandoc docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md -o SAMS-DEVELOPER-OPS-BOOK-DENIS.pdf --pdf-engine=wkhtmltopdf
# or:
pandoc docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md -o SAMS-DEVELOPER-OPS-BOOK-DENIS.pdf
```

## Option 4 — npx (Node, no install)

```bash
cd /var/www/sams
npx md-to-pdf docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.md
```

Output: `docs/SAMS-DEVELOPER-OPS-BOOK-DENIS.pdf`

---

Keep PDF copies **offline and secure** — the book references paths and procedures but should not include real API keys.

**Related:** Quick ops fixes → `docs/SAMS-OPS-RUNBOOK.md` and `docs/README-RUNBOOK-PDF.md`.
