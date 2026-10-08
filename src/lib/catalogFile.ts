/**
 * The portable catalogue file: `*.catalog.json`.
 *
 * One self-contained JSON document holding the catalogue — everything that
 * decides what a job costs, without a single estimate in it. It is meant to live in a repository next to the code that
 * depends on it: a catalogue is a commercial decision, it is reviewed, and it
 * should be diffable when it changes.
 *
 * That shapes two choices:
 *
 * **Records are identified by SKU and name, never by internal id.** Ids are
 * stripped on export and minted fresh on import, so the same catalogue
 * exported from two instances produces the same bytes, and a bundle that
 * references `SUPPORT` still finds it after a round trip.
 *
 * **Nothing is stored until all of it validates.** An import that would
 * half-apply — twelve products in, the thirteenth rejected — leaves a
 * catalogue nobody can reason about. `parseCatalogFile` checks the entire
 * document first and either hands back the whole thing or one sentence
 * explaining which part stopped it.
 */
import { readProduct, type ProductInput } from "./validate";
import type { Product } from "./types";

export const CATALOG_FILE_KIND = "construction/catalog";

/**
 * What this format used to be called.
 *
 * Still accepted on import, and deliberately: a file exported before the app
 * was about buildings holds exactly the same shape, and refusing it would
 * strand somebody's catalogue over a string.
 */
export const LEGACY_CATALOG_FILE_KIND = "cpq/catalog";

export const CATALOG_FILE_VERSION = 1;

export type CatalogFile = {
  kind: typeof CATALOG_FILE_KIND;
  version: number;
  name: string;
  exportedAt: string;
  products: ProductInput[];
};

export type ParsedCatalog = {
  name: string;
  products: ProductInput[];
  /** Things worth knowing that did not stop the import. */
  warnings: string[];
};

export type ParseResult = { ok: true; catalog: ParsedCatalog } | { ok: false; error: string };

/* -------------------------------- export --------------------------------- */

/** Drops everything instance-specific: ids, ownership, timestamps. */
const portableProduct = (product: Product): ProductInput => ({
  sku: product.sku,
  name: product.name,
  description: product.description,
  family: product.family,
  costType: product.costType,
  unitOfMeasure: product.unitOfMeasure,
  listPrice: product.listPrice,
  cost: product.cost,
  active: product.active,
  optionGroups: product.optionGroups,
  rules: product.rules,
  components: product.components,
  volumeTiers: product.volumeTiers,
  wasteFactorPercent: product.wasteFactorPercent,
  purchaseMultiple: product.purchaseMultiple,
  material: product.material,
  // Provenance is deliberately dropped. It names a `catalog_sources` record id
  // that means nothing in the workspace this file is imported into, and a
  // catalogue file is supposed to be the same bytes wherever it came from.
});

export type CatalogExportInput = {
  name?: string;
  products?: Product[];
};

export function buildCatalogFile(input: CatalogExportInput): CatalogFile {
  return {
    kind: CATALOG_FILE_KIND,
    version: CATALOG_FILE_VERSION,
    name: input.name ?? "Catalogue",
    exportedAt: new Date().toISOString(),
    products: (input.products ?? []).map(portableProduct),
  };
}

export const serializeCatalogFile = (input: CatalogExportInput): string =>
  JSON.stringify(buildCatalogFile(input), null, 2);

/** "Framing catalogue" -> "framing-catalogue.catalog.json" */
export function catalogFileName(name: string): string {
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "catalog";
  return `${slug}.catalog.json`;
}

/* -------------------------------- import --------------------------------- */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Reads a catalogue file.
 *
 * `kind` and `version` are optional: a hand-written file with nothing but a
 * `products` array is a perfectly good catalogue, and demanding an envelope
 * would make the format harder to produce than to consume. A file from a
 * *newer* version is refused, because the only honest thing to say about a
 * format this code has not seen is that it has not seen it.
 */
export function parseCatalogFile(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, error: "That file is not a JSON object." };

  if (raw.kind !== undefined && raw.kind !== CATALOG_FILE_KIND && raw.kind !== LEGACY_CATALOG_FILE_KIND) {
    return { ok: false, error: `This is a "${String(raw.kind)}" file, not a ${CATALOG_FILE_KIND} file.` };
  }

  const version = Number(raw.version ?? CATALOG_FILE_VERSION);
  if (Number.isFinite(version) && version > CATALOG_FILE_VERSION) {
    return {
      ok: false,
      error: `This file is version ${version}; this app understands up to ${CATALOG_FILE_VERSION}.`,
    };
  }

  const warnings: string[] = [];

  /* --- products --- */

  const rawProducts = Array.isArray(raw.products) ? raw.products : raw.product ? [raw.product] : [];
  const products: ProductInput[] = [];
  const skus = new Set<string>();

  for (const [index, entry] of rawProducts.entries()) {
    const parsed = readProduct(entry);
    if (!parsed.ok) return { ok: false, error: `Product ${index + 1}: ${parsed.error}` };
    if (skus.has(parsed.value.sku)) {
      return { ok: false, error: `Two products share the SKU ${parsed.value.sku}; a SKU identifies one product.` };
    }
    skus.add(parsed.value.sku);
    products.push(parsed.value);
  }

  // Files written before the catalogue was simplified may carry these. They
  // no longer mean anything here, so they are skipped — and said to be.
  const dropped = (["priceBooks", "pricingRules", "approvalRules"] as const).filter(
    key => Array.isArray(raw[key]) && (raw[key] as unknown[]).length > 0,
  );
  if (dropped.length) {
    warnings.push("Price books and pricing or approval rules in this file were skipped — this app no longer has them.");
  }

  if (!products.length) {
    return { ok: false, error: "There is nothing in this file to import." };
  }

  /* --- cross-references, which warn rather than refuse --- */

  // A bundle may legitimately point at a SKU that is
  // already in the catalogue and not in this file, so a dangling reference is
  // reported rather than rejected.
  for (const product of products) {
    for (const component of product.components) {
      if (!skus.has(component.sku)) {
        warnings.push(`${product.sku} bundles ${component.sku}, which is not in this file.`);
      }
    }
  }

  return {
    ok: true,
    catalog: {
      name: String(raw.name ?? "Catalogue").trim().slice(0, 200) || "Catalogue",
      products,
      warnings,
    },
  };
}
