/**
 * Installing the worked example from `src/lib/samples.ts`.
 *
 * One call fills an empty account with a catalogue, three clients and their
 * jobs, seven proposal templates, an estimate priced from that catalogue and
 * a receivables book spread across the aging — so the
 * first thing a new account sees is the app doing its job rather than nine
 * empty lists.
 *
 * Everything goes in through the same validators and the same pricing engine
 * as anything else. The sample has no privileged path: if it would not import
 * as a file, it does not install either.
 *
 * It is additive and idempotent by SKU and name — running it twice does not
 * produce two catalogues, and it never overwrites something you have edited.
 * Anything that already exists is left exactly as it is and reported as
 * skipped.
 */
import {
  SAMPLE_ACCOUNTS,
  SAMPLE_CATALOG_SOURCES,
  SAMPLE_INVOICES,
  SAMPLE_PRODUCTS,
  SAMPLE_PROJECTS,
  SAMPLE_QUOTE,
  SAMPLE_TEMPLATES,
} from "../lib/samples";
import { defaultSelection } from "../lib/configurator";
import { round } from "../lib/money";
import {
  localId,
  readAccount,
  readCatalogSource,
  readProduct,
  readProject,
  readProposalTemplate,
} from "../lib/validate";
import type { PriceableLine } from "../lib/pricing";
import {
  createAccount,
  createCatalogSource,
  createProduct,
  createProject,
  createProposalTemplate,
  listAccounts,
  listInvoices,
  listCatalogSources,
  listProducts,
  listProjects,
  listProposalTemplates,
  nextProjectNumber,
} from "./db";
import { createPricedQuote, type QuoteDefaults } from "./quotes";
import { createBlankInvoice, discardInvoice, issueInvoice, recordPayment } from "./invoices";
import { addDays, today } from "../lib/receivable";
import { ApiError } from "./http";

export type SeedReport = {
  created: Record<string, number>;
  skipped: Record<string, number>;
  /** The quote the sample built, when it built one. */
  quoteId: string | null;
  notes: string[];
};

/**
 * `ownerEmail` is the installing account's own address, which the sample jobs
 * name as their project manager and superintendent so one person can walk
 * them. `defaults` is the account's settings — the sample estimate is priced
 * under its markup and overhead like any other new one.
 */
export async function installSample(token: string, ownerEmail: string, defaults: QuoteDefaults): Promise<SeedReport> {
  const created: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const notes: string[] = [];

  const count = (bucket: Record<string, number>, key: string) => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };

  /* ----------------------------- the catalogue ---------------------------- */

  const existingProducts = await listProducts(token);
  const haveSku = new Set(existingProducts.map(product => product.sku));

  for (const sample of SAMPLE_PRODUCTS) {
    const parsed = readProduct(sample);
    // A sample that does not validate is this app's bug, not the caller's.
    if (!parsed.ok) throw new ApiError(`The built-in sample is invalid (${sample.sku}): ${parsed.error}`, 500);

    if (haveSku.has(parsed.value.sku)) {
      count(skipped, "products");
      continue;
    }
    await createProduct(token, parsed.value);
    haveSku.add(parsed.value.sku);
    count(created, "products");
  }

  /* ------------------------------- customers ------------------------------ */

  const existingAccounts = await listAccounts(token);
  const haveAccount = new Map(existingAccounts.map(account => [account.name.toLowerCase(), account]));

  for (const sample of SAMPLE_ACCOUNTS) {
    const parsed = readAccount(sample);
    if (!parsed.ok) throw new ApiError(`The built-in sample is invalid (${sample.name}): ${parsed.error}`, 500);
    if (haveAccount.has(parsed.value.name.toLowerCase())) {
      count(skipped, "accounts");
      continue;
    }
    const account = await createAccount(token, parsed.value);
    haveAccount.set(account.name.toLowerCase(), account);
    count(created, "accounts");
  }

  /* -------------------------------- the jobs ------------------------------- */

  // After the clients, because a project names one; before the estimate,
  // because the estimate names a project. That ordering is the whole reason
  // this stage sits here rather than at the end.
  const existingProjects = await listProjects(token);
  const haveProject = new Map(existingProjects.map(project => [project.name.toLowerCase(), project]));

  for (const [index, sample] of SAMPLE_PROJECTS.entries()) {
    if (haveProject.has(sample.name.toLowerCase())) {
      count(skipped, "projects");
      continue;
    }

    // Each sample job belongs to the client at the same position in the list.
    const client = haveAccount.get((SAMPLE_ACCOUNTS[index]?.name ?? "").toLowerCase()) ?? null;

    const parsed = readProject({
      ...sample,
      // No index offset: the count already moves as each one is created, and
      // adding the loop position on top of it skips a number.
      number: await nextProjectNumber(token),
      accountId: client?.id ?? "",
      accountName: client?.name ?? "",
      // The installing account runs its own jobs in the sample, so one person
      // can walk it.
      projectManager: ownerEmail,
      superintendent: ownerEmail,
    });
    if (!parsed.ok) throw new ApiError(`The built-in sample is invalid (${sample.name}): ${parsed.error}`, 500);

    const project = await createProject(token, parsed.value);
    haveProject.set(project.name.toLowerCase(), project);
    count(created, "projects");
  }

  /* --------------------------- the supplier feed --------------------------- */

  const haveSource = new Set((await listCatalogSources(token)).map(source => source.name.toLowerCase()));
  for (const sample of SAMPLE_CATALOG_SOURCES) {
    const parsed = readCatalogSource(sample);
    if (!parsed.ok) throw new ApiError(`The built-in sample is invalid (${sample.name}): ${parsed.error}`, 500);
    if (haveSource.has(parsed.value.name.toLowerCase())) {
      count(skipped, "catalogSources");
      continue;
    }
    await createCatalogSource(token, parsed.value);
    count(created, "catalogSources");
  }

  if (created.catalogSources) {
    notes.push(
      "The sample supplier feed syncs costs and specification but not your sell price, may not create items, " +
        "and holds anything moving more than 20% for review. Download the supplier price list from " +
        "Catalogue → Templates and drop it on the feed to see a plan.",
    );
  }

  /* ------------------------------- documents ------------------------------ */

  const haveTemplate = new Set((await listProposalTemplates(token)).map(template => template.name.toLowerCase()));
  for (const sample of SAMPLE_TEMPLATES) {
    const parsed = readProposalTemplate(sample);
    if (!parsed.ok) throw new ApiError(`The built-in sample is invalid (${sample.name}): ${parsed.error}`, 500);
    if (haveTemplate.has(parsed.value.name.toLowerCase())) {
      count(skipped, "proposalTemplates");
      continue;
    }
    await createProposalTemplate(token, parsed.value);
    count(created, "proposalTemplates");
  }

  /* -------------------------------- a quote ------------------------------- */

  // Only when the products it needs were actually installed by this run or a
  // previous one — a sample quote referencing nothing is worse than none.
  const catalogue = new Map((await listProducts(token)).map(product => [product.sku, product]));
  const account = haveAccount.get(SAMPLE_QUOTE.accountName.toLowerCase()) ?? null;
  const project = haveProject.get(SAMPLE_QUOTE.projectName.toLowerCase()) ?? null;

  const lines: PriceableLine[] = SAMPLE_QUOTE.lines
    .map((sample, index): PriceableLine | null => {
      const product = catalogue.get(sample.sku);
      if (!product) return null;
      return {
        id: localId("ln"),
        productId: product.id,
        quantity: sample.quantity,
        discountPercent: sample.discountPercent,
        unitPriceOverride: null,
        wastePercentOverride: null,
        // Fall back to the product's own defaults if the sample named options
        // that the installed product does not have.
        selectedOptions: sample.options.length ? [...sample.options] : defaultSelection(product),
        description: "",
        parentId: null,
        sortOrder: index,
      };
    })
    .filter((line): line is PriceableLine => line !== null);

  let quoteId: string | null = null;
  if (lines.length && account) {
    const result = await createPricedQuote(
      token,
      {
        name: SAMPLE_QUOTE.name,
        accountId: account.id,
        projectId: project?.id ?? "",
        // The settings' own, like any new estimate.
        markupPercent: null,
        overheadPercent: null,
        discountPercent: 0,
        taxPercent: account.taxPercent,
        shipping: 0,
        validUntil: "",
        notes: SAMPLE_QUOTE.notes,
        internalNotes: SAMPLE_QUOTE.internalNotes,
      },
      lines,
      defaults,
    );
    quoteId = result.quote.id;
    count(created, "quotes");
  } else if (!account) {
    notes.push("The sample quote was skipped: its customer already exists under a different name.");
  }

  /* ------------------------------ receivables ----------------------------- */

  /*
   * Invoices go in through the ordinary path — raised as drafts, issued, then
   * paid against — rather than being written straight to storage with their
   * totals filled in. The sample has no privileged route, so an invoice that
   * would not reconcile through the API does not install either.
   *
   * Idempotency is by customer and PO reference, like everything above: a
   * second install finds them and leaves them alone.
   */
  const existingInvoices = await listInvoices(token);
  const invoiceSeen = new Set(
    existingInvoices.map(one => `${one.customer.name.toLowerCase()}|${one.poNumber}|${one.totals.total}`),
  );

  for (const sample of SAMPLE_INVOICES) {
    const customer = haveAccount.get(sample.accountName.toLowerCase());
    if (!customer) {
      count(skipped, "invoices");
      continue;
    }

    // The job it was raised for, so the project screen shows the billing half
    // rather than a contract value with nothing under it. Matched by client,
    // since each sample client has exactly one job.
    const job = [...haveProject.values()].find(entry => entry.accountId === customer.id) ?? null;

    const lines = sample.lines.map((entry, index) => ({
      id: localId("inl"),
      sourceLineId: null,
      sku: entry.sku,
      description: entry.description,
      quantity: entry.quantity,
      unitPrice: entry.unitPrice,
      amount: 0,
      taxPercent: customer.taxExempt ? 0 : entry.taxPercent,
      taxAmount: 0,
      sortOrder: index,
    }));

    try {
      const raised = await createBlankInvoice(
        token,
        {
          accountId: customer.id,
          quoteId: null,
          projectId: job?.id ?? "",
          currency: customer.currency,
          issueDate: "",
          paymentTermDays: customer.paymentTermDays,
          poNumber: sample.poNumber,
          notes: sample.notes,
          internalNotes: "Part of the worked example.",
        },
        lines,
      );

      // Same customer, same reference, same money: this one is already here.
      const fingerprint = `${customer.name.toLowerCase()}|${sample.poNumber}|${raised.invoice.totals.total}`;
      if (invoiceSeen.has(fingerprint)) {
        await discardInvoice(token, raised.invoice.id);
        count(skipped, "invoices");
        continue;
      }
      invoiceSeen.add(fingerprint);

      const issued = await issueInvoice(token, raised.invoice.id, addDays(today(), -sample.issuedDaysAgo));
      count(created, "invoices");

      if (sample.paidFraction > 0) {
        const amount = round(issued.totals.total * sample.paidFraction, issued.currency);
        if (amount > 0) {
          await recordPayment(token, issued.id, {
            receivedOn: addDays(today(), -sample.paidDaysAgo),
            amount,
            method: "bank_transfer",
            reference: `FT-${sample.issuedDaysAgo}${sample.poNumber.slice(-3)}`,
            note: "",
          });
        }
      }
    } catch (error) {
      // An invoice that will not install is not worth failing the sample over.
      count(skipped, "invoices");
    }
  }

  if (created.invoices) {
    notes.push("The receivables book has one settled invoice, one current, one a fortnight late and one badly overdue.");
  }

  return { created, skipped, quoteId, notes };
}
