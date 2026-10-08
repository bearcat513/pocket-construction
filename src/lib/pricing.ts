/**
 * Turning a set of chosen items into a set of numbers.
 *
 * The whole engine is one pure function, `priceQuote`. Give it the lines an
 * estimator entered, the quote's header and the catalogue, and it hands back
 * every line with its price worked out and the quote's totals. It reads
 * nothing, writes nothing and asks nothing — which is what lets the browser
 * run it on every keystroke for live totals while the server runs the same
 * code on save and is the only copy that decides what is stored.
 *
 * ## The pipeline
 *
 * A line's price is built in a fixed order, and every step is kept on the
 * line, because the question an estimate is always asked is "why is it that
 * price":
 *
 *   0. order quantity  the take-off, plus waste, rounded up to the sales lot
 *   1. list price      the item's list price, or its cost plus the markup
 *   2. options         the configured options' factor, then their delta
 *   3. volume tier     the band the order quantity falls into
 *   4. override        a negotiated unit price replaces steps 1-3 outright
 *   5. discount        the estimator's percentage
 *
 * and then the quote: the lines' subtotal, less the quote discount, plus the
 * quote's overhead, plus shipping, plus tax.
 *
 * Step 0 is first because everything after it multiplies by a quantity: what
 * is priced is what has to be bought, not what the tape measure said.
 * `src/lib/units.ts` owns that arithmetic and explains why the two numbers are
 * kept apart. A material with no waste factor and no purchase multiple — which
 * is most labour and every subcontract — orders exactly its take-off, so the
 * step costs nothing where it means nothing.
 *
 * Markup and overhead are the company's two standing numbers, copied onto
 * each quote when it is created (see `Quote.markupPercent`). Markup only ever
 * prices an item that has no list price of its own; an item somebody priced
 * by hand is sold at that price.
 *
 * ## Why the arithmetic is boring on purpose
 *
 * Every step rounds to the quote's currency (see src/lib/money.ts), and every
 * total is the sum of numbers that were already rounded. A quote is checked
 * with a calculator by people who are about to spend money, and a total that
 * is a cent away from its own visible lines costs more to explain than it
 * could ever save.
 */
import { validateConfiguration } from "./configurator";
import { atLeastZero, clampPercent, percentBetween, percentOf, round, sum, type CurrencyCode } from "./money";
import { orderQuantityFor } from "./units";
import {
  type PricedLine,
  type Product,
  type QuoteLineInput,
  type QuoteTotals,
  type UnitOfMeasure,
  type VolumeTier,
} from "./types";

/** The catalogue snapshot a stored line carries, recovered when repricing. */
type LineSnapshot = Pick<PricedLine, "sku" | "name" | "family" | "costType" | "unitOfMeasure">;

/** What `priceQuote` is given per line: the estimator's input, plus any old snapshot. */
export type PriceableLine = QuoteLineInput & Partial<LineSnapshot>;

export type QuoteHeader = {
  currency: CurrencyCode;
  /** Added to cost for an item with no list price, 0-1000. */
  markupPercent: number;
  /** Charged on the discounted subtotal, 0-100. */
  overheadPercent: number;
  /** Whole-quote discount, applied after every line discount. */
  discountPercent: number;
  taxPercent: number;
  shipping: number;
};

export type PricingContext = {
  /** Every product the caller may price with, by id. */
  products: Map<string, Product>;
};

export type PricedQuote = {
  lines: PricedLine[];
  totals: QuoteTotals;
  /** Problems that stop the quote being sent. */
  issues: string[];
  warnings: string[];
};

/** The most a markup may be. Past 1000% it is a typo, not a policy. */
export const MAX_MARKUP_PERCENT = 1000;

/** A markup as a number the engine can use: finite, never negative, capped. */
export const clampMarkup = (value: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(value, 0), MAX_MARKUP_PERCENT) : 0;

/* ------------------------------- helpers --------------------------------- */

/**
 * The tier a quantity falls into.
 *
 * Tiers are not cumulative — the matching band sets the whole line's price,
 * which is how a published price break reads. The last match wins, so an
 * overlapping table degrades to "the most specific band wins" rather than to
 * whichever one happened to be first in the array.
 */
export function tierFor(tiers: VolumeTier[], quantity: number): VolumeTier | null {
  let match: VolumeTier | null = null;
  for (const tier of tiers) {
    const min = Number.isFinite(tier.minQuantity) ? tier.minQuantity : 0;
    const max = tier.maxQuantity === null || tier.maxQuantity === undefined ? Infinity : tier.maxQuantity;
    if (quantity >= min && quantity <= max) match = tier;
  }
  return match;
}

/** A tier applied to a unit price. `override` replaces, the others reduce. */
function applyTier(unitPrice: number, tier: VolumeTier | null, currency: CurrencyCode): number {
  if (!tier) return unitPrice;
  switch (tier.kind) {
    case "percent":
      return round(unitPrice * (1 - clampPercent(tier.value) / 100), currency);
    case "amount":
      return round(unitPrice - tier.value, currency);
    case "override":
      return round(tier.value, currency);
  }
}

/**
 * What one unit of an item sells for before options, tiers and discounts.
 *
 * Its list price when it has one. When it has none, its cost plus the markup —
 * the case a catalogue kept current by a supplier's cost feed is built around.
 */
export function sellPrice(
  product: Pick<Product, "listPrice" | "cost">,
  markupPercent: number,
  currency: CurrencyCode,
): { price: number; fromCost: boolean } {
  if (product.listPrice > 0) return { price: round(product.listPrice, currency), fromCost: false };
  return { price: round(product.cost * (1 + clampMarkup(markupPercent) / 100), currency), fromCost: true };
}

/* ------------------------------ line pricing ----------------------------- */

/** A line whose product is gone: priced at what it says, and flagged. */
function orphanLine(line: PriceableLine, header: QuoteHeader): PricedLine {
  const currency = header.currency;
  const quantity = atLeastZero(line.quantity);
  const unitPrice = round(line.unitPriceOverride ?? 0, currency);
  const netTotal = round(unitPrice * quantity, currency);

  return {
    ...line,
    sku: line.sku ?? "",
    name: line.name ?? "Unknown item",
    family: line.family ?? "",
    costType: line.costType ?? "material",
    unitOfMeasure: (line.unitOfMeasure ?? "EA") as UnitOfMeasure,
    optionNames: [],
    // Nothing is known about the material, so there is no waste to allow for:
    // the line orders exactly what it says it orders.
    orderQuantity: quantity,
    wastePercent: 0,
    wasteQuantity: 0,
    listUnitPrice: unitPrice,
    pricedFromCost: false,
    optionsUnitDelta: 0,
    baseUnitPrice: unitPrice,
    tier: null,
    unitPrice,
    listTotal: netTotal,
    discountAmount: 0,
    netTotal,
    effectiveDiscountPercent: 0,
    unitCost: 0,
    costTotal: 0,
    margin: netTotal,
    marginPercent: netTotal ? 100 : 0,
    issues: [
      line.sku
        ? `${line.sku} is no longer in the catalogue — re-add the line or price it by hand.`
        : "This line's item is no longer in the catalogue.",
    ],
    warnings: [],
  };
}

function priceLine(line: PriceableLine, header: QuoteHeader, context: PricingContext): PricedLine {
  const currency = header.currency;
  const product = context.products.get(line.productId);
  if (!product) return orphanLine(line, header);

  const issues: string[] = [];
  const warnings: string[] = [];

  /* 0 — the take-off, and what it means you have to buy */

  // `quantity` from here down is the *order* quantity, because it is the one
  // every price is multiplied by. The take-off stays on the line untouched —
  // see src/lib/units.ts for why the two must not be collapsed into one.
  const takeoff = orderQuantityFor(line.quantity, product, line.wastePercentOverride);
  const quantity = takeoff.order;

  /* configuration */

  const configuration = validateConfiguration(product, { selectedOptions: line.selectedOptions, quantity: takeoff.takeoff }, currency);
  issues.push(...configuration.errors);
  warnings.push(...configuration.warnings);

  /* 1 — list price */

  const sell = sellPrice(product, header.markupPercent, currency);
  const listUnitPrice = sell.price;
  if (!listUnitPrice && line.unitPriceOverride === null) {
    warnings.push(`${product.sku} has no list price and no cost, so it is priced at nothing.`);
  }

  /* 2 — options */

  // The factor scales the list price; the delta is added afterwards, so a
  // percentage uplift never silently scales a flat add-on.
  const optionsUnitDelta = round(listUnitPrice * (configuration.unitFactor - 1) + configuration.unitDelta, currency);
  const optionedUnitPrice = round(listUnitPrice + optionsUnitDelta, currency);

  /* 3 — volume tier */

  const tier = tierFor(product.volumeTiers, quantity);
  const tieredUnitPrice = applyTier(optionedUnitPrice, tier, currency);

  /* 4 — override */

  const overridden = line.unitPriceOverride !== null && Number.isFinite(line.unitPriceOverride);
  const baseUnitPrice = overridden ? round(line.unitPriceOverride as number, currency) : tieredUnitPrice;

  /* 5 — the discount, and the totals */

  const discountPercent = clampPercent(line.discountPercent);
  const unitPrice = round(baseUnitPrice * (1 - discountPercent / 100), currency);

  // The baseline is the *configured* product at list — options included,
  // tiers and discounts not. Anything else makes "% off list" meaningless the
  // moment an option adds value: a line whose options cost more than the base
  // product would read as a markup rather than as a discount, and the quote's
  // own list total would come out below its subtotal.
  const listTotal = round(optionedUnitPrice * quantity, currency);
  const netTotal = round(unitPrice * quantity, currency);
  const discountAmount = round(listTotal - netTotal, currency);

  const unitCost = round(product.cost, currency);
  const costTotal = round(unitCost * quantity, currency);
  const margin = round(netTotal - costTotal, currency);

  return {
    ...line,
    // The take-off, as entered. Never the order quantity: writing that back
    // would let the next pricing pass allow for waste on a number that already
    // had waste in it.
    quantity: takeoff.takeoff,
    orderQuantity: takeoff.order,
    wastePercent: takeoff.wastePercent,
    wasteQuantity: takeoff.waste,
    sku: product.sku,
    name: product.name,
    family: product.family,
    costType: product.costType,
    unitOfMeasure: product.unitOfMeasure,
    selectedOptions: configuration.selected,
    optionNames: configuration.optionNames,
    listUnitPrice,
    pricedFromCost: sell.fromCost,
    optionsUnitDelta,
    baseUnitPrice,
    tier,
    unitPrice,
    listTotal,
    discountAmount,
    netTotal,
    effectiveDiscountPercent: percentBetween(discountAmount, listTotal),
    unitCost,
    costTotal,
    margin,
    marginPercent: percentBetween(margin, netTotal),
    issues,
    warnings,
  };
}

/* ------------------------------ quote pricing ---------------------------- */

export function priceQuote(lines: PriceableLine[], header: QuoteHeader, context: PricingContext): PricedQuote {
  const currency = header.currency;

  // Component lines follow their parent; everything else keeps its own order.
  const priced = [...lines]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(line => priceLine(line, header, context));

  const listTotal = sum(priced.map(line => line.listTotal), currency);
  const subtotal = sum(priced.map(line => line.netTotal), currency);
  const costTotal = sum(priced.map(line => line.costTotal), currency);

  const quoteDiscountAmount = percentOf(subtotal, clampPercent(header.discountPercent), currency);
  const discounted = round(subtotal - quoteDiscountAmount, currency);
  const overheadAmount = percentOf(discounted, clampPercent(header.overheadPercent), currency);
  const netTotal = round(discounted + overheadAmount, currency);
  const shipping = round(atLeastZero(header.shipping), currency);
  const taxAmount = percentOf(netTotal + shipping, header.taxPercent, currency);
  const grandTotal = round(netTotal + shipping + taxAmount, currency);

  const margin = round(netTotal - costTotal, currency);

  const totals: QuoteTotals = {
    currency,
    lineCount: priced.length,
    listTotal,
    lineDiscountAmount: round(listTotal - subtotal, currency),
    subtotal,
    quoteDiscountAmount,
    overheadAmount,
    netTotal,
    taxAmount,
    shipping,
    grandTotal,
    // Measured on the lines and the quote discount only: overhead is a charge,
    // not a negative discount, and folding it in would make a discounted
    // estimate read as a marked-up one.
    effectiveDiscountPercent: percentBetween(round(listTotal - discounted, currency), listTotal),
    costTotal,
    margin,
    marginPercent: percentBetween(margin, netTotal),
  };

  return {
    lines: priced,
    totals,
    issues: priced.flatMap(line => line.issues),
    warnings: priced.flatMap(line => line.warnings),
  };
}

/** Whether a priced quote is fit to leave the building. */
export const quoteBlockers = (priced: Pick<PricedQuote, "issues">): string[] => priced.issues;

/* ------------------------------- bundles --------------------------------- */

/**
 * The component lines a bundle brings with it.
 *
 * On a construction estimate this is an **assembly**: one catalogue item that
 * stands for a built thing — a framed wall by the linear foot, a bathroom
 * rough-in — and pulls its materials onto the estimate with it.
 *
 * Expansion happens when the line is added rather than at pricing time, so the
 * estimate stores exactly what it prices: an assembly whose contents change
 * next month does not silently rewrite an estimate that was already sent.
 * Components are ordinary lines with a `parentId` — they show on the estimate,
 * and the client sees what they are actually buying.
 */
export function expandBundle(
  parent: QuoteLineInput,
  product: Product,
  bySku: Map<string, Product>,
  nextId: () => string,
): QuoteLineInput[] {
  return product.components
    .map((component, index): QuoteLineInput | null => {
      const child = bySku.get(component.sku);
      if (!child) return null;
      return {
        id: nextId(),
        productId: child.id,
        // A bundle of three each containing two widgets is six widgets.
        quantity: Math.max(1, atLeastZero(component.quantity)) * Math.max(1, atLeastZero(parent.quantity)),
        discountPercent: clampPercent(component.discountPercent ?? 0),
        unitPriceOverride: null,
        // Each component keeps its own material's waste factor. An assembly
        // covering 100 LF of wall needs studs at their waste and sheathing at
        // sheet goods' rather rougher one, and a single number on the parent
        // could only ever be wrong for one of them.
        wastePercentOverride: null,
        selectedOptions: [],
        description: "",
        parentId: parent.id,
        sortOrder: parent.sortOrder + (index + 1) / 100,
      };
    })
    .filter((line): line is QuoteLineInput => line !== null);
}
