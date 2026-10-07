import { describe, expect, test } from "bun:test";
import {
  asUnit,
  coverageQuantity,
  orderQuantityFor,
  orderWeight,
  roundUpToMultiple,
  unitLabel,
  wastePercentFor,
} from "./units";
import { EMPTY_MATERIAL } from "./types";

const material = (overrides: Partial<typeof EMPTY_MATERIAL> = {}) => ({ ...EMPTY_MATERIAL, ...overrides });

describe("units", () => {
  test("an unrecognised unit falls back rather than being stored", () => {
    expect(asUnit("SF")).toBe("SF");
    expect(asUnit("sf")).toBe("SF");
    expect(asUnit(" lf ")).toBe("LF");
    expect(asUnit("furlongs")).toBe("EA");
    expect(asUnit(undefined)).toBe("EA");
  });

  test("a code with no label is shown as itself rather than hidden", () => {
    expect(unitLabel("CY")).toBe("Cubic yard");
    expect(unitLabel("WIDGETS")).toBe("WIDGETS");
  });
});

describe("purchase multiples", () => {
  test("a quantity rounds up to the lot, never to nearest", () => {
    expect(roundUpToMultiple(4.2, 1)).toBe(4.2); // 1 is "sold singly", not "whole numbers"
    expect(roundUpToMultiple(4.2, 0.25)).toBe(4.25);
    expect(roundUpToMultiple(4.3, 0.25)).toBe(4.5);
    expect(roundUpToMultiple(41, 12)).toBe(48);
  });

  test("no multiple leaves the quantity alone", () => {
    expect(roundUpToMultiple(4.2, 0)).toBe(4.2);
    expect(roundUpToMultiple(4.2, -3)).toBe(4.2);
  });

  test("an exact multiple does not buy one extra lot", () => {
    // 2400 SF of roof at 33.3 SF a bundle is 72.07 bundles in exact
    // arithmetic and 72.00000000000001 in floating point. The difference is a
    // whole bundle on the delivery ticket.
    expect(roundUpToMultiple(48, 12)).toBe(48);
    expect(roundUpToMultiple(0.1 + 0.2, 0.1)).toBe(0.3);
  });
});

describe("waste factors", () => {
  test("a line override beats the material's own", () => {
    expect(wastePercentFor({ wasteFactorPercent: 10 }, 20)).toBe(20);
    expect(wastePercentFor({ wasteFactorPercent: 10 }, null)).toBe(10);
  });

  test("an override of zero is a real answer, not an absent one", () => {
    // "This job wastes nothing" and "use the material's factor" are different
    // instructions, and 0 must mean the first.
    expect(wastePercentFor({ wasteFactorPercent: 15 }, 0)).toBe(0);
  });

  test("nonsense is treated as no allowance", () => {
    expect(wastePercentFor({ wasteFactorPercent: -5 }, null)).toBe(0);
    expect(wastePercentFor(null, null)).toBe(0);
    expect(wastePercentFor({ wasteFactorPercent: 500 }, null)).toBe(100);
  });
});

describe("order quantities", () => {
  test("no waste and no multiple orders exactly the take-off", () => {
    const result = orderQuantityFor(100, { wasteFactorPercent: 0, purchaseMultiple: 0 }, null);
    expect(result).toEqual({ takeoff: 100, wastePercent: 0, order: 100, waste: 0 });
  });

  test("waste is added to the take-off", () => {
    const result = orderQuantityFor(200, { wasteFactorPercent: 15, purchaseMultiple: 0 }, null);
    expect(result.order).toBe(230);
    expect(result.waste).toBe(30);
  });

  test("waste is applied before the lot rounding, not after", () => {
    // 40 sheets at 5% is 42, which rounds up to 48 on a lot of 12. Rounding
    // first would give 48 and then take 5% of a number already rounded up,
    // compounding one adjustment into the other.
    const result = orderQuantityFor(40, { wasteFactorPercent: 5, purchaseMultiple: 12 }, null);
    expect(result.order).toBe(48);
  });

  test("a quarter-yard plant minimum rounds a concrete pour up", () => {
    const result = orderQuantityFor(12.3, { wasteFactorPercent: 5, purchaseMultiple: 0.25 }, null);
    // 12.3 + 5% = 12.915, and the plant batches quarters.
    expect(result.order).toBe(13);
    expect(result.wastePercent).toBe(5);
  });

  test("the take-off is never rewritten by the calculation", () => {
    // The bug this guards is a re-save applying the waste factor a second
    // time, which grows a quantity by 10% every time somebody opens the
    // estimate and does it quietly.
    const once = orderQuantityFor(100, { wasteFactorPercent: 10, purchaseMultiple: 0 }, null);
    const twice = orderQuantityFor(once.takeoff, { wasteFactorPercent: 10, purchaseMultiple: 0 }, null);
    expect(once.order).toBe(110);
    expect(twice.order).toBe(110);
  });

  test("a missing product orders what the take-off says", () => {
    expect(orderQuantityFor(9, null, null).order).toBe(9);
  });

  test("a negative take-off is nothing, not a credit", () => {
    expect(orderQuantityFor(-4, { wasteFactorPercent: 10, purchaseMultiple: 0 }, null).order).toBe(0);
  });
});

describe("coverage", () => {
  test("a measured area becomes a count of what covers it", () => {
    const shingles = material({ coverage: 33.33, coverageUnit: "SF" });
    expect(coverageQuantity(shingles, 2400, "SF")).toBe(72.0072);
  });

  test("a material that covers nothing cannot answer", () => {
    // Null, not zero: an estimator shown "0 bundles" would believe it.
    expect(coverageQuantity(material(), 2400, "SF")).toBeNull();
  });

  test("a mismatched unit cannot answer either", () => {
    const shingles = material({ coverage: 33.33, coverageUnit: "SF" });
    expect(coverageQuantity(shingles, 2400, "LF")).toBeNull();
  });
});

describe("weight", () => {
  test("an order's weight is what it takes to lift it", () => {
    expect(orderWeight(material({ weightPerUnit: 96 }), 180)).toBe(17_280);
  });

  test("an unrecorded weight is unknown, not weightless", () => {
    expect(orderWeight(material(), 180)).toBeNull();
  });
});
