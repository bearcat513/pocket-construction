/**
 * Searching the estimates list on the server.
 *
 * The list used to be the newest fifty, searched in the browser — which meant
 * the fifty-first estimate could not be found by typing its number, and the
 * status counts described a page rather than the account. This is the half
 * that decides *what* to ask PocketBase for; `searchQuotes` in
 * `src/server/db.ts` asks it.
 *
 * Pure, so the filter it writes is tested without a database.
 */
import { QUOTE_STATUSES, type QuoteStatus, type QuoteSummary } from "./types";

/** Columns the list can be sorted on — real columns only, never a JSON path. */
export const QUOTE_SORTS = ["updated", "number", "name", "status", "validUntil"] as const;
export type QuoteSortKey = (typeof QUOTE_SORTS)[number];

export type QuoteSearch = {
  q?: string;
  status?: QuoteStatus | "all";
  sort?: QuoteSortKey;
  /** Ascending when true. The default for `updated` is newest first. */
  ascending?: boolean;
  page?: number;
  perPage?: number;
};

export type QuotePage = {
  items: QuoteSummary[];
  page: number;
  perPage: number;
  /** How many match the search and the status filter, across every page. */
  total: number;
  /** How many match the search, per status — the filter chips' numbers. */
  counts: Partial<Record<QuoteStatus, number>>;
};

export const QUOTE_PAGE_MAX = 200;

/** A filter expression and the values bound into it, for `pb.filter()`. */
export type BoundFilter = { expr: string; params: Record<string, string> };

/**
 * The PocketBase filter for one search.
 *
 * "Expired" is not stored — `withExpiry` derives it from a sent quote whose
 * date has passed — so filtering on it, and on "sent", has to say the same
 * thing in SQL, or the chip would count quotes the list then labels
 * differently.
 */
export function quoteFilter(q: string, status: QuoteStatus | "all", today: string): BoundFilter {
  const clauses: string[] = [];
  const params: Record<string, string> = { today };
  const needle = q.trim();

  if (needle) {
    clauses.push("(name ~ {:q} || number ~ {:q} || header.customer.name ~ {:q})");
    params.q = needle;
  }

  if (status === "expired") {
    clauses.push(`(status = "expired" || (status = "sent" && validUntil != "" && validUntil < {:today}))`);
  } else if (status === "sent") {
    clauses.push(`(status = "sent" && (validUntil = "" || validUntil >= {:today}))`);
  } else if (status !== "all") {
    clauses.push("status = {:status}");
    params.status = status;
  }

  return { expr: clauses.join(" && "), params };
}

/** The PocketBase sort string: the column, then id so a page boundary is stable. */
export function quoteSort(key: QuoteSortKey = "updated", ascending?: boolean): string {
  const up = ascending ?? key !== "updated";
  return `${up ? "" : "-"}${key},id`;
}

/** Reads `?q=&status=&sort=&dir=&page=&perPage=`, repairing rather than refusing. */
export function readQuoteSearch(params: URLSearchParams): Required<QuoteSearch> {
  const status = params.get("status") ?? "all";
  const rawSort = params.get("sort") ?? "updated";
  const sort: QuoteSortKey = (QUOTE_SORTS as readonly string[]).includes(rawSort) ? (rawSort as QuoteSortKey) : "updated";
  const dir = params.get("dir");
  const int = (key: string, fallback: number) => {
    const parsed = Math.trunc(Number(params.get(key)));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };

  return {
    q: (params.get("q") ?? "").slice(0, 200),
    status: (QUOTE_STATUSES as string[]).includes(status) ? (status as QuoteStatus) : "all",
    sort,
    ascending: dir === "asc" ? true : dir === "desc" ? false : sort !== "updated",
    page: int("page", 1),
    perPage: Math.min(int("perPage", 50), QUOTE_PAGE_MAX),
  };
}

/** The query string `readQuoteSearch` reads back. */
export function quoteSearchQuery(search: QuoteSearch): string {
  const params = new URLSearchParams();
  if (search.q?.trim()) params.set("q", search.q.trim());
  if (search.status && search.status !== "all") params.set("status", search.status);
  if (search.sort && search.sort !== "updated") params.set("sort", search.sort);
  if (search.ascending !== undefined) params.set("dir", search.ascending ? "asc" : "desc");
  if (search.page && search.page > 1) params.set("page", String(search.page));
  if (search.perPage) params.set("perPage", String(search.perPage));
  const text = params.toString();
  return text ? `?${text}` : "";
}
