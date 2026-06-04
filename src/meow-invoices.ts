#!/usr/bin/env node
/**
 * Meow invoices: list all invoices and download their PDFs.
 *
 *   GET /billing/invoices                       -> Invoice[] (JSON array)
 *   GET /billing/invoices/{invoice_id}/download -> application/pdf (raw bytes)
 *
 * Auth: x-api-key header, scope `billing:invoices:read` (read-only is enough).
 * Optional x-entity-id header to scope to a single entity.
 *
 * Config via env:
 *   MEOW_API_KEY    (required)  API key
 *   MEOW_ENTITY_ID  (optional)  scope requests to one entity
 *   MEOW_BASE_URL   (optional)  default https://api.meow.com/v1
 *                               sandbox: https://api.sandbox.meow.com/v1
 *
 * Usage:
 *   meow-invoices list                 # print all invoices
 *   meow-invoices download [outDir]    # download every invoice PDF (default ./invoices)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

type InvoiceStatus =
  | "Draft"
  | "Open"
  | "Pending"
  | "Scheduled"
  | "Partially Paid"
  | "Paid"
  | "Canceled"
  | "Expired"
  | "Overdue";

/** Subset of the Meow Invoice schema that this script reads. */
interface Invoice {
  id: string;
  name: string | null;
  status: InvoiceStatus;
  amount: string;
  amount_due: string;
  invoice_number: string | null;
  due_date?: string | null;
  created_at: string;
}

const BASE_URL = (process.env.MEOW_BASE_URL ?? "https://api.meow.com/v1").replace(/\/+$/, "");
const API_KEY = process.env.MEOW_API_KEY;
const ENTITY_ID = process.env.MEOW_ENTITY_ID;
const DOWNLOAD_CONCURRENCY = 5;

function authHeaders(): Record<string, string> {
  if (!API_KEY) {
    fail("MEOW_API_KEY is not set. Export your Meow API key (scope: billing:invoices:read).");
  }
  const headers: Record<string, string> = { "x-api-key": API_KEY };
  if (ENTITY_ID) headers["x-entity-id"] = ENTITY_ID;
  return headers;
}

/** Reads an error body for diagnostics without throwing on non-JSON responses. */
async function readErrorBody(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text ? ` - ${text.slice(0, 500)}` : "";
  } catch {
    return "";
  }
}

async function listInvoices(): Promise<Invoice[]> {
  const res = await fetch(`${BASE_URL}/billing/invoices`, {
    headers: { ...authHeaders(), accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`List invoices failed: ${res.status} ${res.statusText}${await readErrorBody(res)}`);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) {
    throw new Error("List invoices: expected a JSON array");
  }
  return data as Invoice[];
}

/** Server sends `Content-Disposition: attachment; filename="Invoice - INV-2024-001.pdf"`. */
function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  // RFC 5987 extended form takes precedence: filename*=UTF-8''encoded
  const extended = /filename\*=(?:[^']*'[^']*')?([^;]+)/i.exec(header);
  if (extended?.[1]) {
    try {
      return decodeURIComponent(extended[1].trim().replace(/^"|"$/g, ""));
    } catch {
      // fall through to the plain form
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

/** Strips path separators and characters that are unsafe in filenames. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\]/g, "-")
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Picks a unique, filesystem-safe name. Prefers the server-provided filename,
 * falls back to the invoice number, then the id. `used` guards against
 * collisions (the check + add is synchronous, so it is safe under concurrency).
 */
function resolveFilename(invoice: Invoice, header: string | null, used: Set<string>): string {
  const fromHeader = parseContentDispositionFilename(header);
  const base = fromHeader ?? `Invoice - ${invoice.invoice_number ?? invoice.id}.pdf`;
  let name = sanitizeFilename(base);
  if (!name.toLowerCase().endsWith(".pdf")) name += ".pdf";

  if (used.has(name)) {
    const dot = name.lastIndexOf(".");
    name = `${name.slice(0, dot)} (${invoice.id})${name.slice(dot)}`;
  }
  used.add(name);
  return name;
}

async function downloadInvoicePdf(invoice: Invoice, outDir: string, used: Set<string>): Promise<string> {
  const res = await fetch(`${BASE_URL}/billing/invoices/${invoice.id}/download`, {
    headers: { ...authHeaders(), accept: "application/pdf" },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}${await readErrorBody(res)}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const filename = resolveFilename(invoice, res.headers.get("content-disposition"), used);
  const path = join(outDir, filename);
  await writeFile(path, bytes);
  return path;
}

/** Runs `fn` over `items` with a bounded number of in-flight tasks. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function formatInvoiceRow(inv: Invoice): string {
  const number = (inv.invoice_number ?? "(no number)").padEnd(16);
  const status = inv.status.padEnd(14);
  const due = `${inv.amount_due}/${inv.amount}`.padEnd(18);
  return `${number} ${status} due ${due} ${inv.id}`;
}

async function runList(): Promise<void> {
  const invoices = await listInvoices();
  if (invoices.length === 0) {
    console.log("No invoices found.");
    return;
  }
  console.log(`Found ${invoices.length} invoice(s):\n`);
  for (const inv of invoices) console.log(formatInvoiceRow(inv));
}

async function runDownload(outDir: string): Promise<void> {
  const invoices = await listInvoices();
  if (invoices.length === 0) {
    console.log("No invoices found, nothing to download.");
    return;
  }
  await mkdir(outDir, { recursive: true });
  console.log(`Downloading ${invoices.length} invoice PDF(s) to ${outDir} ...`);

  const used = new Set<string>();
  const failures: Array<{ invoice: Invoice; error: string }> = [];

  await mapWithConcurrency(invoices, DOWNLOAD_CONCURRENCY, async (invoice) => {
    const label = invoice.invoice_number ?? invoice.id;
    try {
      const path = await downloadInvoicePdf(invoice, outDir, used);
      console.log(`  ok   ${label} -> ${path}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ invoice, error: message });
      console.error(`  FAIL ${label}: ${message}`);
    }
  });

  const ok = invoices.length - failures.length;
  console.log(`\nDone. ${ok} succeeded, ${failures.length} failed.`);
  if (failures.length > 0) process.exitCode = 1;
}

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function printUsage(): void {
  console.log(
    [
      "Usage:",
      "  meow-invoices list                 List all invoices",
      "  meow-invoices download [outDir]    Download every invoice PDF (default ./invoices)",
      "",
      "Environment:",
      "  MEOW_API_KEY    (required)  API key with scope billing:invoices:read",
      "  MEOW_ENTITY_ID  (optional)  scope to a single entity",
      "  MEOW_BASE_URL   (optional)  default https://api.meow.com/v1",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case "list":
      await runList();
      break;
    case "download":
      await runDownload(arg ?? "./invoices");
      break;
    case undefined:
    case "help":
    case "-h":
    case "--help":
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
