# meow-invoices

A small TypeScript CLI to **list all your Meow invoices** and **download every invoice as a PDF** via the [Meow API](https://developer.meow.com).

It calls two endpoints:

| Purpose | Endpoint | Docs |
|---------|----------|------|
| List invoices | `GET /billing/invoices` | [List Invoices](https://developer.meow.com/api-reference/billing/list-invoices.md) |
| Download a PDF | `GET /billing/invoices/{invoice_id}/download` | [Download Invoice PDF](https://developer.meow.com/api-reference/billing/download-invoice-pdf.md) |

The download endpoint returns **raw PDF bytes** (not a JSON payload or a download URL), so the script writes the response body straight to disk. Filenames come from the server's `Content-Disposition` header when present.

## Requirements

- Node.js >= 18 (uses the built-in `fetch`)
- A Meow API key with the `billing:invoices:read` scope (read-only is enough)

## Install

```bash
git clone git@github.com:itsahedge/meow-invoices.git
cd meow-invoices
npm install
```

## Configuration

The script is configured entirely through environment variables:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MEOW_API_KEY` | yes | — | API key with scope `billing:invoices:read` |
| `MEOW_ENTITY_ID` | no | — | Scope requests to a single entity (multi-entity keys) |
| `MEOW_BASE_URL` | no | `https://api.meow.com/v1` | Override for sandbox: `https://api.sandbox.meow.com/v1` |

```bash
export MEOW_API_KEY="your-api-key"
# optional:
# export MEOW_ENTITY_ID="00000000-0000-0000-0000-000000000000"
# export MEOW_BASE_URL="https://api.sandbox.meow.com/v1"
```

## Usage

```bash
# List every invoice (number, status, amount due / total, id)
npm run list

# Download every invoice PDF into ./invoices (created if missing)
npm run download

# Download into a custom directory
npm run download -- ./out
```

You can also run it directly with `tsx`:

```bash
npx tsx src/meow-invoices.ts list
npx tsx src/meow-invoices.ts download ./out
```

### Example output

```
$ npm run list
Found 3 invoice(s):

INV-2024-001     Paid           due 0.00/1500.00       3f2a...e91
INV-2024-002     Open           due 500.00/500.00      7b1c...44d
(no number)      Draft          due 0.00/0.00          9d0e...a02
```

```
$ npm run download
Downloading 3 invoice PDF(s) to ./invoices ...
  ok   INV-2024-001 -> invoices/Invoice - INV-2024-001.pdf
  ok   INV-2024-002 -> invoices/Invoice - INV-2024-002.pdf
  ok   9d0e...a02 -> invoices/Invoice - 9d0e...a02.pdf

Done. 3 succeeded, 0 failed.
```

## How it works

```
GET /billing/invoices                       -> Invoice[]   (collect IDs)
        |
        v  (5 concurrent workers)
GET /billing/invoices/{id}/download          -> raw PDF bytes
        |
        v
write to <outDir>/<filename>.pdf
```

- **Filenames**: taken from the `Content-Disposition` header (e.g. `attachment; filename="Invoice - INV-2024-001.pdf"`), sanitized for the filesystem, and de-duplicated by appending the invoice id on collision (drafts can have a null invoice number).
- **Concurrency**: downloads run 5 at a time so large invoice sets don't hammer the API.
- **Error isolation**: a failed download is reported and skipped; the run continues. The process exits with a non-zero code if any download failed, so it is safe to use in CI or cron.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run list` | List all invoices |
| `npm run download [-- <dir>]` | Download all invoice PDFs |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm run build` | Compile to `dist/` |

## License

Proprietary.
