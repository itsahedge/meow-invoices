---
name: meow-invoices
description: List a Meow account's invoices and download invoice PDFs using this repo's CLI, via the Meow API. Use whenever the user wants to list Meow invoices, download or export Meow invoice PDFs, fetch or back up all invoices from Meow, or pull invoice documents from the Meow billing API.
---

# Meow Invoices

This repo is a TypeScript CLI that lists invoices and downloads every invoice PDF from a Meow account. Everything you need to run it is below.

It wraps two read-only Meow API endpoints:

- List Invoices — `GET /billing/invoices` → JSON array of invoices
- Download Invoice PDF — `GET /billing/invoices/{invoice_id}/download` → raw PDF bytes

Docs: https://developer.meow.com/api-reference/billing/list-invoices.md and https://developer.meow.com/api-reference/billing/download-invoice-pdf.md

## Prerequisites

- `node` (>= 18) and `npm`.
- `MEOW_API_KEY` set in the environment, with the `billing:invoices:read` scope (read-only is enough). If it is not set, ask the user for it or tell them to export it. Never invent a key, and never print the key value back.
- Optional `MEOW_ENTITY_ID` — scope to a single entity on multi-entity keys.
- Optional `MEOW_BASE_URL` — target sandbox `https://api.sandbox.meow.com/v1` (default is production `https://api.meow.com/v1`).

## Run it

From the repo root, install dependencies once (skip if `node_modules` already exists):

```bash
npm install
```

List invoices (when the user wants to see/enumerate invoices):

```bash
npm run --silent list
```

Each row is: `<invoice_number> <status> due <amount_due>/<amount> <id>`.

Download all invoice PDFs (when the user wants the PDFs/documents):

```bash
npm run --silent download            # writes PDFs to ./invoices
npm run --silent download -- <dir>   # writes PDFs to a custom directory
```

If the user names a destination, pass it as `<dir>`, preferably an absolute path.

## Report results

- `list`: summarize counts by status if the list is long; surface the invoice numbers/ids the user asked about.
- `download`: report how many succeeded vs. failed and the output path. The command exits non-zero if any download failed; failed invoices are printed with a `FAIL` prefix. Relay which ones failed.

## Notes

- Read-only: this never creates, modifies, sends, or pays invoices.
- The download endpoint returns raw PDF bytes (not a URL). Filenames come from the server `Content-Disposition` header, sanitized and de-duplicated by the CLI; downloads run 5 at a time.
- A 401/403 means the key is missing the `billing:invoices:read` scope or is wrong. An empty `list` result means the account/entity has no invoices.
