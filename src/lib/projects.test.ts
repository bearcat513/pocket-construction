import { describe, expect, test } from "bun:test";
import { filterProjects, projectStats, sortProjects } from "./projects";
import { EMPTY_ADDRESS, type CurrencyCode, type InvoiceSummary, type Project, type QuoteSummary } from "./types";

/* -------------------------------- fixtures -------------------------------- */

const project = (overrides: Partial<Project> = {}): Project => ({
  id: "prj_1",
  number: "PRJ-2026-0001",
  name: "Cedar Row Townhomes",
  accountId: "acc_1",
  accountName: "Harbour Point Development",
  status: "in_progress",
  contractType: "fixed_price",
  projectType: "Multifamily",
  description: "",
  siteAddress: { ...EMPTY_ADDRESS, line1: "418 Cedar Row", city: "Oakland", state: "CA", postalCode: "94607" },
  startDate: "2026-03-02",
  targetCompletionDate: "2026-11-30",
  actualCompletionDate: "",
  projectManager: "pm@builder.example.com",
  superintendent: "super@builder.example.com",
  permitNumber: "B2026-04417",
  clientReference: "HPD-CR-01",
  currency: "USD",
  contractValue: 1_850_000,
  tags: ["phase-1"],
  notes: "",
  ownerId: "u1",
  sharedWith: [],
  createdAt: "2026-01-04T00:00:00Z",
  updatedAt: "2026-03-01T00:00:00Z",
  ...overrides,
});

const estimate = (
  status: QuoteSummary["status"],
  grandTotal: number,
  currency: CurrencyCode = "USD",
): QuoteSummary =>
  ({
    id: `qte_${status}_${grandTotal}`,
    status,
    currency,
    totals: { grandTotal },
    createdAt: "2026-02-01T00:00:00Z",
    updatedAt: "2026-02-01T00:00:00Z",
  }) as unknown as QuoteSummary;

const invoice = (
  state: InvoiceSummary["state"],
  total: number,
  paidAmount = 0,
  dueDate = "2026-12-31",
  currency: CurrencyCode = "USD",
): InvoiceSummary =>
  ({
    id: `inv_${state}_${total}_${dueDate}`,
    state,
    currency,
    dueDate,
    totals: { total, paidAmount, creditedAmount: 0, balance: total - paidAmount },
  }) as unknown as InvoiceSummary;

const TODAY = "2026-06-15";

/* --------------------------------- totals --------------------------------- */

describe("project roll-up", () => {
  test("open and accepted estimates are counted apart", () => {
    const stats = projectStats({
      project: project(),
      estimates: [estimate("sent", 120_000), estimate("draft", 40_000), estimate("accepted", 900_000), estimate("declined", 55_000)],
      invoices: [],
      today: TODAY,
    });

    expect(stats.openEstimateCount).toBe(2);
    expect(stats.openEstimateValue).toBe(160_000);
    expect(stats.acceptedEstimateValue).toBe(900_000);
    expect(stats.estimateCount).toBe(4);
  });

  test("a draft invoice is not money owed and a void never was", () => {
    const stats = projectStats({
      project: project(),
      estimates: [],
      invoices: [invoice("draft", 50_000), invoice("void", 70_000), invoice("issued", 120_000, 40_000)],
      today: TODAY,
    });

    expect(stats.invoicedValue).toBe(120_000);
    expect(stats.paidValue).toBe(40_000);
    expect(stats.outstandingValue).toBe(80_000);
  });

  test("an overdue balance is the balance, not the total", () => {
    const stats = projectStats({
      project: project(),
      estimates: [],
      invoices: [invoice("issued", 100_000, 60_000, "2026-05-01")],
      today: TODAY,
    });

    expect(stats.overdueValue).toBe(40_000);
  });

  test("an invoice not yet due is outstanding but not overdue", () => {
    const stats = projectStats({
      project: project(),
      estimates: [],
      invoices: [invoice("issued", 100_000, 0, "2026-07-31")],
      today: TODAY,
    });

    expect(stats.outstandingValue).toBe(100_000);
    expect(stats.overdueValue).toBe(0);
  });

  test("an overpaid invoice shows a negative balance rather than losing the money", () => {
    const stats = projectStats({
      project: project(),
      estimates: [],
      invoices: [invoice("issued", 100_000, 120_000)],
      today: TODAY,
    });

    expect(stats.outstandingValue).toBe(-20_000);
  });

  test("backlog is what is accepted and not yet billed", () => {
    const stats = projectStats({
      project: project(),
      estimates: [estimate("accepted", 900_000)],
      invoices: [invoice("issued", 350_000)],
      today: TODAY,
    });

    expect(stats.backlogValue).toBe(550_000);
  });

  test("billing past the accepted total reads as no backlog, not negative backlog", () => {
    // Change orders and trued-up unit-price work put a job over its estimate
    // as a matter of course, and "-40,000 backlog" reads as a bug.
    const stats = projectStats({
      project: project(),
      estimates: [estimate("accepted", 300_000)],
      invoices: [invoice("issued", 340_000)],
      today: TODAY,
    });

    expect(stats.backlogValue).toBe(0);
  });

  test("another currency is counted and never added in", () => {
    const stats = projectStats({
      project: project({ currency: "USD" }),
      estimates: [estimate("sent", 100_000, "USD"), estimate("sent", 90_000, "EUR")],
      invoices: [invoice("issued", 50_000, 0, "2026-12-31", "EUR")],
      today: TODAY,
    });

    expect(stats.openEstimateValue).toBe(100_000);
    expect(stats.openEstimateCount).toBe(2);
    expect(stats.invoicedValue).toBe(0);
    expect(stats.otherCurrencyCount).toBe(2);
  });

  test("a project with nothing on it totals zero rather than failing", () => {
    const stats = projectStats({ project: project(), estimates: [], invoices: [], today: TODAY });
    expect(stats.invoicedValue).toBe(0);
    expect(stats.backlogValue).toBe(0);
  });
});

/* -------------------------------- searching ------------------------------- */

describe("finding a project", () => {
  const projects = [
    project({ id: "a", name: "Cedar Row Townhomes", status: "in_progress" }),
    project({
      id: "b",
      number: "PRJ-2026-0002",
      name: "Mill Street Offices",
      accountName: "Tessellate Property",
      accountId: "acc_2",
      status: "bidding",
      permitNumber: "B2026-05590",
      siteAddress: { ...EMPTY_ADDRESS, city: "Berkeley", state: "CA" },
      tags: ["prevailing-wage"],
      contractValue: 620_000,
      updatedAt: "2026-05-02T00:00:00Z",
    }),
    project({ id: "c", number: "PRJ-2025-0044", name: "Old Depot", status: "complete", contractValue: 90_000 }),
  ];

  const ids = (result: Project[]) => result.map(entry => entry.id);

  test("a job is found by the address people say out loud", () => {
    expect(ids(filterProjects(projects, { search: "berkeley" }))).toEqual(["b"]);
  });

  test("a job is found by its permit number", () => {
    expect(ids(filterProjects(projects, { search: "B2026-05590" }))).toEqual(["b"]);
  });

  test("every term has to match, across fields", () => {
    expect(ids(filterProjects(projects, { search: "mill tessellate" }))).toEqual(["b"]);
    expect(ids(filterProjects(projects, { search: "mill harbour" }))).toEqual([]);
  });

  test("live work can be isolated from everything ever won or lost", () => {
    expect(ids(filterProjects(projects, { liveOnly: true }))).toEqual(["a"]);
  });

  test("status, client and tag narrow independently", () => {
    expect(ids(filterProjects(projects, { status: "complete" }))).toEqual(["c"]);
    expect(ids(filterProjects(projects, { accountId: "acc_2" }))).toEqual(["b"]);
    expect(ids(filterProjects(projects, { tag: "prevailing-wage" }))).toEqual(["b"]);
  });

  test("sorting by status puts live work above finished work", () => {
    // A status sort that put ten cancelled jobs above the one being built
    // would be useless.
    expect(ids(sortProjects(projects, "status"))).toEqual(["a", "b", "c"]);
  });

  test("sorting by value is largest first", () => {
    expect(ids(sortProjects(projects, "value"))).toEqual(["a", "b", "c"]);
  });
});
