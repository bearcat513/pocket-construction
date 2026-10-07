/**
 * A worked example: a catalogue, the policy around it, two customers and the
 * documents to send them.
 *
 * An empty CPQ is not explorable. You cannot see what a volume tier does
 * without a product that has one, what an approval rule does without a
 * discount deep enough to trip it, or what a bundle does without a bundle. So
 * a new account can install this in one click and then take it apart — every
 * feature in the app is represented by something here that uses it.
 *
 * It is deliberately a *plausible* B2B software catalogue rather than a
 * minimal one: tiers that overlap the way published price breaks do, a
 * services family with its own discount ceiling, a bundle whose components
 * carry the price, and an approval ladder that a 30% discount actually walks
 * up. The numbers are made up; the shapes are not.
 *
 * Everything here goes through `src/lib/validate.ts` on its way in, exactly
 * like an imported file, so the sample cannot encode anything the app would
 * otherwise refuse.
 */
import { priceQuote } from "./pricing";
import { starterPdfTemplate, type PdfTemplate } from "./pdfTemplate";
import { addDays, dueDateFor, invoiceTotals, pricedLines, today as todayIso } from "./receivable";
import { SAMPLE_COVER_BANNER, SAMPLE_LOGO } from "./sampleBrand";
import { EMPTY_MAPPING, EMPTY_MATERIAL } from "./types";
import type { Invoice, InvoiceLine, ProposalFormat, Product, Quote, TemplateKind } from "./types";
import type {
  AccountInput,
  ApprovalRuleInput,
  CatalogSourceInput,
  PriceBookInput,
  PricingRuleInput,
  ProductInput,
  ProjectInput,
} from "./validate";

/* -------------------------------- catalogue ------------------------------- */

/**
 * A light-commercial and residential general contractor's catalogue.
 *
 * Every field the app has an opinion about is exercised by something in here:
 * waste factors on the sheet goods that actually waste, a purchase multiple on
 * the ready-mix nobody will sell you by the cubic foot, coverage on the two
 * materials that are bought by the bundle and measured by the square foot, all
 * five cost types, all three charge types (the scissor lift is the recurring
 * one — it is rented by the month, which is what `recurring` means on a job
 * site), an assembly that pulls its own materials onto the estimate, and a
 * window with a submittal against it and a four-week lead time.
 *
 * The prices are plausible rather than real. The shapes are real.
 */
export const SAMPLE_PRODUCTS: ProductInput[] = [
  {
    sku: "LBR-STUD-2X4",
    name: "2×4 Stud, 92⅝″",
    description: "Kiln-dried Douglas Fir #2 precut stud for 8′ walls.",
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
    // Lumber is culled on site: crooks, splits and the odd one used as a brace.
    wasteFactorPercent: 8,
    purchaseMultiple: 0,
    material: {
      ...EMPTY_MATERIAL,
      division: "06",
      manufacturer: "Cascade Mills",
      supplier: "Harbor Building Supply",
      supplierSku: "DF2-2X4-925",
      nominalSize: "2x4",
      actualSize: "1.5 in × 3.5 in × 92.625 in",
      grade: "Douglas Fir #2 KD-HT",
      weightPerUnit: 9.4,
    },
    optionGroups: [],
    rules: [],
    components: [],
    // A unit of studs is 294; the breaks are where a yard stops picking sticks
    // and puts a banded unit on the truck.
    volumeTiers: [
      { minQuantity: 1, maxQuantity: 293, kind: "percent", value: 0 },
      { minQuantity: 294, maxQuantity: 881, kind: "percent", value: 6 },
      { minQuantity: 882, maxQuantity: null, kind: "percent", value: 11 },
    ],
    attributes: { "Unit quantity": "294 per banded unit", Treatment: "Kiln dried, heat treated" },
  },
  {
    sku: "LBR-OSB-716",
    name: "OSB Sheathing, 7/16″ 4×8",
    description: "APA-rated exposure 1 wall and roof sheathing.",
    family: "Framing",
    costType: "material",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "SHT",
    listPrice: 18.9,
    cost: 15.1,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 10,
    // Sheet goods waste harder than sticks: every sheet cut to fit leaves an
    // offcut too small for the next opening.
    wasteFactorPercent: 12,
    purchaseMultiple: 0,
    material: {
      ...EMPTY_MATERIAL,
      division: "06",
      supplier: "Harbor Building Supply",
      supplierSku: "OSB-716-48",
      nominalSize: "7/16 in × 4 ft × 8 ft",
      grade: "APA Rated Sheathing, Exposure 1",
      weightPerUnit: 46,
      coverage: 32,
      coverageUnit: "SF",
    },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [
      { minQuantity: 1, maxQuantity: 49, kind: "percent", value: 0 },
      { minQuantity: 50, maxQuantity: null, kind: "percent", value: 7 },
    ],
    attributes: { Span: "24/16", Exposure: "Exposure 1" },
  },
  {
    sku: "CONC-RM-4000",
    name: "Ready-Mix Concrete, 4000 PSI",
    description: "4000 PSI mix delivered to site, 4″ slump, ¾″ aggregate.",
    family: "Concrete",
    costType: "material",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "CY",
    listPrice: 168,
    cost: 142,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 8,
    wasteFactorPercent: 5,
    // No plant batches finer than a quarter yard.
    purchaseMultiple: 0.25,
    material: {
      ...EMPTY_MATERIAL,
      division: "03",
      supplier: "Valley Ready Mix",
      supplierSku: "4000-34-4",
      grade: "4000 PSI @ 28 days",
      weightPerUnit: 4050,
      leadTimeDays: 2,
    },
    optionGroups: [
      {
        id: "grp_mix",
        key: "mix",
        name: "Mix additions",
        description: "Priced per cubic yard, on top of the base mix.",
        select: "many",
        required: false,
        options: [
          { id: "opt_fiber", key: "fiber", name: "Synthetic fibre", description: "Replaces sheet mesh in a slab on grade.", priceDelta: 9 },
          { id: "opt_accel", key: "accelerator", name: "Accelerator", description: "Cold-weather set. Non-chloride.", priceDelta: 7 },
          { id: "opt_air", key: "air_entrained", name: "Air entrainment", description: "Freeze-thaw durability. Required for exterior flatwork.", priceDelta: 5 },
          { id: "opt_retard", key: "retarder", name: "Retarder", description: "Extends working time in hot weather.", priceDelta: 6 },
        ],
      },
    ],
    rules: [
      {
        id: "prl_conc_temp",
        kind: "excludes",
        when: ["accelerator"],
        then: ["retarder"],
        message: "An accelerator and a retarder in the same load cancel each other out — pick one.",
      },
      {
        id: "prl_conc_shortload",
        kind: "validate",
        when: [],
        then: [],
        expression: "quantity >= 1",
        message: "A plant will not send a truck for less than a yard.",
      },
    ],
    components: [],
    // A short load carries a surcharge; a full truck is ten yards.
    volumeTiers: [
      { minQuantity: 0, maxQuantity: 4.75, kind: "amount", value: -35 },
      { minQuantity: 5, maxQuantity: 9.75, kind: "percent", value: 0 },
      { minQuantity: 10, maxQuantity: null, kind: "percent", value: 5 },
    ],
    attributes: { Slump: "4 in ± 1", Aggregate: "3/4 in", "Short load fee": "Under 5 CY" },
  },
  {
    sku: "RFG-SHNG-ARCH",
    name: "Architectural Shingles",
    description: "Laminated asphalt shingle, 130 mph wind rating.",
    family: "Roofing",
    costType: "material",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "BDL",
    listPrice: 38.5,
    cost: 31.2,
    currency: "USD",
    active: true,
    minQuantity: 3,
    maxQuantity: 0,
    floorDiscountPercent: 10,
    // Hips, valleys and starter courses all come off the bundle count.
    wasteFactorPercent: 12,
    purchaseMultiple: 1,
    material: {
      ...EMPTY_MATERIAL,
      division: "07",
      manufacturer: "Summit Roofing Products",
      manufacturerPartNumber: "SR-ARCH-130",
      supplier: "Beacon Supply",
      supplierSku: "SHG-ARCH-WW",
      grade: "ASTM D3462, Class A",
      finish: "Weathered Wood",
      weightPerUnit: 78,
      coverage: 33.33,
      coverageUnit: "SF",
      leadTimeDays: 5,
      submittalRequired: true,
    },
    optionGroups: [
      {
        id: "grp_color",
        key: "color",
        name: "Colour",
        description: "No price difference — stocked colours only.",
        select: "one",
        required: true,
        options: [
          { id: "opt_ww", key: "weathered_wood", name: "Weathered Wood", priceDelta: 0, default: true },
          { id: "opt_cb", key: "charcoal_black", name: "Charcoal Black", priceDelta: 0 },
          { id: "opt_dr", key: "driftwood", name: "Driftwood", priceDelta: 0 },
        ],
      },
      {
        id: "grp_warranty",
        key: "warranty",
        name: "Warranty",
        description: "The enhanced warranty requires the full manufacturer system.",
        select: "one",
        required: true,
        options: [
          { id: "opt_std_war", key: "standard_warranty", name: "Standard — limited lifetime", priceDelta: 0, default: true },
          { id: "opt_sys_war", key: "system_warranty", name: "System — 50 year non-prorated", description: "Requires matching underlayment, starter and ridge.", priceDelta: 4.25 },
        ],
      },
    ],
    rules: [
      {
        id: "prl_rfg_min",
        kind: "validate",
        when: [],
        then: [],
        expression: "quantity >= 3",
        message: "Shingles are sold three bundles to the square.",
      },
    ],
    components: [],
    volumeTiers: [
      { minQuantity: 3, maxQuantity: 59, kind: "percent", value: 0 },
      { minQuantity: 60, maxQuantity: null, kind: "percent", value: 8 },
    ],
    attributes: { "Wind rating": "130 mph", "Fire rating": "Class A", Coverage: "3 bundles per square" },
  },
  {
    sku: "DRY-5812-4X12",
    name: "Gypsum Board, 5/8″ Type X 4×12",
    description: "Fire-rated gypsum wallboard, tapered edge.",
    family: "Interior Finishes",
    costType: "material",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "SHT",
    listPrice: 21.4,
    cost: 17.6,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 10,
    // The worst waster in the catalogue, and the reason the field exists.
    wasteFactorPercent: 15,
    purchaseMultiple: 0,
    material: {
      ...EMPTY_MATERIAL,
      division: "09",
      manufacturer: "Keystone Gypsum",
      manufacturerPartNumber: "KG-TX58-412",
      supplier: "Harbor Building Supply",
      supplierSku: "GYP-TX58-412",
      nominalSize: "5/8 in × 4 ft × 12 ft",
      grade: "ASTM C1396 Type X",
      weightPerUnit: 96,
      coverage: 48,
      coverageUnit: "SF",
    },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [
      { minQuantity: 1, maxQuantity: 99, kind: "percent", value: 0 },
      { minQuantity: 100, maxQuantity: null, kind: "percent", value: 9 },
    ],
    attributes: { "Fire rating": "Type X, 1 hr assembly", Edge: "Tapered" },
  },
  {
    sku: "WIN-DH-3050",
    name: "Double-Hung Window, 30″ × 50″",
    description: "Vinyl double-hung, low-E argon insulated glazing.",
    family: "Openings",
    costType: "material",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "EA",
    listPrice: 412,
    cost: 318,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 15,
    // Windows are ordered to an opening. Nothing is cut off and nothing spare
    // is delivered — which is exactly why the field is zero here rather than
    // absent from the model.
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: {
      ...EMPTY_MATERIAL,
      division: "08",
      manufacturer: "Northline Windows",
      manufacturerPartNumber: "NL-DH-3050-LE",
      supplier: "Northline Direct",
      nominalSize: "30 in × 50 in",
      actualSize: "29.5 in × 49.5 in rough opening 30.5 in × 50.5 in",
      grade: "NFRC U-0.28 SHGC-0.22",
      finish: "White",
      weightPerUnit: 52,
      leadTimeDays: 28,
      submittalRequired: true,
    },
    optionGroups: [
      {
        id: "grp_glaz",
        key: "glazing",
        name: "Glazing",
        select: "one",
        required: true,
        options: [
          { id: "opt_le2", key: "low_e_double", name: "Low-E double, argon", priceDelta: 0, default: true },
          { id: "opt_le3", key: "low_e_triple", name: "Low-E triple, argon", description: "U-0.20. Adds four weeks to the lead time.", priceDelta: 0, priceFactor: 1.32 },
          { id: "opt_tmp", key: "tempered", name: "Tempered", description: "Required within 24″ of a door or below 18″ AFF.", priceDelta: 88 },
        ],
      },
      {
        id: "grp_grid",
        key: "grid",
        name: "Grille",
        select: "one",
        required: false,
        options: [
          { id: "opt_nogrid", key: "no_grid", name: "None", priceDelta: 0, default: true },
          { id: "opt_col", key: "colonial", name: "Colonial, between glass", priceDelta: 46 },
          { id: "opt_pr", key: "prairie", name: "Prairie, between glass", priceDelta: 46 },
        ],
      },
    ],
    rules: [
      {
        id: "prl_win_trip",
        kind: "excludes",
        when: ["low_e_triple"],
        then: ["tempered"],
        message: "Triple glazing is not offered tempered in this size — specify a fixed tempered unit instead.",
      },
      {
        id: "prl_win_grid",
        kind: "recommend",
        when: ["colonial"],
        then: ["low_e_double"],
        message: "Between-glass colonial grilles read best on double glazing; on triple they sit oddly deep.",
      },
    ],
    components: [],
    volumeTiers: [
      { minQuantity: 1, maxQuantity: 9, kind: "percent", value: 0 },
      { minQuantity: 10, maxQuantity: 24, kind: "percent", value: 7 },
      { minQuantity: 25, maxQuantity: null, kind: "percent", value: 13 },
    ],
    attributes: { "U-factor": "0.28", "Egress rated": "No", Warranty: "20 year glass seal" },
  },
  {
    sku: "LAB-CARP-JRNY",
    name: "Carpenter — Journeyman",
    description: "Journeyman carpenter, straight time. Burdened rate.",
    family: "Labor",
    costType: "labor",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "HR",
    listPrice: 86,
    cost: 61,
    currency: "USD",
    active: true,
    minQuantity: 4,
    maxQuantity: 0,
    floorDiscountPercent: 8,
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: { ...EMPTY_MATERIAL, division: "01" },
    optionGroups: [
      {
        id: "grp_shift",
        key: "shift",
        name: "Shift",
        select: "one",
        required: true,
        options: [
          { id: "opt_st", key: "straight_time", name: "Straight time", priceDelta: 0, default: true },
          { id: "opt_ot", key: "overtime", name: "Overtime", description: "Over 8 in a day or on a Saturday.", priceDelta: 0, priceFactor: 1.5 },
          { id: "opt_dt", key: "double_time", name: "Double time", description: "Sundays and holidays.", priceDelta: 0, priceFactor: 2 },
        ],
      },
    ],
    rules: [],
    components: [],
    volumeTiers: [],
    attributes: { Burden: "Includes payroll taxes, insurance and fringe", Classification: "Journeyman" },
  },
  {
    sku: "LAB-CREW-FRAME",
    name: "Framing Crew — Four Hands",
    description: "Lead carpenter and three framers, per working day.",
    family: "Labor",
    costType: "labor",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "DAY",
    listPrice: 2560,
    cost: 1890,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 10,
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: { ...EMPTY_MATERIAL, division: "06" },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [
      { minQuantity: 1, maxQuantity: 9, kind: "percent", value: 0 },
      { minQuantity: 10, maxQuantity: null, kind: "percent", value: 6 },
    ],
    attributes: { Crew: "1 lead + 3 framers", Day: "8 hours on site" },
  },
  {
    sku: "EQP-LIFT-19",
    name: "Scissor Lift, 19′ Electric",
    description: "19 ft electric scissor lift on site, delivery and pickup included.",
    family: "Equipment",
    costType: "equipment",
    // The catalogue's recurring item: a lift is rented by the month for as
    // long as the estimate's term says it is on the job.
    chargeType: "recurring",
    billingPeriod: "monthly",
    unitOfMeasure: "MO",
    listPrice: 685,
    cost: 495,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 12,
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: {
      ...EMPTY_MATERIAL,
      division: "01",
      manufacturer: "Genie",
      manufacturerPartNumber: "GS-1930",
      supplier: "Tri-County Rentals",
      weightPerUnit: 2750,
      leadTimeDays: 3,
    },
    optionGroups: [
      {
        id: "grp_lift",
        key: "lift_extras",
        name: "Extras",
        select: "many",
        required: false,
        options: [
          { id: "opt_dw", key: "damage_waiver", name: "Damage waiver", description: "14% of the rental.", priceDelta: 0, priceFactor: 1.14 },
          { id: "opt_nm", key: "non_marking", name: "Non-marking tyres", description: "For finished floors.", priceDelta: 75 },
        ],
      },
    ],
    rules: [],
    components: [],
    volumeTiers: [],
    attributes: { "Platform height": "19 ft", "Working height": "25 ft", Power: "Electric, 24V" },
  },
  {
    sku: "SUB-ELEC-ROUGH",
    name: "Electrical Rough-In — Subcontract",
    description: "Licensed electrical subcontractor: rough-in, panel and inspection.",
    family: "Subcontracts",
    costType: "subcontract",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "LS",
    listPrice: 14800,
    cost: 12900,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    // A subcontract is bought at a bid price. There is very little room in it
    // and the approval ladder is told so by this number.
    floorDiscountPercent: 5,
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: { ...EMPTY_MATERIAL, division: "26", submittalRequired: true, leadTimeDays: 14 },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [],
    attributes: { Scope: "Rough-in, panel, permit and inspection", Excludes: "Fixtures, trim, low voltage" },
  },
  {
    sku: "EXC-FOOTING",
    name: "Footing Excavation",
    description: "Machine excavation and spoil removal, billed against surveyed volume.",
    family: "Sitework",
    costType: "equipment",
    // Quoted at an estimated volume and trued up against what was actually
    // dug, which is how earthwork is very often written.
    chargeType: "usage",
    billingPeriod: "monthly",
    unitOfMeasure: "CY",
    listPrice: 34,
    cost: 24.5,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 10,
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: { ...EMPTY_MATERIAL, division: "31" },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [
      { minQuantity: 1, maxQuantity: 99, kind: "percent", value: 0 },
      { minQuantity: 100, maxQuantity: null, kind: "percent", value: 12 },
    ],
    attributes: { Basis: "Surveyed neat line volume", Excludes: "Rock, dewatering, shoring" },
  },
  {
    sku: "GEN-DUMPSTER-30",
    name: "Dumpster, 30 Yard",
    description: "30 cubic yard roll-off: delivery, one pull and tipping fees.",
    family: "General Requirements",
    costType: "other",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "EA",
    listPrice: 620,
    cost: 470,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 10,
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: { ...EMPTY_MATERIAL, division: "01", supplier: "Tri-County Rentals", leadTimeDays: 2 },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [],
    attributes: { Size: "30 CY", Includes: "Delivery, one pull, 4 ton tipping allowance" },
  },
  {
    sku: "ASM-WALL-2X6",
    name: "Exterior Wall Assembly, 2×6",
    description:
      "One linear foot of 8′ exterior wall: studs at 16″ on centre, plates, sheathing and the crew to stand it.",
    family: "Assemblies",
    costType: "material",
    chargeType: "one-time",
    billingPeriod: "monthly",
    unitOfMeasure: "LF",
    // The assembly line itself carries only what its components do not: the
    // fasteners, the housewrap and the blocking nobody takes off separately.
    listPrice: 6.4,
    cost: 4.9,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 10,
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: { ...EMPTY_MATERIAL, division: "06" },
    optionGroups: [],
    rules: [],
    // Per linear foot of wall: 0.75 studs at 16" o.c. with corners and
    // openings, 0.375 sheets of sheathing (32 SF covers 4 LF of 8' wall).
    components: [
      { id: "cmp_stud", sku: "LBR-STUD-2X4", quantity: 1, required: true },
      { id: "cmp_osb", sku: "LBR-OSB-716", quantity: 1, required: true },
    ],
    volumeTiers: [],
    attributes: { Height: "8 ft", Spacing: "16 in o.c.", Includes: "Plates, sheathing, fasteners, housewrap" },
  },
];

/* ------------------------------ price books ------------------------------ */

export const SAMPLE_PRICE_BOOKS: PriceBookInput[] = [
  {
    name: "2026 published",
    description: "The published schedule of values. Every item's catalogue price, with the floors below which nothing sells.",
    currency: "USD",
    isDefault: true,
    active: true,
    validFrom: "",
    validTo: "",
    entries: [
      { sku: "LBR-STUD-2X4", unitPrice: 4.28, minPrice: 3.72, active: true },
      { sku: "LBR-OSB-716", unitPrice: 18.9, minPrice: 16.4, active: true },
      { sku: "CONC-RM-4000", unitPrice: 168, minPrice: 152, active: true },
      { sku: "RFG-SHNG-ARCH", unitPrice: 38.5, minPrice: 33.8, active: true },
      { sku: "DRY-5812-4X12", unitPrice: 21.4, minPrice: 18.9, active: true },
      { sku: "WIN-DH-3050", unitPrice: 412, minPrice: 342, active: true },
      { sku: "LAB-CARP-JRNY", unitPrice: 86, minPrice: 72, active: true },
      { sku: "LAB-CREW-FRAME", unitPrice: 2_560, minPrice: 2_150, active: true },
      { sku: "EQP-LIFT-19", unitPrice: 685, minPrice: 560, active: true },
      { sku: "SUB-ELEC-ROUGH", unitPrice: 14_800, minPrice: 13_600, active: true },
      { sku: "EXC-FOOTING", unitPrice: 34, minPrice: 27, active: true },
      { sku: "GEN-DUMPSTER-30", unitPrice: 620, minPrice: 520, active: true },
      { sku: "ASM-WALL-2X6", unitPrice: 6.4, minPrice: 5.4, active: true },
    ],
  },
  {
    name: "Repeat developer",
    description:
      "What a developer on their fourth building pays. Already sharpened, so the floors are what keep the next negotiation from going underwater.",
    currency: "USD",
    isDefault: false,
    active: true,
    validFrom: "",
    validTo: "",
    entries: [
      { sku: "LBR-STUD-2X4", unitPrice: 4.02, minPrice: 3.72, active: true },
      { sku: "LBR-OSB-716", unitPrice: 17.8, minPrice: 16.4, active: true },
      { sku: "CONC-RM-4000", unitPrice: 161, minPrice: 152, active: true },
      { sku: "RFG-SHNG-ARCH", unitPrice: 36.2, minPrice: 33.8, active: true },
      { sku: "DRY-5812-4X12", unitPrice: 20.1, minPrice: 18.9, active: true },
      { sku: "WIN-DH-3050", unitPrice: 384, minPrice: 342, active: true },
      { sku: "LAB-CARP-JRNY", unitPrice: 82, minPrice: 72, active: true },
      { sku: "LAB-CREW-FRAME", unitPrice: 2_430, minPrice: 2_150, active: true },
      { sku: "EQP-LIFT-19", unitPrice: 640, minPrice: 560, active: true },
      { sku: "SUB-ELEC-ROUGH", unitPrice: 14_200, minPrice: 13_600, active: true },
      { sku: "EXC-FOOTING", unitPrice: 31, minPrice: 27, active: true },
      { sku: "GEN-DUMPSTER-30", unitPrice: 590, minPrice: 520, active: true },
      { sku: "ASM-WALL-2X6", unitPrice: 6.05, minPrice: 5.4, active: true },
    ],
  },
];

/* ----------------------------- pricing rules ----------------------------- */

export const SAMPLE_PRICING_RULES: PricingRuleInput[] = [
  {
    name: "Long rental term",
    description: "Equipment held on a job past six months comes down in price, without undercutting a better rate already given.",
    scope: "line",
    condition: "termMonths >= 6 && isRecurring == 1",
    target: "discountPercent",
    expression: "max(discountPercent, 10)",
    appliesToFamily: "Equipment",
    appliesToSku: "",
    priority: 10,
    active: true,
    message: "Long-term rental rate",
  },
  {
    name: "Crew day rate over a full week",
    description: "Five days or more of the same crew is sold at the weekly rate.",
    scope: "line",
    condition: "quantity >= 5",
    target: "discountPercent",
    expression: "max(discountPercent, 8)",
    appliesToFamily: "",
    appliesToSku: "LAB-CREW-FRAME",
    priority: 20,
    active: true,
    message: "Weekly crew rate",
  },
  {
    name: "Subcontract markup",
    description:
      "Subcontracted work carries the general contractor's fee as an explicit adjustment rather than buried in the unit price, so the client can see what it is.",
    scope: "line",
    condition: "isSubcontract == 1",
    target: "adjustment",
    expression: "round(netTotal * 0.08, 2)",
    appliesToFamily: "",
    appliesToSku: "",
    priority: 30,
    active: true,
    message: "GC fee, 8%",
  },
  {
    name: "Large project rebate",
    description: "A rebate on a whole contract above a quarter of a million, applied to the estimate rather than to any one line.",
    scope: "quote",
    condition: "subtotal >= 250000",
    target: "discountPercent",
    expression: "max(discountPercent, 3)",
    appliesToFamily: "",
    appliesToSku: "",
    priority: 40,
    active: true,
    message: "Project rebate",
  },
];

/* ---------------------------- approval rules ----------------------------- */

/**
 * The approver is the account installing the sample, so the ladder can
 * actually be walked in a demo: submit a quote, approve it as yourself, send
 * it. Point them at real colleagues once there are some.
 *
 * Each rule asks one person here for the same reason — a quorum of two cannot
 * be met by one account, and a sample you cannot finish is worse than a simple
 * one. The shape is what the editor is for: add a second approver to the VP
 * rule and set it to two, and the demo turns into a board.
 */
export const sampleApprovalRules = (approverEmail: string): ApprovalRuleInput[] => [
  {
    name: "Estimating manager",
    scope: "quote",
    metric: "discountPercent",
    comparator: ">",
    threshold: 10,
    condition: "",
    level: 1,
    approvers: [approverEmail],
    approvalsRequired: 1,
    rejectionsRequired: 1,
    message: "More than 10% off the estimate needs the estimating manager.",
    active: true,
  },
  {
    name: "Below an item's own floor",
    scope: "line",
    metric: "floorBreach",
    comparator: ">",
    threshold: 0,
    condition: "",
    level: 1,
    approvers: [approverEmail],
    approvalsRequired: 1,
    rejectionsRequired: 1,
    message: "A line was cut past the ceiling its own catalogue item allows.",
    active: true,
  },
  {
    name: "Owner — thin job",
    scope: "quote",
    metric: "marginPercent",
    comparator: "<",
    threshold: 18,
    condition: "",
    level: 2,
    approvers: [approverEmail],
    approvalsRequired: 1,
    rejectionsRequired: 1,
    message: "Under 18% margin is a job that cannot absorb a surprise.",
    active: true,
  },
  {
    name: "Owner — large contract",
    scope: "quote",
    metric: "netTotal",
    comparator: ">",
    threshold: 500_000,
    condition: "",
    level: 2,
    approvers: [approverEmail],
    approvalsRequired: 1,
    rejectionsRequired: 1,
    message: "Anything over half a million is the owner's signature.",
    active: true,
  },
  {
    // The rule that makes the formula language earn its keep: this is a
    // policy about the *shape* of a job, not about any one number on it.
    name: "Owner — mostly subcontracted",
    scope: "quote",
    metric: "custom",
    comparator: ">",
    threshold: 0,
    condition: "subtotal > 100000 && costTotal > subtotal * 0.82",
    level: 2,
    approvers: [approverEmail],
    approvalsRequired: 1,
    rejectionsRequired: 1,
    message: "Cost is over 82% of the contract — check what is being carried for whom.",
    active: true,
  },
];

/* --------------------------------- clients -------------------------------- */

export const SAMPLE_ACCOUNTS: AccountInput[] = [
  {
    name: "Harbour Point Development",
    industry: "Property development",
    website: "https://harbourpoint.example.com",
    status: "customer",
    tags: ["repeat", "multifamily"],
    contacts: [
      {
        id: "con_hpd_dana",
        name: "Dana Okafor",
        title: "Development Manager",
        email: "dana.okafor@harbourpoint.example.com",
        phone: "+1 415 555 0142",
        role: "commercial",
        primary: true,
      },
      {
        id: "con_hpd_ap",
        name: "Accounts Payable",
        title: "",
        email: "ap@harbourpoint.example.com",
        phone: "",
        role: "billing",
        primary: false,
      },
      {
        id: "con_hpd_wren",
        name: "Wren Abiodun",
        title: "Principal",
        email: "w.abiodun@harbourpoint.example.com",
        phone: "+1 415 555 0107",
        role: "signatory",
        primary: false,
      },
    ],
    billingAddress: {
      line1: "1200 Embarcadero",
      line2: "Suite 400",
      city: "San Francisco",
      state: "CA",
      postalCode: "94107",
      country: "United States",
    },
    // The invoice goes to the development office; the lumber goes to the site.
    shippingAddress: {
      line1: "418 Cedar Row",
      line2: "",
      city: "Oakland",
      state: "CA",
      postalCode: "94607",
      country: "United States",
    },
    shippingSameAsBilling: false,
    currency: "USD",
    priceBookId: "",
    paymentTerms: "Net 30",
    paymentTermDays: 30,
    creditLimit: 2_500_000,
    defaultDiscountPercent: 0,
    taxExempt: false,
    taxPercent: 8.5,
    notes:
      "Fourth building with us. Pays on time, argues about change orders. Dana signs anything under $50k; " +
      "past that it goes to Wren.",
  },
  {
    name: "Tessellate Property Group",
    industry: "Commercial real estate",
    website: "https://tessellate.example.com",
    status: "prospect",
    tags: ["tenant-improvement", "prevailing-wage"],
    contacts: [
      {
        id: "con_tess_marco",
        name: "Marco Iversen",
        title: "Facilities Director",
        email: "m.iversen@tessellate.example.com",
        phone: "+1 510 555 0188",
        role: "commercial",
        primary: true,
      },
      {
        id: "con_tess_pm",
        name: "Priya Raghavan",
        title: "Project Manager",
        email: "p.raghavan@tessellate.example.com",
        phone: "+1 510 555 0190",
        role: "technical",
        primary: false,
      },
    ],
    billingAddress: {
      line1: "88 Mill Street",
      line2: "",
      city: "Berkeley",
      state: "CA",
      postalCode: "94710",
      country: "United States",
    },
    shippingAddress: {
      line1: "88 Mill Street",
      line2: "",
      city: "Berkeley",
      state: "CA",
      postalCode: "94710",
      country: "United States",
    },
    shippingSameAsBilling: true,
    currency: "USD",
    priceBookId: "",
    paymentTerms: "Net 45",
    paymentTermDays: 45,
    // Advisory only: nothing here blocks an estimate on it, because a limit
    // somebody typed last year would be wrong more often than right.
    creditLimit: 400_000,
    defaultDiscountPercent: 0,
    taxExempt: false,
    taxPercent: 8.5,
    notes: "Prevailing wage on anything they own. Marco wants two references before he will sign.",
  },
];

/* -------------------------------- projects -------------------------------- */

/**
 * Two jobs, at the two ends of a contractor's year.
 *
 * Cedar Row is under way and being billed — which is what makes the
 * receivables screen and the project roll-up show something. Mill Street is
 * still a bid, which is the state most work is in most of the time and the one
 * an empty app never demonstrates.
 */
export const SAMPLE_PROJECTS: Omit<ProjectInput, "accountName">[] = [
  {
    number: "",
    name: "Cedar Row Townhomes",
    accountId: "",
    status: "in_progress",
    contractType: "fixed_price",
    projectType: "Multifamily — 14 units",
    description: "Shell, envelope and rough-in for fourteen three-storey townhomes over a shared podium.",
    siteAddress: {
      line1: "418 Cedar Row",
      line2: "",
      city: "Oakland",
      state: "CA",
      postalCode: "94607",
      country: "United States",
    },
    startDate: "2026-03-02",
    targetCompletionDate: "2026-11-30",
    actualCompletionDate: "",
    projectManager: "",
    superintendent: "",
    permitNumber: "B2026-04417",
    clientReference: "HPD-CR-01",
    currency: "USD",
    contractValue: 1_850_000,
    tags: ["phase-1"],
    notes: "Podium poured. Framing started on units 1-6.",
  },
  {
    number: "",
    name: "Mill Street Offices — Level 3",
    accountId: "",
    status: "bidding",
    contractType: "unit_price",
    projectType: "Tenant improvement",
    description: "Full floor demolition and rebuild: partitions, ceilings, finishes and electrical rough-in.",
    siteAddress: {
      line1: "88 Mill Street",
      line2: "Level 3",
      city: "Berkeley",
      state: "CA",
      postalCode: "94710",
      country: "United States",
    },
    startDate: "",
    targetCompletionDate: "",
    actualCompletionDate: "",
    projectManager: "",
    superintendent: "",
    permitNumber: "",
    clientReference: "",
    currency: "USD",
    // No contract until somebody signs one, and a bid is not a contract.
    contractValue: 0,
    tags: ["prevailing-wage"],
    notes: "Bid due 2026-10-09. Marco wants unit rates rather than a lump sum.",
  },
];

/* ---------------------------- catalogue sources --------------------------- */

/**
 * One supplier feed, configured the careful way.
 *
 * It syncs costs and specification and **not the sell price**, it may not
 * create items, and anything moving more than 20% waits for a person. That is
 * not timidity: it is what the first run of a real feed should look like, and
 * the sample is the only documentation most people will read.
 *
 * It has no URL. A source fed by a dropped file is an ordinary source — plenty
 * of suppliers email a spreadsheet and have no endpoint at all — and starting
 * the example there means the sample workspace does not depend on a server
 * that is not there.
 */
export const SAMPLE_CATALOG_SOURCES: CatalogSourceInput[] = [
  {
    name: "Harbor Building Supply — weekly",
    description:
      "The Tuesday price list, as a CSV. Matched on their SKU, not ours: they know their own codes and know " +
      "nothing about ours.",
    format: "csv",
    url: "",
    recordPath: "",
    mapping: {
      ...EMPTY_MAPPING,
      key: "supplier_sku",
      matchOn: "supplierSku",
      sku: "our_sku",
      name: "description",
      cost: "unit_cost",
      unitOfMeasure: "uom",
      manufacturer: "manufacturer",
      manufacturerPartNumber: "mfr_part",
      supplierSku: "supplier_sku",
      leadTimeDays: "lead_days",
      weightPerUnit: "weight_lb",
    },
    policy: {
      // Cost and specification. The sell price stays ours.
      fields: ["cost", "manufacturer", "manufacturerPartNumber", "leadTimeDays", "weightPerUnit"],
      createMissing: false,
      deactivateMissing: false,
      maxPriceChangePercent: 20,
      markupPercent: 0,
      defaultFamily: "",
      defaultCostType: "material",
      currency: "USD",
    },
    active: true,
    lastRun: null,
  },
];

/**
 * A worked CSV for that source, so the sync screen has something to run
 * against before anybody has a supplier feed to point at.
 *
 * Deliberately awkward in the three ways a real price list is: a quoted
 * description with commas in it, a price with a currency symbol and a
 * thousands separator, and one row whose cost has moved far enough to be
 * flagged rather than applied.
 */
export const SAMPLE_FEED_CSV = [
  "supplier_sku,our_sku,description,uom,unit_cost,manufacturer,mfr_part,lead_days,weight_lb",
  'DF2-2X4-925,LBR-STUD-2X4,"2x4 Stud, 92-5/8in, DF #2",EA,$3.51,Cascade Mills,DF2-2X4,3,9.4',
  'OSB-716-48,LBR-OSB-716,"OSB Sheathing, 7/16in, 4x8",SHT,$19.64,,,3,46',
  'GYP-TX58-412,DRY-5812-4X12,"Gypsum Board, 5/8in Type X, 4x12",SHT,"$1,019.20",Keystone Gypsum,KG-TX58-412,5,96',
  'SHG-ARCH-WW,RFG-SHNG-ARCH,"Architectural Shingle, Weathered Wood",BDL,$32.85,Summit Roofing Products,SR-ARCH-130,7,78',
  'CAULK-SIL-10,,"Silicone Sealant, 10.1 oz",TUBE,$8.40,ChemBond,CB-SIL-10,2,1.1',
].join("\n");

/* --------------------------- proposal templates -------------------------- */

/*
 * The HTML proposal, branded.
 *
 * A text template needs nothing from this app to carry a logo — an `<img>`
 * with a `data:` URL is a picture that survives being saved to disk, emailed
 * and opened offline, which a link to an asset on a server is not. It is the
 * same logo, and the same argument, as the PDF templates: a document that
 * travels has to take its branding with it.
 */
const HTML_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{{quote.name}} — {{quote.number}}</title>
    <style>
      body { font: 15px/1.55 -apple-system, Segoe UI, Roboto, sans-serif; color: #18181b; margin: 0; padding: 48px; }
      header { display: flex; justify-content: space-between; align-items: start; border-bottom: 2px solid #1d4ed8; padding-bottom: 16px; }
      .brand { display: flex; gap: 12px; align-items: center; }
      .brand img { width: 44px; height: 44px; border-radius: 10px; }
      .brand-name { font-weight: 600; font-size: 15px; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      .muted { color: #71717a; font-size: 13px; }
      .parties { display: flex; gap: 48px; margin: 28px 0; }
      table { border-collapse: collapse; width: 100%; margin-top: 8px; }
      th { text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #71717a; border-bottom: 1px solid #e4e4e7; padding: 8px 10px; }
      td { padding: 10px; border-bottom: 1px solid #f4f4f5; }
      th:nth-child(n+3), td:nth-child(n+3) { text-align: right; white-space: nowrap; }
      .totals { margin-left: auto; width: 320px; margin-top: 20px; }
      .totals td { border: 0; padding: 4px 10px; }
      .totals tr:last-child td { border-top: 2px solid #18181b; font-weight: 600; font-size: 17px; padding-top: 10px; }
      footer { margin-top: 40px; border-top: 1px solid #e4e4e7; padding-top: 16px; }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">
        <img src="${SAMPLE_LOGO}" alt="Nimbus" />
        <div>
          <h1>{{quote.name}}</h1>
          <div class="muted">Quote {{quote.number}} · revision {{quote.version}} · {{quote.date}}</div>
        </div>
      </div>
      <div class="muted">
        <div class="brand-name">Nimbus Software Ltd</div>
        14 Harbour Road, Bristol BS1 5TY<br />
        Valid until <strong>{{quote.validUntil}}</strong>
      </div>
    </header>

    <div class="parties">
      <div>
        <div class="muted">Prepared for</div>
        <strong>{{customer.name}}</strong><br />
        {{customer.contactName}}<br />
        {{customer.address}}
      </div>
      <div>
        <div class="muted">Prepared by</div>
        <strong>{{seller.name}}</strong><br />
        {{seller.email}}<br />
        Terms: {{customer.paymentTerms}}
      </div>
    </div>

    <table>
      <thead>
        <tr><th>Item</th><th>Billing</th><th>Qty</th><th>Unit</th><th>Total</th></tr>
      </thead>
      <tbody>
        {{#lines}}<tr>
          <td><strong>{{line.name}}</strong><div class="muted">{{line.options}}{{line.description}}</div></td>
          <td class="muted">{{line.billing}}</td>
          <td>{{line.quantity}}</td>
          <td>{{line.unitPrice}}</td>
          <td>{{line.total}}</td>
        </tr>{{/lines}}
      </tbody>
    </table>

    <table class="totals">
      <tr><td class="muted">List</td><td>{{totals.listTotal}}</td></tr>
      <tr><td class="muted">Discount ({{totals.discountPercent}})</td><td>−{{totals.discount}}</td></tr>
      <tr><td class="muted">Shipping</td><td>{{totals.shipping}}</td></tr>
      <tr><td class="muted">Tax</td><td>{{totals.tax}}</td></tr>
      <tr><td>Total ({{quote.termMonths}} months)</td><td>{{totals.grandTotal}}</td></tr>
    </table>

    <footer>
      <p>{{quote.notes}}</p>
      <p class="muted">Recurring charges shown across the full {{quote.termMonths}}-month term ({{totals.mrr}} per month). Pricing is valid until {{quote.validUntil}}.</p>
    </footer>
  </body>
</html>`;

const MARKDOWN_TEMPLATE = `# {{quote.name}}

**Quote {{quote.number}}** · revision {{quote.version}} · {{quote.date}}
Valid until **{{quote.validUntil}}**

| Prepared for | Prepared by |
| --- | --- |
| {{customer.name}}<br>{{customer.contactName}}<br>{{customer.contactEmail}} | {{seller.name}}<br>{{seller.email}} |

## Items

{{lines.table}}

## Totals

| | |
| --- | --- |
| List | {{totals.listTotal}} |
| Discount ({{totals.discountPercent}}) | −{{totals.discount}} |
| Tax | {{totals.tax}} |
| **Total ({{quote.termMonths}} months)** | **{{totals.grandTotal}}** |

Monthly recurring: {{totals.mrr}} · Annual recurring: {{totals.arr}} · One-time: {{totals.oneTime}}

{{quote.notes}}

Payment terms: {{customer.paymentTerms}}`;

const TEXT_TEMPLATE = `{{quote.name}}
Quote {{quote.number}} (rev {{quote.version}}), {{quote.date}}
Valid until {{quote.validUntil}}

FOR
{{customer.name}}
{{customer.contactName}}
{{customer.address}}

FROM
{{seller.name}} <{{seller.email}}>

ITEMS
{{lines.table}}

List .......... {{totals.listTotal}}
Discount ...... -{{totals.discount}} ({{totals.discountPercent}})
Tax ........... {{totals.tax}}
TOTAL ......... {{totals.grandTotal}}  over {{quote.termMonths}} months

{{quote.notes}}

Payment terms: {{customer.paymentTerms}}`;

/*
 * The same two registers, for an invoice.
 *
 * Shorter than the proposal ones, and that is the point: a proposal argues,
 * an invoice states. What is owed, by when, against which purchase order,
 * and where to quote the number when paying.
 */
const INVOICE_MARKDOWN_TEMPLATE = `# Invoice {{invoice.number}}

**{{invoice.status}}** · issued {{invoice.date}} · due **{{invoice.dueDate}}** ({{invoice.paymentTerms}})

| Bill to | From |
| --- | --- |
| {{customer.name}}<br>{{customer.contactName}}<br>{{customer.contactEmail}} | {{seller.name}}<br>{{seller.email}} |

PO reference: {{invoice.poNumber}}

## Lines

{{lines.table}}

## Totals

| | |
| --- | --- |
| Subtotal | {{totals.subtotal}} |
| Tax | {{totals.tax}} |
| Total | {{totals.total}} |
| Paid | −{{totals.paid}} |
| Credited | −{{totals.credited}} |
| **Balance due** | **{{totals.balance}}** |

{{invoice.notes}}

Please quote {{invoice.number}} with your payment.`;

const INVOICE_TEXT_TEMPLATE = `INVOICE {{invoice.number}}
{{invoice.status}} · issued {{invoice.date}} · due {{invoice.dueDate}} ({{invoice.paymentTerms}})

BILL TO
{{customer.name}}
{{customer.contactName}}
{{customer.address}}

FROM
{{seller.name}} <{{seller.email}}>

PO: {{invoice.poNumber}}

LINES
{{lines.table}}

Subtotal ...... {{totals.subtotal}}
Tax ........... {{totals.tax}}
Total ......... {{totals.total}}
Paid .......... -{{totals.paid}}
Credited ...... -{{totals.credited}}
BALANCE DUE ... {{totals.balance}}

{{invoice.notes}}

Please quote {{invoice.number}} with your payment.`;

/* ----------------------------- PDF templates ----------------------------- */

/**
 * The PDF a customer receives, in four registers.
 *
 * `starterPdfTemplate()` is the plain full proposal — addresses, line items
 * with their configured options, a totals panel and signature lines. The three
 * below take it somewhere:
 *
 * - **Summary** is the same quote on one page: no signatures, no notes,
 *   tighter type. The bottom end of the range.
 * - **Branded** is the top end, and between them they use every block and
 *   every setting the format has — a repeating letterhead, a full line table,
 *   the whole customer-facing totals list, a terms page behind a page break.
 * - **Order form** is the shape nobody thinks of as a proposal: a cover
 *   graphic, a letterhead that appears once, and a table meant to be signed.
 *
 * They are examples in the strict sense — everything here is something you
 * could have built in the editor, and taking one apart is the fastest way to
 * find out what a block does.
 */
const PDF_SUMMARY: PdfTemplate = {
  page: {
    size: "A4",
    margins: { top: 48, right: 44, bottom: 48, left: 44 },
    family: "helvetica",
    fontSize: 9.5,
    textColor: "#18181b",
    mutedColor: "#71717a",
    accentColor: "#1d4ed8",
  },
  blocks: [
    { type: "heading", text: "Quote {{quote.number}}", size: 16, color: "#1d4ed8" },
    { type: "text", text: "{{quote.name}}", size: 11, spaceAfter: 2 },
    {
      type: "text",
      text: "Prepared for {{customer.name}} · valid until {{quote.validUntil}} · {{quote.termMonths}}-month term",
      size: 8.5,
      color: "#71717a",
    },
    { type: "divider", color: "#1d4ed8", thickness: 1.5 },
    { type: "spacer", height: 4 },
    {
      type: "lineItems",
      columns: [
        { field: "name", header: "Item", width: 6 },
        { field: "quantity", header: "Qty", width: 1, align: "right" },
        { field: "unitPrice", header: "Unit", width: 1.8, align: "right" },
        { field: "discountPercent", header: "Disc.", width: 1.2, align: "right" },
        { field: "total", header: "Total", width: 2.2, align: "right" },
      ],
      showOptions: true,
      showDescription: false,
      headerFill: "#eff6ff",
      fontSize: 9,
    },
    {
      type: "totals",
      width: 230,
      rows: [
        { label: "Subtotal", field: "subtotal" },
        { label: "Discount", field: "totalDiscount", omitIfZero: true },
        { label: "Tax", field: "taxAmount", omitIfZero: true },
        { label: "Total", field: "grandTotal", emphasis: true },
      ],
    },
    { type: "spacer", height: 6 },
    {
      type: "fields",
      rows: [
        { label: "Monthly recurring", value: "{{totals.mrr}}" },
        { label: "Annual recurring", value: "{{totals.arr}}" },
        { label: "One-time charges", value: "{{totals.oneTime}}" },
        { label: "Total contract value", value: "{{totals.tcv}}" },
      ],
    },
  ],
  footer: { text: "{{quote.number}} · prepared by {{seller.email}}", showPageNumbers: true },
};

/* ------------------------------ the branded one --------------------------- */

/**
 * The everything template: the one to open when you want to know what the
 * format can do.
 *
 * It carries a letterhead on every page, which is what the generous top margin
 * is for — the band is the margin, and content starts under it. The line table
 * shows six columns rather than five because a customer who is being asked for
 * a signature wants to see the discount they negotiated on the line it applies
 * to, and the totals list is the full customer-facing set including the
 * recurring split. Behind the page break is the part every real proposal has
 * and no minimal example ever does: the terms.
 */
const PDF_BRANDED: PdfTemplate = {
  page: {
    size: "A4",
    // The top margin is the letterhead band. A shallower one would print the
    // first heading over the logo.
    margins: { top: 96, right: 48, bottom: 64, left: 48 },
    family: "helvetica",
    fontSize: 10,
    textColor: "#18181b",
    mutedColor: "#71717a",
    accentColor: "#1d4ed8",
  },
  header: {
    logo: SAMPLE_LOGO,
    logoWidth: 40,
    logoAlign: "left",
    text: "Nimbus Software Ltd\n14 Harbour Road, Bristol BS1 5TY\nhello@nimbus.example · VAT GB 421 8890 23",
    rule: true,
  },
  blocks: [
    { type: "heading", text: "{{quote.name}}", size: 20, color: "#1d4ed8", spaceAfter: 2 },
    {
      type: "text",
      text: "Quote {{quote.number}} · revision {{quote.version}} · prepared {{quote.date}} · valid until {{quote.validUntil}}",
      size: 9,
      color: "#71717a",
      spaceAfter: 10,
    },
    {
      type: "columns",
      gap: 20,
      columns: [
        {
          heading: "PREPARED FOR",
          text: "{{customer.name}}\n{{customer.contactName}}\n{{customer.address}}",
        },
        {
          heading: "PREPARED BY",
          text: "{{seller.name}}\n{{seller.email}}\nNimbus Software Ltd",
        },
        {
          heading: "COMMERCIAL TERMS",
          text: "{{quote.termMonths}}-month term\nPayment {{customer.paymentTerms}}\nPriced in {{quote.currency}}",
          align: "right",
        },
      ],
    },
    { type: "divider", color: "#1d4ed8", thickness: 1.5 },
    { type: "spacer", height: 6 },
    { type: "heading", text: "What you are buying", size: 13, spaceAfter: 6 },
    {
      type: "lineItems",
      columns: [
        { field: "number", header: "#", width: 0.6 },
        { field: "sku", header: "SKU", width: 1.7 },
        { field: "name", header: "Item", width: 4.6 },
        { field: "quantity", header: "Qty", width: 0.9, align: "right" },
        // Wide enough for a five-figure unit price with a currency symbol in
        // front of it: a wrapped number in a money column reads as a mistake.
        { field: "unitPrice", header: "Unit", width: 2, align: "right" },
        { field: "discountPercent", header: "Disc.", width: 1, align: "right" },
        { field: "total", header: "Total", width: 2.2, align: "right" },
      ],
      showOptions: true,
      showDescription: true,
      headerFill: "#eff6ff",
      zebra: "#f8fafc",
      fontSize: 9,
    },
    {
      type: "totals",
      width: 260,
      rows: [
        { label: "List price", field: "listTotal" },
        { label: "Line discounts", field: "lineDiscountAmount", omitIfZero: true },
        { label: "Quote discount", field: "quoteDiscountAmount", omitIfZero: true },
        { label: "Discount off list", field: "effectiveDiscountPercent", omitIfZero: true },
        { label: "Shipping", field: "shipping", omitIfZero: true },
        { label: "Tax", field: "taxAmount", omitIfZero: true },
        { label: "Total", field: "grandTotal", emphasis: true },
      ],
    },
    { type: "spacer", height: 10 },
    {
      type: "fields",
      rows: [
        { label: "Monthly recurring", value: "{{totals.mrr}}" },
        { label: "Annual recurring", value: "{{totals.arr}}" },
        { label: "One-time charges", value: "{{totals.oneTime}}" },
        { label: "Total contract value", value: "{{totals.tcv}} over {{quote.termMonths}} months" },
      ],
    },
    { type: "text", text: "{{quote.notes}}", size: 9, color: "#52525b" },

    { type: "pageBreak" },

    { type: "heading", text: "Terms of this quote", size: 13, spaceAfter: 6 },
    {
      type: "text",
      text: "Pricing is held until {{quote.validUntil}} and assumes the full {{quote.termMonths}}-month term stated above. Recurring charges are billed in advance; one-time charges are invoiced on delivery. Payment terms are {{customer.paymentTerms}} from the date of invoice.",
      size: 9.5,
      spaceAfter: 8,
    },
    {
      type: "text",
      text: "Quantities may be increased mid-term at the unit prices shown here, pro-rated to the end of the current term. Reductions take effect at renewal. Taxes, where they apply, are shown separately and charged at the rate in force on the invoice date.",
      size: 9.5,
      spaceAfter: 8,
    },
    {
      type: "text",
      text: "This document is a quotation and not an invoice. It becomes an order when signed by both parties below.",
      size: 9.5,
      italic: true,
      spaceAfter: 10,
    },
    {
      type: "signatures",
      parties: [
        { label: "{{customer.name}}", caption: "Name, title and date" },
        { label: "Nimbus Software Ltd", caption: "Name, title and date" },
      ],
    },
  ],
  footer: { text: "{{quote.number}} · {{customer.name}} · commercial in confidence", showPageNumbers: true },
};

/* ------------------------------- the order form --------------------------- */

/**
 * The document that gets signed.
 *
 * Two things here that the proposals do not do: a full-width image in the
 * flow — the cover band across the top — and a letterhead set to `firstPageOnly`,
 * so the continuation pages are plain. Both are worth seeing, and an order
 * form is where they belong: it is a cover and a table, and nothing else.
 */
const PDF_ORDER_FORM: PdfTemplate = {
  page: {
    size: "A4",
    margins: { top: 74, right: 52, bottom: 56, left: 52 },
    family: "helvetica",
    fontSize: 10,
    textColor: "#0f172a",
    mutedColor: "#64748b",
    accentColor: "#0f172a",
  },
  header: {
    logo: SAMPLE_LOGO,
    logoWidth: 32,
    logoAlign: "right",
    text: "Nimbus Software Ltd\nOrder form",
    firstPageOnly: true,
  },
  blocks: [
    // The content width on A4 at these margins is 491pt, so this runs from
    // margin to margin.
    { type: "image", source: SAMPLE_COVER_BANNER, width: 491, spaceAfter: 16 },
    { type: "heading", text: "Order form", size: 22, spaceAfter: 2 },
    { type: "text", text: "{{customer.name}}", size: 13, spaceAfter: 2 },
    {
      type: "text",
      text: "Quote {{quote.number}} · revision {{quote.version}} · valid until {{quote.validUntil}}",
      size: 9,
      color: "#64748b",
      spaceAfter: 14,
    },
    {
      type: "fields",
      rows: [
        { label: "Account", value: "{{customer.name}}" },
        { label: "Contact", value: "{{customer.contactName}} · {{customer.contactEmail}}" },
        { label: "Billing address", value: "{{customer.address}}" },
        { label: "Payment terms", value: "{{customer.paymentTerms}}" },
        { label: "Term", value: "{{quote.termMonths}} months" },
        { label: "Currency", value: "{{quote.currency}}" },
      ],
    },
    { type: "divider", thickness: 1 },
    { type: "spacer", height: 4 },
    {
      type: "lineItems",
      columns: [
        { field: "name", header: "Item", width: 5.2 },
        { field: "billing", header: "Billing", width: 1.5 },
        { field: "term", header: "Term", width: 1.5 },
        { field: "quantity", header: "Qty", width: 0.8, align: "right" },
        { field: "unitPrice", header: "Unit price", width: 2.1, align: "right" },
        { field: "total", header: "Total", width: 2.2, align: "right" },
      ],
      showOptions: true,
      showDescription: false,
      headerFill: "#f1f5f9",
      fontSize: 9,
    },
    {
      type: "totals",
      width: 240,
      rows: [
        { label: "Subtotal", field: "subtotal" },
        { label: "Discount", field: "totalDiscount", omitIfZero: true },
        { label: "Shipping", field: "shipping", omitIfZero: true },
        { label: "Tax", field: "taxAmount", omitIfZero: true },
        { label: "Order total", field: "grandTotal", emphasis: true },
      ],
    },
    { type: "spacer", height: 8 },
    {
      type: "text",
      text: "By signing below, {{customer.name}} orders the items listed above under the terms of the quotation dated {{quote.date}}.",
      size: 9,
      color: "#475569",
    },
    {
      type: "signatures",
      parties: [
        { label: "{{customer.name}}", caption: "Signature, name and date" },
        { label: "Nimbus Software Ltd", caption: "Signature, name and date" },
      ],
    },
  ],
  footer: { text: "Order form {{quote.number}}", showPageNumbers: true },
};

export const SAMPLE_TEMPLATES: { name: string; kind: TemplateKind; format: ProposalFormat; body: string }[] = [
  { name: "Proposal — branded PDF", kind: "quote", format: "pdf", body: JSON.stringify(PDF_BRANDED) },
  { name: "Order form — PDF", kind: "quote", format: "pdf", body: JSON.stringify(PDF_ORDER_FORM) },
  { name: "Proposal — PDF", kind: "quote", format: "pdf", body: JSON.stringify(starterPdfTemplate()) },
  { name: "Quote summary — PDF", kind: "quote", format: "pdf", body: JSON.stringify(PDF_SUMMARY) },
  { name: "Proposal — letterhead", kind: "quote", format: "html", body: HTML_TEMPLATE },
  { name: "Proposal — Markdown", kind: "quote", format: "markdown", body: MARKDOWN_TEMPLATE },
  { name: "Quote summary — plain text", kind: "quote", format: "text", body: TEXT_TEMPLATE },
  { name: "Invoice — PDF", kind: "invoice", format: "pdf", body: JSON.stringify(starterPdfTemplate("invoice")) },
  { name: "Invoice — Markdown", kind: "invoice", format: "markdown", body: INVOICE_MARKDOWN_TEMPLATE },
  { name: "Invoice — plain text", kind: "invoice", format: "text", body: INVOICE_TEXT_TEMPLATE },
];

/** What a brand-new text template starts as, so the tokens are discoverable. */
export const starterTemplateBody = (kind: TemplateKind): string =>
  kind === "invoice" ? INVOICE_MARKDOWN_TEMPLATE : MARKDOWN_TEMPLATE;

/**
 * The quote the sample installs, written against SKUs rather than ids — the
 * seeder resolves them once the products exist.
 *
 * It is built to trip the approval ladder: 40 Enterprise users at 22% off,
 * with services, lands past the manager's 15% and drags the deal desk in on
 * the training line.
 */
export const SAMPLE_QUOTE = {
  name: "Cedar Row Townhomes — shell and envelope",
  accountName: "Harbour Point Development",
  projectName: "Cedar Row Townhomes",
  termMonths: 6,
  notes:
    "Quantities are taken off the 2026-08-14 permit set. Material allowances include waste; the electrical " +
    "subcontract is held at the bid price for 30 days.",
  internalNotes:
    "Shingle waste is at 12% for the hips. The lift is on the job six months — check whether the rental rule fired.",
  lines: [
    // A take-off in the units a building is measured in. What has to be
    // bought is worked out from the waste factors on the catalogue.
    { sku: "LBR-STUD-2X4", quantity: 2_240, discountPercent: 0, options: [] },
    { sku: "LBR-OSB-716", quantity: 310, discountPercent: 0, options: [] },
    { sku: "CONC-RM-4000", quantity: 96, discountPercent: 0, options: ["fiber", "air_entrained"] },
    { sku: "RFG-SHNG-ARCH", quantity: 210, discountPercent: 8, options: ["weathered_wood", "system_warranty"] },
    { sku: "DRY-5812-4X12", quantity: 640, discountPercent: 0, options: [] },
    { sku: "WIN-DH-3050", quantity: 56, discountPercent: 12, options: ["low_e_double", "colonial"] },
    { sku: "LAB-CREW-FRAME", quantity: 22, discountPercent: 0, options: [] },
    // The recurring one: a lift on the job for the length of the term.
    { sku: "EQP-LIFT-19", quantity: 1, discountPercent: 0, options: ["damage_waiver"] },
    { sku: "SUB-ELEC-ROUGH", quantity: 1, discountPercent: 0, options: [] },
    { sku: "GEN-DUMPSTER-30", quantity: 6, discountPercent: 0, options: [] },
  ],
} as const;

/* ------------------------------ receivables ------------------------------ */

/**
 * Three invoices, so the receivables screen arrives with a book on it rather
 * than five empty columns.
 *
 * Deliberately spread across the aging: one settled, one a fortnight late and
 * part paid, one badly overdue. The dates are relative to the day the sample
 * is installed, so the aging always reads the same however long the app has
 * been sitting there — an example whose numbers depend on when you clicked it
 * teaches nothing.
 */
export const SAMPLE_INVOICES: {
  accountName: string;
  /** Issued this many days before the install. Its terms decide when it fell due. */
  issuedDaysAgo: number;
  poNumber: string;
  notes: string;
  lines: { sku: string; description: string; quantity: number; unitPrice: number; taxPercent: number }[];
  /** Cash received against it, as a fraction of the total. 1 settles it. */
  paidFraction: number;
  paidDaysAgo: number;
}[] = [
  {
    accountName: "Harbour Point Development",
    // Net 30, issued 20 days ago: not yet due, and already paid in full.
    issuedDaysAgo: 20,
    poNumber: "PO-88213",
    notes: "Site work and foundations, per the schedule of values. Thank you.",
    lines: [
      { sku: "EXC-FOOTING", description: "Footing excavation — surveyed volume", quantity: 412, unitPrice: 34, taxPercent: 0 },
      { sku: "CONC-RM-4000", description: "Ready-mix 4000 PSI — footings and podium", quantity: 168, unitPrice: 168, taxPercent: 8.5 },
    ],
    paidFraction: 1,
    paidDaysAgo: 6,
  },
  {
    accountName: "Harbour Point Development",
    // Net 30, issued 45 days ago: a fortnight past due, half paid.
    issuedDaysAgo: 45,
    poNumber: "PO-88110",
    notes: "Framing package delivered and stood, units 1-6.",
    lines: [
      { sku: "LBR-STUD-2X4", description: "2×4 studs — units 1-6", quantity: 2_420, unitPrice: 4.02, taxPercent: 8.5 },
      { sku: "LAB-CREW-FRAME", description: "Framing crew — 11 working days", quantity: 11, unitPrice: 2_560, taxPercent: 0 },
    ],
    paidFraction: 0.5,
    paidDaysAgo: 12,
  },
  {
    accountName: "Tessellate Property Group",
    // Net 45, issued 160 days ago: comfortably into the 90+ column, untouched.
    issuedDaysAgo: 160,
    poNumber: "",
    notes: "Pre-construction: survey, measured drawings and budget estimate.",
    lines: [
      { sku: "LAB-CARP-JRNY", description: "Pre-construction survey and take-off", quantity: 46, unitPrice: 86, taxPercent: 0 },
    ],
    paidFraction: 0,
    paidDaysAgo: 0,
  },
];

/* ----------------------------- the specimen ------------------------------ */

/**
 * A fully priced estimate to design templates against.
 *
 * Built by running the real pricing engine over items defined right here,
 * rather than hand-written — a specimen whose totals do not add up is exactly
 * the thing a template preview must never show. It carries the awkward cases
 * on purpose: a long configured item name, an options line, a lump-sum
 * subcontract and a discount deep enough to be worth printing.
 */
export function specimenQuote(): Quote {
  const product = (overrides: Partial<Product>): Product => ({
    id: overrides.sku ?? "prd",
    sku: "SKU",
    name: "Product",
    description: "",
    family: "",
    chargeType: "recurring",
    billingPeriod: "monthly",
    unitOfMeasure: "EA",
    listPrice: 0,
    cost: 0,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 0,
    costType: "material",
    wasteFactorPercent: 0,
    purchaseMultiple: 0,
    material: { ...EMPTY_MATERIAL },
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [],
    attributes: {},
    ownerId: "",
    sharedWith: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  });

  const products = [
    product({
      sku: "RFG-SHNG-ARCH",
      name: "Architectural Shingles, 130 mph, Weathered Wood",
      chargeType: "one-time",
      unitOfMeasure: "BDL",
      listPrice: 38.5,
      cost: 31.2,
      // The specimen's awkward line: a waste factor and a purchase multiple
      // together, so a template that prints a quantity is designed against a
      // line where the take-off and the order quantity differ.
      wasteFactorPercent: 12,
      purchaseMultiple: 1,
      optionGroups: [
        {
          id: "g",
          key: "warranty",
          name: "Warranty",
          select: "one",
          required: true,
          options: [
            { id: "o1", key: "system_warranty", name: "System — 50 year non-prorated", priceDelta: 4.25 },
            { id: "o2", key: "ridge_vent", name: "Ridge vent system", priceDelta: 1.8 },
          ],
        },
      ],
    }),
    product({
      sku: "DRY-5812-4X12",
      name: "Gypsum Board, 5/8″ Type X 4×12",
      chargeType: "one-time",
      unitOfMeasure: "SHT",
      listPrice: 21.4,
      cost: 17.6,
      wasteFactorPercent: 15,
    }),
    product({
      sku: "SUB-ELEC-ROUGH",
      name: "Electrical rough-in — subcontract",
      chargeType: "one-time",
      costType: "subcontract",
      unitOfMeasure: "LS",
      listPrice: 14_800,
      cost: 12_900,
    }),
  ];

  const line = (productId: string, quantity: number, discountPercent: number, options: string[], sortOrder: number) => ({
    id: `ln_${productId}`,
    productId,
    quantity,
    discountPercent,
    unitPriceOverride: null,
    wastePercentOverride: null,
    selectedOptions: options,
    termMonths: 0,
    description: "",
    parentId: null,
    sortOrder,
  });

  const priced = priceQuote(
    [
      line("RFG-SHNG-ARCH", 96, 12, ["system_warranty", "ridge_vent"], 0),
      line("DRY-5812-4X12", 180, 8, [], 1),
      line("SUB-ELEC-ROUGH", 1, 0, [], 2),
    ],
    { currency: "USD", termMonths: 36, discountPercent: 0, taxPercent: 8.5, shipping: 0 },
    { products: new Map(products.map(entry => [entry.id, entry])), priceBook: null, rules: [] },
  );

  const today = new Date();
  const validUntil = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  return {
    id: "qte_specimen",
    number: "EST-2026-0042",
    name: "Cedar Row Townhomes — shell and envelope",
    status: "sent",
    version: 1,
    supersedesId: null,
    projectId: "prj_specimen",
    projectName: "PRJ-2026-0014 — Cedar Row Townhomes",
    customer: {
      accountId: "acc_specimen",
      name: "Harbour Point Development",
      contactName: "Dana Okafor",
      contactTitle: "Development Manager",
      contactEmail: "dana.okafor@harbourpoint.example.com",
      contactPhone: "+1 415 555 0142",
      billingAddress: {
        line1: "1200 Embarcadero",
        line2: "Suite 400",
        city: "San Francisco",
        state: "CA",
        postalCode: "94107",
        country: "United States",
      },
      shippingAddress: {
        line1: "418 Cedar Row",
        line2: "",
        city: "Oakland",
        state: "CA",
        postalCode: "94607",
        country: "United States",
      },
      paymentTerms: "Net 30",
    },
    priceBookId: "",
    currency: "USD",
    termMonths: 6,
    discountPercent: 0,
    taxPercent: 8.5,
    shipping: 0,
    validUntil: validUntil.toISOString().slice(0, 10),
    notes:
      "Quantities are taken off the 2026-08-14 permit set. Material allowances include waste; " +
      "the electrical subcontract is held at the bid price for 30 days.",
    internalNotes: "",
    lines: priced.lines,
    totals: priced.totals,
    approvals: [],
    approverIds: [],
    ownerId: "",
    sharedWith: [],
    sentAt: today.toISOString(),
    decidedAt: "",
    createdAt: today.toISOString(),
    updatedAt: today.toISOString(),
  };
}

/**
 * An invoice to design invoice templates against.
 *
 * Built the same way the specimen quote is — the real arithmetic over real
 * lines — and carrying the two things an invoice template has to be designed
 * against but a fresh one never shows: a part payment, so `Paid` and
 * `Balance due` are not the same number, and a credit, so the footer has all
 * six of its rows. It is dated a week past due on purpose, so
 * `{{invoice.status}}` renders "Overdue" in the preview and whoever is
 * building the template finds out what that looks like before a customer
 * does.
 */
export function specimenInvoice(): Invoice {
  const quote = specimenQuote();
  const currency = "USD" as const;

  const line = (
    sku: string,
    description: string,
    quantity: number,
    unitPrice: number,
    taxPercent: number,
  ): InvoiceLine => ({
    id: `iln_${sku.toLowerCase()}`,
    sourceLineId: null,
    sku,
    description,
    quantity,
    unitPrice,
    // Filled in by `invoiceTotals` below, which is the same function the
    // server re-totals with: a specimen whose lines do not add up is exactly
    // what a preview must never show.
    amount: 0,
    taxPercent,
    taxAmount: 0,
  });

  const lines = [
    line("PLAT-CORE", "Nimbus Platform — Enterprise, SSO and SCIM (40 users)", 40, 168.48, 8.5),
    line("STOR", "Managed Storage (60 TB)", 60, 16.2, 8.5),
    // Zero-rated beside standard-rated, which is the case a single-rate
    // invoice cannot express and this one can.
    line("ONBOARD", "Onboarding and migration", 1, 12_000, 0),
  ];

  const payments = [
    {
      id: "pay_specimen",
      invoiceId: "inv_specimen",
      receivedOn: addDays(todayIso(), -14),
      amount: 5_000,
      method: "bank_transfer" as const,
      reference: "FT2026041700931",
      note: "",
      ownerId: "",
      createdAt: "",
      updatedAt: "",
    },
  ];

  const credits = [
    {
      id: "crd_specimen",
      invoiceId: "inv_specimen",
      issuedOn: addDays(todayIso(), -10),
      amount: 250,
      reason: "goodwill" as const,
      note: "Late start on the migration.",
      ownerId: "",
      createdAt: "",
      updatedAt: "",
    },
  ];

  // Both from the same functions the server re-totals with, so the specimen
  // adds up the way a real invoice does.
  const priced = pricedLines(lines, currency);
  const totals = invoiceTotals(lines, payments, credits, currency);
  const issueDate = addDays(todayIso(), -37);

  return {
    id: "inv_specimen",
    number: "INV-2026-0042",
    quoteId: quote.id,
    quoteNumber: quote.number,
    projectId: quote.projectId,
    projectName: quote.projectName,
    customer: quote.customer,
    currency,
    state: "issued",
    issueDate,
    dueDate: dueDateFor(issueDate, 30),
    paymentTermDays: 30,
    poNumber: "PO-88417",
    notes: "Payable by transfer to the account on file. Late payment interest applies after 30 days.",
    internalNotes: "",
    lines: priced,
    payments,
    credits,
    totals,
    ownerId: "",
    sharedWith: [],
    createdAt: issueDate,
    updatedAt: todayIso(),
  };
}
