# Export SAMS Ops Runbook to PDF

## Option 1 — VS Code / Cursor (easiest)

1. Open `docs/SAMS-OPS-RUNBOOK.md`
2. Open Markdown preview (Ctrl+Shift+V)
3. Print → **Save as PDF**

## Option 2 — GitHub

1. Push repo to GitHub
2. Open `docs/SAMS-OPS-RUNBOOK.md` on github.com
3. Print page → Save as PDF

## Option 3 — Pandoc (on VPS or PC with pandoc installed)

```bash
cd /var/www/sams
pandoc docs/SAMS-OPS-RUNBOOK.md -o SAMS-OPS-RUNBOOK.pdf --pdf-engine=wkhtmltopdf
# or:
pandoc docs/SAMS-OPS-RUNBOOK.md -o SAMS-OPS-RUNBOOK.pdf
```

## Option 4 — npx (Node, no install)

```bash
cd /var/www/sams
npx md-to-pdf docs/SAMS-OPS-RUNBOOK.md
```

Output: `docs/SAMS-OPS-RUNBOOK.pdf`

---

Keep PDF copies **offline and secure** — the runbook references paths and procedures but should not include real API keys.
