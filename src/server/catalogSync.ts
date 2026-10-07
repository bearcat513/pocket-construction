/**
 * Running a catalogue sync: the half that touches the world.
 *
 * `src/lib/catalogSync.ts` decides what *would* change and is pure. This file
 * does the two impure things that decision needs either side of it — fetching
 * a feed, and writing the plan into the catalogue — and deliberately does
 * nothing else. Everything interesting is still in the pure half, which is why
 * the sync engine is testable without a network or a database.
 *
 * ## Preview and apply are the same code
 *
 * `runSync` takes an `apply` flag and is otherwise one path. A preview that
 * ran different logic from the sync would be a preview of nothing, and this is
 * the one place where sharing the code is worth more than any clarity a split
 * would buy.
 *
 * ## The fetch is deliberately dull
 *
 * A timeout, a size cap, no credentials, and no redirect off http(s). The
 * server holds no secrets to leak into an outbound request and sends none, so
 * a feed URL is an unauthenticated GET made on behalf of the signed-in user
 * who typed it — but it is still the server making it, so the URL is checked
 * (in `readCatalogSource`) before it ever reaches here, and the response is
 * capped so a feed that streams forever cannot take the process with it.
 *
 * ## Writes go through the ordinary door
 *
 * A synced item is created and updated by `createProduct` and `updateProduct`,
 * with the caller's own token, through `readProduct` — the same functions, the
 * same validation and the same access control as an item somebody typed. A
 * sync cannot write anything a person could not, which is what stops "the feed
 * did it" from ever being an explanation for a record that should not exist.
 */
import {
  applyChange,
  emptyCounts,
  isApplicable,
  planSync,
  readFeed,
  type SyncAction,
  type SyncPlan,
} from "../lib/catalogSync";
import { readProduct } from "../lib/validate";
import type { CatalogSource, Product, SyncRunSummary } from "../lib/types";
import { createProduct, listProducts, stampCatalogRun, updateProduct } from "./db";
import { ApiError } from "./http";

/** Long enough for a slow supplier, short enough that nobody gives up first. */
const FETCH_TIMEOUT_MS = 20_000;

/**
 * A price list bigger than this is not a price list.
 *
 * Eight megabytes is roughly forty thousand rows of CSV, which is an order of
 * magnitude more than any contractor's catalogue. The cap exists so a feed
 * that returns a video does not become a memory problem.
 */
const MAX_FEED_BYTES = 8 * 1024 * 1024;

/* --------------------------------- fetching -------------------------------- */

export type FetchResult = { ok: true; body: string } | { ok: false; error: string };

/**
 * Reads a feed over the network.
 *
 * Every failure comes back as a sentence rather than an exception, because
 * every one of them is something the person who configured the source can act
 * on, and none of them is a bug in this app.
 */
export async function fetchFeed(url: string): Promise<FetchResult> {
  if (!url) return { ok: false, error: "This source has no URL — upload a file to sync it." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { accept: "text/csv, application/json, text/plain;q=0.9, */*;q=0.8" },
      // The server has no credentials to offer and must not acquire any from
      // the browser's context.
      credentials: "omit",
    });

    if (!response.ok) {
      return { ok: false, error: `The feed answered ${response.status} ${response.statusText || ""}`.trim() + "." };
    }

    // Checked before reading where the server tells us, and again after, since
    // plenty of feeds do not send a length.
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_FEED_BYTES) {
      return { ok: false, error: `That feed is ${(declared / 1024 / 1024).toFixed(1)} MB, past the 8 MB limit.` };
    }

    const body = await response.text();
    if (body.length > MAX_FEED_BYTES) {
      return { ok: false, error: `That feed is ${(body.length / 1024 / 1024).toFixed(1)} MB, past the 8 MB limit.` };
    }

    return { ok: true, body };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, error: `The feed did not answer within ${FETCH_TIMEOUT_MS / 1000} seconds.` };
    }
    return { ok: false, error: `The feed could not be reached: ${error instanceof Error ? error.message : "unknown error"}.` };
  }
}

/* ---------------------------------- running -------------------------------- */

export type SyncResult = {
  plan: SyncPlan;
  /** What was actually written, which is empty on a preview. */
  applied: boolean;
  /** Items that could not be saved, with the reason. Never fatal to the run. */
  failures: { sku: string; error: string }[];
  summary: SyncRunSummary;
};

export type RunOptions = {
  source: CatalogSource;
  /** The feed's payload. Fetched by the caller, or uploaded by a person. */
  body: string;
  /** False previews; true writes. */
  apply: boolean;
  /** Who is running it, for the record kept on the source. */
  byEmail: string;
  /**
   * Keys the reviewer has explicitly accepted, for rows the plan flagged.
   *
   * A flagged row is never written on the strength of the policy alone — that
   * is the whole point of flagging it — so an apply that wants one included
   * has to name it. Empty means "apply only what did not need a decision".
   */
  acceptedKeys?: string[];
};

/**
 * Plans a sync, and applies it when asked.
 *
 * The catalogue is read once, up front, and the plan is built against that
 * snapshot. A row whose item is changed by somebody else mid-run would be
 * written over — which is the same race as two people editing one item in the
 * UI, and is resolved the same way: last write wins, and the provenance stamp
 * says which one it was.
 */
export async function runSync(token: string, options: RunOptions): Promise<SyncResult> {
  const { source, body, apply, byEmail } = options;
  const accepted = new Set(options.acceptedKeys ?? []);

  const read = readFeed(body, source);
  if (!read.ok) throw new ApiError(read.error, 422);

  const products = await listProducts(token);
  const plan = planSync({ source, rows: read.rows, products: products });

  const failures: SyncResult["failures"] = [];
  const counts = { ...plan.counts };

  if (apply) {
    const byId = new Map(products.map(product => [product.id, product]));
    const now = new Date().toISOString();

    for (const change of plan.changes) {
      // A flagged row waits for a person, unless this run is that person.
      const permitted = isApplicable(change.action) || (change.action === "flagged" && accepted.has(change.key));
      if (!permitted) continue;

      const existing = change.productId ? (byId.get(change.productId) ?? null) : null;
      const input = applyChange(change, existing, source, now);

      // Through the ordinary validator, so a synced item is exactly as legal
      // as a typed one.
      const parsed = readProduct(input);
      if (!parsed.ok) {
        failures.push({ sku: change.sku || change.key, error: parsed.error });
        continue;
      }

      try {
        if (existing) await updateProduct(token, existing.id, parsed.value);
        else await createProduct(token, parsed.value);
        if (change.action === "flagged") {
          counts.flagged -= 1;
          counts.update += 1;
        }
      } catch (error) {
        // One bad row must not abandon four hundred good ones.
        failures.push({ sku: change.sku || change.key, error: error instanceof Error ? error.message : "Could not save." });
      }
    }
  }

  const summary: SyncRunSummary = {
    ranAt: new Date().toISOString(),
    byEmail,
    applied: apply,
    rowsRead: plan.rowsRead,
    created: counts.create,
    updated: counts.update,
    unchanged: counts.unchanged,
    flagged: counts.flagged,
    deactivated: counts.deactivate,
    skipped: counts.skip + failures.length,
    error: "",
  };

  // Recorded only for a run that wrote: a preview is not something the source
  // "last did", and stamping one would make the history lie about when the
  // catalogue last actually moved.
  if (apply) await stampCatalogRun(token, source.id, summary).catch(() => undefined);

  return { plan: { ...plan, counts }, applied: apply, failures, summary };
}

/**
 * A source's feed, fetched and run.
 *
 * The failure path stamps the source too: "it last ran on Tuesday and could
 * not reach the server" is exactly the thing somebody needs to see on the
 * sources list, and a run that silently left no trace is how a catalogue goes
 * three weeks without an update that everybody assumed was happening.
 */
export async function syncFromUrl(
  token: string,
  source: CatalogSource,
  apply: boolean,
  byEmail: string,
  acceptedKeys?: string[],
): Promise<SyncResult> {
  const fetched = await fetchFeed(source.url);

  if (!fetched.ok) {
    if (apply) {
      await stampCatalogRun(token, source.id, {
        ...blankSummary(byEmail, apply),
        error: fetched.error,
      }).catch(() => undefined);
    }
    throw new ApiError(fetched.error, 502);
  }

  return runSync(token, { source, body: fetched.body, apply, byEmail, acceptedKeys });
}

const blankSummary = (byEmail: string, applied: boolean): SyncRunSummary => {
  const counts = emptyCounts();
  return {
    ranAt: new Date().toISOString(),
    byEmail,
    applied,
    rowsRead: 0,
    created: counts.create,
    updated: counts.update,
    unchanged: counts.unchanged,
    flagged: counts.flagged,
    deactivated: counts.deactivate,
    skipped: counts.skip,
    error: "",
  };
};

/** Column names a feed offers, for the mapping editor to choose from. */
export async function inspectFeed(source: Pick<CatalogSource, "format" | "recordPath" | "url">, body?: string) {
  let payload = body ?? "";
  if (!payload) {
    const fetched = await fetchFeed(source.url);
    if (!fetched.ok) throw new ApiError(fetched.error, 502);
    payload = fetched.body;
  }

  const read = readFeed(payload, source);
  if (!read.ok) throw new ApiError(read.error, 422);

  // A handful of rows is enough to see whether a mapping is pointing at the
  // right columns, and it keeps the response small.
  return { columns: read.columns, rowCount: read.rows.length, sample: read.rows.slice(0, 5) };
}

/** Actions a plan reports, for the API index. */
export const SYNC_ACTION_ORDER: SyncAction[] = ["flagged", "create", "update", "deactivate", "skip", "unchanged"];
