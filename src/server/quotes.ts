/**
 * Quotes: the part of the server that actually decides things.
 *
 * Everything a quote *says* is derived here, never accepted from a client.
 * A request sends what the estimator chose — products, quantities, options,
 * discounts — and this module loads the catalogue, prices it and stores what
 * came out. A browser that posts its own totals changes nothing: the numbers
 * are recomputed and overwritten every single time.
 *
 * That is the whole reason the pricing engine is pure and lives in
 * `src/lib/`. The client runs it for instant feedback, this runs it for the
 * record, and because it is the same code the two never disagree about what a
 * quote costs — only about which of them is allowed to say so.
 *
 * Access control is still PocketBase's. Nothing here selects by owner; the
 * collection rules do, evaluated against the caller's own token.
 */
import { priceQuote, type PriceableLine } from "../lib/pricing";
import type { Preferences } from "../lib/preferences";
import {
  emptyCustomer,
  isEditableStatus,
  primaryContact,
  QUOTE_TRANSITIONS,
  type Account,
  type CustomerSnapshot,
  type Product,
  type Quote,
  type QuoteStatus,
} from "../lib/types";
import type { QuoteHeaderInput } from "../lib/validate";
import { DEFAULT_CURRENCY } from "../lib/money";
import {
  createQuote,
  getAccount,
  getProject,
  getQuote,
  listProducts,
  nextQuoteNumber,
  updateQuote,
  type QuoteRecordInput,
} from "./db";
import { ApiError } from "./http";

/* ------------------------------ the catalogue ---------------------------- */

export type Catalogue = {
  products: Product[];
  byId: Map<string, Product>;
  bySku: Map<string, Product>;
};

/**
 * Everything the caller may price with.
 *
 * Read in one go and passed around, rather than fetched per line: a quote with
 * forty lines would otherwise be forty round trips to price, and every one of
 * them would be answering the same question.
 */
export async function loadCatalogue(token: string): Promise<Catalogue> {
  const products = await listProducts(token);
  return {
    products,
    byId: new Map(products.map(product => [product.id, product])),
    bySku: new Map(products.map(product => [product.sku, product])),
  };
}

/* ------------------------------- the customer ---------------------------- */

/**
 * The customer details a quote carries itself, copied from the account.
 *
 * Copied rather than referenced, so a quote sent last quarter still renders
 * with the address it was sent to, and a quote shared with a colleague who
 * cannot read your accounts still renders at all.
 */
export function snapshotCustomer(account: Account | null): CustomerSnapshot {
  if (!account) return emptyCustomer();
  // A document is addressed to one person, so the contact list flattens to
  // its primary here. Which one that is can change on the account tomorrow;
  // who this quote was addressed to cannot.
  const contact = primaryContact(account);
  return {
    accountId: account.id,
    name: account.name,
    contactName: contact?.name ?? "",
    contactTitle: contact?.title ?? "",
    contactEmail: contact?.email ?? "",
    contactPhone: contact?.phone ?? "",
    billingAddress: { ...account.billingAddress },
    shippingAddress: { ...account.shippingAddress },
    paymentTerms: account.paymentTerms,
  };
}

/* -------------------------------- pricing -------------------------------- */

export type RepricedQuote = {
  record: QuoteRecordInput;
  issues: string[];
  warnings: string[];
};

type RepriceInput = {
  /** Markup and overhead resolved — see `resolveRates`. */
  header: QuoteHeaderInput & { markupPercent: number; overheadPercent: number };
  lines: PriceableLine[];
  existing?: Quote | null;
  number: string;
  status: QuoteStatus;
  version: number;
  supersedesId: string | null;
  projectId: string;
  projectName: string;
  customer: CustomerSnapshot;
  sentAt?: string;
  decidedAt?: string;
};

/**
 * Prices a quote and returns the record to store. Pure once the catalogue is
 * in hand, which is what makes it safe to call on every save.
 */
export function repriceQuote(input: RepriceInput, catalogue: Catalogue): RepricedQuote {
  const currency = DEFAULT_CURRENCY;

  const priced = priceQuote(
    input.lines,
    {
      currency,
      markupPercent: input.header.markupPercent,
      overheadPercent: input.header.overheadPercent,
      discountPercent: input.header.discountPercent,
      taxPercent: input.header.taxPercent,
      shipping: input.header.shipping,
    },
    { products: catalogue.byId },
  );

  return {
    record: {
      number: input.number,
      name: input.header.name,
      status: input.status,
      version: input.version,
      supersedesId: input.supersedesId,
      projectId: input.projectId,
      projectName: input.projectName,
      customer: input.customer,
      currency,
      markupPercent: input.header.markupPercent,
      overheadPercent: input.header.overheadPercent,
      discountPercent: input.header.discountPercent,
      taxPercent: input.header.taxPercent,
      shipping: input.header.shipping,
      validUntil: input.header.validUntil,
      notes: input.header.notes,
      internalNotes: input.header.internalNotes,
      lines: priced.lines,
      totals: priced.totals,
      ...(input.sentAt !== undefined ? { sentAt: input.sentAt } : {}),
      ...(input.decidedAt !== undefined ? { decidedAt: input.decidedAt } : {}),
    },
    issues: priced.issues,
    warnings: priced.warnings,
  };
}

/** `validUntil` + N days from today, as an ISO date. */
export function defaultValidUntil(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + Math.max(1, days));
  return date.toISOString().slice(0, 10);
}

/**
 * A quote past its own expiry date reads as expired.
 *
 * Computed on read rather than written by a job: "expired" is a fact about the
 * calendar, and a status that only becomes true when something happens to
 * sweep it is a status that lies between sweeps. The stored value is left
 * alone, so reopening the quote (`draft`) restores it exactly.
 */
export function withExpiry<T extends { status: QuoteStatus; validUntil: string }>(quote: T, today = new Date()): T {
  if (quote.status !== "sent" || !quote.validUntil) return quote;
  return quote.validUntil < today.toISOString().slice(0, 10) ? { ...quote, status: "expired" as QuoteStatus } : quote;
}

/* ------------------------------- creating -------------------------------- */

export type CreateQuoteResult = { quote: Quote; issues: string[]; warnings: string[] };

/** What a new quote starts from: the account's settings. */
export type QuoteDefaults = Pick<Preferences, "quoteValidDays" | "markupPercent" | "overheadPercent">;

/**
 * A header with its markup and overhead decided: what the body said, or —
 * when it said nothing — `fallback`, which is the settings for a new quote and
 * the quote's own numbers for an existing one.
 */
const resolveRates = (
  header: QuoteHeaderInput,
  fallback: { markupPercent: number; overheadPercent: number },
): QuoteHeaderInput & { markupPercent: number; overheadPercent: number } => ({
  ...header,
  markupPercent: header.markupPercent ?? fallback.markupPercent,
  overheadPercent: header.overheadPercent ?? fallback.overheadPercent,
});

/**
 * Creates a quote.
 *
 * The number is derived from how many quotes the caller has, so two created in
 * the same second can collide on the unique index. That is retried rather than
 * locked against: the number is a label, and a retry costs less than the
 * machinery that would make a counter authoritative.
 */
export async function createPricedQuote(
  token: string,
  header: QuoteHeaderInput,
  lines: PriceableLine[],
  defaults: QuoteDefaults,
): Promise<CreateQuoteResult> {
  const [catalogue, account, project] = await Promise.all([
    loadCatalogue(token),
    header.accountId ? getAccount(token, header.accountId) : Promise.resolve(null),
    header.projectId ? getProject(token, header.projectId) : Promise.resolve(null),
  ]);

  if (header.accountId && !account) throw new ApiError("That account does not exist, or is not yours.", 404);
  if (header.projectId && !project) throw new ApiError("That project does not exist, or is not yours.", 404);

  const resolved = resolveRates(
    {
      ...header,
      validUntil: header.validUntil || defaultValidUntil(defaults.quoteValidDays),
      // The account's own tax and discount are the starting point, since they
      // are facts about the customer rather than about this quote.
      taxPercent: account?.taxExempt ? 0 : (header.taxPercent || account?.taxPercent) ?? header.taxPercent,
    },
    defaults,
  );

  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextQuoteNumber(token, attempt);
    const priced = repriceQuote(
      {
        header: resolved,
        lines,
        number,
        status: "draft",
        version: 1,
        supersedesId: null,
        projectId: project?.id ?? "",
        // Snapshotted so the estimate list reads without a join, and so a
        // renamed job does not rewrite the documents already sent under it.
        projectName: project ? `${project.number} — ${project.name}` : "",
        customer: snapshotCustomer(account),
        sentAt: "",
        decidedAt: "",
      },
      catalogue,
    );

    try {
      return { quote: await createQuote(token, priced.record), issues: priced.issues, warnings: priced.warnings };
    } catch (error) {
      // A duplicate number is the one failure worth another go.
      if (attempt < 4 && error instanceof ApiError && /number/i.test(error.message)) continue;
      throw error;
    }
  }

  throw new ApiError("Could not allocate a quote number. Try again.", 409);
}

/* -------------------------------- editing -------------------------------- */

/**
 * Saves an edit.
 *
 * Only a draft can be written to. A sent quote is a document that exists in
 * someone else's inbox with a number on it; changing it underneath its reader
 * is how an estimate stops being trustworthy. `revise` is the supported way
 * forward from there.
 */
export async function saveQuote(
  token: string,
  id: string,
  header: QuoteHeaderInput,
  lines: PriceableLine[],
): Promise<CreateQuoteResult> {
  const existing = await getQuote(token, id);
  if (!existing) throw new ApiError("Quote not found, or not yours to change.", 404);

  if (!isEditableStatus(existing.status)) {
    throw new ApiError(
      `This quote is ${existing.status.replace("_", " ")}, so it cannot be edited. ` +
        "Reopen it as a draft, or create a new revision.",
      409,
    );
  }

  const [catalogue, account, project] = await Promise.all([
    loadCatalogue(token),
    header.accountId ? getAccount(token, header.accountId) : Promise.resolve(null),
    header.projectId && header.projectId !== existing.projectId
      ? getProject(token, header.projectId)
      : Promise.resolve(null),
  ]);

  if (header.accountId && !account) throw new ApiError("That account does not exist, or is not yours.", 404);
  if (header.projectId && header.projectId !== existing.projectId && !project) {
    throw new ApiError("That project does not exist, or is not yours.", 404);
  }

  // Re-snapshot only when the account actually changed; otherwise the quote
  // keeps the details it was written against.
  const customer =
    header.accountId && header.accountId !== existing.customer.accountId
      ? snapshotCustomer(account)
      : header.accountId
        ? existing.customer
        : emptyCustomer();

  const priced = repriceQuote(
    {
      header: resolveRates(header, existing),
      lines,
      number: existing.number,
      status: "draft",
      version: existing.version,
      supersedesId: existing.supersedesId,
      projectId: header.projectId,
      // Re-snapshotted only when the job actually changed, so an estimate
      // keeps the name the job had when it was written.
      projectName: project ? `${project.number} — ${project.name}` : header.projectId ? existing.projectName : "",
      customer,
    },
    catalogue,
  );

  const quote = await updateQuote(token, id, priced.record);
  if (!quote) throw new ApiError("Quote not found, or not yours to change.", 404);

  return { quote, issues: priced.issues, warnings: priced.warnings };
}

/* ------------------------------ transitions ------------------------------ */

/** The header fields, pulled back out of a stored quote. */
const headerOf = (quote: Quote): QuoteHeaderInput & { markupPercent: number; overheadPercent: number } => ({
  name: quote.name,
  accountId: quote.customer.accountId,
  projectId: quote.projectId,
  markupPercent: quote.markupPercent,
  overheadPercent: quote.overheadPercent,
  discountPercent: quote.discountPercent,
  taxPercent: quote.taxPercent,
  shipping: quote.shipping,
  validUntil: quote.validUntil,
  notes: quote.notes,
  internalNotes: quote.internalNotes,
});

/** A stored quote, as the shape `updateQuote` wants back. */
const recordOf = (quote: Quote): QuoteRecordInput => ({
  number: quote.number,
  name: quote.name,
  status: quote.status,
  version: quote.version,
  supersedesId: quote.supersedesId,
  projectId: quote.projectId,
  projectName: quote.projectName,
  customer: quote.customer,
  currency: quote.currency,
  markupPercent: quote.markupPercent,
  overheadPercent: quote.overheadPercent,
  discountPercent: quote.discountPercent,
  taxPercent: quote.taxPercent,
  shipping: quote.shipping,
  validUntil: quote.validUntil,
  notes: quote.notes,
  internalNotes: quote.internalNotes,
  lines: quote.lines,
  totals: quote.totals,
});

/**
 * Moves a quote along its life.
 *
 * The legal moves are in `QUOTE_TRANSITIONS`, shared with the UI so the
 * buttons on screen and the transitions the server will accept are the same
 * list. Sending carries an extra condition, checked here because it is the
 * one with consequences outside the app.
 */
export async function transitionQuote(token: string, id: string, to: QuoteStatus): Promise<Quote> {
  const existing = await getQuote(token, id);
  if (!existing) throw new ApiError("Quote not found.", 404);

  const from = withExpiry(existing).status;
  if (!QUOTE_TRANSITIONS[from]?.includes(to)) {
    const allowed = QUOTE_TRANSITIONS[from] ?? [];
    throw new ApiError(
      allowed.length
        ? `A quote that is ${from.replace("_", " ")} can only become ${allowed.join(" or ")}.`
        : `A quote that is ${from.replace("_", " ")} cannot be changed.`,
      409,
    );
  }

  if (to === "sent") {
    if (!existing.lines.length) throw new ApiError("There is nothing on this quote to send.", 400);
    // A line the catalogue can no longer price, or a configuration it would
    // refuse, is not something to put in front of a client.
    const problem = existing.lines.flatMap(line => line.issues ?? [])[0];
    if (problem) throw new ApiError(`This quote has problems that must be fixed first: ${problem}`, 409);
  }

  const record: QuoteRecordInput = {
    ...recordOf(existing),
    status: to,
    ...(to === "sent" ? { sentAt: new Date().toISOString() } : {}),
    ...(to === "accepted" || to === "declined" ? { decidedAt: new Date().toISOString() } : {}),
  };

  const saved = await updateQuote(token, id, record);
  if (!saved) throw new ApiError("Quote not found, or not yours to change.", 404);

  return saved;
}

/**
 * Creates the next revision of a quote.
 *
 * A new record rather than an edit: the quote that was sent stays exactly as
 * it was sent, with its own number, and the new one says
 * what it supersedes. That is what makes "which version did they sign" a
 * question with an answer.
 */
export async function reviseQuote(token: string, id: string): Promise<CreateQuoteResult> {
  const existing = await getQuote(token, id);
  if (!existing) throw new ApiError("Quote not found.", 404);

  const catalogue = await loadCatalogue(token);

  const priced = repriceQuote(
    {
      header: headerOf(existing),
      lines: existing.lines,
      // The number carries the revision, so the two documents are obviously
      // the same deal and obviously not the same document.
      number: `${existing.number}-r${existing.version + 1}`,
      status: "draft",
      version: existing.version + 1,
      supersedesId: existing.id,
      // A revision is the same job as the estimate it revises.
      projectId: existing.projectId,
      projectName: existing.projectName,
      customer: existing.customer,
      sentAt: "",
      decidedAt: "",
    },
    catalogue,
  );

  const quote = await createQuote(token, priced.record);
  return { quote, issues: priced.issues, warnings: priced.warnings };
}
