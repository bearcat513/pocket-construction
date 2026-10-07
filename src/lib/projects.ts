/**
 * What a job actually came to, across everything written against it.
 *
 * The project record says what is *true* of a job — where it is, who is
 * running it, what the contract says. This file answers the other question a
 * superintendent or an owner opens a job for: where does the money stand. It
 * is the same division of labour as `src/lib/customers.ts`, and the same two
 * rules apply, both learned the hard way elsewhere in this app.
 *
 * **Nothing is stored.** A project's estimated value, contract value, amount
 * invoiced and amount still owed are all functions of the estimates and
 * invoices attached to it, and are recomputed on every read. A stored
 * "invoiced to date" is a number that disagrees with the invoices underneath
 * it the first time anybody voids one, and the disagreement surfaces in front
 * of a client.
 *
 * **Only one currency is ever added up.** A project is denominated in one
 * currency; nothing stops an estimate or an invoice against it being written
 * in another. Those are counted and reported, never summed — a job value that
 * quietly added dollars to euros would be a wrong number presented
 * confidently, which is worse than no number at all.
 *
 * The one thing that is *not* derived is `contractValue` on the project
 * itself: see the note on that field in `./types`. The awarded contract sum is
 * a negotiated figure, and this file reports what the estimates say beside it
 * rather than overwriting it.
 */
import { round, sum } from "./money";
import { invoiceStatus } from "./receivable";
import type {
  CurrencyCode,
  InvoiceSummary,
  Project,
  ProjectStatus,
  QuoteStatus,
  QuoteSummary,
} from "./types";

/* -------------------------------- roll-up -------------------------------- */

/** Estimates still in play: nobody has said yes or no, and the clock has not run out. */
const OPEN_STATUSES: ReadonlySet<QuoteStatus> = new Set<QuoteStatus>([
  "draft",
  "in_review",
  "approved",
  "rejected",
  "sent",
]);

export type ProjectStats = {
  /** The project's own currency — the only one anything here is summed in. */
  currency: CurrencyCode;

  /* --- what has been offered --- */
  estimateCount: number;
  openEstimateCount: number;
  /** Estimates still being decided, at grand total. */
  openEstimateValue: number;
  acceptedEstimateCount: number;
  /**
   * Everything the client has accepted, at grand total.
   *
   * This is the number to read against the project's own `contractValue`. The
   * two differing is not an error — a contract is negotiated after the
   * estimate is accepted more often than not — but it is worth seeing.
   */
  acceptedEstimateValue: number;

  /* --- what has been billed --- */
  invoiceCount: number;
  /** Every issued invoice's total. Drafts are not money owed and voids never were. */
  invoicedValue: number;
  paidValue: number;
  /** What is still outstanding, which may be negative if a client overpaid. */
  outstandingValue: number;
  /** The part of what is outstanding that is past its due date. */
  overdueValue: number;

  /* --- what is left --- */
  /**
   * Accepted work not yet invoiced: the backlog.
   *
   * Clamped at zero, and this is the one clamp in the file. Billing past the
   * accepted estimate total is an ordinary thing — change orders, unit-price
   * work trued up — and reporting it as negative backlog would read as an
   * error rather than as the normal state of a job in its last month.
   */
  backlogValue: number;

  /** Documents written in some other currency: counted, never added up. */
  otherCurrencyCount: number;
};

export const emptyProjectStats = (currency: CurrencyCode): ProjectStats => ({
  currency,
  estimateCount: 0,
  openEstimateCount: 0,
  openEstimateValue: 0,
  acceptedEstimateCount: 0,
  acceptedEstimateValue: 0,
  invoiceCount: 0,
  invoicedValue: 0,
  paidValue: 0,
  outstandingValue: 0,
  overdueValue: 0,
  backlogValue: 0,
  otherCurrencyCount: 0,
});

export type ProjectRollupInput = {
  project: Pick<Project, "currency">;
  estimates: QuoteSummary[];
  invoices: InvoiceSummary[];
  /** Today, as an ISO date. Injected so "overdue" is testable. */
  today?: string;
};

/**
 * Everything the project screen puts at the top of the page.
 *
 * Takes whatever the caller has for this project — the server's per-project
 * lists, or the lists already in memory filtered down. Order does not matter.
 */
export function projectStats({ project, estimates, invoices, today }: ProjectRollupInput): ProjectStats {
  const currency = project.currency;
  const stats = emptyProjectStats(currency);

  const open: number[] = [];
  const accepted: number[] = [];

  for (const estimate of estimates) {
    stats.estimateCount += 1;

    const comparable = estimate.currency === currency;
    if (!comparable) stats.otherCurrencyCount += 1;

    if (OPEN_STATUSES.has(estimate.status)) {
      stats.openEstimateCount += 1;
      if (comparable) open.push(round(estimate.totals?.grandTotal ?? 0, currency));
    } else if (estimate.status === "accepted") {
      stats.acceptedEstimateCount += 1;
      if (comparable) accepted.push(round(estimate.totals?.grandTotal ?? 0, currency));
    }
  }

  const invoiced: number[] = [];
  const paid: number[] = [];
  const outstanding: number[] = [];
  const overdue: number[] = [];

  for (const invoice of invoices) {
    stats.invoiceCount += 1;

    const comparable = invoice.currency === currency;
    if (!comparable) {
      stats.otherCurrencyCount += 1;
      continue;
    }

    // A draft is not money owed and a void never was. Only an issued invoice
    // is a receivable — the same rule the aging report runs on.
    const status = invoiceStatus(invoice, today);
    if (status === "draft" || status === "void") continue;

    invoiced.push(round(invoice.totals?.total ?? 0, currency));
    paid.push(round(invoice.totals?.paidAmount ?? 0, currency));
    outstanding.push(round(invoice.totals?.balance ?? 0, currency));
    if (status === "overdue") overdue.push(round(invoice.totals?.balance ?? 0, currency));
  }

  stats.openEstimateValue = sum(open, currency);
  stats.acceptedEstimateValue = sum(accepted, currency);
  stats.invoicedValue = sum(invoiced, currency);
  stats.paidValue = sum(paid, currency);
  stats.outstandingValue = sum(outstanding, currency);
  stats.overdueValue = sum(overdue, currency);
  stats.backlogValue = Math.max(0, round(stats.acceptedEstimateValue - stats.invoicedValue, currency));

  return stats;
}

/* ------------------------------- searching ------------------------------- */

/**
 * Everything about a job worth typing into a search box, as one lowercased
 * string.
 *
 * The permit number and the site city are in it deliberately: a job gets
 * referred to out loud by its address far more often than by its name, and by
 * its permit number by everybody who does not work for you.
 */
function haystack(project: Project): string {
  return [
    project.number,
    project.name,
    project.accountName,
    project.projectType,
    project.permitNumber,
    project.clientReference,
    project.projectManager,
    project.superintendent,
    ...project.tags,
    project.siteAddress.line1,
    project.siteAddress.city,
    project.siteAddress.state,
    project.siteAddress.postalCode,
  ]
    .join(" ")
    .toLowerCase();
}

export type ProjectFilter = {
  search?: string;
  /** "" is every status. */
  status?: ProjectStatus | "";
  /** "" is every client. */
  accountId?: string;
  /** "" is every tag. */
  tag?: string;
  /** True to show only awarded and in-progress work. */
  liveOnly?: boolean;
};

/** Every term has to match, in any field. */
export function filterProjects(projects: Project[], filter: ProjectFilter): Project[] {
  const terms = (filter.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const { status, accountId, tag, liveOnly } = filter;

  return projects.filter(project => {
    if (status && project.status !== status) return false;
    if (accountId && project.accountId !== accountId) return false;
    if (tag && !project.tags.includes(tag)) return false;
    if (liveOnly && !isLive(project.status)) return false;
    if (!terms.length) return true;

    const text = haystack(project);
    return terms.every(term => text.includes(term));
  });
}

const isLive = (status: ProjectStatus): boolean => status === "awarded" || status === "in_progress";

export type ProjectSort = "recent" | "number" | "name" | "status" | "value";

export const PROJECT_SORTS: { value: ProjectSort; label: string }[] = [
  { value: "recent", label: "Recently changed" },
  { value: "number", label: "Number" },
  { value: "name", label: "Name" },
  { value: "status", label: "Status" },
  { value: "value", label: "Contract value" },
];

/** The order statuses read in, which is the order a job moves through them. */
const STATUS_ORDER: Record<ProjectStatus, number> = {
  in_progress: 0,
  awarded: 1,
  bidding: 2,
  lead: 3,
  complete: 4,
  cancelled: 5,
};

export function sortProjects(projects: Project[], sort: ProjectSort): Project[] {
  const sorted = [...projects];
  switch (sort) {
    case "number":
      return sorted.sort((a, b) => b.number.localeCompare(a.number));
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "status":
      // Live work first, then by recency inside each band — a status sort that
      // put ten cancelled jobs above the one being built would be useless.
      return sorted.sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
          (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt),
      );
    case "value":
      return sorted.sort((a, b) => b.contractValue - a.contractValue);
    default:
      return sorted.sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt));
  }
}
