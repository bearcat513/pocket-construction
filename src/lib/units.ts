/**
 * Quantities: what a take-off measured, and what that means you have to buy.
 *
 * A construction estimate has two quantities on every line and confusing them
 * is the classic way to come up short. The **take-off quantity** is the
 * finished work — 2,400 square feet of roof, 312 linear feet of top plate.
 * The **order quantity** is what lands on site: the take-off plus an
 * allowance for what gets cut off, broken and thrown away, rounded up to
 * whatever lot the supplier will actually sell.
 *
 * Both live on the line (see `PricedLine` in `./types`), the take-off is what
 * the estimator types, and the order quantity is derived here on every pricing
 * pass. Deriving rather than storing is the important half: a stored order
 * quantity that gets waste applied to it again on the next save grows by 10%
 * every time somebody opens the estimate, and it does it quietly.
 *
 * Nothing in this file converts between units. That sounds like the obvious
 * next feature and it is deliberately absent: square feet become bundles at a
 * rate that is a property of one product (`coverage`), not of the units, and a
 * generic SF→BDL conversion would be wrong for every material except the one
 * it was written against. `coverageQuantity` below does that conversion the
 * only way it can be done correctly — with the material in hand.
 */
import type { MaterialSpec, Product, UnitOfMeasure } from "./types";
import { UNIT_LABELS, UNIT_SET } from "./types";

/** Quantities are counts of things, so four decimals is well past enough. */
const QUANTITY_PRECISION = 4;

/**
 * Rounds a quantity for display and storage.
 *
 * Not currency rounding: a quantity is not money, it has no minor unit, and
 * 0.3333 cubic yards is a real number that must not become 0.33 before it is
 * multiplied by a price.
 */
export const roundQuantity = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** QUANTITY_PRECISION;
  return Math.round(value * factor) / factor;
};

/** Anything not a usable positive quantity becomes zero. */
export const atLeastZeroQuantity = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? roundQuantity(parsed) : 0;
};

/** A unit code, or `EA` for anything this app does not recognise. */
export const asUnit = (value: unknown, fallback: UnitOfMeasure = "EA"): UnitOfMeasure => {
  const code = String(value ?? "").trim().toUpperCase();
  return (UNIT_SET.has(code) ? code : fallback) as UnitOfMeasure;
};

/** "SF" -> "Square foot". An unknown code is shown as itself rather than hidden. */
export const unitLabel = (unit: string): string => UNIT_LABELS[unit as UnitOfMeasure] ?? unit;

/**
 * Rounds a quantity up to a whole multiple of the lot it is sold in.
 *
 * Up, never to nearest: the question this answers is "how much do I have to
 * buy", and a supplier who sells shingles by the bundle will not sell you
 * 4.2 bundles. A multiple of 0 or 1 — the common case — leaves the quantity
 * alone rather than forcing it to a whole number, because plenty of materials
 * are genuinely sold in fractions (concrete by the quarter yard, wire by the
 * foot off a spool).
 */
export function roundUpToMultiple(quantity: number, multiple: number): number {
  const amount = atLeastZeroQuantity(quantity);
  if (!Number.isFinite(multiple) || multiple <= 0 || multiple === 1) return amount;
  if (!amount) return 0;
  // Nudged before ceiling: 2400/33.3 is 72.07 in exact arithmetic and
  // 72.00000000000001 in floating point, and the difference is a whole extra
  // bundle on the delivery ticket.
  const lots = Math.ceil(amount / multiple - 1e-9);
  return roundQuantity(lots * multiple);
}

/** What waste percentage a line uses: its own override, else the material's. */
export function wastePercentFor(
  product: Pick<Product, "wasteFactorPercent"> | null | undefined,
  override: number | null | undefined,
): number {
  const chosen = override === null || override === undefined ? product?.wasteFactorPercent : override;
  const parsed = Number(chosen);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, 100);
}

export type OrderQuantity = {
  /** What the estimator measured. */
  takeoff: number;
  /** The percentage applied. */
  wastePercent: number;
  /** What has to be bought: take-off plus waste, rounded up to the lot. */
  order: number;
  /** `order − takeoff`. The allowance, in the line's own unit. */
  waste: number;
};

/**
 * The take-off quantity turned into an order quantity.
 *
 * Waste first, then the lot rounding, and in that order for a reason: a 5%
 * allowance on 40 sheets is two sheets, and rounding to the lot first would
 * take the allowance on a number that was already rounded up, quietly
 * compounding one adjustment into the other.
 */
export function orderQuantityFor(
  takeoffQuantity: number,
  product: Pick<Product, "wasteFactorPercent" | "purchaseMultiple"> | null | undefined,
  override: number | null | undefined,
): OrderQuantity {
  const takeoff = atLeastZeroQuantity(takeoffQuantity);
  const wastePercent = wastePercentFor(product, override);
  const withWaste = roundQuantity(takeoff * (1 + wastePercent / 100));
  const order = roundUpToMultiple(withWaste, product?.purchaseMultiple ?? 0);
  return { takeoff, wastePercent, order, waste: roundQuantity(order - takeoff) };
}

/**
 * How many stocking units cover a measured area, length or volume.
 *
 * The bridge between a take-off written the way a building is measured (2,400
 * SF of roof) and a catalogue written the way a material is sold (bundles of
 * shingles). It needs the material because the rate is the material's — which
 * is why it takes one, and why there is no free-standing unit conversion
 * anywhere in this file.
 *
 * Returns null when the material declares no coverage, or when it covers a
 * different unit than the one measured. Null means "this cannot be answered",
 * not zero: an estimator shown 0 bundles would believe it.
 */
export function coverageQuantity(
  material: Pick<MaterialSpec, "coverage" | "coverageUnit">,
  measured: number,
  measuredUnit: UnitOfMeasure,
): number | null {
  const rate = Number(material.coverage);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!material.coverageUnit || material.coverageUnit !== measuredUnit) return null;
  const amount = atLeastZeroQuantity(measured);
  if (!amount) return 0;
  return roundQuantity(amount / rate);
}

/**
 * Total weight of an order, in pounds, or null when the material has no
 * recorded weight.
 *
 * Null rather than zero for the same reason as above: "this weighs nothing"
 * and "nobody has recorded what this weighs" are different answers, and only
 * one of them should be allowed to reach a crane schedule.
 */
export function orderWeight(
  material: Pick<MaterialSpec, "weightPerUnit">,
  orderQuantity: number,
): number | null {
  const each = Number(material.weightPerUnit);
  if (!Number.isFinite(each) || each <= 0) return null;
  return roundQuantity(each * atLeastZeroQuantity(orderQuantity));
}
