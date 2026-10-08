/**
 * The catalogue as a spreadsheet, in both directions.
 *
 * `*.catalog.json` is the format that holds everything — option groups,
 * configuration rules, volume tiers, assemblies — and it is the one that
 * round-trips. But nobody keys four hundred items into JSON. They key them
 * into a spreadsheet, so this reads one: one row per item, one column per
 * flat field, and nothing that needs nesting.
 *
 * It reads into the *same* raw shape a catalogue file holds and hands that to
 * `parseCatalogFile`, so a spreadsheet import has no rules of its own: the
 * same validator, the same all-or-nothing, the same "an existing SKU is left
 * exactly as it is" on the way in. What this file adds is strictness about
 * the cells, which a JSON body does not need:
 *
 * - **An unreadable number is an error, never 0.** `readProduct` is lenient
 *   by design (it repairs old records), and a lenient reader turns "$4.2O"
 *   into a free stud. A price cell that cannot be read stops the import and
 *   names the row.
 * - **An unknown unit is an error, never EA.** A catalogue that cannot tell
 *   "SF" from "sq ft" multiplies a price per square foot by a count of sheets.
 * - **An unknown column is reported, not guessed at.** Headers are matched
 *   loosely — case, spaces and underscores do not matter, and a few common
 *   spellings are accepted — but a column that matches nothing is named in a
 *   warning rather than silently dropped.
 *
 * The column list below is also the export's: `catalogCsvRow` writes exactly
 * these, so a spreadsheet exported from one workspace imports into another.
 */
import { parseCatalogFile, type ParseResult } from "./catalogFile";
import { parseBoolean, parseNumber, parseTable } from "./csv";
import { COST_TYPES, CSI_DIVISION_NAMES, UNITS_OF_MEASURE, UNIT_SET } from "./types";
import { readProduct, type ProductInput } from "./validate";

type Kind = "text" | "number" | "integer" | "boolean" | "unit" | "enum" | "division";

export type CatalogCsvColumn = {
  /** The header, exactly as the template and the export write it. */
  column: string;
  kind: Kind;
  required: boolean;
  /** One line, for the column guide. */
  note: string;
  /** For `enum`: the values allowed. */
  values?: readonly string[];
  /** Other headers that mean the same thing, as people actually write them. */
  aliases?: string[];
};

/** Material specification fields: stored under `material` rather than on the item. */
const MATERIAL_FIELDS = new Set([
  "division",
  "manufacturer",
  "manufacturerPartNumber",
  "supplier",
  "supplierSku",
  "nominalSize",
  "actualSize",
  "grade",
  "finish",
  "weightPerUnit",
  "coverage",
  "coverageUnit",
  "leadTimeDays",
  "submittalRequired",
]);

export const CATALOG_CSV_COLUMNS: CatalogCsvColumn[] = [
  { column: "sku", kind: "text", required: true, note: "Your code for the item: letters, digits, dot, dash, underscore. A SKU already in the catalogue is left alone.", aliases: ["item code", "code", "part"] },
  { column: "name", kind: "text", required: true, note: "What the estimate line says.", aliases: ["item", "item name"] },
  { column: "description", kind: "text", required: false, note: "Longer text, shown under the name on a proposal." },
  { column: "family", kind: "text", required: false, note: "The group it is filed under: Framing, Concrete, Labor…", aliases: ["category", "group"] },
  { column: "costType", kind: "enum", required: false, values: COST_TYPES, note: "How a job cost report adds it up. Blank is material." },
  { column: "unitOfMeasure", kind: "unit", required: true, values: UNITS_OF_MEASURE, note: "What one of it is. A code from the closed list — SF, not sq ft.", aliases: ["uom", "unit", "units"] },
  { column: "listPrice", kind: "number", required: true, note: "Your sell price per unit. 0 prices it at cost plus the estimate's markup; blank is refused.", aliases: ["price", "sell price", "unit price"] },
  { column: "cost", kind: "number", required: false, note: "What one unit costs you. Blank is 0.", aliases: ["unit cost"] },
  { column: "active", kind: "boolean", required: false, note: "yes / no. Blank is yes." },
  { column: "wasteFactorPercent", kind: "number", required: false, note: "Bought on top of the take-off, in percent. Drywall 15, studs 8, windows 0.", aliases: ["waste", "waste percent", "waste factor"] },
  { column: "purchaseMultiple", kind: "number", required: false, note: "The lot it is sold in: 0.25 for concrete by the quarter yard. Blank sells any quantity.", aliases: ["lot", "lot size", "multiple"] },
  { column: "division", kind: "division", required: false, note: "CSI MasterFormat division, two digits: 03 concrete, 06 wood, 09 finishes.", aliases: ["csi division", "csi"] },
  { column: "manufacturer", kind: "text", required: false, note: "", aliases: ["mfr", "brand"] },
  { column: "manufacturerPartNumber", kind: "text", required: false, note: "", aliases: ["mfr part", "mfr part number", "part number", "model"] },
  { column: "supplier", kind: "text", required: false, note: "Who you buy it from.", aliases: ["vendor"] },
  { column: "supplierSku", kind: "text", required: false, note: "Their code for it — what a supplier feed matches on.", aliases: ["vendor sku", "supplier code"] },
  { column: "nominalSize", kind: "text", required: false, note: "What it is called: 2x4.", aliases: ["size"] },
  { column: "actualSize", kind: "text", required: false, note: "What it measures: 1.5 in × 3.5 in." },
  { column: "grade", kind: "text", required: false, note: "Grade, mix or rating.", aliases: ["mix"] },
  { column: "finish", kind: "text", required: false, note: "", aliases: ["color", "colour"] },
  { column: "weightPerUnit", kind: "number", required: false, note: "Pounds per unit.", aliases: ["weight", "weight lb"] },
  { column: "coverage", kind: "number", required: false, note: "How much one unit covers: 32 for a 4×8 sheet in SF." },
  { column: "coverageUnit", kind: "unit", required: false, values: UNITS_OF_MEASURE, note: "The unit coverage is measured in. Needed when coverage is set." },
  { column: "leadTimeDays", kind: "integer", required: false, note: "Days from order to site.", aliases: ["lead time", "lead days"] },
  { column: "submittalRequired", kind: "boolean", required: false, note: "yes if the architect has to approve it first.", aliases: ["submittal"] },
];

/**
 * Columns the export writes for a person to read, which no spreadsheet can
 * write back. Known, so they are not reported as strangers; and if one has
 * anything in it, the import says what it could not carry.
 */
const EXPORT_ONLY = ["marginPercent", "optionGroups", "options", "configurationRules", "bundleComponents", "volumeTiers"];

/**
 * Columns an older export wrote for fields the catalogue no longer has. Known,
 * so re-importing an old spreadsheet does not list them as strangers.
 */
const RETIRED = ["chargeType", "billingPeriod", "currency", "minQuantity", "maxQuantity", "floorDiscountPercent", "attributes"];
const STRUCTURED = new Set(["optionGroups", "options", "configurationRules", "bundleComponents", "volumeTiers"]);

const normalise = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]/g, "");

const BY_HEADER = new Map<string, CatalogCsvColumn>();
for (const spec of CATALOG_CSV_COLUMNS) {
  BY_HEADER.set(normalise(spec.column), spec);
  for (const alias of spec.aliases ?? []) BY_HEADER.set(normalise(alias), spec);
}
const IGNORED = new Map([...EXPORT_ONLY, ...RETIRED].map(column => [normalise(column), column]));

/* --------------------------------- writing -------------------------------- */

const blankZero = (value: number) => (value ? value : "");

/** One item as one spreadsheet row, keyed by `CATALOG_CSV_COLUMNS`. */
export function catalogCsvRow(product: ProductInput): Record<string, string | number | boolean> {
  const material = product.material;
  return {
    sku: product.sku,
    name: product.name,
    description: product.description,
    family: product.family,
    costType: product.costType,
    unitOfMeasure: product.unitOfMeasure,
    listPrice: product.listPrice,
    cost: product.cost,
    active: product.active,
    wasteFactorPercent: product.wasteFactorPercent,
    purchaseMultiple: blankZero(product.purchaseMultiple),
    division: material.division,
    manufacturer: material.manufacturer,
    manufacturerPartNumber: material.manufacturerPartNumber,
    supplier: material.supplier,
    supplierSku: material.supplierSku,
    nominalSize: material.nominalSize,
    actualSize: material.actualSize,
    grade: material.grade,
    finish: material.finish,
    weightPerUnit: blankZero(material.weightPerUnit),
    coverage: blankZero(material.coverage),
    coverageUnit: material.coverageUnit,
    leadTimeDays: blankZero(material.leadTimeDays),
    submittalRequired: material.submittalRequired,
  };
}

/* --------------------------------- reading -------------------------------- */

type Cell = { ok: true; value: unknown } | { ok: false; error: string };

function readCell(spec: CatalogCsvColumn, raw: string): Cell {
  switch (spec.kind) {
    case "text":
      return { ok: true, value: raw };
    case "number":
    case "integer": {
      const value = parseNumber(raw);
      if (value === null) return { ok: false, error: `${spec.column} "${raw}" is not a number` };
      if (value < 0) return { ok: false, error: `${spec.column} cannot be negative (${raw})` };
      if (spec.kind === "integer" && !Number.isInteger(value)) {
        return { ok: false, error: `${spec.column} has to be a whole number (${raw})` };
      }
      return { ok: true, value };
    }
    case "boolean": {
      // parseBoolean's fallback is how an unreadable cell is told apart.
      const yes = parseBoolean(raw, true);
      const no = parseBoolean(raw, false);
      if (yes !== no) return { ok: false, error: `${spec.column} "${raw}" is not yes or no` };
      return { ok: true, value: yes };
    }
    case "unit": {
      const code = raw.toUpperCase();
      if (!UNIT_SET.has(code)) {
        return { ok: false, error: `"${raw}" is not a unit of measure (${UNITS_OF_MEASURE.join(", ")})` };
      }
      return { ok: true, value: code };
    }
    case "enum": {
      const match = spec.values?.find(value => value.toLowerCase() === raw.toLowerCase());
      if (!match) return { ok: false, error: `${spec.column} "${raw}" is not one of ${spec.values?.join(", ")}` };
      return { ok: true, value: match };
    }
    case "division": {
      const code = raw.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
      if (!CSI_DIVISION_NAMES[code]) return { ok: false, error: `"${raw}" is not a CSI division` };
      return { ok: true, value: code };
    }
  }
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/**
 * Reads a catalogue spreadsheet, or says which cell stopped it.
 *
 * Comma, semicolon, tab or pipe delimited; a byte-order mark and CRLF are
 * fine. A row with nothing in it is skipped, so a template with the example
 * rows deleted and a few blank lines left behind still imports.
 */
export function parseCatalogCsv(text: string, name = "Spreadsheet import"): ParseResult {
  const table = parseTable(text);
  if (!table.columns.length) return { ok: false, error: "That file is empty." };

  const bound: { header: string; spec: CatalogCsvColumn }[] = [];
  const unknown: string[] = [];
  const structured: string[] = [];
  const claimed = new Set<string>();

  for (const header of table.columns) {
    const key = normalise(header);
    const spec = BY_HEADER.get(key);
    if (spec) {
      if (claimed.has(spec.column)) return { ok: false, error: `Two columns both mean ${spec.column} ("${header}").` };
      claimed.add(spec.column);
      bound.push({ header, spec });
    } else if (IGNORED.has(key)) {
      if (STRUCTURED.has(IGNORED.get(key)!)) structured.push(header);
    } else {
      unknown.push(header);
    }
  }

  const missing = CATALOG_CSV_COLUMNS.filter(spec => spec.required && !claimed.has(spec.column)).map(spec => spec.column);
  if (missing.length) {
    return {
      ok: false,
      error:
        `The file has no ${missing.join(", ")} column${missing.length === 1 ? "" : "s"}. ` +
        "The first row has to be the column headings — download the template for the exact names.",
    };
  }

  const skuHeader = bound.find(entry => entry.spec.column === "sku")!.header;
  const products: Record<string, unknown>[] = [];
  let dropped = 0;

  for (const [index, row] of table.rows.entries()) {
    if (Object.values(row).every(value => !value)) continue;
    // A heading is row 1, so data starts at 2 — the number a spreadsheet shows.
    const label = `Row ${index + 2}${row[skuHeader] ? ` (${row[skuHeader]})` : ""}`;

    const product: Record<string, unknown> = {};
    const material: Record<string, unknown> = {};

    for (const { header, spec } of bound) {
      const raw = row[header] ?? "";
      if (!raw) {
        if (spec.required) return { ok: false, error: `${label}: ${spec.column} is empty.` };
        continue;
      }
      const cell = readCell(spec, raw);
      if (!cell.ok) return { ok: false, error: `${label}: ${cell.error}.` };
      (MATERIAL_FIELDS.has(spec.column) ? material : product)[spec.column] = cell.value;
    }

    if (material.coverage && !material.coverageUnit) {
      return { ok: false, error: `${label}: coverage needs a coverageUnit, or the number means nothing.` };
    }

    // Checked here as well as by parseCatalogFile, so a refusal names the row.
    const checked = readProduct({ ...product, material });
    if (!checked.ok) return { ok: false, error: `${label}: ${checked.error}` };

    if (structured.some(header => row[header] && row[header] !== "0")) dropped++;
    products.push({ ...product, material });
  }

  if (!products.length) return { ok: false, error: "The file has headings but no items under them." };

  const parsed = parseCatalogFile({ name, products });
  if (!parsed.ok) return parsed;

  const warnings = [...parsed.catalog.warnings];
  if (unknown.length) {
    warnings.push(`Ignored ${plural(unknown.length, "column")} this app does not know: ${unknown.join(", ")}.`);
  }
  if (dropped) {
    warnings.push(
      `${plural(dropped, "row")} had options, volume tiers or assembly components, which a spreadsheet cannot ` +
        "carry. Those items came in without them — use a *.catalog.json file, or add them on the item.",
    );
  }

  return { ok: true, catalog: { ...parsed.catalog, warnings } };
}
