import { describe, expect, test } from "bun:test";
import { applyChange, isApplicable, planSync, readFeed, type SyncChange } from "./catalogSync";
import {
  DEFAULT_SYNC_POLICY,
  EMPTY_MAPPING,
  EMPTY_MATERIAL,
  type CatalogSource,
  type Product,
  type SyncField,
  type SyncPolicy,
} from "./types";

/* -------------------------------- fixtures -------------------------------- */

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "prd_1",
  sku: "LBR-STUD-2X4",
  name: "2×4 Stud, 92⅝″",
  description: "Kiln-dried stud.",
  family: "Framing",
  costType: "material",
  chargeType: "one-time",
  billingPeriod: "monthly",
  unitOfMeasure: "EA",
  listPrice: 4.28,
  cost: 3.35,
  currency: "USD",
  active: true,
  minQuantity: 1,
  maxQuantity: 0,
  floorDiscountPercent: 12,
  wasteFactorPercent: 8,
  purchaseMultiple: 0,
  material: { ...EMPTY_MATERIAL, supplierSku: "DF2-2X4-925", supplier: "Harbor Building Supply" },
  provenance: null,
  optionGroups: [],
  rules: [],
  components: [],
  volumeTiers: [],
  attributes: {},
  ownerId: "u1",
  sharedWith: [],
  createdAt: "",
  updatedAt: "",
  ...overrides,
});

const source = (
  policy: Partial<SyncPolicy> = {},
  mapping: Partial<typeof EMPTY_MAPPING> = {},
): Pick<CatalogSource, "id" | "name" | "mapping" | "policy"> => ({
  id: "src_1",
  name: "Harbor weekly price list",
  mapping: {
    ...EMPTY_MAPPING,
    key: "supplier_sku",
    matchOn: "supplierSku",
    sku: "sku",
    name: "description",
    cost: "unit_cost",
    ...mapping,
  },
  policy: { ...DEFAULT_SYNC_POLICY, fields: ["cost"] as SyncField[], ...policy },
});

/* ------------------------------ reading feeds ----------------------------- */

describe("reading a feed", () => {
  test("a CSV price list becomes rows", () => {
    const result = readFeed("supplier_sku,unit_cost\nDF2-2X4-925,3.55", { format: "csv", recordPath: "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toEqual([{ supplier_sku: "DF2-2X4-925", unit_cost: "3.55" }]);
  });

  test("a JSON envelope is walked to its array", () => {
    const body = JSON.stringify({ data: { items: [{ supplier_sku: "DF2-2X4-925", unit_cost: 3.55 }] } });
    const result = readFeed(body, { format: "json", recordPath: "data.items" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Numbers are stringified so one parser reads every feed.
    expect(result.rows[0]).toEqual({ supplier_sku: "DF2-2X4-925", unit_cost: "3.55" });
  });

  test("a payload that is not where it was promised says so", () => {
    const result = readFeed(JSON.stringify({ data: {} }), { format: "json", recordPath: "data.items" });
    expect(result).toEqual({ ok: false, error: 'There is no array at "data.items" in that payload.' });
  });

  test("an empty feed is an error, not an empty plan", () => {
    expect(readFeed("", { format: "csv", recordPath: "" }).ok).toBe(false);
    expect(readFeed("sku,cost\n", { format: "csv", recordPath: "" }).ok).toBe(false);
  });
});

/* -------------------------------- planning -------------------------------- */

describe("planning a sync", () => {
  test("a changed cost is an update, field by field", () => {
    const plan = planSync({
      source: source(),
      rows: [{ supplier_sku: "DF2-2X4-925", unit_cost: "3.55" }],
      products: [product()],
    });

    expect(plan.counts.update).toBe(1);
    const change = plan.changes[0]!;
    expect(change.action).toBe("update");
    expect(change.changes).toEqual([
      { field: "cost", label: "Unit cost", from: "3.35", to: "3.55", changePercent: 5.97 },
    ]);
  });

  test("an unchanged row is reported, not silently dropped", () => {
    const plan = planSync({
      source: source(),
      rows: [{ supplier_sku: "DF2-2X4-925", unit_cost: "3.35" }],
      products: [product()],
    });
    expect(plan.counts.unchanged).toBe(1);
    expect(plan.changes[0]!.changes).toEqual([]);
  });

  test("a field the policy does not name is left alone", () => {
    // The whole point of the policy: a supplier's spreadsheet may carry a
    // name column and still not be allowed to rename your catalogue.
    const plan = planSync({
      source: source({ fields: ["cost"] }, { name: "description" }),
      rows: [{ supplier_sku: "DF2-2X4-925", unit_cost: "3.35", description: "Something else entirely" }],
      products: [product()],
    });
    expect(plan.changes[0]!.action).toBe("unchanged");
  });

  test("a price move past the ceiling is flagged rather than applied", () => {
    const plan = planSync({
      source: source({ fields: ["cost"], maxPriceChangePercent: 25 }),
      rows: [{ supplier_sku: "DF2-2X4-925", unit_cost: "33.50" }],
      products: [product()],
    });

    const change = plan.changes[0]!;
    expect(change.action).toBe("flagged");
    expect(change.changes[0]!.changePercent).toBe(900);
    expect(change.notes[0]).toContain("past the 25%");
    expect(isApplicable("flagged")).toBe(false);
  });

  test("a ceiling of zero turns the guard off deliberately", () => {
    const plan = planSync({
      source: source({ fields: ["cost"], maxPriceChangePercent: 0 }),
      rows: [{ supplier_sku: "DF2-2X4-925", unit_cost: "33.50" }],
      products: [product()],
    });
    expect(plan.changes[0]!.action).toBe("update");
  });

  test("an unmatched row is skipped unless the source may create items", () => {
    const rows = [{ supplier_sku: "NEW-THING", unit_cost: "9.10", sku: "NEW-THING", description: "New thing" }];

    const refused = planSync({ source: source({ createMissing: false }), rows, products: [product()] });
    expect(refused.counts.skip).toBe(1);
    expect(refused.changes[0]!.notes[0]).toContain("may not create items");

    const allowed = planSync({
      source: source({ createMissing: true, fields: ["cost", "name"] }, { name: "description" }),
      rows,
      products: [product()],
    });
    expect(allowed.counts.create).toBe(1);
    expect(allowed.changes[0]!.sku).toBe("NEW-THING");
  });

  test("an item the feed has dropped is deactivated only when asked", () => {
    const kept = planSync({ source: source(), rows: [], products: [product()] });
    expect(kept.counts.deactivate).toBe(0);

    const dropped = planSync({ source: source({ deactivateMissing: true }), rows: [], products: [product()] });
    expect(dropped.counts.deactivate).toBe(1);
    expect(dropped.changes[0]!.notes[0]).toContain("stays on every estimate");
  });

  test("a blank cell never blanks a field that has a value", () => {
    // A supplier leaving a cell empty means "I have nothing to say", not
    // "delete what you know".
    const plan = planSync({
      source: source({ fields: ["manufacturer"] }, { manufacturer: "mfr" }),
      rows: [{ supplier_sku: "DF2-2X4-925", mfr: "" }],
      products: [product({ material: { ...EMPTY_MATERIAL, supplierSku: "DF2-2X4-925", manufacturer: "Cascade Mills" } })],
    });
    expect(plan.changes[0]!.action).toBe("unchanged");
  });

  test("an unreadable price leaves the price alone", () => {
    const plan = planSync({
      source: source(),
      rows: [{ supplier_sku: "DF2-2X4-925", unit_cost: "call for pricing" }],
      products: [product()],
    });
    expect(plan.changes[0]!.action).toBe("unchanged");
  });

  test("keys match past case and stray spaces", () => {
    const plan = planSync({
      source: source(),
      rows: [{ supplier_sku: " df2-2x4-925 ", unit_cost: "3.55" }],
      products: [product()],
    });
    expect(plan.changes[0]!.action).toBe("update");
  });

  test("a duplicated key in the feed uses the first row and says so", () => {
    const plan = planSync({
      source: source(),
      rows: [
        { supplier_sku: "DF2-2X4-925", unit_cost: "3.55" },
        { supplier_sku: "DF2-2X4-925", unit_cost: "9.99" },
      ],
      products: [product()],
    });
    expect(plan.counts.update).toBe(1);
    expect(plan.counts.skip).toBe(1);
    expect(plan.changes.find(entry => entry.action === "update")!.changes[0]!.to).toBe("3.55");
  });

  test("a source with no key column refuses rather than matching nothing", () => {
    const plan = planSync({
      source: source({}, { key: "" }),
      rows: [{ supplier_sku: "DF2-2X4-925" }],
      products: [product()],
    });
    expect(plan.changes).toEqual([]);
    expect(plan.warnings[0]).toContain("no key column");
  });

  test("rows needing a decision sort to the top", () => {
    const plan = planSync({
      source: source({ fields: ["cost"], createMissing: true, maxPriceChangePercent: 20 }, { name: "description" }),
      rows: [
        { supplier_sku: "DF2-2X4-925", unit_cost: "3.40" },
        { supplier_sku: "OSB-716", unit_cost: "99.00", sku: "OSB", description: "Sheathing" },
        { supplier_sku: "GYP-58", unit_cost: "40.00" },
      ],
      products: [product(), product({ id: "prd_2", sku: "GYP", cost: 17.6, material: { ...EMPTY_MATERIAL, supplierSku: "GYP-58" } })],
    });

    expect(plan.changes[0]!.action).toBe("flagged");
  });

  test("a markup turns a cost feed into a priced item", () => {
    const plan = planSync({
      source: source({ fields: ["price"], markupPercent: 20 }),
      rows: [{ supplier_sku: "DF2-2X4-925", unit_cost: "4.00" }],
      products: [product()],
    });
    expect(plan.changes[0]!.changes[0]).toMatchObject({ field: "price", from: "4.28", to: "4.8" });
  });
});

/* -------------------------------- applying -------------------------------- */

describe("applying a change", () => {
  const change = (overrides: Partial<SyncChange> = {}): SyncChange => ({
    action: "update",
    key: "DF2-2X4-925",
    productId: "prd_1",
    sku: "LBR-STUD-2X4",
    name: "2×4 Stud, 92⅝″",
    changes: [{ field: "cost", label: "Unit cost", from: "3.35", to: "3.55" }],
    notes: [],
    ...overrides,
  });

  test("everything the feed does not own survives the sync", () => {
    const existing = product();
    const result = applyChange(change(), existing, { ...source(), policy: source().policy }, "2026-09-20T00:00:00Z");

    expect(result.cost).toBe(3.55);
    // The fields a contractor actually owns.
    expect(result.wasteFactorPercent).toBe(8);
    expect(result.floorDiscountPercent).toBe(12);
    expect(result.listPrice).toBe(4.28);
    expect(result.family).toBe("Framing");
  });

  test("a sync stamps where the number came from", () => {
    const result = applyChange(change(), product(), source(), "2026-09-20T00:00:00Z");
    expect(result.provenance).toEqual({
      sourceId: "src_1",
      sourceName: "Harbor weekly price list",
      sourceKey: "DF2-2X4-925",
      syncedAt: "2026-09-20T00:00:00Z",
      fields: ["cost"],
    });
  });

  test("a created item starts from the policy's defaults", () => {
    const result = applyChange(
      change({
        action: "create",
        productId: null,
        sku: "NEW-THING",
        name: "New thing",
        changes: [{ field: "cost", label: "Unit cost", from: "", to: "9.10" }],
      }),
      null,
      source({ defaultFamily: "Sundries", defaultCostType: "material" }),
      "2026-09-20T00:00:00Z",
    );

    expect(result.sku).toBe("NEW-THING");
    expect(result.family).toBe("Sundries");
    expect(result.cost).toBe(9.1);
    expect(result.listPrice).toBe(0);
    expect(result.active).toBe(true);
  });

  test("a deactivation changes nothing but the flag", () => {
    const result = applyChange(
      change({ action: "deactivate", changes: [{ field: "active", label: "Active", from: "yes", to: "no" }] }),
      product(),
      source(),
      "2026-09-20T00:00:00Z",
    );
    expect(result.active).toBe(false);
    expect(result.cost).toBe(3.35);
  });
});
