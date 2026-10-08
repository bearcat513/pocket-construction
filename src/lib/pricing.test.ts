/**
 * The pricing engine is the part of this app that is allowed to be wrong in
 * the most expensive way, so the tests below are written as the questions a
 * finance team would ask: does the total equal the lines, does markup price
 * only what has no price, does overhead land where the estimate says it does.
 */
import { describe, expect, test } from "bun:test";
import { expandBundle, priceQuote, sellPrice, tierFor, type PricingContext, type QuoteHeader } from "./pricing";
import type { Product, QuoteLineInput } from "./types";
import { EMPTY_MATERIAL } from "./types";

/* -------------------------------- fixtures ------------------------------- */

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "prd_platform",
  sku: "PLAT",
  name: "Platform",
  description: "",
  family: "Framing",
  unitOfMeasure: "EA",
  listPrice: 100,
  cost: 30,
  active: true,
  optionGroups: [],
  rules: [],
  components: [],
  volumeTiers: [],
  costType: "material",
  wasteFactorPercent: 0,
  purchaseMultiple: 0,
  material: { ...EMPTY_MATERIAL },
  ownerId: "u1",
  createdAt: "",
  updatedAt: "",
  ...overrides,
});

const line = (overrides: Partial<QuoteLineInput> = {}): QuoteLineInput => ({
  id: "ln_1",
  productId: "prd_platform",
  quantity: 10,
  discountPercent: 0,
  unitPriceOverride: null,
  wastePercentOverride: null,
  selectedOptions: [],
  description: "",
  parentId: null,
  sortOrder: 0,
  ...overrides,
});

const header = (overrides: Partial<QuoteHeader> = {}): QuoteHeader => ({
  currency: "USD",
  markupPercent: 0,
  overheadPercent: 0,
  discountPercent: 0,
  taxPercent: 0,
  shipping: 0,
  ...overrides,
});

const context = (products: Product[]): PricingContext => ({
  products: new Map(products.map(entry => [entry.id, entry])),
});

/* --------------------------------- basics -------------------------------- */

describe("a line's price", () => {
  test("list price times the quantity", () => {
    const priced = priceQuote([line()], header(), context([product()]));
    const only = priced.lines[0]!;

    expect(only.unitPrice).toBe(100);
    expect(only.netTotal).toBe(1_000);
    expect(only.pricedFromCost).toBe(false);
  });

  test("margin comes off cost, not off list", () => {
    const priced = priceQuote([line({ discountPercent: 25 })], header(), context([product()]));
    const only = priced.lines[0]!;

    expect(only.netTotal).toBe(750); // 75 × 10
    expect(only.costTotal).toBe(300); // 30 × 10
    expect(only.margin).toBe(450);
    expect(only.marginPercent).toBe(60);
  });
});

/* -------------------------------- markup --------------------------------- */

describe("markup", () => {
  test("an item with no list price sells at cost plus the quote's markup", () => {
    const lumber = product({ listPrice: 0, cost: 40 });
    const priced = priceQuote([line()], header({ markupPercent: 25 }), context([lumber]));
    const only = priced.lines[0]!;

    expect(only.listUnitPrice).toBe(50);
    expect(only.pricedFromCost).toBe(true);
    expect(only.netTotal).toBe(500);
    expect(only.margin).toBe(100);
  });

  test("an item somebody priced by hand keeps its price, whatever the markup", () => {
    const priced = priceQuote([line()], header({ markupPercent: 25 }), context([product()]));
    expect(priced.lines[0]!.listUnitPrice).toBe(100);
  });

  test("a markup is never negative and never absurd", () => {
    expect(sellPrice({ listPrice: 0, cost: 10 }, -50, "USD").price).toBe(10);
    expect(sellPrice({ listPrice: 0, cost: 10 }, 50_000, "USD").price).toBe(110);
  });

  test("an item with neither a price nor a cost says so", () => {
    const free = product({ listPrice: 0, cost: 0 });
    const priced = priceQuote([line()], header({ markupPercent: 20 }), context([free]));
    expect(priced.warnings[0]).toContain("no list price and no cost");
  });
});

/* -------------------------------- options -------------------------------- */

describe("configured options", () => {
  const configurable = product({
    optionGroups: [
      {
        id: "g1",
        key: "tier",
        name: "Tier",
        select: "one",
        required: true,
        options: [
          { id: "o1", key: "std", name: "Standard", priceDelta: 0, default: true },
          { id: "o2", key: "prem", name: "Premium", priceDelta: 0, priceFactor: 1.4 },
        ],
      },
      {
        id: "g2",
        key: "addons",
        name: "Add-ons",
        select: "many",
        required: false,
        options: [{ id: "o3", key: "sso", name: "SSO", priceDelta: 15 }],
      },
    ],
  });

  test("a factor scales the list price and a delta is added after it", () => {
    const priced = priceQuote(
      [line({ selectedOptions: ["prem", "sso"], quantity: 1 })],
      header(),
      context([configurable]),
    );
    const only = priced.lines[0]!;

    // 100 × 1.4 = 140, then +15 — not (100 + 15) × 1.4.
    expect(only.optionsUnitDelta).toBe(55);
    expect(only.unitPrice).toBe(155);
    expect(only.optionNames).toEqual(["Premium", "SSO"]);
  });

  test("the list baseline includes the options, so a discount is never negative", () => {
    // The bug this guards: with the baseline taken before options, a line
    // whose options add value reads as a *markup* — the quote's list total
    // lands below its own subtotal and "% off list" comes out negative.
    const priced = priceQuote(
      [line({ selectedOptions: ["prem", "sso"], quantity: 10, discountPercent: 20 })],
      header(),
      context([configurable]),
    );
    const only = priced.lines[0]!;

    // 100 × 1.4 + 15 = 155 at list, 124 after the 20% discount.
    expect(only.listUnitPrice).toBe(100);
    expect(only.listTotal).toBe(1_550);
    expect(only.unitPrice).toBe(124);
    expect(only.netTotal).toBe(1_240);
    expect(only.effectiveDiscountPercent).toBe(20);

    expect(priced.totals.listTotal).toBeGreaterThanOrEqual(priced.totals.subtotal);
    expect(priced.totals.effectiveDiscountPercent).toBe(20);
  });

  test("an invalid configuration prices, and says what is wrong", () => {
    const priced = priceQuote([line({ selectedOptions: [] })], header(), context([configurable]));

    expect(priced.lines[0]!.issues).toEqual(["Choose an option for “Tier”."]);
    expect(priced.issues.length).toBe(1);
    // It still produces a number: a rep needs to see the consequence of the
    // thing they have half-finished.
    expect(priced.lines[0]!.netTotal).toBe(1_000);
  });
});

/* -------------------------------- tiers ---------------------------------- */

describe("volume tiers", () => {
  const tiered = product({
    volumeTiers: [
      { minQuantity: 1, maxQuantity: 99, kind: "percent", value: 0 },
      { minQuantity: 100, maxQuantity: 499, kind: "percent", value: 10 },
      { minQuantity: 500, maxQuantity: null, kind: "override", value: 75 },
    ],
  });

  test("the band a quantity lands in sets the whole line's price", () => {
    const mid = priceQuote([line({ quantity: 200 })], header(), context([tiered]));
    expect(mid.lines[0]!.unitPrice).toBe(90);
    expect(mid.lines[0]!.netTotal).toBe(18_000);

    const top = priceQuote([line({ quantity: 500 })], header(), context([tiered]));
    expect(top.lines[0]!.unitPrice).toBe(75);
    expect(top.lines[0]!.tier?.kind).toBe("override");
  });

  test("tierFor treats a null upper bound as 'and above'", () => {
    expect(tierFor(tiered.volumeTiers, 10_000)?.value).toBe(75);
    expect(tierFor([], 10)).toBeNull();
  });
});

/* -------------------------------- totals --------------------------------- */

describe("waste factors", () => {
  test("a line is priced on what has to be bought, not on what was measured", () => {
    const drywall = product({ id: "prd_dry", sku: "DRY", listPrice: 20, cost: 15, wasteFactorPercent: 15 });
    const priced = priceQuote(
      [line({ productId: "prd_dry", quantity: 100 })],
      header(),
      context([drywall]),
    );

    const result = priced.lines[0]!;
    expect(result.quantity).toBe(100);
    expect(result.orderQuantity).toBe(115);
    expect(result.wasteQuantity).toBe(15);
    expect(result.netTotal).toBe(2_300);
  });

  test("the take-off survives a re-price, so waste is never compounded", () => {
    const drywall = product({ id: "prd_dry", sku: "DRY", listPrice: 20, cost: 15, wasteFactorPercent: 15 });
    const first = priceQuote([line({ productId: "prd_dry", quantity: 100 })], header(), context([drywall]));
    const second = priceQuote(first.lines, header(), context([drywall]));

    expect(second.lines[0]!.quantity).toBe(100);
    expect(second.lines[0]!.orderQuantity).toBe(115);
    expect(second.totals.netTotal).toBe(first.totals.netTotal);
  });

  test("a line override beats the material's factor, and zero means zero", () => {
    const drywall = product({ id: "prd_dry", sku: "DRY", listPrice: 20, cost: 15, wasteFactorPercent: 15 });
    const none = priceQuote(
      [line({ productId: "prd_dry", quantity: 100, wastePercentOverride: 0 })],
      header(),
      context([drywall]),
    );

    expect(none.lines[0]!.orderQuantity).toBe(100);
    expect(none.lines[0]!.netTotal).toBe(2_000);
  });

  test("a purchase multiple rounds the order up to a whole lot", () => {
    const concrete = product({
      id: "prd_conc",
      sku: "CONC",
      listPrice: 168,
      cost: 142,
      wasteFactorPercent: 5,
      purchaseMultiple: 0.25,
    });
    const priced = priceQuote(
      [line({ productId: "prd_conc", quantity: 12.3 })],
      header(),
      context([concrete]),
    );

    // 12.3 + 5% is 12.915, and the plant batches quarter yards.
    expect(priced.lines[0]!.orderQuantity).toBe(13);
    expect(priced.lines[0]!.netTotal).toBe(2_184);
  });

  test("a volume tier is matched on what is ordered, not on what was measured", () => {
    const studs = product({
      id: "prd_stud",
      sku: "STUD",
      listPrice: 4,
      cost: 3,
      wasteFactorPercent: 8,
      volumeTiers: [
        { minQuantity: 0, maxQuantity: 293, kind: "percent", value: 0 },
        { minQuantity: 294, maxQuantity: null, kind: "percent", value: 10 },
      ],
    });
    // 280 measured is 302.4 ordered, which is a banded unit and gets the break.
    const priced = priceQuote(
      [line({ productId: "prd_stud", quantity: 280 })],
      header(),
      context([studs]),
    );

    expect(priced.lines[0]!.orderQuantity).toBe(302.4);
    expect(priced.lines[0]!.tier?.value).toBe(10);
    expect(priced.lines[0]!.unitPrice).toBe(3.6);
  });
});

describe("quote totals", () => {
  test("the total is the lines added up, and tax comes last", () => {
    const setup = product({ id: "prd_setup", sku: "SETUP", listPrice: 2_500, cost: 500 });
    const priced = priceQuote(
      [line({ quantity: 10 }), line({ id: "ln_2", productId: "prd_setup", quantity: 1, sortOrder: 1 })],
      header({ discountPercent: 10, taxPercent: 8.25, shipping: 100 }),
      context([product(), setup]),
    );

    const totals = priced.totals;
    expect(totals.subtotal).toBe(3_500); // 1,000 + 2,500
    expect(totals.quoteDiscountAmount).toBe(350);
    expect(totals.netTotal).toBe(3_150);
    expect(totals.taxAmount).toBe(268.13); // 8.25% of 3,250, half up
    expect(totals.grandTotal).toBe(3_518.13);
  });

  test("overhead is charged on the discounted subtotal, and taxed with it", () => {
    const priced = priceQuote(
      [line({ quantity: 10 })],
      header({ discountPercent: 10, overheadPercent: 10, taxPercent: 10 }),
      context([product()]),
    );

    const totals = priced.totals;
    expect(totals.subtotal).toBe(1_000);
    expect(totals.quoteDiscountAmount).toBe(100);
    expect(totals.overheadAmount).toBe(90); // 10% of 900, not of 1,000
    expect(totals.netTotal).toBe(990);
    expect(totals.taxAmount).toBe(99);
    expect(totals.grandTotal).toBe(1_089);
    // A charge is not a negative discount.
    expect(totals.effectiveDiscountPercent).toBe(10);
    expect(totals.margin).toBe(690);
  });

  test("the effective discount counts the lines and the quote discount", () => {
    const priced = priceQuote(
      [line({ quantity: 10, discountPercent: 20 })],
      header({ discountPercent: 10 }),
      context([product()]),
    );

    expect(priced.totals.listTotal).toBe(1_000);
    expect(priced.totals.netTotal).toBe(720); // 20% then 10%
    expect(priced.totals.effectiveDiscountPercent).toBe(28);
  });

  test("an empty quote totals to zero rather than to NaN", () => {
    const priced = priceQuote([], header({ taxPercent: 20 }), context([product()]));
    expect(priced.totals.grandTotal).toBe(0);
    expect(priced.totals.marginPercent).toBe(0);
    expect(priced.totals.effectiveDiscountPercent).toBe(0);
  });

  test("a deleted product does not take the quote down with it", () => {
    const priced = priceQuote([line({ unitPriceOverride: 42 })], header(), context([]));

    expect(priced.lines[0]!.name).toBe("Unknown item");
    expect(priced.lines[0]!.netTotal).toBe(420);
    expect(priced.issues[0]).toContain("no longer in the catalogue");
  });
});

/* -------------------------------- bundles -------------------------------- */

describe("bundles", () => {
  test("components arrive as their own lines, at their bundle discount", () => {
    const support = product({ id: "prd_support", sku: "SUPPORT", name: "Support", listPrice: 20 });
    const suite = product({
      id: "prd_suite",
      sku: "SUITE",
      components: [{ id: "c1", sku: "SUPPORT", quantity: 1, required: true, discountPercent: 50 }],
    });

    let counter = 0;
    const parent = line({ id: "ln_parent", productId: "prd_suite", quantity: 3 });
    const children = expandBundle(parent, suite, new Map([["SUPPORT", support]]), () => `ln_c${++counter}`);

    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ productId: "prd_support", quantity: 3, discountPercent: 50, parentId: "ln_parent" });

    const priced = priceQuote([parent, ...children], header(), context([suite, support]));
    expect(priced.lines[1]!.netTotal).toBe(30); // 20 × 3 × 50%
    expect(priced.totals.subtotal).toBe(330);
  });

  test("a component whose product is missing is skipped, not faked", () => {
    const suite = product({ id: "prd_suite", components: [{ id: "c1", sku: "GONE", quantity: 1, required: true }] });
    expect(expandBundle(line(), suite, new Map(), () => "x")).toEqual([]);
  });
});

/* -------------------------------- rounding ------------------------------- */

describe("rounding", () => {
  test("the total equals the visible lines, to the cent", () => {
    const odd = product({ listPrice: 33.333, cost: 0 });
    const priced = priceQuote(
      [line({ quantity: 3 }), line({ id: "ln_2", quantity: 3, sortOrder: 1 })],
      header(),
      context([odd]),
    );

    // Each line is 33.33 × 3 = 99.99, and the quote is the two of them.
    expect(priced.lines[0]!.netTotal).toBe(99.99);
    expect(priced.totals.subtotal).toBe(199.98);
  });

});
