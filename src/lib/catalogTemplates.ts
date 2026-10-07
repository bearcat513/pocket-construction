/**
 * Starting points for getting a catalogue in: files to download, fill in and
 * import.
 *
 * Two ways in, and a template for each:
 *
 * - **A spreadsheet** (`catalog-template.csv`) — one row per item, the flat
 *   fields only. This is how a catalogue actually gets built: somebody's
 *   price list pasted into Excel and tidied. Imported by the same button as a
 *   catalogue file; see `src/lib/catalogCsv.ts`.
 * - **A catalogue file** (`catalog-template.catalog.json`) — everything a
 *   spreadsheet cannot hold: option groups, configuration rules, volume
 *   tiers, assemblies, a price book.
 *
 * And one more, which is not a catalogue at all: the supplier price list the
 * sample's feed is mapped to, so the sync review has something to run against
 * before anybody has a supplier to point it at.
 *
 * Every body here is built from data, never hand-written text, and
 * `catalogTemplates.test.ts` imports each one through the real parser — a
 * template that would not import is worse than none.
 */
import { CATALOG_CSV_COLUMNS, catalogCsvRow } from "./catalogCsv";
import { CATALOG_FILE_KIND, CATALOG_FILE_VERSION } from "./catalogFile";
import { writeCsv } from "./csv";
import { SAMPLE_FEED_CSV } from "./samples";
import { EMPTY_MATERIAL } from "./types";
import type { PriceBookInput, ProductInput } from "./validate";

export type CatalogTemplate = {
  /** The download's file name, and its path under `/api/catalog/templates/`. */
  file: string;
  title: string;
  /** One or two sentences: what it is and how to use it. */
  description: string;
  contentType: string;
  body: () => string;
};

/**
 * The example rows: one of each shape a catalogue has to hold.
 *
 * Deliberately *not* the sample's items, so importing the template into a
 * workspace that already has the sample creates something rather than
 * reporting everything as already present — which reads as the import not
 * working.
 */
const EXAMPLE_PRODUCTS: ProductInput[] = [
  {
    sku: "PLY-CDX-34",
    name: "Plywood, ¾″ CDX 4×8",
    description: "Structural subfloor and roof deck.",
    family: "Framing",
    costType: "material",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "SHT",
    listPrice: 48.5,
    cost: 39.2,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 10,
    wasteFactorPercent: 10,
    purchaseMultiple: 0,
    material: {
      ...EMPTY_MATERIAL,
      division: "06",
      supplier: "Your Lumber Yard",
      supplierSku: "CDX-34-48",
      nominalSize: "3/4 in × 4 ft × 8 ft",
      actualSize: "23/32 in × 4 ft × 8 ft",
      grade: "APA Rated, Exposure 1",
      weightPerUnit: 70,
      coverage: 32,
      coverageUnit: "SF",
      leadTimeDays: 2,
    },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [
      { minQuantity: 1, maxQuantity: 49, kind: "percent", value: 0 },
      { minQuantity: 50, maxQuantity: null, kind: "percent", value: 6 },
    ],
    attributes: { Span: "48/24", "Tongue and groove": "No" },
  },
  {
    sku: "AGG-BASE-34",
    name: "Crushed Aggregate Base, ¾″",
    description: "Class II base under slabs and paving, delivered.",
    family: "Sitework",
    costType: "material",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "TON",
    listPrice: 42,
    cost: 31,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 8,
    wasteFactorPercent: 8,
    // Sold by the half ton off the scale.
    purchaseMultiple: 0.5,
    material: { ...EMPTY_MATERIAL, division: "31", supplier: "Your Quarry", grade: "Caltrans Class II" },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [],
    attributes: { Compaction: "95% relative" },
  },
  {
    sku: "LAB-TILE-SETTER",
    name: "Tile Setter",
    description: "Journeyman tile setter, straight time. Burdened rate.",
    family: "Labor",
    costType: "labor",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "HR",
    listPrice: 92,
    cost: 66,
    currency: "USD",
    active: true,
    minQuantity: 4,
    maxQuantity: 0,
    floorDiscountPercent: 8,
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: { ...EMPTY_MATERIAL, division: "09" },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [],
    attributes: {},
  },
  {
    sku: "EQP-HEATER-PROP",
    name: "Propane Space Heater, 125k BTU",
    description: "Forced-air heater for drying and cold-weather work, rented by the month.",
    family: "Equipment",
    costType: "equipment",
    chargeType: "recurring",
    billingPeriod: "monthly",
    unitOfMeasure: "MO",
    listPrice: 340,
    cost: 240,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 10,
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: { ...EMPTY_MATERIAL, division: "01", supplier: "Your Rental Yard", leadTimeDays: 1 },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [],
    attributes: { Fuel: "Propane, 20 lb or 100 lb cylinder" },
  },
];

/** What only the catalogue file can say: options, a rule, an assembly. */
const EXAMPLE_ASSEMBLY: ProductInput = {
  sku: "ASM-SUBFLOOR",
  name: "Subfloor Assembly, ¾″ Glued and Screwed",
  description: "One sheet of subfloor laid, glued and screwed: the plywood, adhesive and the hour to lay it.",
  family: "Assemblies",
  costType: "material",
  chargeType: "one-time",
  billingPeriod: "monthly",
  unitOfMeasure: "SHT",
  // Adhesive and screws; the plywood is its own line.
  listPrice: 6.5,
  cost: 4.1,
  currency: "USD",
  active: true,
  minQuantity: 1,
  maxQuantity: 0,
  floorDiscountPercent: 10,
  wasteFactorPercent: 0,
  purchaseMultiple: 0,
  material: { ...EMPTY_MATERIAL, division: "06" },
  optionGroups: [
    {
      id: "grp_fastening",
      key: "fastening",
      name: "Fastening",
      description: "Options are priced per unit of the line, on top of the list price.",
      select: "one",
      required: true,
      options: [
        { id: "opt_screws", key: "screws", name: "Screws", priceDelta: 0, default: true },
        { id: "opt_nails", key: "ring_shank", name: "Ring-shank nails", priceDelta: -1.25 },
      ],
    },
    {
      id: "grp_extras",
      key: "extras",
      name: "Extras",
      select: "many",
      required: false,
      options: [
        { id: "opt_sound", key: "sound_mat", name: "Sound mat underlayment", priceDelta: 18 },
        { id: "opt_rush", key: "rush", name: "Rush schedule", description: "A 15% uplift, applied before any delta.", priceDelta: 0, priceFactor: 1.15 },
      ],
    },
  ],
  rules: [
    {
      id: "prl_sound_screws",
      kind: "recommend",
      when: ["sound_mat"],
      then: ["screws"],
      message: "Nails through a sound mat squeak within a year — screw it down.",
    },
    {
      id: "prl_min_sheets",
      kind: "validate",
      when: [],
      then: [],
      expression: "quantity >= 4",
      message: "Not worth mobilising for fewer than four sheets.",
    },
  ],
  // Each sheet laid pulls one sheet of plywood onto the estimate, at the
  // plywood's own waste factor.
  components: [{ id: "cmp_ply", sku: "PLY-CDX-34", quantity: 1, required: true }],
  volumeTiers: [
    { minQuantity: 1, maxQuantity: 99, kind: "percent", value: 0 },
    { minQuantity: 100, maxQuantity: null, kind: "percent", value: 5 },
  ],
  attributes: { Adhesive: "Polyurethane subfloor adhesive", Screws: "2-1/2 in at 6 in o.c. edges, 12 in field" },
};

const EXAMPLE_PRICE_BOOK: PriceBookInput = {
  name: "Template price book",
  description: "A negotiated schedule: a price per SKU, and the floor below which it may not be discounted.",
  currency: "USD",
  isDefault: false,
  active: true,
  validFrom: "",
  validTo: "",
  entries: [
    { sku: "PLY-CDX-34", unitPrice: 46, minPrice: 42, active: true },
    { sku: "AGG-BASE-34", unitPrice: 40, minPrice: 35, active: true },
    { sku: "ASM-SUBFLOOR", unitPrice: 6.25, minPrice: 5.5, active: true },
  ],
};

const COLUMN_NAMES = CATALOG_CSV_COLUMNS.map(spec => spec.column);

export const CATALOG_TEMPLATES: CatalogTemplate[] = [
  {
    file: "catalog-template.csv",
    title: "Spreadsheet, with examples",
    description:
      "Every column the importer reads, with four example rows — a sheet good, a bulk material sold by " +
      "the half ton, a labour rate and a monthly rental. Replace the rows with your own and import it.",
    contentType: "text/csv; charset=utf-8",
    body: () => writeCsv(EXAMPLE_PRODUCTS.map(catalogCsvRow), COLUMN_NAMES),
  },
  {
    file: "catalog-template-blank.csv",
    title: "Spreadsheet, blank",
    description: "The same columns and nothing under them. Only sku, name, unitOfMeasure and listPrice are required.",
    contentType: "text/csv; charset=utf-8",
    body: () => writeCsv([], COLUMN_NAMES),
  },
  {
    file: "catalog-template.catalog.json",
    title: "Catalogue file",
    description:
      "For what a spreadsheet cannot hold: option groups, configuration rules, volume tiers, an assembly " +
      "that pulls its materials onto the estimate, and a price book.",
    contentType: "application/json; charset=utf-8",
    body: () =>
      JSON.stringify(
        {
          kind: CATALOG_FILE_KIND,
          version: CATALOG_FILE_VERSION,
          name: "Catalogue template",
          products: [...EXAMPLE_PRODUCTS, EXAMPLE_ASSEMBLY],
          priceBooks: [EXAMPLE_PRICE_BOOK],
          pricingRules: [],
          approvalRules: [],
        },
        null,
        2,
      ),
  },
  {
    file: "supplier-feed-example.csv",
    title: "Supplier price list",
    description:
      "Not for Import. A supplier's weekly list, the shape the sample's \"Harbor Building Supply\" feed is " +
      "mapped to — drop it on that feed to see a sync plan, with one price move held for review.",
    contentType: "text/csv; charset=utf-8",
    body: () => SAMPLE_FEED_CSV,
  },
];

export const catalogTemplate = (file: string): CatalogTemplate | undefined =>
  CATALOG_TEMPLATES.find(template => template.file === file);

export const catalogTemplateUrl = (file: string): string => `/api/catalog/templates/${encodeURIComponent(file)}`;
