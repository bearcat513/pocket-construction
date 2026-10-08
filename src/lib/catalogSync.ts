/**
 * Keeping the catalogue up to date from a supplier's feed.
 *
 * A building-material catalogue goes stale faster than any other part of this
 * app. Lumber moves weekly, a manufacturer discontinues a colour, a supplier
 * renumbers half their line, and an estimate priced off last quarter's
 * catalogue is wrong in a way nobody notices until the invoices come in. So a
 * catalogue wants feeding — and feeding a catalogue automatically is exactly
 * the kind of thing that goes wrong quietly and expensively.
 *
 * This file is the half that decides what *would* change. It is pure: hand it
 * the rows somebody fetched and the catalogue as it stands, and it hands back
 * a **plan** — every item the feed touches, what it would set, what it would
 * leave alone, and what it refuses to do without being asked twice. Nothing
 * here reads a network or writes a record; `src/server/catalogSync.ts` does
 * both, and does nothing else.
 *
 * ## Four rules, and the reason for each
 *
 * **A plan is proposed before it is applied.** The preview and the sync run
 * the same function over the same rows; the preview just stops afterwards.
 * Anything else means the first time you see what a feed does is after it has
 * done it.
 *
 * **A feed owns only the fields it was given.** The policy names them. Waste
 * factors, option groups, assemblies, discount ceilings and — unless you
 * deliberately say otherwise — the sell price are not a supplier's to set.
 * This is why the plan reports changes field by field rather than as "updated".
 *
 * **A large price move is flagged, not applied.** A feed with a misplaced
 * decimal point is not a hypothetical, and `maxPriceChangePercent` is the
 * difference between noticing it in a review screen and noticing it in a
 * margin report. Flagged rows carry both numbers and wait for a person.
 *
 * **Nothing is ever deleted.** An item the feed has stopped carrying can be
 * deactivated, and only if asked; it stays on every estimate that already
 * quoted it. A catalogue is not a mirror of a supplier's stock list.
 */
import { parseBoolean, parseNumber, parseTable, type DelimitedTable } from "./csv";
import { round } from "./money";
import { asUnit, roundQuantity } from "./units";
import {
  CSI_DIVISION_NAMES,
  EMPTY_MATERIAL,
  SYNC_FIELD_LABELS,
  type CatalogSource,
  type CostType,
  type MatchKey,
  type Product,
  type SourceMapping,
  type SyncField,
  type SyncPolicy,
  type UnitOfMeasure,
} from "./types";
import type { ProductInput } from "./validate";

/* ------------------------------ reading rows ------------------------------ */

/** One record from a feed, before anything is decided about it. */
export type SourceRow = Record<string, string>;

export type ReadResult = { ok: true; columns: string[]; rows: SourceRow[] } | { ok: false; error: string };

/** Walks "data.items" into a payload, returning null when the path is not there. */
function atPath(payload: unknown, path: string): unknown {
  if (!path) return payload;
  let current: unknown = payload;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[segment];
  }
  return current ?? null;
}

/**
 * Turns a fetched payload into rows.
 *
 * JSON values are stringified rather than kept as their own types, so that
 * everything downstream reads one shape — a price is parsed from text by the
 * same code whether it arrived as `"4.28"`, `4.28` or `"$4.28"`, and there is
 * one place where that can be wrong.
 */
export function readFeed(body: string, source: Pick<CatalogSource, "format" | "recordPath">): ReadResult {
  if (!body.trim()) return { ok: false, error: "The feed returned nothing." };

  if (source.format === "csv") {
    const table: DelimitedTable = parseTable(body);
    if (!table.columns.length) return { ok: false, error: "That file has no header row." };
    if (!table.rows.length) return { ok: false, error: "That file has a header row and nothing under it." };
    return { ok: true, columns: table.columns, rows: table.rows };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return { ok: false, error: "The feed is not valid JSON." };
  }

  const located = atPath(payload, source.recordPath);
  if (!Array.isArray(located)) {
    return {
      ok: false,
      error: source.recordPath
        ? `There is no array at "${source.recordPath}" in that payload.`
        : "That payload is not an array — name the path to the list of items.",
    };
  }

  const rows: SourceRow[] = [];
  const columns = new Set<string>();
  for (const entry of located) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const row: SourceRow = {};
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (value === null || value === undefined) row[key] = "";
      else if (typeof value === "object") continue; // nested objects are not columns
      else row[key] = String(value);
      columns.add(key);
    }
    rows.push(row);
  }

  if (!rows.length) return { ok: false, error: "That payload's array has no objects in it." };
  return { ok: true, columns: [...columns], rows };
}

/* ----------------------------- the plan itself ---------------------------- */

/**
 * What a sync would do to one catalogue item.
 *
 * `flagged` is the interesting one: the row matched, the feed wants to change
 * a price, and the change is larger than the policy allows unattended. It is
 * reported with both numbers and applied only when a person says so.
 */
export type SyncAction = "create" | "update" | "unchanged" | "flagged" | "deactivate" | "skip";

export const SYNC_ACTIONS: SyncAction[] = ["create", "update", "unchanged", "flagged", "deactivate", "skip"];

export const SYNC_ACTION_LABELS: Record<SyncAction, string> = {
  create: "New",
  update: "Update",
  unchanged: "Unchanged",
  flagged: "Needs review",
  deactivate: "Deactivate",
  skip: "Skipped",
};

/** One field the feed would change, with what it is now and what it would be. */
export type FieldChange = {
  field: SyncField;
  label: string;
  from: string;
  to: string;
  /** Set when the change is a price or cost move, as a percentage. */
  changePercent?: number;
};

export type SyncChange = {
  action: SyncAction;
  /** The feed's own key for the row. */
  key: string;
  /** The catalogue item this matched, when it matched one. */
  productId: string | null;
  sku: string;
  name: string;
  changes: FieldChange[];
  /** Why it was skipped or flagged, in a sentence a person can act on. */
  notes: string[];
};

export type SyncPlan = {
  sourceId: string;
  sourceName: string;
  rowsRead: number;
  changes: SyncChange[];
  counts: Record<SyncAction, number>;
  /** Problems with the feed as a whole, not with any one row. */
  warnings: string[];
};

export const emptyCounts = (): Record<SyncAction, number> => ({
  create: 0,
  update: 0,
  unchanged: 0,
  flagged: 0,
  deactivate: 0,
  skip: 0,
});

/* -------------------------------- matching -------------------------------- */

/** What a catalogue item is matched by, under one match key. */
function productKey(product: Product, matchOn: MatchKey): string {
  const raw =
    matchOn === "sku"
      ? product.sku
      : matchOn === "supplierSku"
        ? product.material.supplierSku
        : product.material.manufacturerPartNumber;
  return raw.trim().toUpperCase();
}

/** Feed keys are matched case- and space-insensitively; suppliers are casual. */
const normalizeKey = (value: string): string => value.trim().toUpperCase();

/* ------------------------------ field reading ----------------------------- */

const text = (row: SourceRow, column: string): string => (column ? (row[column] ?? "").trim() : "");

/** A percentage move between two numbers, or 0 when there is no baseline. */
export function movePercent(from: number, to: number): number {
  if (!Number.isFinite(from) || from === 0) return to === from ? 0 : 100;
  return Math.abs(round(((to - from) / Math.abs(from)) * 100, "USD"));
}

/** Where a synced field reads from on an existing item, as a string. */
function currentValue(product: Product, field: SyncField): string {
  switch (field) {
    case "name":
      return product.name;
    case "description":
      return product.description;
    case "cost":
      return String(product.cost);
    case "price":
      return String(product.listPrice);
    case "unitOfMeasure":
      return product.unitOfMeasure;
    case "family":
      return product.family;
    case "active":
      return product.active ? "yes" : "no";
    case "division":
      return product.material.division;
    case "weightPerUnit":
      return String(product.material.weightPerUnit);
    case "coverage":
      return String(product.material.coverage);
    case "leadTimeDays":
      return String(product.material.leadTimeDays);
    case "coverageUnit":
      return product.material.coverageUnit;
    default:
      return product.material[field as keyof typeof product.material] as string;
  }
}

/**
 * What the feed says a field should be, as a string, or null when the feed
 * does not carry it.
 *
 * Null and empty string are different answers here and the difference matters:
 * a column the feed does not have must leave the field alone, while a column
 * that is present and blank is the supplier saying it has no value.
 */
function feedValue(row: SourceRow, field: SyncField, mapping: SourceMapping, policy: SyncPolicy): string | null {
  const column =
    field === "price" ? mapping.price : field === "cost" ? mapping.cost : (mapping[field as keyof SourceMapping] as string);

  if (field === "price" && !mapping.price) {
    // A feed with a cost column and a markup can still set a price.
    if (!policy.markupPercent || !mapping.cost) return null;
    const cost = parseNumber(row[mapping.cost]);
    if (cost === null) return null;
    return String(round(cost * (1 + policy.markupPercent / 100)));
  }

  if (!column || !(column in row)) return null;
  const raw = (row[column] ?? "").trim();

  switch (field) {
    case "cost":
    case "price": {
      const parsed = parseNumber(raw);
      // An unreadable price is not zero. Leave it alone and say so.
      return parsed === null ? null : String(round(parsed));
    }
    case "weightPerUnit":
    case "coverage": {
      const parsed = parseNumber(raw);
      return parsed === null ? null : String(roundQuantity(Math.max(0, parsed)));
    }
    case "leadTimeDays": {
      const parsed = parseNumber(raw);
      return parsed === null ? null : String(Math.max(0, Math.round(parsed)));
    }
    case "active":
      return parseBoolean(raw, true) ? "yes" : "no";
    case "unitOfMeasure":
      return raw ? asUnit(raw) : null;
    case "coverageUnit":
      return raw ? asUnit(raw) : null;
    case "division": {
      const code = raw.trim().slice(0, 2).padStart(2, "0");
      return CSI_DIVISION_NAMES[code] ? code : null;
    }
    default:
      return raw;
  }
}

/* ------------------------------ planning a run ---------------------------- */

export type PlanInput = {
  source: Pick<CatalogSource, "id" | "name" | "mapping" | "policy">;
  rows: SourceRow[];
  products: Product[];
};

/**
 * Works out what a sync would do, and changes nothing.
 *
 * The plan is ordered the way a person reads it: what needs a decision first,
 * then what is new, then the ordinary updates, then everything that is already
 * right. A run of four hundred rows where three need attention should put
 * those three at the top.
 */
export function planSync({ source, rows, products }: PlanInput): SyncPlan {
  const { mapping, policy } = source;
  const warnings: string[] = [];
  const changes: SyncChange[] = [];

  if (!mapping.key) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      rowsRead: rows.length,
      changes: [],
      counts: emptyCounts(),
      warnings: ["This source has no key column set, so no row can be matched to an item."],
    };
  }

  if (!policy.fields.length) {
    warnings.push("This source is not allowed to write any field, so every matched row will read as unchanged.");
  }

  /* --- index the catalogue by the key this feed matches on --- */

  const byKey = new Map<string, Product>();
  const duplicated = new Set<string>();
  for (const product of products) {
    const key = productKey(product, mapping.matchOn);
    if (!key) continue;
    if (byKey.has(key)) duplicated.add(key);
    else byKey.set(key, product);
  }
  if (duplicated.size) {
    warnings.push(
      `${duplicated.size} catalogue item${duplicated.size === 1 ? "" : "s"} share a ` +
        `${mapping.matchOn === "sku" ? "SKU" : mapping.matchOn === "supplierSku" ? "supplier SKU" : "part number"} ` +
        `with another (${[...duplicated].slice(0, 3).join(", ")}); the first of each was matched.`,
    );
  }

  /* --- walk the feed --- */

  const seen = new Set<string>();
  const seenRowKeys = new Set<string>();

  for (const row of rows) {
    const rawKey = text(row, mapping.key);
    if (!rawKey) {
      changes.push({
        action: "skip",
        key: "",
        productId: null,
        sku: "",
        name: text(row, mapping.name),
        changes: [],
        notes: ["This row has no value in the key column."],
      });
      continue;
    }

    const key = normalizeKey(rawKey);
    if (seenRowKeys.has(key)) {
      changes.push({
        action: "skip",
        key: rawKey,
        productId: null,
        sku: "",
        name: text(row, mapping.name),
        changes: [],
        notes: ["The feed lists this key more than once; only the first row was used."],
      });
      continue;
    }
    seenRowKeys.add(key);

    const existing = byKey.get(key);

    if (!existing) {
      if (!policy.createMissing) {
        changes.push({
          action: "skip",
          key: rawKey,
          productId: null,
          sku: "",
          name: text(row, mapping.name),
          changes: [],
          notes: ["No catalogue item matches this key, and this source may not create items."],
        });
        continue;
      }
      changes.push(plannedCreation(row, rawKey, mapping, policy));
      continue;
    }

    seen.add(key);
    changes.push(plannedUpdate(existing, row, rawKey, mapping, policy));
  }

  /* --- what the feed has stopped carrying --- */

  if (policy.deactivateMissing) {
    for (const [key, product] of byKey) {
      if (seen.has(key) || !product.active) continue;
      changes.push({
        action: "deactivate",
        key,
        productId: product.id,
        sku: product.sku,
        name: product.name,
        changes: [{ field: "active", label: "Active", from: "yes", to: "no" }],
        notes: ["This source no longer lists it. It stays on every estimate that already quotes it."],
      });
    }
  }

  const order: Record<SyncAction, number> = { flagged: 0, create: 1, update: 2, deactivate: 3, skip: 4, unchanged: 5 };
  changes.sort((a, b) => order[a.action] - order[b.action] || a.sku.localeCompare(b.sku) || a.key.localeCompare(b.key));

  const counts = emptyCounts();
  for (const change of changes) counts[change.action]++;

  return { sourceId: source.id, sourceName: source.name, rowsRead: rows.length, changes, counts, warnings };
}

/** A row with no match, under a policy that allows new items. */
function plannedCreation(row: SourceRow, rawKey: string, mapping: SourceMapping, policy: SyncPolicy): SyncChange {
  const notes: string[] = [];

  // A created item needs a SKU. The mapped column, else the feed's own key,
  // which is at least stable and unique within the feed.
  const skuRaw = text(row, mapping.sku) || rawKey;
  const sku = skuRaw.toUpperCase().replace(/\s+/g, "-").replace(/[^A-Z0-9._-]/g, "");
  const name = text(row, mapping.name);

  if (!sku) {
    return {
      action: "skip",
      key: rawKey,
      productId: null,
      sku: "",
      name,
      changes: [],
      notes: ["There is nothing here that can be used as a SKU."],
    };
  }
  if (!name) {
    return {
      action: "skip",
      key: rawKey,
      productId: null,
      sku,
      name: "",
      changes: [],
      notes: ["This row has no name, and an item with no name is unusable in a picker."],
    };
  }

  // A creation lists everything the feed will set, so the reviewer sees the
  // whole item rather than the word "new".
  const changes: FieldChange[] = [];
  for (const field of policy.fields) {
    const value = feedValue(row, field, mapping, policy);
    if (value === null || value === "") continue;
    changes.push({ field, label: labelFor(field), from: "", to: value });
  }

  if (!policy.fields.includes("cost") && !policy.fields.includes("price")) {
    notes.push("This source may not set prices, so the new item arrives at zero — price it before quoting it.");
  }

  return { action: "create", key: rawKey, productId: null, sku, name, changes, notes };
}

/** A row that matched an item. */
function plannedUpdate(
  product: Product,
  row: SourceRow,
  rawKey: string,
  mapping: SourceMapping,
  policy: SyncPolicy,
): SyncChange {
  const changes: FieldChange[] = [];
  const notes: string[] = [];
  let flagged = false;

  for (const field of policy.fields) {
    const next = feedValue(row, field, mapping, policy);
    if (next === null) continue;

    const current = currentValue(product, field);
    if (next === current) continue;

    // An empty feed value never blanks a field that has something in it: a
    // supplier leaving a cell empty means "I have nothing to say", not
    // "delete what you know".
    if (next === "" && current !== "") continue;

    const change: FieldChange = { field, label: labelFor(field), from: current, to: next };

    if (field === "cost" || field === "price") {
      const move = movePercent(Number(current), Number(next));
      change.changePercent = move;
      if (policy.maxPriceChangePercent > 0 && move > policy.maxPriceChangePercent) {
        flagged = true;
        notes.push(
          `${labelFor(field)} moves ${move}% (${current} → ${next}), past the ${policy.maxPriceChangePercent}% this source may change unattended.`,
        );
      }
    }

    changes.push(change);
  }

  if (!changes.length) {
    return { action: "unchanged", key: rawKey, productId: product.id, sku: product.sku, name: product.name, changes: [], notes: [] };
  }

  return {
    action: flagged ? "flagged" : "update",
    key: rawKey,
    productId: product.id,
    sku: product.sku,
    name: product.name,
    changes,
    notes,
  };
}

const labelFor = (field: SyncField): string => SYNC_FIELD_LABELS[field] ?? field;

/* -------------------------------- applying -------------------------------- */

/**
 * The item a change would produce, as a `ProductInput`.
 *
 * Returns a whole product rather than a patch, because everything that writes
 * in this app writes a validated whole record — which is what guarantees that
 * a synced item is exactly as legal as a typed one. The fields the policy does
 * not name are copied straight off the existing item, untouched.
 */
export function applyChange(
  change: SyncChange,
  existing: Product | null,
  source: Pick<CatalogSource, "id" | "name" | "policy">,
  now: string,
): ProductInput {
  const policy = source.policy;

  const base: ProductInput = existing
    ? {
        sku: existing.sku,
        name: existing.name,
        description: existing.description,
        family: existing.family,
        costType: existing.costType,
        unitOfMeasure: existing.unitOfMeasure,
        listPrice: existing.listPrice,
        cost: existing.cost,
        active: existing.active,
        wasteFactorPercent: existing.wasteFactorPercent,
        purchaseMultiple: existing.purchaseMultiple,
        material: { ...existing.material },
        provenance: existing.provenance ?? null,
        optionGroups: existing.optionGroups,
        rules: existing.rules,
        components: existing.components,
        volumeTiers: existing.volumeTiers,
      }
    : {
        sku: change.sku,
        name: change.name,
        description: "",
        family: policy.defaultFamily,
        costType: policy.defaultCostType as CostType,
        unitOfMeasure: "EA",
        listPrice: 0,
        cost: 0,
        active: true,
        wasteFactorPercent: 0,
        purchaseMultiple: 0,
        material: { ...EMPTY_MATERIAL },
        provenance: null,
        optionGroups: [],
        rules: [],
        components: [],
        volumeTiers: [],
      };

  for (const change_ of change.changes) {
    const value = change_.to;
    switch (change_.field) {
      case "name":
        base.name = value;
        break;
      case "description":
        base.description = value;
        break;
      case "family":
        base.family = value;
        break;
      case "cost":
        base.cost = Number(value) || 0;
        break;
      case "price":
        base.listPrice = Number(value) || 0;
        break;
      case "unitOfMeasure":
        base.unitOfMeasure = value as UnitOfMeasure;
        break;
      case "active":
        base.active = value === "yes";
        break;
      case "weightPerUnit":
        base.material.weightPerUnit = Number(value) || 0;
        break;
      case "coverage":
        base.material.coverage = Number(value) || 0;
        break;
      case "leadTimeDays":
        base.material.leadTimeDays = Number(value) || 0;
        break;
      case "coverageUnit":
        base.material.coverageUnit = value as UnitOfMeasure;
        break;
      default:
        (base.material as unknown as Record<string, string>)[change_.field] = value;
        break;
    }
  }

  base.provenance = {
    sourceId: source.id,
    sourceName: source.name,
    sourceKey: change.key,
    syncedAt: now,
    fields: change.changes.map(entry => entry.field),
  };

  return base;
}

/** The actions a run actually writes. Everything else is reported and left. */
export const isApplicable = (action: SyncAction): boolean =>
  action === "create" || action === "update" || action === "deactivate";
