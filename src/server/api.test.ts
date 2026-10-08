/**
 * End-to-end tests against a real Bun.serve process talking to a real
 * PocketBase, so the route table, the storage layer, the migration's access
 * rules and the hooks are all exercised for real.
 *
 * The PocketBase is a throwaway container on its own port and its own empty
 * volume (see ./testPocketBase.ts). Without Docker, everything that needs an
 * account skips, and the handful of anonymous routes still run.
 *
 * The tests that matter most are the ones about *authority*: that the server
 * prices a quote rather than believing one, that one account sees nothing of
 * another's, and that a sent quote cannot be edited underneath its reader.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, startTestPocketBase } from "./testPocketBase";
import { DEFAULT_PREFERENCES, PREFERENCE_LIMITS } from "../lib/preferences";
import { WORKSPACE_FILE_KIND } from "../lib/workspaceFile";
import { CATALOG_FILE_KIND } from "../lib/catalogFile";
import { SAMPLE_INVOICES, SAMPLE_PRODUCTS, SAMPLE_PROJECTS } from "../lib/samples";

const PORT = 3100 + Math.floor(Math.random() * 400);
const BASE = `http://localhost:${PORT}`;

const PASSWORD = "test-password-123";
/** Unique per run, so re-runs against one PocketBase never collide. */
const suffix = Math.random().toString(36).slice(2, 8);
const ALICE = `alice-${suffix}@example.com`;
const BOB = `bob-${suffix}@example.com`;

// Top-level await: the container has to exist before the describes below
// decide whether to register their account-backed tests or skip them.
const pocketbase = await startTestPocketBase();
if (!pocketbase.available) {
  console.warn(
    `\n[test] skipping every test that needs an account: ${pocketbase.reason}.\n` +
      "[test] start Docker, or point PB_TEST_URL at a PocketBase built from docker/, to run them.\n",
  );
}

/** A test that needs somewhere to store records — which is nearly all of them. */
const signedIn = pocketbase.available ? test : test.skip;

let server: ReturnType<typeof Bun.spawn>;

/** Alice's session. Every request below is hers unless it says otherwise. */
let cookie = "";
let bobCookie = "";

async function api(path: string, init?: RequestInit & { cookie?: string }) {
  const session = init?.cookie ?? cookie;
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(session ? { cookie: session } : {}),
    },
  });
}

const json = async (path: string, init?: RequestInit & { cookie?: string }) =>
  (await api(path, init)).json() as Promise<any>;

const post = (path: string, payload: unknown, init?: RequestInit & { cookie?: string }) =>
  json(path, { ...init, method: "POST", body: JSON.stringify(payload) });

const put = (path: string, payload: unknown, init?: RequestInit & { cookie?: string }) =>
  json(path, { ...init, method: "PUT", body: JSON.stringify(payload) });

/** Registers an account and returns the session cookie it was handed. */
async function register(email: string): Promise<string> {
  const response = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (response.status !== 201) throw new Error(`could not register ${email}: ${await response.text()}`);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

/** The account id behind a session. */
const idOf = async (session: string): Promise<string> => (await json("/api/auth/me", { cookie: session })).user.id;

/**
 * Registers an account and has Alice — the first account, so staff — put it on
 * staff, which is what it takes to see or change the company catalogue.
 */
async function staffAccount(email: string): Promise<string> {
  const session = await register(email);
  await put(`/api/staff/${await idOf(session)}`, { staff: true });
  return session;
}

/* -------------------------------- fixtures ------------------------------- */

const PLATFORM = {
  sku: "PLAT",
  name: "Platform",
  family: "Software",
  unitOfMeasure: "EA",
  listPrice: 100,
  cost: 30,
  optionGroups: [
    {
      key: "tier",
      name: "Tier",
      select: "one",
      required: true,
      options: [
        { key: "standard", name: "Standard", priceDelta: 0, default: true },
        { key: "premium", name: "Premium", priceDelta: 0, priceFactor: 1.5 },
      ],
    },
  ],
  volumeTiers: [
    { minQuantity: 1, maxQuantity: 49, kind: "percent", value: 0 },
    { minQuantity: 50, maxQuantity: null, kind: "percent", value: 10 },
  ],
};

/** Ids minted during setup and reused across the describes below. */
let platformId = "";
let accountId = "";
let templateId = "";

beforeAll(async () => {
  server = Bun.spawn(["bun", "src/index.ts"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: "production",
      POCKETBASE_URL: pocketbase.url,
      PB_ADMIN_EMAIL: TEST_ADMIN_EMAIL,
      PB_ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      // not listening yet
    }
    await Bun.sleep(100);
  }

  if (pocketbase.available) {
    cookie = await register(ALICE);
    bobCookie = await register(BOB);

    platformId = (await post("/api/products", PLATFORM)).id;
    accountId = (await post("/api/accounts", {
      name: "Harbour Logistics",
      contactName: "Dana Okafor",
      contactEmail: "dana@harbour.example.com",
      currency: "USD",
      paymentTerms: "Net 30",
      taxPercent: 10,
    })).id;
    templateId = (await post("/api/proposal-templates", {
      name: "Plain quote",
      format: "text",
      body: "{{quote.number}} for {{customer.name}}\n{{lines.table}}\nTotal {{totals.grandTotal}}",
    })).id;
  }
});

afterAll(async () => {
  server?.kill();
  await pocketbase.stop();
});

/** A quote body with one line of `quantity` platform users. */
const quoteBody = (overrides: Record<string, unknown> = {}, line: Record<string, unknown> = {}) => ({
  name: "Expansion",
  accountId,
  taxPercent: 0,
  lines: [
    {
      id: "ln_1",
      productId: platformId,
      quantity: 10,
      discountPercent: 0,
      selectedOptions: ["standard"],
      sortOrder: 0,
      ...line,
    },
  ],
  ...overrides,
});

/* ------------------------------- the basics ------------------------------ */

describe("the front door", () => {
  test("GET /api/health answers without an account", async () => {
    const payload = await json("/api/health", { cookie: " " });
    expect(payload.status).toBe("ok");
  });

  test("GET /api documents itself", async () => {
    const payload = await json("/api", { cookie: " " });
    expect(payload.name).toBe("sitelines");
    expect(payload.endpoints["POST   /api/quotes"]).toBeString();
    expect(payload.endpoints["POST   /api/projects"]).toBeString();
    expect(payload.endpoints["POST   /api/catalog-sources/:id/preview"]).toBeString();
    // The pricing pipeline is documented in the order it actually runs, and it
    // now starts one step earlier than it used to: what is priced is what has
    // to be bought, not what the tape measure said.
    expect(payload.pricing.pipeline[0]).toContain("take-off");
    expect(payload.pricing.pipeline[1]).toContain("markup");
  });

  test("an unknown API path is a 404, not the SPA", async () => {
    const response = await api("/api/nope", { cookie: " " });
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("anything that touches data needs an account", async () => {
    for (const path of ["/api/quotes", "/api/products", "/api/accounts", "/api/preferences"]) {
      expect((await api(path, { cookie: " " })).status).toBe(401);
    }
  });

  signedIn("GET /api/reference gives the UI its vocabulary", async () => {
    const payload = await json("/api/reference");
    expect(payload.quoteStatuses).toEqual(["draft", "sent", "accepted", "declined", "expired"]);
    expect(payload.quoteTransitions.draft).toEqual(["sent"]);
  });
});

/* -------------------------------- catalogue ------------------------------ */

describe("the catalogue", () => {
  signedIn("a product round-trips with its options and tiers", async () => {
    const product = await json(`/api/products/${platformId}`);
    expect(product.sku).toBe("PLAT");
    expect(product.optionGroups[0].options[1].priceFactor).toBe(1.5);
    expect(product.volumeTiers).toHaveLength(2);
    expect(product.ownerId).toBeString();
  });

  signedIn("a product without a SKU is refused with a sentence", async () => {
    const response = await api("/api/products", {
      method: "POST",
      body: JSON.stringify({ name: "Nameless" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("needs a SKU");
  });

  signedIn("a configuration rule naming an option that does not exist is refused", async () => {
    const payload = await post("/api/products", {
      ...PLATFORM,
      sku: "BADRULE",
      rules: [{ kind: "requires", when: ["premium"], then: ["nonexistent"], message: "" }],
    });
    expect(payload.error).toContain("references an option that does not exist");
  });

  signedIn("two products cannot share a SKU", async () => {
    const response = await api("/api/products", { method: "POST", body: JSON.stringify(PLATFORM) });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  signedIn("POST /api/products/:id/configure enforces the product's own rules", async () => {
    const valid = await post(`/api/products/${platformId}/configure`, {
      selectedOptions: ["premium"],
      quantity: 10,
    });
    expect(valid.valid).toBe(true);
    expect(valid.unitFactor).toBe(1.5);

    const missing = await post(`/api/products/${platformId}/configure`, { selectedOptions: [], quantity: 10 });
    expect(missing.valid).toBe(false);
    expect(missing.errors[0]).toContain("Tier");
    expect(missing.defaults).toEqual(["standard"]);
  });

  signedIn("the routes the simplification removed are gone", async () => {
    for (const path of ["/api/price-books", "/api/pricing-rules", "/api/approval-rules", "/api/quotes/awaiting"]) {
      expect((await api(path)).status).toBe(404);
    }
    // And a catalogue item is the owner's own, never shared.
    expect((await api(`/api/products/${platformId}/shares`)).status).toBe(404);
  });
});

/* -------------------------------- customers ------------------------------ */

describe("customers", () => {
  /** A customer created by this block alone, so its quote history is knowable. */
  let meridianId = "";

  signedIn("a customer round-trips with its contacts, tags and two addresses", async () => {
    const created = await post("/api/accounts", {
      name: "Meridian Health",
      status: "customer",
      // Deliberately shouted, duplicated and out of order.
      tags: ["Enterprise", "enterprise", "EMEA"],
      contacts: [
        { name: "Sam Ellery", title: "Procurement", email: "S.Ellery@meridian.example.org", role: "commercial" },
        { name: "Accounts Payable", email: "ap@meridian.example.org", role: "billing", primary: true },
      ],
      billingAddress: { line1: "88 Longwood Avenue", city: "Boston", state: "MA", country: "United States" },
      shippingSameAsBilling: false,
      shippingAddress: { line1: "Dock 4", city: "Chelsea", state: "MA", country: "United States" },
      currency: "USD",
      paymentTerms: "Net 45",
    });
    meridianId = created.id;

    expect(created.status).toBe("customer");
    expect(created.tags).toEqual(["emea", "enterprise"]);
    expect(created.contacts).toHaveLength(2);
    expect(created.contacts[0].email).toBe("s.ellery@meridian.example.org");
    // Each contact is given an id, since nothing in the body carried one.
    expect(created.contacts[0].id).toBeString();
    expect(created.shippingAddress.city).toBe("Chelsea");

    // And it reads back the same way, which is the half that goes through
    // the JSON column rather than through the validator.
    const read = await json(`/api/accounts/${meridianId}`);
    expect(read.contacts.map((contact: any) => contact.name)).toEqual(["Sam Ellery", "Accounts Payable"]);
    expect(read.tags).toEqual(["emea", "enterprise"]);
  });

  signedIn("exactly one contact is primary, whatever the body claims", async () => {
    const none = await post("/api/accounts", {
      name: "No primary named",
      currency: "USD",
      contacts: [{ name: "First" }, { name: "Second" }],
    });
    expect(none.contacts.map((contact: any) => contact.primary)).toEqual([true, false]);

    const several = await put(`/api/accounts/${none.id}`, {
      name: "No primary named",
      currency: "USD",
      contacts: [{ name: "First", primary: true }, { name: "Second", primary: true }],
    });
    expect(several.contacts.map((contact: any) => contact.primary)).toEqual([true, false]);
  });

  signedIn("a body written before contacts existed becomes one contact", async () => {
    // The shape `POST /api/accounts` took a version ago, and the shape the
    // account every other test in this file uses was created with.
    const legacy = await json(`/api/accounts/${accountId}`);
    expect(legacy.contacts).toHaveLength(1);
    expect(legacy.contacts[0].name).toBe("Dana Okafor");
    expect(legacy.contacts[0].email).toBe("dana@harbour.example.com");
    expect(legacy.contacts[0].primary).toBe(true);
    // Nothing was said about shipping, so it goes where the invoice goes.
    expect(legacy.shippingSameAsBilling).toBe(true);
  });

  signedIn("a contact with a broken address is refused with a sentence", async () => {
    const payload = await post("/api/accounts", {
      name: "Typo",
      currency: "USD",
      contacts: [{ name: "Nobody", email: "not-an-address" }],
    });
    expect(payload.error).toContain("is not an email address");
  });

  signedIn("the quote snapshots the primary contact, title and shipping address", async () => {
    const quote = await post("/api/quotes", {
      name: "Meridian pilot",
      accountId: meridianId,
      lines: [{ id: "ln_1", productId: platformId, quantity: 10, selectedOptions: ["standard"] }],
    });

    // The billing contact was flagged primary, so that is who it is addressed to.
    expect(quote.quote.customer.contactName).toBe("Accounts Payable");
    expect(quote.quote.customer.contactEmail).toBe("ap@meridian.example.org");
    expect(quote.quote.customer.shippingAddress.city).toBe("Chelsea");
    expect(quote.quote.customer.billingAddress.city).toBe("Boston");
  });

  signedIn("GET /api/accounts/:id/quotes is that customer's history and nobody else's", async () => {
    const history = await json(`/api/accounts/${meridianId}/quotes`);
    expect(history).toHaveLength(1);
    expect(history[0].name).toBe("Meridian pilot");
    expect(history[0].customer.accountId).toBe(meridianId);

    // A quote for the other customer stays out of it, and vice versa.
    await post("/api/quotes", quoteBody({ name: "Harbour expansion" }));

    const others = await json(`/api/accounts/${accountId}/quotes`);
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((quote: any) => quote.customer.accountId === accountId)).toBe(true);
    expect(await json(`/api/accounts/${meridianId}/quotes`)).toHaveLength(1);
  });

  signedIn("GET /api/quotes/search finds past the first page and counts by status", async () => {
    await post("/api/quotes", quoteBody({ name: "Needle in the haystack" }));
    await post("/api/quotes", quoteBody({ name: "Some other job" }));
    const all = await json("/api/quotes/search?perPage=1");
    expect(all.items).toHaveLength(1);
    expect(all.total).toBeGreaterThan(1);
    expect(Object.values(all.counts).reduce((sum: number, n: any) => sum + n, 0)).toBe(all.total);

    const found = await json("/api/quotes/search?q=haystack");
    expect(found.items.map((quote: any) => quote.name)).toEqual(["Needle in the haystack"]);
    expect(found.total).toBe(1);
    expect(found.counts).toEqual({ draft: 1 });

    const none = await json("/api/quotes/search?q=haystack&status=sent");
    expect(none.items).toHaveLength(0);
    expect(none.counts).toEqual({ draft: 1 });

    // A stranger's search finds nothing of this account's.
    expect((await json("/api/quotes/search?q=haystack", { cookie: bobCookie })).total).toBe(0);
  });

  signedIn("somebody else's customer has no history to read", async () => {
    const response = await api(`/api/accounts/${meridianId}/quotes`, { cookie: bobCookie });
    expect(response.status).toBe(404);
  });
});

/* --------------------------------- pricing ------------------------------- */

describe("pricing is the server's job", () => {
  signedIn("the totals in a request body are ignored", async () => {
    const created = await post("/api/quotes", {
      ...quoteBody(),
      // A client insisting the quote is free changes nothing.
      totals: { grandTotal: 0, netTotal: 0 },
      lines: [{ ...quoteBody().lines[0], netTotal: 0, unitPrice: 0 }],
    });

    expect(created.quote.totals.netTotal).toBe(1_000);
    expect(created.quote.lines[0].unitPrice).toBe(100);
    expect(created.quote.lines[0].netTotal).toBe(1_000);
  });

  signedIn("options and tiers both reach the price", async () => {
    const created = await post("/api/quotes", quoteBody({}, { quantity: 50, selectedOptions: ["premium"] }));
    const line = created.quote.lines[0];

    // 100 × 1.5 = 150, less the 10% tier at 50 = 135 each.
    expect(line.optionsUnitDelta).toBe(50);
    expect(line.tier.value).toBe(10);
    expect(line.unitPrice).toBe(135);
    expect(line.netTotal).toBe(6_750);
  });

  signedIn("a new quote takes the settings' markup and overhead, then keeps its own", async () => {
    const lumber = await post("/api/products", { sku: "COSTED", name: "Priced from cost", unitOfMeasure: "EA", listPrice: 0, cost: 50 });
    await put("/api/preferences", { ...DEFAULT_PREFERENCES, markupPercent: 20, overheadPercent: 10 });

    try {
      const body = { name: "Cost plus", accountId, lines: [{ id: "ln_1", productId: lumber.id, quantity: 10 }] };
      const created = await post("/api/quotes", body);

      expect(created.quote.markupPercent).toBe(20);
      expect(created.quote.overheadPercent).toBe(10);
      // 50 + 20% = 60 each; 600 for ten, and 10% overhead on top. (Tax is the
      // client's own 10%, on top of all of it.)
      expect(created.quote.lines[0].unitPrice).toBe(60);
      expect(created.quote.lines[0].pricedFromCost).toBe(true);
      expect(created.quote.totals.subtotal).toBe(600);
      expect(created.quote.totals.overheadAmount).toBe(60);
      expect(created.quote.totals.netTotal).toBe(660);

      // The settings move on; an estimate already written does not move with them.
      await put("/api/preferences", { ...DEFAULT_PREFERENCES, markupPercent: 50, overheadPercent: 0 });
      const resaved = await put(`/api/quotes/${created.quote.id}`, body);
      expect(resaved.quote.markupPercent).toBe(20);
      expect(resaved.quote.totals.netTotal).toBe(660);

      // Unless the estimate itself is told otherwise.
      const changed = await put(`/api/quotes/${created.quote.id}`, { ...body, markupPercent: 0, overheadPercent: 0 });
      expect(changed.quote.totals.netTotal).toBe(500);
    } finally {
      await put("/api/preferences", DEFAULT_PREFERENCES);
      await api(`/api/products/${lumber.id}`, { method: "DELETE" });
    }
  });

  signedIn("POST /api/quotes/preview prices without storing", async () => {
    const before = (await json("/api/quotes")).length;
    const preview = await post("/api/quotes/preview", quoteBody({ name: "Hypothetical" }));

    expect(preview.totals.netTotal).toBe(1_000);
    expect((await json("/api/quotes")).length).toBe(before);
  });

  signedIn("POST /api/formula/validate checks an item rule against what it can see", async () => {
    const good = await post("/api/formula/validate", { expression: "quantity >= 4 && option.std", optionKeys: ["std"] });
    expect(good.valid).toBe(true);

    const bad = await post("/api/formula/validate", { expression: "subtotal * 0.9" });
    expect(bad.valid).toBe(false);
    expect(bad.error).toContain("Unknown variable");
  });
});

/* -------------------------------- lifecycle ------------------------------ */

describe("a quote's life", () => {
  signedIn("a quote is numbered, and a revision says what it supersedes", async () => {
    const created = await post("/api/quotes", quoteBody({ name: "Numbered" }));
    expect(created.quote.number).toMatch(/^EST-\d{4}-\d{4}$/);
    expect(created.quote.status).toBe("draft");
    expect(created.quote.version).toBe(1);
    expect(created.quote.customer.name).toBe("Harbour Logistics");

    const revised = await post(`/api/quotes/${created.quote.id}/revise`, {});
    expect(revised.quote.version).toBe(2);
    expect(revised.quote.supersedesId).toBe(created.quote.id);
    expect(revised.quote.number).toContain("-r2");

    // The original is untouched — that is the point of a revision.
    const original = await json(`/api/quotes/${created.quote.id}`);
    expect(original.version).toBe(1);
  });

  signedIn("a draft is sent, then accepted", async () => {
    const created = await post("/api/quotes", quoteBody({ name: "Clean" }));

    const sent = await post(`/api/quotes/${created.quote.id}/status`, { status: "sent" });
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).toBeString();

    const accepted = await post(`/api/quotes/${created.quote.id}/status`, { status: "accepted" });
    expect(accepted.status).toBe("accepted");
  });

  signedIn("an illegal transition is refused with the legal ones", async () => {
    const created = await post("/api/quotes", quoteBody({ name: "Stuck" }));
    const response = await api(`/api/quotes/${created.quote.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "accepted" }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("can only become sent");
  });

  signedIn("an empty quote cannot be sent", async () => {
    const created = await post("/api/quotes", quoteBody({ name: "Empty", lines: [] }));
    const response = await api(`/api/quotes/${created.quote.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "sent" }),
    });
    expect(response.status).toBe(400);
  });

  signedIn("a quote with a line the catalogue refuses cannot be sent", async () => {
    // No option chosen in a required group: the configurator says no.
    const created = await post("/api/quotes", quoteBody({ name: "Unconfigured" }, { selectedOptions: [] }));
    expect(created.issues.length).toBeGreaterThan(0);

    const response = await api(`/api/quotes/${created.quote.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: "sent" }),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("must be fixed first");
  });

  signedIn("a sent quote cannot be edited underneath its reader", async () => {
    const created = await post("/api/quotes", quoteBody({ name: "Out the door" }));
    await post(`/api/quotes/${created.quote.id}/status`, { status: "sent" });

    const response = await api(`/api/quotes/${created.quote.id}`, {
      method: "PUT",
      body: JSON.stringify(quoteBody({ name: "Sneaky" })),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("cannot be edited");
  });
});

/* ------------------------------- receivables ----------------------------- */

describe("receivables", () => {
  /** A quote taken all the way to accepted, and the invoice raised from it. */
  let acceptedQuote: any = null;
  let invoiceId = "";

  /** Walks a fresh quote to `accepted` and hands it back. */
  const acceptedQuoteFor = async (name: string) => {
    const created = await post("/api/quotes", quoteBody({ name }));
    await post(`/api/quotes/${created.quote.id}/status`, { status: "sent" });
    return post(`/api/quotes/${created.quote.id}/status`, { status: "accepted" });
  };

  signedIn("an accepted quote raises a draft invoice that reconciles with it", async () => {
    acceptedQuote = await acceptedQuoteFor("To be invoiced");

    const raised = await post(`/api/quotes/${acceptedQuote.id}/invoice`, {});
    invoiceId = raised.invoice.id;

    expect(raised.invoice.number).toMatch(/^INV-\d{4}-\d{4}$/);
    // Always a draft: issuing is a separate, deliberate act.
    expect(raised.invoice.state).toBe("draft");
    expect(raised.invoice.issueDate).toBe("");
    expect(raised.invoice.dueDate).toBe("");
    expect(raised.invoice.quoteId).toBe(acceptedQuote.id);
    expect(raised.invoice.quoteNumber).toBe(acceptedQuote.number);

    // The customer came from the quote's own snapshot, not from the account.
    expect(raised.invoice.customer.name).toBe("Harbour Logistics");
    expect(raised.invoice.lines.length).toBeGreaterThan(0);

    // The whole point: it adds up to what the customer accepted.
    expect(raised.invoice.totals.total).toBe(acceptedQuote.totals.grandTotal);
    expect(raised.warnings).toEqual([]);
  });

  signedIn("the totals in a request body are ignored, the same as a quote's", async () => {
    const lying = await put(`/api/invoices/${invoiceId}`, {
      accountId,
      totals: { total: 1, balance: 0, paidAmount: 999 },
      lines: [{ description: "One thing", quantity: 2, unitPrice: 50 }],
    });

    expect(lying.invoice.totals.total).toBe(100);
    expect(lying.invoice.totals.paidAmount).toBe(0);
    expect(lying.invoice.totals.balance).toBe(100);
    // And the line got its own amount worked out for it.
    expect(lying.invoice.lines[0].amount).toBe(100);
  });

  signedIn("a quote nobody has sent cannot be invoiced", async () => {
    const draft = await post("/api/quotes", quoteBody({ name: "Never sent" }));
    const response = await api(`/api/quotes/${draft.quote.id}/invoice`, { method: "POST" });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("sent or accepted");
  });

  signedIn("invoicing the same quote twice warns rather than refusing", async () => {
    // A deposit and then the balance is legitimate; double-billing by
    // accident is the thing worth saying out loud.
    const again = await post(`/api/quotes/${acceptedQuote.id}/invoice`, {});
    expect(again.warnings.join(" ")).toContain("has already been invoiced");
    await api(`/api/invoices/${again.invoice.id}`, { method: "DELETE" });
  });

  signedIn("issuing dates it and works out when it falls due", async () => {
    const issued = await post(`/api/invoices/${invoiceId}/issue`, { issueDate: "2026-03-01" });

    expect(issued.state).toBe("issued");
    expect(issued.issueDate).toBe("2026-03-01");
    // Harbour Logistics is Net 30, seeded from their payment terms text.
    expect(issued.paymentTermDays).toBe(30);
    expect(issued.dueDate).toBe("2026-03-31");
  });

  signedIn("an issued invoice's lines are fixed", async () => {
    const response = await api(`/api/invoices/${invoiceId}`, {
      method: "PUT",
      body: JSON.stringify({ accountId, lines: [{ description: "Sneaky", quantity: 1, unitPrice: 5 }] }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("credit against it instead");
  });

  signedIn("an issued invoice is never deleted, only voided", async () => {
    const response = await api(`/api/invoices/${invoiceId}`, { method: "DELETE" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("gapless");
  });

  signedIn("a payment moves the balance and nothing else", async () => {
    const paid = await post(`/api/invoices/${invoiceId}/payments`, {
      amount: 40,
      receivedOn: "2026-03-10",
      method: "bank_transfer",
      reference: "FT-99",
    });

    expect(paid.invoice.totals.paidAmount).toBe(40);
    expect(paid.invoice.totals.balance).toBe(60);
    expect(paid.invoice.totals.total).toBe(100);
    expect(paid.invoice.payments).toHaveLength(1);
    expect(paid.invoice.payments[0].reference).toBe("FT-99");
    expect(paid.warnings).toEqual([]);
  });

  signedIn("a payment of nothing is refused", async () => {
    const payload = await post(`/api/invoices/${invoiceId}/payments`, { amount: 0 });
    expect(payload.error).toContain("greater than zero");
  });

  signedIn("a credit bigger than the balance is refused; the balance is not", async () => {
    const tooBig = await api(`/api/invoices/${invoiceId}/credits`, {
      method: "POST",
      body: JSON.stringify({ amount: 500, reason: "adjustment" }),
    });
    expect(tooBig.status).toBe(400);
    expect((await tooBig.json()).error).toContain("more than the");

    const credited = await post(`/api/invoices/${invoiceId}/credits`, { amount: 10, reason: "goodwill" });
    expect(credited.invoice.totals.creditedAmount).toBe(10);
    expect(credited.invoice.totals.balance).toBe(50);
  });

  signedIn("an invoice with a payment on it cannot be voided", async () => {
    const response = await api(`/api/invoices/${invoiceId}/void`, { method: "POST" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("Credit it instead");
  });

  signedIn("an overpayment is recorded, warned about, and left negative", async () => {
    // The money is in the bank whether or not the invoice expected it.
    const paid = await post(`/api/invoices/${invoiceId}/payments`, { amount: 90 });

    expect(paid.invoice.totals.balance).toBe(-40);
    expect(paid.warnings.join(" ")).toContain("overpaid");

    // Settled, so it drops out of the aging entirely.
    const aged = await json("/api/receivables/aging?currency=USD&asOf=2030-01-01");
    expect(aged.buckets["90+"].count).toBe(0);
  });

  signedIn("a payment entered in error can be taken back off", async () => {
    const before = await json(`/api/invoices/${invoiceId}`);
    const removed = await api(`/api/invoices/${invoiceId}/payments/${before.payments[1].id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect((await removed.json()).totals.balance).toBe(50);
  });

  signedIn("the aging report buckets the balance, as of a date", async () => {
    // Due 2026-03-31, £50 still owed. Read on 2026-05-20 that is 50 days late.
    const report = await json("/api/receivables/aging?currency=USD&asOf=2026-05-20");

    expect(report.currency).toBe("USD");
    expect(report.asOf).toBe("2026-05-20");
    expect(report.buckets["31-60"].amount).toBe(50);
    expect(report.outstanding).toBe(50);
    expect(report.overdue).toBe(50);

    // Read the day after issue, the same invoice is simply not yet due.
    const early = await json("/api/receivables/aging?currency=USD&asOf=2026-03-02");
    expect(early.buckets.current.amount).toBe(50);
    expect(early.overdue).toBe(0);
  });

  signedIn("a customer's invoices are their own, and nobody else's", async () => {
    const mine = await json(`/api/accounts/${accountId}/invoices`);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((one: any) => one.customer.accountId === accountId)).toBe(true);

    expect((await api(`/api/invoices/${invoiceId}`, { cookie: bobCookie })).status).toBe(404);
    expect(await json("/api/invoices", { cookie: bobCookie })).toEqual([]);
  });

  signedIn("a blank invoice picks up the customer's terms and currency", async () => {
    const raised = await post("/api/invoices", {
      accountId,
      lines: [{ description: "Consultancy", quantity: 2, unitPrice: 750, taxPercent: 10 }],
      poNumber: "PO-4417",
    });

    expect(raised.invoice.state).toBe("draft");
    expect(raised.invoice.currency).toBe("USD");
    expect(raised.invoice.paymentTermDays).toBe(30);
    expect(raised.invoice.poNumber).toBe("PO-4417");
    expect(raised.invoice.totals.subtotal).toBe(1_500);
    expect(raised.invoice.totals.taxAmount).toBe(150);
    expect(raised.invoice.totals.total).toBe(1_650);

    // A draft is not a receivable, and a draft can be thrown away.
    expect((await api(`/api/invoices/${raised.invoice.id}`, { method: "DELETE" })).status).toBe(200);
  });

  signedIn("nothing can be paid against a draft", async () => {
    const raised = await post("/api/invoices", {
      accountId,
      lines: [{ description: "Not yet", quantity: 1, unitPrice: 10 }],
    });
    const response = await api(`/api/invoices/${raised.invoice.id}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount: 10 }),
    });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("not been issued");
    await api(`/api/invoices/${raised.invoice.id}`, { method: "DELETE" });
  });

  signedIn("a payment is a record of its own, with an identity and an owner", async () => {
    const ledger = await json(`/api/invoices/${invoiceId}/payments`);

    expect(ledger.length).toBeGreaterThan(0);
    const payment = ledger[0];
    expect(payment.id).toMatch(/^pmt_/);
    expect(payment.invoiceId).toBe(invoiceId);
    expect(payment.ownerId).toBeString();
    // Its own created date, rather than a timestamp inside somebody's JSON.
    expect(payment.createdAt).toBeString();
    expect(payment.receivedOn).toBe("2026-03-10");
  });

  signedIn("cash is answerable on its own, across invoices", async () => {
    // The question the embedded ledger could not answer without opening every
    // invoice in the workspace.
    const all = await json("/api/payments");
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((one: any) => one.invoiceId && one.amount > 0)).toBe(true);

    const mine = await json(`/api/payments?invoiceId=${invoiceId}`);
    expect(mine.every((one: any) => one.invoiceId === invoiceId)).toBe(true);
    expect(mine.length).toBeLessThanOrEqual(all.length);

    const credits = await json(`/api/credits?invoiceId=${invoiceId}`);
    expect(credits.every((one: any) => one.invoiceId === invoiceId)).toBe(true);
  });

  signedIn("two payments banked at the same moment both land", async () => {
    // The bug that made this a collection. When the ledger was an array on the
    // invoice, recording a payment was a read-modify-write of the whole
    // record, so the second save wrote back the ledger the first had read and
    // one payment vanished. An insert cannot do that.
    const raised = await post("/api/invoices", {
      accountId,
      lines: [{ description: "Concurrent", quantity: 1, unitPrice: 300 }],
    });
    await post(`/api/invoices/${raised.invoice.id}/issue`, {});

    await Promise.all([
      post(`/api/invoices/${raised.invoice.id}/payments`, { amount: 100, reference: "A" }),
      post(`/api/invoices/${raised.invoice.id}/payments`, { amount: 100, reference: "B" }),
      post(`/api/invoices/${raised.invoice.id}/payments`, { amount: 100, reference: "C" }),
    ]);

    const after = await json(`/api/invoices/${raised.invoice.id}`);
    expect(after.payments).toHaveLength(3);
    expect(after.payments.map((one: any) => one.reference).sort()).toEqual(["A", "B", "C"]);
    // And the balance is read off the ledger, so it agrees with all three.
    expect(after.totals.paidAmount).toBe(300);
    expect(after.totals.balance).toBe(0);
  });

  signedIn("the balance is computed from the ledger, never cached on the invoice", async () => {
    // Deleting a payment row is enough to move the balance: nothing has to
    // remember to rewrite a number on the invoice.
    const before = await json(`/api/invoices/${invoiceId}`);
    const balanceBefore = before.totals.balance;
    const payment = before.payments[0];

    const removed = await api(`/api/invoices/${invoiceId}/payments/${payment.id}`, { method: "DELETE" });
    expect(removed.status).toBe(200);
    expect((await removed.json()).totals.balance).toBe(balanceBefore + payment.amount);

    // The list endpoint agrees, which is the half that reads every ledger at once.
    const listed = (await json("/api/invoices")).find((one: any) => one.id === invoiceId);
    expect(listed.totals.balance).toBe(balanceBefore + payment.amount);

    // Put it back so the aging assertions above still describe this invoice.
    await post(`/api/invoices/${invoiceId}/payments`, {
      amount: payment.amount,
      receivedOn: payment.receivedOn,
      reference: payment.reference,
    });
  });

  signedIn("a payment belonging to another invoice cannot be removed through this one", async () => {
    const other = await post("/api/invoices", {
      accountId,
      lines: [{ description: "Elsewhere", quantity: 1, unitPrice: 50 }],
    });
    await post(`/api/invoices/${other.invoice.id}/issue`, {});
    const recorded = await post(`/api/invoices/${other.invoice.id}/payments`, { amount: 50 });
    const paymentId = recorded.invoice.payments[0].id;

    const response = await api(`/api/invoices/${invoiceId}/payments/${paymentId}`, { method: "DELETE" });
    expect(response.status).toBe(404);

    // Still there, on the invoice it actually belongs to.
    expect(await json(`/api/invoices/${other.invoice.id}/payments`)).toHaveLength(1);
  });

  signedIn("nobody else can file a payment against your invoice", async () => {
    // Through the API Bob cannot even see the invoice, so this goes straight
    // at PocketBase to check the collection rule rather than the route.
    const response = await fetch(`${pocketbase.url}/api/collections/payments/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: await bobToken() },
      body: JSON.stringify({ id: "pmt_intruder", invoice: invoiceId, amount: 999, receivedOn: "2026-03-10" }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    // And Alice's ledger is untouched by it.
    const ledger = await json(`/api/invoices/${invoiceId}/payments`);
    expect(ledger.every((one: any) => one.id !== "pmt_intruder")).toBe(true);
  });

  signedIn("Bob sees no ledger at all, because he sees no invoices", async () => {
    expect(await json("/api/payments", { cookie: bobCookie })).toEqual([]);
    expect(await json("/api/credits", { cookie: bobCookie })).toEqual([]);
  });

  signedIn("the cash receipts export names the invoice, not its id", async () => {
    const response = await api("/api/payments?format=csv");
    const csv = await response.text();

    expect(csv).toContain("receivedOn,invoice,customer");
    expect(csv).toContain("reference");
    // Read beside a bank statement, so it carries the human-facing number.
    expect(csv).toMatch(/INV-\d{4}-\d{4}/);
    expect(csv).toContain("Harbour Logistics");
  });

  signedIn("the receivables export carries the derived status and aging", async () => {
    const response = await api("/api/invoices/export?format=csv&asOf=2026-05-20");
    const csv = await response.text();

    expect(csv).toContain("invoice,quote,customer");
    expect(csv).toContain("daysOverdue");
    expect(csv).toContain("agingBucket");
    // Status is derived on the way out, because it is stored nowhere.
    expect(csv).toContain("status");
  });
});

/* -------------------------------- privacy -------------------------------- */

describe("one account's records are its own", () => {
  signedIn("Bob sees nothing of Alice's catalogue, clients or quotes", async () => {
    const created = await post("/api/quotes", quoteBody({ name: "Alice's own" }));

    expect(await json("/api/products", { cookie: bobCookie })).toEqual([]);
    expect(await json("/api/accounts", { cookie: bobCookie })).toEqual([]);
    expect((await api(`/api/products/${platformId}`, { cookie: bobCookie })).status).toBe(404);
    expect((await api(`/api/quotes/${created.quote.id}`, { cookie: bobCookie })).status).toBe(404);
  });

  signedIn("nor can he write to her quote by going to PocketBase directly", async () => {
    const created = await post("/api/quotes", quoteBody({ name: "Not Bob's" }));
    await fetch(`${pocketbase.url}/api/collections/quotes/records/${created.quote.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: await bobToken() },
      body: JSON.stringify({ name: "Rewritten by Bob", totals: { grandTotal: 1 } }),
    });

    const after = await json(`/api/quotes/${created.quote.id}`);
    expect(after.name).toBe("Not Bob's");
    expect(after.totals.grandTotal).toBeGreaterThan(1);
  });
});

/** Bob's raw PocketBase token, for the one test that bypasses this API. */
async function bobToken(): Promise<string> {
  const response = await fetch(`${pocketbase.url}/api/collections/users/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: BOB, password: PASSWORD }),
  });
  return (await response.json()).token;
}

/* ---------------------------------- staff -------------------------------- */

describe("staff keep the company catalogue", () => {
  signedIn("the first account is staff, and somebody who just signed up is not", async () => {
    expect((await json("/api/auth/me")).user.staff).toBe(true);
    expect((await json("/api/auth/me", { cookie: bobCookie })).user.staff).toBe(false);
  });

  signedIn("somebody who is not staff sees no catalogue and cannot add to it", async () => {
    expect(await json("/api/products", { cookie: bobCookie })).toEqual([]);
    expect(await json("/api/catalog-sources", { cookie: bobCookie })).toEqual([]);
    const response = await api("/api/products", {
      method: "POST",
      body: JSON.stringify({ sku: "BOBS-OWN", name: "Bob's item", unitOfMeasure: "EA", listPrice: 1 }),
      cookie: bobCookie,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  signedIn("nor can they see who is staff, or make themselves so", async () => {
    expect((await api("/api/staff", { cookie: bobCookie })).status).toBe(403);
    const bobId = await idOf(bobCookie);
    expect((await api(`/api/staff/${bobId}`, { method: "PUT", body: JSON.stringify({ staff: true }), cookie: bobCookie })).status).toBe(403);

    // Nor by writing the flag onto their own record in PocketBase directly.
    await fetch(`${pocketbase.url}/api/collections/users/records/${bobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: await bobToken() },
      body: JSON.stringify({ staff: true }),
    });
    expect((await json("/api/auth/me", { cookie: bobCookie })).user.staff).toBe(false);
  });

  signedIn("staff put somebody on staff, and they see the same catalogue", async () => {
    const team = await json("/api/staff");
    expect(team.users.find((user: any) => user.email === ALICE).staff).toBe(true);

    const bobId = await idOf(bobCookie);
    const made = await put(`/api/staff/${bobId}`, { staff: true });
    expect(made.staff).toBe(true);

    // One catalogue: Bob sees the item Alice created, and may change it.
    const seen = await json(`/api/products/${platformId}`, { cookie: bobCookie });
    expect(seen.sku).toBe("PLAT");
    const edited = await put(`/api/products/${platformId}`, { ...PLATFORM, description: "Edited by Bob" }, { cookie: bobCookie });
    expect(edited.description).toBe("Edited by Bob");
    // It is still Alice's record; owner is who created it, not who may edit it.
    expect(edited.ownerId).toBe(await idOf(cookie));

    // And off again.
    expect((await put(`/api/staff/${bobId}`, { staff: false })).staff).toBe(false);
    expect(await json("/api/products", { cookie: bobCookie })).toEqual([]);
  });

  signedIn("nobody can take themselves off staff", async () => {
    const response = await api(`/api/staff/${await idOf(cookie)}`, { method: "PUT", body: JSON.stringify({ staff: false }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("yourself");
    expect((await json("/api/auth/me")).user.staff).toBe(true);
  });

  signedIn("an API key cannot make anybody staff", async () => {
    const issued = await post("/api/keys", { name: "staff test" });
    const response = await fetch(`${BASE}/api/staff/${await idOf(bobCookie)}`, {
      method: "PUT",
      headers: { "X-API-Key": String(issued.key), "Content-Type": "application/json" },
      body: JSON.stringify({ staff: true }),
    });
    expect(response.status).toBe(403);
    expect((await json("/api/auth/me", { cookie: bobCookie })).user.staff).toBe(false);
    await api(`/api/keys/${issued.id}`, { method: "DELETE" });
  });

  signedIn("a SKU is one item across the company, whoever created it", async () => {
    const carl = await staffAccount(`carl-${suffix}@example.com`);
    const response = await api("/api/products", { method: "POST", body: JSON.stringify(PLATFORM), cookie: carl });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

/* --------------------------------- sharing ------------------------------- */

describe("sharing", () => {
  signedIn("a shared quote is readable, not writable", async () => {
    const quote = (await post("/api/quotes", quoteBody({ name: "For Bob to read" }))).quote;
    await post(`/api/quotes/${quote.id}/shares`, { email: BOB });

    const shares = await json(`/api/quotes/${quote.id}/shares`);
    expect(shares.sharedWith).toEqual([BOB]);
    expect(shares.canShare).toBe(true);

    // Bob reads it now.
    expect((await json(`/api/quotes/${quote.id}`, { cookie: bobCookie })).name).toBe("For Bob to read");

    // He cannot change it.
    const write = await api(`/api/quotes/${quote.id}`, {
      method: "PUT",
      cookie: bobCookie,
      body: JSON.stringify(quoteBody({ name: "Bob's version" })),
    });
    expect(write.status).toBe(404);

    // A recipient sees who shared it, and not who else has it.
    const bobsView = await json(`/api/quotes/${quote.id}/shares`, { cookie: bobCookie });
    expect(bobsView.owner).toBe(ALICE);
    expect(bobsView.canShare).toBe(false);
    expect(bobsView.sharedWith).toEqual([]);

    await api(`/api/quotes/${quote.id}/shares?email=${encodeURIComponent(BOB)}`, { method: "DELETE" });
    expect((await api(`/api/quotes/${quote.id}`, { cookie: bobCookie })).status).toBe(404);
  });

  signedIn("the directory lists the accounts, so a picker has something to offer", async () => {
    // The complaint this answers: an empty picker on an instance
    // with ten accounts, because the list was built from addresses you had
    // already typed rather than from the accounts that exist.
    const payload = await json("/api/directory");

    const emails = payload.users.map((user: any) => user.email);
    expect(emails).toContain(ALICE);
    expect(emails).toContain(BOB);
    expect(payload.users.length).toBeGreaterThanOrEqual(2);

    // Sorted, so a long list is scannable.
    expect([...emails].sort()).toEqual(emails);
  });

  signedIn("the directory gives out an address and a name, and nothing else", async () => {
    const { users } = await json("/api/directory");
    const bob = users.find((user: any) => user.email === BOB);

    expect(Object.keys(bob).sort()).toEqual(["email", "id", "name"]);
    // Not the things an account would not want handed out.
    expect(bob).not.toHaveProperty("verified");
    expect(bob).not.toHaveProperty("created");
    expect(bob).not.toHaveProperty("preferences");
  });

  signedIn("it still takes an account to read it", async () => {
    expect((await api("/api/directory", { cookie: " " })).status).toBe(401);
  });

  signedIn("the collection itself stays closed — the directory is the only way through", async () => {
    // Bob's own token against PocketBase directly: the `users` list rule is
    // untouched, so he sees himself and nobody else.
    const response = await fetch(`${pocketbase.url}/api/collections/users/records?perPage=100`, {
      headers: { Authorization: await bobToken() },
    });

    const listed = (await response.json()).items ?? [];
    expect(listed.every((user: any) => user.id === undefined || user.email === BOB || !user.email)).toBe(true);
  });

  signedIn("sharing an address with no account says so", async () => {
    const quote = (await post("/api/quotes", quoteBody({ name: "Shared with nobody" }))).quote;
    const response = await api(`/api/quotes/${quote.id}/shares`, {
      method: "POST",
      body: JSON.stringify({ email: "nobody@example.com" }),
    });
    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("No account is registered");
  });
});

/* ------------------------------- the outputs ----------------------------- */

describe("what comes out", () => {
  let quoteId = "";

  signedIn("a quote exports as CSV with one row per line", async () => {
    quoteId = (await post("/api/quotes", quoteBody({ name: "For export" }))).quote.id;

    const response = await api(`/api/quotes/${quoteId}/export?format=csv`);
    expect(response.headers.get("content-type")).toContain("text/csv");

    const [header, row] = (await response.text()).split("\n");
    expect(header).toContain("sku");
    expect(header).toContain("netTotal");
    // Bare numbers, because a spreadsheet has to add them up.
    expect(row).toContain("1000");
  });

  signedIn("a quote renders through a proposal template", async () => {
    const response = await api(`/api/quotes/${quoteId}/document?templateId=${templateId}`);
    expect(response.headers.get("content-disposition")).toContain(".txt");

    const text = await response.text();
    expect(text).toContain("Harbour Logistics");
    expect(text).toContain("PLAT");
    expect(text).toContain("$1,000.00");
  });

  signedIn("a PDF template answers with a PDF, not with text", async () => {
    const pdfTemplateId = (
      await post("/api/proposal-templates", {
        name: "PDF proposal",
        format: "pdf",
        // An empty body means "the starter", which is what the editor opens.
        body: "",
      })
    ).id;

    const response = await api(`/api/quotes/${quoteId}/document?templateId=${pdfTemplateId}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain(".pdf");

    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // The quote's own details are in the file.
    expect(text).toContain("Harbour Logistics");

    // `?inline` is the same PDF, dispositioned for an iframe rather than a save.
    const inline = await api(`/api/quotes/${quoteId}/document?templateId=${pdfTemplateId}&inline`);
    expect(inline.headers.get("content-type")).toBe("application/pdf");
    expect(inline.headers.get("content-disposition")).toContain("inline");
  });

  signedIn("a PDF template is stored as the canonical document, margin rows dropped", async () => {
    const created = await post("/api/proposal-templates", {
      name: "Hand-written PDF",
      format: "pdf",
      body: JSON.stringify({
        page: { size: "Letter", fontSize: 99 },
        blocks: [
          { type: "text", text: "Hello {{customer.name}}" },
          { type: "totals", rows: [{ label: "Margin", field: "marginPercent" }] },
        ],
        footer: { text: "" },
      }),
    });

    const stored = JSON.parse(created.body);
    expect(stored.page.size).toBe("Letter");
    // Clamped rather than refused.
    expect(stored.page.fontSize).toBeLessThanOrEqual(18);
    // A proposal template has no way to name an internal number, so the row
    // was dropped and the block fell back to the customer-facing default.
    expect(JSON.stringify(stored)).not.toContain("marginPercent");
  });

  signedIn("a PDF template whose body is not JSON is refused", async () => {
    const response = await api("/api/proposal-templates", {
      method: "POST",
      body: JSON.stringify({ name: "Broken", format: "pdf", body: "# not a document" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("valid JSON");
  });

  signedIn("an invoice renders through an invoice template", async () => {
    const invoiceTemplateId = (
      await post("/api/proposal-templates", {
        name: "Plain invoice",
        kind: "invoice",
        format: "text",
        body: "{{invoice.number}} for {{customer.name}}\n{{lines.table}}\nDue {{invoice.dueDate}}: {{totals.balance}}",
      })
    ).id;

    const raised = await post("/api/invoices", {
      accountId,
      lines: [{ description: "Consultancy", quantity: 2, unitPrice: 750, taxPercent: 10 }],
    });
    const invoice = await post(`/api/invoices/${raised.invoice.id}/issue`, {});

    const response = await api(`/api/invoices/${invoice.id}/document?templateId=${invoiceTemplateId}`);
    expect(response.headers.get("content-disposition")).toContain(".txt");

    const text = await response.text();
    expect(text).toContain(invoice.number);
    expect(text).toContain("Harbour Logistics");
    expect(text).toContain("Consultancy");
    expect(text).toContain("$1,650.00");

    // The balance on the page is the ledger's, computed on this read — so a
    // payment banked a second ago is on the document a customer downloads.
    await post(`/api/invoices/${invoice.id}/payments`, { amount: 650 });
    expect(await (await api(`/api/invoices/${invoice.id}/document?templateId=${invoiceTemplateId}`)).text()).toContain(
      "$1,000.00",
    );

    // And ?inline is the preview pane's envelope, as it is for a quote.
    const payload = await json(`/api/invoices/${invoice.id}/document?templateId=${invoiceTemplateId}&inline`);
    expect(payload.format).toBe("text");
    expect(payload.unknownTokens).toEqual([]);
  });

  signedIn("a template of the wrong kind is refused, with what is wrong", async () => {
    // Rendering a quote template against an invoice would resolve every token
    // to a blank and hand the customer a document full of holes.
    const raised = await post("/api/invoices", {
      accountId,
      lines: [{ description: "Mismatched", quantity: 1, unitPrice: 100 }],
    });

    const response = await api(`/api/invoices/${raised.invoice.id}/document?templateId=${templateId}`);
    expect(response.status).toBe(422);
    expect((await response.json()).error).toContain("quote template");

    await api(`/api/invoices/${raised.invoice.id}`, { method: "DELETE" });
  });

  signedIn("an invoice PDF template is held to the invoice totals list", async () => {
    const created = await post("/api/proposal-templates", {
      name: "Hand-written invoice PDF",
      kind: "invoice",
      format: "pdf",
      body: JSON.stringify({
        page: {},
        blocks: [
          { type: "text", text: "Invoice {{invoice.number}}" },
          {
            type: "totals",
            rows: [
              { label: "Overhead", field: "overheadAmount" },
              { label: "Margin", field: "marginPercent" },
            ],
          },
        ],
        footer: { text: "" },
      }),
    });

    expect(created.kind).toBe("invoice");
    // Neither a quote's numbers nor an internal one survive the read.
    expect(created.body).not.toContain("overheadAmount");
    expect(created.body).not.toContain("marginPercent");
    expect(created.body).toContain("balance");
  });

  signedIn("a template written before invoices existed is still a quote's", async () => {
    // No `kind` in the body at all, which is every template stored before the
    // column existed and every script written against the old API.
    const created = await post("/api/proposal-templates", {
      name: "Kindless",
      format: "text",
      body: "{{quote.number}}",
    });
    expect(created.kind).toBe("quote");
  });

  signedIn("?inline gives the preview pane the text and its warnings", async () => {
    const payload = await json(`/api/quotes/${quoteId}/document?templateId=${templateId}&inline`);
    expect(payload.format).toBe("text");
    expect(payload.unknownTokens).toEqual([]);
    expect(payload.text).toContain("Harbour Logistics");
  });

  signedIn("the catalogue round-trips through *.catalog.json", async () => {
    const file = await json("/api/catalog/export");
    expect(file.kind).toBe(CATALOG_FILE_KIND);
    expect(file.products[0].sku).toBe("PLAT");
    // Ids are stripped, so the file is stable and diffable.
    expect(file.products[0].id).toBeUndefined();

    // Re-importing skips what is already there rather than duplicating it.
    const reimport = await post("/api/catalog/import", file);
    expect(reimport.skipped).toContain("product PLAT");

    // Somebody who is not staff cannot add to the company catalogue at all.
    const carol = await register(`carol-${suffix}@example.com`);
    const refused = await api("/api/catalog/import", { method: "POST", body: JSON.stringify(file), cookie: carol });
    expect(refused.status).toBeGreaterThanOrEqual(400);

    // And once they are, it is the same catalogue: nothing new to import.
    await put(`/api/staff/${await idOf(carol)}`, { staff: true });
    const again = await post("/api/catalog/import", file, { cookie: carol });
    expect(again.skipped).toContain("product PLAT");
    expect((await json("/api/products", { cookie: carol })).map((p: any) => p.sku)).toContain("PLAT");
  });

  signedIn("a spreadsheet imports through the same route, and a bad cell refuses all of it", async () => {
    const send = (text: string) =>
      fetch(`${BASE}/api/catalog/import`, {
        method: "POST",
        headers: { "Content-Type": "text/csv", cookie },
        body: text,
      }).then(response => response.json() as Promise<any>);

    // The downloadable template is the thing people start from; it has to import.
    const template = await (await fetch(`${BASE}/api/catalog/templates/catalog-template.csv`)).text();
    const imported = await send(template);
    expect(imported.created.products).toBeGreaterThanOrEqual(4);
    expect((await json("/api/products")).map((p: any) => p.sku)).toContain("PLY-CDX-34");

    // Nothing is written until every row is good.
    const refused = await send("sku,name,unitOfMeasure,listPrice\nCSV-OK,Fine,EA,10\nCSV-BAD,Broken,EA,call us");
    expect(refused.error).toContain("Row 3 (CSV-BAD)");
    expect((await json("/api/products")).map((p: any) => p.sku)).not.toContain("CSV-OK");
  });

  test("the catalogue templates download without a credential", async () => {
    const list = (await (await fetch(`${BASE}/api/catalog/templates`)).json()) as any[];
    expect(list.map(entry => entry.file)).toContain("catalog-template.catalog.json");
    for (const entry of list) {
      const response = await fetch(`${BASE}${entry.url}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain(entry.file);
    }
    expect((await fetch(`${BASE}/api/catalog/templates/nope.csv`)).status).toBe(404);
  });

  signedIn("a catalogue file from a newer version is refused", async () => {
    const payload = await post("/api/catalog/import", { kind: CATALOG_FILE_KIND, version: 99, products: [] });
    expect(payload.error).toContain("version 99");
  });

  signedIn("the workspace export holds everything, quotes included", async () => {
    const file = await json("/api/export");
    expect(file.kind).toBe(WORKSPACE_FILE_KIND);
    expect(file.exportedBy).toBe(ALICE);
    expect(file.catalog.kind).toBe(CATALOG_FILE_KIND);
    expect(file.accounts[0].name).toBe("Harbour Logistics");
    expect(file.quotes.length).toBeGreaterThan(0);

    // The receivables come out too, with their ledgers — an export that kept
    // what you offered but not what you are owed is half a backup.
    expect(Array.isArray(file.invoices)).toBe(true);
    expect(file.invoices.length).toBeGreaterThan(0);
    const withLedger = file.invoices.find((one: any) => one.payments.length > 0);
    expect(withLedger).toBeDefined();
    expect(withLedger.lines.length).toBeGreaterThan(0);
    // Nothing derived is in the file: status and aging are recomputed on read.
    expect(withLedger.status).toBeUndefined();
    expect(file.quotes[0].lines).toBeArray();
    expect(file.preferences.markupPercent).toBe(DEFAULT_PREFERENCES.markupPercent);
  });
});

/* ------------------------------- preferences ----------------------------- */

describe("preferences", () => {
  signedIn("they start at the defaults and clamp what they are sent", async () => {
    expect(await json("/api/preferences")).toEqual(DEFAULT_PREFERENCES);

    const saved = await put("/api/preferences", {
      theme: "dark",
      markupPercent: 9_999,
      quoteValidDays: 0,
      defaultCurrency: "NOPE",
      showMargin: true,
      locale: "en-GB",
      somethingElse: "dropped",
    });

    expect(saved.theme).toBe("dark");
    expect(saved.markupPercent).toBe(PREFERENCE_LIMITS.markupPercent.max);
    expect(saved.quoteValidDays).toBe(PREFERENCE_LIMITS.validDays.min);
    // A key the app no longer has is dropped like any other stranger.
    expect(saved).not.toHaveProperty("defaultCurrency");
    expect(saved.showMargin).toBe(true);
    expect(saved).not.toHaveProperty("somethingElse");

    await put("/api/preferences", DEFAULT_PREFERENCES);
  });
});

/* --------------------------------- sample -------------------------------- */

describe("the worked example", () => {
  signedIn("installs into a fresh account, and is idempotent", async () => {
    const dave = await staffAccount(`dave-${suffix}@example.com`);

    const first = await post("/api/sample", {}, { cookie: dave });
    expect(first.created.products).toBe(SAMPLE_PRODUCTS.length);
    expect(first.created.quotes).toBe(1);
    expect(first.quoteId).toBeString();

    // The sample estimate prices cleanly, so it can go straight out.
    const sent = await post(`/api/quotes/${first.quoteId}/status`, { status: "sent" }, { cookie: dave });
    expect(sent.status).toBe("sent");

    // The jobs and the supplier feed come with it, and the estimate is
    // attached to the job rather than floating loose.
    expect(first.created.projects).toBe(SAMPLE_PROJECTS.length);
    expect(first.created.catalogSources).toBe(1);

    const estimate = await json(`/api/quotes/${first.quoteId}`, { cookie: dave });
    expect(estimate.projectId).toBeTruthy();
    expect(estimate.projectName).toContain("Cedar Row Townhomes");

    const second = await post("/api/sample", {}, { cookie: dave });
    expect(second.created.products ?? 0).toBe(0);
    expect(second.skipped.products).toBe(SAMPLE_PRODUCTS.length);
    expect(second.created.projects ?? 0).toBe(0);
    expect(second.skipped.projects).toBe(SAMPLE_PROJECTS.length);
  });

  signedIn("it arrives with a receivables book spread across the aging", async () => {
    const erin = await register(`erin-${suffix}@example.com`);
    const report = await post("/api/sample", {}, { cookie: erin });

    expect(report.created.invoices).toBe(SAMPLE_INVOICES.length);

    // The invoices went in through the ordinary path, so they are issued,
    // dated, and one of them is part paid.
    const invoices = await json("/api/invoices", { cookie: erin });
    expect(invoices).toHaveLength(SAMPLE_INVOICES.length);
    expect(invoices.every((one: any) => one.state === "issued")).toBe(true);
    expect(invoices.every((one: any) => one.issueDate && one.dueDate)).toBe(true);
    expect(invoices.some((one: any) => one.totals.paidAmount > 0)).toBe(true);

    // One settled, one late, one badly late — which is the whole point of
    // shipping sample invoices rather than an empty five-column report.
    const aged = await json("/api/receivables/aging?currency=USD", { cookie: erin });
    expect(aged.outstanding).toBeGreaterThan(0);
    expect(aged.overdue).toBeGreaterThan(0);
    expect(aged.paidAmount).toBeGreaterThan(0);
    expect(aged.buckets["90+"].count).toBe(1);

    // And a second install does not raise the same ones again.
    const again = await post("/api/sample", {}, { cookie: erin });
    expect(again.created.invoices ?? 0).toBe(0);
    expect(again.skipped.invoices).toBe(SAMPLE_INVOICES.length);
    expect(await json("/api/invoices", { cookie: erin })).toHaveLength(SAMPLE_INVOICES.length);
  });
});

/* --------------------------------- projects -------------------------------- */

describe("projects", () => {
  signedIn("a new job gets a number minted for it", async () => {
    const owner = await register(`pm-${suffix}@example.com`);

    const first = await post("/api/projects", { name: "Cedar Row Townhomes", currency: "USD" }, { cookie: owner });
    expect(first.number).toMatch(/^PRJ-\d{4}-0001$/);

    const second = await post("/api/projects", { name: "Mill Street Level 3", currency: "USD" }, { cookie: owner });
    expect(second.number).toMatch(/^PRJ-\d{4}-0002$/);
  });

  signedIn("the number is the job's, and an edit cannot move it", async () => {
    // It is on drawings, permits and other people's purchase orders.
    const owner = await register(`pm2-${suffix}@example.com`);
    const project = await post("/api/projects", { name: "Depot Rebuild", currency: "USD" }, { cookie: owner });

    const edited = await put(
      `/api/projects/${project.id}`,
      { name: "Depot Rebuild — Phase 2", number: "PRJ-1999-9999", currency: "USD" },
      { cookie: owner },
    );

    expect(edited.name).toBe("Depot Rebuild — Phase 2");
    expect(edited.number).toBe(project.number);
  });

  signedIn("a completion date before the start is refused", async () => {
    const owner = await register(`pm3-${suffix}@example.com`);
    const response = await api("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Backwards", startDate: "2026-06-01", targetCompletionDate: "2026-01-01" }),
      cookie: owner,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("before it starts");
  });

  signedIn("an estimate attaches to a job, and its summary adds the job up", async () => {
    const owner = await staffAccount(`pm4-${suffix}@example.com`);
    await post("/api/sample", {}, { cookie: owner });

    const projects = await json("/api/projects", { cookie: owner });
    const cedar = projects.find((one: any) => one.name === "Cedar Row Townhomes");
    expect(cedar).toBeTruthy();

    const summary = await json(`/api/projects/${cedar.id}/summary`, { cookie: owner });
    expect(summary.project.id).toBe(cedar.id);
    expect(summary.estimates.length).toBeGreaterThan(0);
    // The sample's estimate is a draft, so it is open work rather than won.
    expect(summary.stats.openEstimateValue).toBeGreaterThan(0);
    expect(summary.stats.currency).toBe("USD");
  });

  signedIn("a job is not visible to somebody else's account", async () => {
    const owner = await register(`pm5-${suffix}@example.com`);
    const stranger = await register(`pm6-${suffix}@example.com`);
    const project = await post("/api/projects", { name: "Private Job", currency: "USD" }, { cookie: owner });

    const response = await api(`/api/projects/${project.id}`, { cookie: stranger });
    expect(response.status).toBe(404);
  });

  signedIn("an estimate cannot be attached to somebody else's job", async () => {
    const owner = await register(`pm7-${suffix}@example.com`);
    const stranger = await register(`pm8-${suffix}@example.com`);
    const project = await post("/api/projects", { name: "Not Yours", currency: "USD" }, { cookie: owner });

    const response = await api("/api/quotes", {
      method: "POST",
      body: JSON.stringify({ name: "Poaching", projectId: project.id, currency: "USD", lines: [] }),
      cookie: stranger,
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error).toContain("project");
  });
});

/* ---------------------------- catalogue sources ---------------------------- */

describe("catalogue sources", () => {
  const FEED = [
    "supplier_sku,unit_cost,mfr",
    "DF2-2X4-925,3.51,Cascade Mills",
    "GYP-TX58-412,999.00,Keystone Gypsum",
  ].join("\n");

  /**
   * A member of staff, the sample catalogue, and one source mapped onto it.
   *
   * The catalogue is the company's, so an earlier test's sync has already
   * moved the two items this feed touches — they are put back to the sample's
   * own numbers first, so every test starts from the same catalogue.
   */
  async function workspace(label: string, policy: Record<string, unknown> = {}) {
    const session = await staffAccount(`feed-${label}-${suffix}@example.com`);
    await post("/api/sample", {}, { cookie: session });

    const products = await json("/api/products", { cookie: session });
    for (const sku of ["LBR-STUD-2X4", "DRY-5812-4X12"]) {
      const stored = products.find((one: any) => one.sku === sku);
      const original = SAMPLE_PRODUCTS.find(one => one.sku === sku);
      await put(`/api/products/${stored.id}`, original, { cookie: session });
    }

    const source = await post(
      "/api/catalog-sources",
      {
        name: `Test feed ${label}`,
        format: "csv",
        mapping: { key: "supplier_sku", matchOn: "supplierSku", cost: "unit_cost", manufacturer: "mfr" },
        policy: { fields: ["cost", "manufacturer"], maxPriceChangePercent: 20, ...policy },
      },
      { cookie: session },
    );

    return { session, source };
  }

  signedIn("a source with no key column is refused", async () => {
    // Nothing could be matched, so it would either do nothing or duplicate the
    // whole catalogue on every run.
    const session = await register(`feed-nokey-${suffix}@example.com`);
    const response = await api("/api/catalog-sources", {
      method: "POST",
      body: JSON.stringify({ name: "Keyless", format: "csv" }),
      cookie: session,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("key column");
  });

  signedIn("a URL the server will not fetch is refused at the door", async () => {
    const session = await register(`feed-scheme-${suffix}@example.com`);
    const response = await api("/api/catalog-sources", {
      method: "POST",
      body: JSON.stringify({
        name: "Local file",
        format: "csv",
        url: "file:///etc/passwd",
        mapping: { key: "sku" },
      }),
      cookie: session,
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("http");
  });

  signedIn("inspecting an uploaded feed reports its columns", async () => {
    const { session, source } = await workspace("inspect");
    const result = await post(`/api/catalog-sources/${source.id}/inspect`, { body: FEED }, { cookie: session });

    expect(result.columns).toEqual(["supplier_sku", "unit_cost", "mfr"]);
    expect(result.rowCount).toBe(2);
    expect(result.sample[0].supplier_sku).toBe("DF2-2X4-925");
  });

  signedIn("a preview changes nothing", async () => {
    const { session, source } = await workspace("preview");

    const before = await json("/api/products", { cookie: session });
    const stud = before.find((one: any) => one.sku === "LBR-STUD-2X4");

    const preview = await post(`/api/catalog-sources/${source.id}/preview`, { body: FEED }, { cookie: session });
    expect(preview.applied).toBe(false);
    expect(preview.plan.counts.update).toBe(1);
    // The gypsum row moves far enough to need a person.
    expect(preview.plan.counts.flagged).toBe(1);

    const after = await json("/api/products", { cookie: session });
    expect(after.find((one: any) => one.sku === "LBR-STUD-2X4").cost).toBe(stud.cost);

    // And a preview is not something the source "last did".
    const source_ = await json(`/api/catalog-sources/${source.id}`, { cookie: session });
    expect(source_.lastRun).toBeNull();
  });

  signedIn("a sync writes the ordinary changes and holds the flagged one", async () => {
    const { session, source } = await workspace("apply");

    const result = await post(`/api/catalog-sources/${source.id}/sync`, { body: FEED }, { cookie: session });
    expect(result.applied).toBe(true);
    expect(result.failures).toEqual([]);

    const products = await json("/api/products", { cookie: session });
    const stud = products.find((one: any) => one.sku === "LBR-STUD-2X4");
    const gypsum = products.find((one: any) => one.sku === "DRY-5812-4X12");

    expect(stud.cost).toBe(3.51);
    expect(stud.material.manufacturer).toBe("Cascade Mills");
    // Held back: a 5,600% cost move is a decimal point, not a price rise.
    expect(gypsum.cost).toBe(17.6);

    // Everything the feed does not own survived it.
    expect(stud.wasteFactorPercent).toBe(8);
    expect(stud.listPrice).toBe(4.28);

    // And the sync said where the number came from.
    expect(stud.provenance.sourceId).toBe(source.id);
    expect(stud.provenance.fields).toContain("cost");

    const stamped = await json(`/api/catalog-sources/${source.id}`, { cookie: session });
    expect(stamped.lastRun.applied).toBe(true);
    expect(stamped.lastRun.updated).toBe(1);
    expect(stamped.lastRun.flagged).toBe(1);
  });

  signedIn("a flagged row goes through once a person accepts it", async () => {
    const { session, source } = await workspace("accept");

    const result = await post(
      `/api/catalog-sources/${source.id}/sync`,
      { body: FEED, accept: ["GYP-TX58-412"] },
      { cookie: session },
    );

    expect(result.plan.counts.flagged).toBe(0);

    const products = await json("/api/products", { cookie: session });
    expect(products.find((one: any) => one.sku === "DRY-5812-4X12").cost).toBe(999);
  });

  signedIn("a source will not invent a catalogue item unless it is allowed to", async () => {
    const extra = [FEED, "NEW-SEALANT,8.40,ChemBond"].join("\n");
    const { session, source } = await workspace("nocreate");

    const plan = await post(`/api/catalog-sources/${source.id}/sync`, { body: extra }, { cookie: session });
    expect(plan.plan.counts.skip).toBe(1);
    expect(plan.plan.counts.create).toBe(0);
    expect(plan.plan.changes.find((one: any) => one.action === "skip").notes[0]).toContain("may not create items");
  });

  signedIn("a source that is allowed to create items does", async () => {
    // No sample catalogue here: an empty workspace is the honest test of
    // creation, and it keeps the two halves of this rule independent.
    const session = await staffAccount(`feed-create-${suffix}@example.com`);
    const source = await post(
      "/api/catalog-sources",
      {
        name: "Creating feed",
        format: "csv",
        mapping: { key: "supplier_sku", matchOn: "supplierSku", sku: "supplier_sku", name: "mfr", cost: "unit_cost" },
        policy: { fields: ["cost", "name"], createMissing: true, defaultFamily: "Sundries" },
      },
      { cookie: session },
    );

    const result = await post(
      `/api/catalog-sources/${source.id}/sync`,
      { body: "supplier_sku,unit_cost,mfr\nNEW-SEALANT,8.40,ChemBond" },
      { cookie: session },
    );

    expect(result.plan.counts.create).toBe(1);
    expect(result.failures).toEqual([]);

    const products = await json("/api/products", { cookie: session });
    const created = products.find((one: any) => one.sku === "NEW-SEALANT");
    expect(created.name).toBe("ChemBond");
    expect(created.cost).toBe(8.4);
    expect(created.family).toBe("Sundries");
    // A feed that may not set the sell price leaves it at zero rather than
    // guessing one, and the plan says so.
    expect(created.listPrice).toBe(0);
  });

  signedIn("a switched-off source refuses to run", async () => {
    const { session, source } = await workspace("inactive");
    await put(`/api/catalog-sources/${source.id}`, { ...source, active: false }, { cookie: session });

    const response = await api(`/api/catalog-sources/${source.id}/sync`, {
      method: "POST",
      body: JSON.stringify({ body: FEED }),
      cookie: session,
    });

    expect(response.status).toBe(409);
  });

  signedIn("a source is not visible to an account that is not staff", async () => {
    const { source } = await workspace("private");
    const stranger = await register(`feed-stranger-${suffix}@example.com`);

    expect((await api(`/api/catalog-sources/${source.id}`, { cookie: stranger })).status).toBe(404);
    // And the sync route is behind the same read.
    expect(
      (
        await api(`/api/catalog-sources/${source.id}/sync`, {
          method: "POST",
          body: JSON.stringify({ body: FEED }),
          cookie: stranger,
        })
      ).status,
    ).toBe(404);
  });
});

/* ------------------------------- api keys -------------------------------- */

describe("an API key", () => {
  /** A fresh account's key, issued the way the settings page issues one. */
  async function keyFor(name: string) {
    const session = await register(`${name}-${suffix}@example.com`);
    const issued = await post("/api/keys", { name }, { cookie: session });
    return { session, key: String(issued.key) };
  }

  const withKey = (path: string, key: string, init: RequestInit = {}) =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { "X-API-Key": key, ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });

  signedIn("reaches the routes PocketBase answers through a hook, not only the collection API", async () => {
    // The directory is relayed to a hook route; a key sent there as
    // `Authorization` reads as anonymous and the relay answers 401.
    const { key } = await keyFor("key-relay");
    const response = await withKey("/api/directory", key);
    expect(response.status).toBe(200);
    expect(Array.isArray(((await response.json()) as { users: unknown[] }).users)).toBe(true);
  });

  signedIn("cannot set a Telegram bot, which is a credential", async () => {
    const { key } = await keyFor("key-telegram");
    const response = await withKey("/api/telegram/bot", key, {
      method: "PUT",
      body: JSON.stringify({ token: "" }),
    });
    expect(response.status).toBe(403);
  });
});

/* -------------------------------- telegram ------------------------------- */

describe("telegram", () => {
  // The test container sets no TELEGRAM_BOT_TOKEN, so nothing here reaches
  // Telegram: these are the paths that are decided before a call would be made.

  signedIn("an account with nothing set up has no bot, no chat and the defaults", async () => {
    const session = await register(`tg-fresh-${suffix}@example.com`);
    const status = await json("/api/telegram", { cookie: session });

    expect(status.bot).toEqual({ source: "none", username: "" });
    expect(status.pairing).toBeNull();
    expect(status.settings).toMatchObject({ enabled: true, chatId: "", apiKeyOnly: true, minRows: 0 });
  });

  signedIn("settings round-trip, and a body cannot name the chat", async () => {
    const session = await register(`tg-settings-${suffix}@example.com`);
    const saved = await put(
      "/api/telegram",
      {
        enabled: false,
        events: { finished: false, failed: true, quoteDecided: true },
        minRows: 500,
        apiKeyOnly: false,
        chatId: "999999",
        chatLabel: "Somebody else",
      },
      { cookie: session },
    );

    expect(saved.settings).toEqual({
      enabled: false,
      chatId: "",
      chatLabel: "",
      events: { finished: false, failed: true, quoteDecided: true, paymentReceived: false },
      minRows: 500,
      apiKeyOnly: false,
    });
    expect((await json("/api/telegram", { cookie: session })).settings).toEqual(saved.settings);
  });

  signedIn("one account's settings are not another's", async () => {
    const mine = await register(`tg-mine-${suffix}@example.com`);
    const theirs = await register(`tg-theirs-${suffix}@example.com`);
    await put("/api/telegram", { minRows: 42 }, { cookie: mine });

    expect((await json("/api/telegram", { cookie: theirs })).settings.minRows).toBe(0);
  });

  signedIn("the row is invisible to the collection API, token and all", async () => {
    const session = await register(`tg-hidden-${suffix}@example.com`);
    await put("/api/telegram", { minRows: 1 }, { cookie: session });
    const token = decodeURIComponent(session.split("=")[1] ?? "");

    const response = await fetch(`${pocketbase.url}/api/collections/telegram_links/records`, {
      headers: { Authorization: token },
    });
    // Closed rules answer a user with 403 on list, which is the point.
    expect(response.status).toBe(403);
  });

  signedIn("a malformed bot token is refused by name, before Telegram is asked", async () => {
    const session = await register(`tg-badtoken-${suffix}@example.com`);
    const response = await api("/api/telegram/bot", {
      method: "PUT",
      body: JSON.stringify({ token: "not-a-token" }),
      cookie: session,
    });

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/bot token/);
  });

  signedIn("pairing needs a bot, checking needs a pairing, and a test needs a chat", async () => {
    const session = await register(`tg-nobot-${suffix}@example.com`);

    const pair = await api("/api/telegram/pair", { method: "POST", cookie: session });
    expect(pair.status).toBe(400);
    expect(((await pair.json()) as { error: string }).error).toMatch(/No bot is set up/);

    const check = await api("/api/telegram/pair/check", { method: "POST", cookie: session });
    expect(check.status).toBe(400);

    const sent = await api("/api/telegram/test", { method: "POST", cookie: session });
    expect(sent.status).toBe(400);
    expect(((await sent.json()) as { error: string }).error).toMatch(/Link a chat first/);
  });

  signedIn("unlinking with nothing linked is harmless", async () => {
    const session = await register(`tg-unlink-${suffix}@example.com`);
    const response = await api("/api/telegram/chat", { method: "DELETE", cookie: session });
    expect(response.status).toBe(200);
  });
});

/* --------------------------------- website -------------------------------- */

describe("the public website", () => {
  /** A visitor: no cookie, and a sender address of its own for the rate limit. */
  const visitor = (path: string, init: RequestInit = {}, from = "203.0.113.1") =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), "X-Forwarded-For": from },
    });

  const enquiry = {
    firstName: "Pat",
    lastName: "Visitor",
    email: "pat@example.com",
    phone: "555-0100",
    area: "Kitchen",
    description: "New cabinets, maybe an island.",
  };

  signedIn("is readable without an account, and comes up already filled in", async () => {
    const page = (await (await visitor("/api/site")).json()) as any;
    expect(page.texts["brand.name"][0].title).toBe("Klein Remodeling");
    expect(page.texts["services.list"].map((t: any) => t.title)).toEqual([
      "Complete Remodeling",
      "Home Interior",
      "Handyman Services",
    ]);
    expect(page.images["projects.gallery"]).toHaveLength(4);
  });

  signedIn("serves its pictures itself, cached hard, at the widths it keeps", async () => {
    const page = (await (await visitor("/api/site")).json()) as any;
    const url = page.images["hero.image"][0].url as string;
    expect(url).toStartWith("/api/site/images/");

    const full = await visitor(url);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("image/jpeg");
    expect(full.headers.get("cache-control")).toContain("immutable");
    const fullBytes = (await full.arrayBuffer()).byteLength;

    const thumb = await visitor(`${url}?thumb=480x0`);
    expect(thumb.status).toBe(200);
    expect((await thumb.arrayBuffer()).byteLength).toBeLessThan(fullBytes);

    // Nothing outside the website's own pictures can be reached through it.
    expect((await visitor("/api/site/images/sim_hero/..%2F..%2Fusers")).status).toBe(404);
    expect((await visitor("/api/site/images/NOPE/x.jpg")).status).toBe(404);
  });

  signedIn("the contact form files a request a visitor cannot read back", async () => {
    const sent = await visitor("/api/site/contact", { method: "POST", body: JSON.stringify(enquiry) }, "203.0.113.2");
    expect(sent.status).toBe(201);

    expect((await visitor("/api/site/requests")).status).toBe(401);
    expect((await api("/api/site/requests", { cookie: bobCookie })).status).toBe(403);

    const inbox = (await json("/api/site/requests")) as any[];
    const mine = inbox.find(request => request.email === "pat@example.com");
    expect(mine).toMatchObject({ firstName: "Pat", area: "Kitchen", status: "new" });

    const replied = await put(`/api/site/requests/${mine.id}`, { status: "replied" });
    expect(replied.status).toBe("replied");
  });

  signedIn("the form says what to fix, and a bot is thanked and forgotten", async () => {
    const bad = await visitor(
      "/api/site/contact",
      { method: "POST", body: JSON.stringify({ ...enquiry, email: "not an address" }) },
      "203.0.113.3",
    );
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/valid email/);

    const bot = await visitor(
      "/api/site/contact",
      { method: "POST", body: JSON.stringify({ ...enquiry, email: "bot@example.com", website: "http://spam.example" }) },
      "203.0.113.3",
    );
    expect(bot.status).toBe(201);
    const inbox = (await json("/api/site/requests")) as any[];
    expect(inbox.some(request => request.email === "bot@example.com")).toBe(false);
  });

  signedIn("one sender filling the inbox is slowed down", async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await visitor(
        "/api/site/contact",
        { method: "POST", body: JSON.stringify({ ...enquiry, email: `flood${attempt}@example.com` }) },
        "198.51.100.9",
      );
      statuses.push(response.status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
  });

  signedIn("the first account edits it; nobody else does", async () => {
    expect(((await json("/api/auth/me")) as any).user.siteEditor).toBe(true);
    expect(((await json("/api/auth/me", { cookie: bobCookie })) as any).user.siteEditor).toBe(false);

    const refused = await api("/api/site/texts", { method: "POST", body: JSON.stringify({ name: "x" }), cookie: bobCookie });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toMatch(/website editor/);

    const slotRefused = await api("/api/site/slots/hero.text", {
      method: "PUT",
      body: JSON.stringify({ ids: [] }),
      cookie: bobCookie,
    });
    expect(slotRefused.status).toBe(403);
  });

  signedIn("changing which words go where is an edit to the layout, not the words", async () => {
    const headline = await post("/api/site/texts", { title: "Kitchens done right", body: "Since 1984." });
    expect(headline.name).toBe("Kitchens done right");

    const before = (await json("/api/site/content")) as any;
    const originalHero = before.placements.find((p: any) => p.slot === "hero.text").textId;

    const placed = await put("/api/site/slots/hero.text", { ids: [headline.id] });
    expect(placed).toHaveLength(1);
    let page = (await (await visitor("/api/site")).json()) as any;
    expect(page.texts["hero.text"][0].title).toBe("Kitchens done right");

    // The old headline still exists — it is simply not placed.
    const after = (await json("/api/site/content")) as any;
    expect(after.texts.some((t: any) => t.id === originalHero)).toBe(true);

    // Reorder a list slot.
    const services = before.placements
      .filter((p: any) => p.slot === "services.list")
      .sort((a: any, b: any) => a.position - b.position)
      .map((p: any) => p.textId);
    await put("/api/site/slots/services.list", { ids: [...services].reverse() });
    page = (await (await visitor("/api/site")).json()) as any;
    expect(page.texts["services.list"][0].title).toBe("Handyman Services");

    // Deleting a text takes it off the page.
    expect((await api(`/api/site/texts/${headline.id}`, { method: "DELETE" })).status).toBe(200);
    page = (await (await visitor("/api/site")).json()) as any;
    expect(page.texts["hero.text"]).toBeUndefined();

    // Put things back as they were.
    await put("/api/site/slots/hero.text", { ids: [originalHero] });
    await put("/api/site/slots/services.list", { ids: services });
  });

  signedIn("a slot refuses what it cannot hold", async () => {
    expect((await api("/api/site/slots/hero.nope", { method: "PUT", body: JSON.stringify({ ids: [] }) })).status).toBe(400);
    expect(
      (await api("/api/site/slots/hero.image", { method: "PUT", body: JSON.stringify({ ids: ["sim_hero", "sim_about"] }) }))
        .status,
    ).toBe(400);
    // A text id in an image slot names nothing in site_images.
    expect(
      (await api("/api/site/slots/hero.image", { method: "PUT", body: JSON.stringify({ ids: ["stx_hero"] }) })).status,
    ).toBe(400);
  });

  signedIn("pictures are uploaded as files, and an SVG is refused", async () => {
    const png = await Bun.file(new URL("../../docker/pb_migrations/website/logo-roof.png", import.meta.url)).arrayBuffer();

    const form = new FormData();
    form.set("file", new File([png], "roof.png", { type: "image/png" }));
    form.set("alt", "A roofline");
    const uploaded = await fetch(`${BASE}/api/site/images`, { method: "POST", body: form, headers: { cookie } });
    expect(uploaded.status).toBe(201);
    const image = (await uploaded.json()) as any;
    expect(image).toMatchObject({ name: "roof", alt: "A roofline" });
    expect((await visitor(image.url)).status).toBe(200);

    const renamed = await put(`/api/site/images/${image.id}`, { name: "Roof, again", alt: "" });
    expect(renamed.name).toBe("Roof, again");
    expect(renamed.url).toBe(image.url);

    const svg = new FormData();
    svg.set("file", new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "x.svg", { type: "image/svg+xml" }));
    const refused = await fetch(`${BASE}/api/site/images`, { method: "POST", body: svg, headers: { cookie } });
    expect(refused.status).toBe(400);

    expect((await api(`/api/site/images/${image.id}`, { method: "DELETE" })).status).toBe(200);
  });
});

/* --------------------------------- booking -------------------------------- */

describe("booking a visit", () => {
  const visitor = (path: string, init: RequestInit = {}, from = "203.0.113.30") =>
    fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), "X-Forwarded-For": from },
    });

  const visit = { firstName: "Ada", lastName: "Visitor", email: "ada@example.com", phone: "555-0101", address: "1 Elm St" };

  const book = (start: string, from: string, extra: Record<string, unknown> = {}) =>
    visitor("/api/site/booking", { method: "POST", body: JSON.stringify({ ...visit, start, ...extra }) }, from);

  const calendar = async () => (await (await visitor("/api/site/booking")).json()) as any;
  const offered = (page: any): string[] => page.days.flatMap((day: any) => day.slots.map((slot: any) => slot.start));

  /** Every day, eight to six, on UTC, so the test does not care what time it runs. */
  const OPEN = {
    enabled: true,
    timezone: "UTC",
    noticeHours: 0,
    durationMinutes: 60,
    bufferMinutes: 30,
    horizonDays: 14,
    hours: Array.from({ length: 7 }, () => ({ open: true, start: "08:00", end: "18:00" })),
  };

  signedIn("is switched off on a fresh instance, and offers nothing", async () => {
    const page = await calendar();
    expect(page.settings.enabled).toBe(false);
    expect(page.days).toEqual([]);
    const refused = await book(new Date(Date.now() + 3 * 86_400_000).toISOString(), "203.0.113.31");
    expect(refused.status).toBe(409);
  });

  signedIn("only an editor sets the hours, and a wrong zone is refused", async () => {
    expect((await api("/api/site/booking/settings", { method: "PUT", body: JSON.stringify(OPEN), cookie: bobCookie })).status).toBe(403);
    const bad = await api("/api/site/booking/settings", { method: "PUT", body: JSON.stringify({ ...OPEN, timezone: "Mars/Olympus" }) });
    expect(bad.status).toBe(400);

    const saved = await put("/api/site/booking/settings", OPEN);
    expect(saved).toMatchObject({ enabled: true, timezone: "UTC", bufferMinutes: 30 });
    expect(saved.hours).toHaveLength(7);
    expect((await calendar()).days.length).toBeGreaterThan(10);
  });

  signedIn("a visitor books a free slot, and it is gone from the calendar without saying who took it", async () => {
    const before = await calendar();
    const slot = before.days.at(-1).slots[0];

    const booked = await book(slot.start, "203.0.113.32");
    expect(booked.status).toBe(201);
    expect(await booked.json()).toMatchObject({ start: slot.start, end: slot.end });

    const after = await calendar();
    expect(offered(after)).not.toContain(slot.start);
    expect(JSON.stringify(after)).not.toContain("ada@example.com");

    const again = await book(slot.start, "203.0.113.33");
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toMatch(/just booked/);
  });

  signedIn("two visitors racing for one slot get one booking between them", async () => {
    const slot = (await calendar()).days.at(-2).slots[3];
    const statuses = await Promise.all(
      [40, 41, 42, 43, 44].map(n => book(slot.start, `203.0.113.${n}`, { email: `racer${n}@example.com` }).then(r => r.status)),
    );
    expect(statuses.sort()).toEqual([201, 409, 409, 409, 409]);
  });

  signedIn("a time the calendar does not offer is refused with a sentence", async () => {
    const day = (await calendar()).days.at(-3);
    const offGrid = new Date(Date.parse(day.slots[0].start) + 15 * 60_000).toISOString();
    const refused = await book(offGrid, "203.0.113.50");
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toMatch(/not one we can offer/);

    const incomplete = await book(day.slots[0].start, "203.0.113.50", { phone: "" });
    expect(incomplete.status).toBe(400);
  });

  signedIn("a bot is shown a booking and nothing is kept", async () => {
    const slot = (await calendar()).days.at(-4).slots[0];
    const bot = await book(slot.start, "203.0.113.51", { website: "http://spam.example", email: "bot@example.com" });
    expect(bot.status).toBe(201);
    expect(offered(await calendar())).toContain(slot.start);
  });

  signedIn("only an editor reads who booked, and cancelling frees the slot", async () => {
    expect((await visitor("/api/site/appointments")).status).toBe(401);
    expect((await api("/api/site/appointments", { cookie: bobCookie })).status).toBe(403);

    const appointments = (await json("/api/site/appointments")) as any[];
    const ada = appointments.find(entry => entry.email === "ada@example.com");
    expect(ada).toMatchObject({ firstName: "Ada", phone: "555-0101", address: "1 Elm St", state: "booked" });
    expect(appointments.some(entry => entry.email === "bot@example.com")).toBe(false);

    const cancelled = await put(`/api/site/appointments/${ada.id}`, { state: "cancelled" });
    expect(cancelled.state).toBe("cancelled");
    expect(offered(await calendar())).toContain(ada.start);

    expect((await api(`/api/site/appointments/${ada.id}`, { method: "PUT", body: JSON.stringify({ state: "lost" }) })).status).toBe(400);
  });

  signedIn("PocketBase itself lets nobody around the booking hook", async () => {
    // Straight at the records API, anonymously and as an editor: no create rule at all.
    const direct = await fetch(`${pocketbase.url}/api/collections/appointments/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...visit, start: "2030-01-01 10:00:00.000Z", end: "2030-01-01 11:00:00.000Z" }),
    });
    expect(direct.status).toBeGreaterThanOrEqual(400);
    expect((await fetch(`${pocketbase.url}/api/collections/appointments/records`)).status).toBe(200);
    const list = (await (await fetch(`${pocketbase.url}/api/collections/appointments/records`)).json()) as any;
    expect(list.items).toEqual([]);

    // The busy times are bare intervals.
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const busy = (await (await fetch(`${pocketbase.url}/api/build/booking/busy?from=${from}&to=${to}`)).json()) as any;
    expect(busy.busy.length).toBeGreaterThan(0);
    for (const entry of busy.busy) expect(Object.keys(entry).sort()).toEqual(["end", "start"]);
  });

  signedIn("switching it off again empties the calendar", async () => {
    await put("/api/site/booking/settings", { ...OPEN, enabled: false });
    expect((await calendar()).days).toEqual([]);
  });
});
