/**
 * The CPQ domain, shared by the server and the React UI.
 *
 * Five things are modelled here, and the order below is the order a quote
 * actually flows through them:
 *
 *   product   — what is sold: a price, a cost, options, rules, tiers
 *   price book— what it costs this customer: per-product overrides in one currency
 *   line      — one product on one quote: quantity, options, discount, term
 *   rule      — pricing and approval policy, expressed as formulas
 *   quote     — the document: lines, totals, approvals, status, a customer
 *
 * Two conventions run through the whole file.
 *
 * **Money is a plain number in the quote's currency.** Not minor units, not a
 * decimal library: every amount is rounded to the currency's precision at each
 * step by `src/lib/money.ts`, which is what keeps a total equal to the sum of
 * the lines a reader can see. See that file for why.
 *
 * **A quote snapshots what it was priced from.** A line carries the product's
 * name, SKU and list price as they were when it was priced, and the quote
 * carries the customer's details the same way. A quote sent last quarter still
 * renders correctly after the catalogue moves on, and a quote shared with a
 * colleague who cannot read your accounts still renders at all.
 */

/* ------------------------------- currency -------------------------------- */

/**
 * The currencies a price book may be denominated in. A closed list rather than
 * free text: the minor-unit count in `src/lib/money.ts` has to exist for every
 * one of them, and a quote whose currency nothing can round is worse than a
 * quote that could not be created.
 */
export const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "JPY", "CHF", "SEK", "INR", "BRL"] as const;

export type CurrencyCode = (typeof CURRENCIES)[number];

export const CURRENCY_SET: ReadonlySet<string> = new Set(CURRENCIES);

/* ----------------------------- construction ------------------------------ */

/**
 * The unit a material is measured, bought and billed in.
 *
 * A closed list rather than free text, and this is the one place the app is
 * opinionated about vocabulary: a take-off that says "SF" and a price list
 * that says "sq ft" describe the same square foot, and a catalogue that
 * cannot tell you so will happily multiply a price per square foot by a
 * quantity in sheets. Everything that converts, rounds or reconciles a
 * quantity goes through `src/lib/units.ts`, which needs an entry here for
 * every unit it may be handed.
 *
 * `EA` is the fallback for anything countable that has no better unit, and is
 * what an import falls back to rather than inventing one.
 */
export const UNITS_OF_MEASURE = [
  "EA",
  "LF",
  "SF",
  "SY",
  "CF",
  "CY",
  "BF",
  "LB",
  "TON",
  "KG",
  "GAL",
  "QT",
  "BAG",
  "BOX",
  "BDL",
  "ROLL",
  "SHT",
  "PC",
  "PR",
  "SQ",
  "PLT",
  "TUBE",
  "HR",
  "DAY",
  "WK",
  "MO",
  "LS",
] as const;

export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

export const UNIT_SET: ReadonlySet<string> = new Set(UNITS_OF_MEASURE);

/** What each unit means on a take-off, spelled out for the pickers. */
export const UNIT_LABELS: Record<UnitOfMeasure, string> = {
  EA: "Each",
  LF: "Linear foot",
  SF: "Square foot",
  SY: "Square yard",
  CF: "Cubic foot",
  CY: "Cubic yard",
  BF: "Board foot",
  LB: "Pound",
  TON: "Ton",
  KG: "Kilogram",
  GAL: "Gallon",
  QT: "Quart",
  BAG: "Bag",
  BOX: "Box",
  BDL: "Bundle",
  ROLL: "Roll",
  SHT: "Sheet",
  PC: "Piece",
  PR: "Pair",
  SQ: "Square (100 SF)",
  PLT: "Pallet",
  TUBE: "Tube",
  HR: "Hour",
  DAY: "Day",
  WK: "Week",
  MO: "Month",
  LS: "Lump sum",
};

/**
 * What kind of money a catalogue item is.
 *
 * The standard five buckets a job is costed in, and the reason this exists
 * separately from `family` (which is free text the estimator chooses) and from
 * `chargeType` (which is about *when* it is billed): a job's cost report is
 * always broken down these five ways, whatever the estimator called the
 * families, and an approval rule that wants to watch subcontracted work needs
 * a field it can trust rather than a naming convention it has to hope for.
 *
 * `material` is the default because it is the bulk of a catalogue and because
 * an item nobody classified is far more often a material than anything else.
 */
export type CostType = "material" | "labor" | "equipment" | "subcontract" | "other";

export const COST_TYPES: CostType[] = ["material", "labor", "equipment", "subcontract", "other"];

export const COST_TYPE_LABELS: Record<CostType, string> = {
  material: "Material",
  labor: "Labor",
  equipment: "Equipment",
  subcontract: "Subcontract",
  other: "Other",
};

/**
 * The CSI MasterFormat division an item belongs to.
 *
 * Stored as the two-digit string ("06"), not the name, because the names get
 * revised and the numbers do not — and because a supplier feed that carries a
 * classification at all carries the number. Empty means unclassified, which is
 * a perfectly ordinary state for a catalogue somebody is still building.
 *
 * Only the divisions a building contractor actually estimates against are
 * listed. MasterFormat runs to 48; the ones past 34 are process and utility
 * work that this app has no opinion about, and an item in one of those is
 * better left unclassified than filed under a division chosen for it.
 */
export const CSI_DIVISIONS: { code: string; name: string }[] = [
  { code: "01", name: "General Requirements" },
  { code: "02", name: "Existing Conditions" },
  { code: "03", name: "Concrete" },
  { code: "04", name: "Masonry" },
  { code: "05", name: "Metals" },
  { code: "06", name: "Wood, Plastics & Composites" },
  { code: "07", name: "Thermal & Moisture Protection" },
  { code: "08", name: "Openings" },
  { code: "09", name: "Finishes" },
  { code: "10", name: "Specialties" },
  { code: "11", name: "Equipment" },
  { code: "12", name: "Furnishings" },
  { code: "13", name: "Special Construction" },
  { code: "14", name: "Conveying Equipment" },
  { code: "21", name: "Fire Suppression" },
  { code: "22", name: "Plumbing" },
  { code: "23", name: "Heating, Ventilating & Air Conditioning" },
  { code: "26", name: "Electrical" },
  { code: "27", name: "Communications" },
  { code: "28", name: "Electronic Safety & Security" },
  { code: "31", name: "Earthwork" },
  { code: "32", name: "Exterior Improvements" },
  { code: "33", name: "Utilities" },
];

export const CSI_DIVISION_NAMES: Record<string, string> = Object.fromEntries(
  CSI_DIVISIONS.map(division => [division.code, division.name]),
);

/** "06" -> "06 — Wood, Plastics & Composites". Empty stays empty. */
export const divisionLabel = (code: string): string =>
  code ? `${code} — ${CSI_DIVISION_NAMES[code] ?? "Unclassified"}` : "";

/**
 * What a catalogue item physically is — the half of a building material that
 * a price does not describe.
 *
 * Everything here is optional and everything here is *inert to the pricing
 * engine* except `wasteFactorPercent` and `purchaseMultiple`, which are the
 * two that change what gets ordered. The rest is specification: it prints on a
 * submittal, it is what a supplier feed fills in, and it is what an estimator
 * searches by when they know the part but not the SKU.
 *
 * The nominal/actual split on dimensions is not pedantry. A 2×4 is 1½ × 3½,
 * every framer knows it, and a catalogue that records only one of the two
 * numbers is useless for whichever question you did not anticipate.
 */
export type MaterialSpec = {
  /** CSI MasterFormat division code, two digits. Empty is unclassified. */
  division: string;
  manufacturer: string;
  /** The manufacturer's own part number — what a submittal is checked against. */
  manufacturerPartNumber: string;
  /** Who you buy it from. Free text: a material has more than one source. */
  supplier: string;
  /** The supplier's code for it, which is rarely your SKU. */
  supplierSku: string;
  /** "2x4", "5/8 in", "R-21" — how the trade names the size. */
  nominalSize: string;
  /** "1.5 in x 3.5 in x 96 in" — what a tape measure says. */
  actualSize: string;
  /** Species, alloy, mix, grade: "Douglas Fir #2", "4000 PSI", "Type X". */
  grade: string;
  /** Finish or colour, where it is an ordering distinction rather than a taste. */
  finish: string;
  /** Pounds per stocking unit. Zero means unrecorded. Freight and crane picks read it. */
  weightPerUnit: number;
  /**
   * How much of `coverageUnit` one stocking unit covers — a bundle of shingles
   * covering 33.3 SF, a tube of sealant running 55 LF. Zero means the item
   * does not cover anything, which is most of them.
   */
  coverage: number;
  coverageUnit: UnitOfMeasure | "";
  /** Working days from order to site. Zero means unrecorded, not "immediate". */
  leadTimeDays: number;
  /** Whether it needs a submittal before it may be installed. */
  submittalRequired: boolean;
};

export const EMPTY_MATERIAL: MaterialSpec = {
  division: "",
  manufacturer: "",
  manufacturerPartNumber: "",
  supplier: "",
  supplierSku: "",
  nominalSize: "",
  actualSize: "",
  grade: "",
  finish: "",
  weightPerUnit: 0,
  coverage: 0,
  coverageUnit: "",
  leadTimeDays: 0,
  submittalRequired: false,
};

/**
 * Where a catalogue item's numbers last came from.
 *
 * A catalogue that syncs from a supplier feed is a catalogue where "why is
 * this $4.12" has an answer, and this is it: which feed, what that feed calls
 * the item, and when it last said so. Absent on anything typed in by hand,
 * which is the honest distinction — a hand-priced item is somebody's decision
 * and a synced one is a supplier's.
 */
export type CatalogProvenance = {
  /** The `catalog_sources` record it came from. */
  sourceId: string;
  sourceName: string;
  /** The key the feed identified it by, which is rarely the local SKU. */
  sourceKey: string;
  /** ISO timestamp of the sync that last wrote to this item. */
  syncedAt: string;
  /** What that sync set, so a surprising price says where it came from. */
  fields: string[];
};

/* -------------------------------- product -------------------------------- */

/**
 * How an item is billed, which is what decides where its money lands in the
 * totals.
 *
 * `one-time` is nearly everything on a construction estimate: material
 * delivered, labour performed, a subcontract let. `recurring` is what is
 * rented — a lift on the job for four months, a temporary fence, a service
 * agreement after handover — and it bills per period for the length of the
 * term. `usage` is a unit-rate item quoted at an estimated quantity and
 * trued up against what was actually placed, which is how excavation and
 * concrete are very often written.
 */
export type ChargeType = "one-time" | "recurring" | "usage";

export const CHARGE_TYPES: ChargeType[] = ["one-time", "recurring", "usage"];

/** How often a recurring charge is billed. Ignored for one-time products. */
export type BillingPeriod = "monthly" | "quarterly" | "annual";

export const BILLING_PERIODS: BillingPeriod[] = ["monthly", "quarterly", "annual"];

/** Months in one billing period — the divisor behind every MRR figure. */
export const BILLING_PERIOD_MONTHS: Record<BillingPeriod, number> = {
  monthly: 1,
  quarterly: 3,
  annual: 12,
};

/**
 * One choice inside an option group.
 *
 * An option changes the line's unit price in one of two ways, and a group may
 * mix them: `priceDelta` adds a fixed amount (an add-on module at $12/user),
 * `priceFactor` multiplies (a "Premium" tier at 1.4× the base). Both apply
 * when both are set — the factor first, then the delta, so a percentage uplift
 * never silently scales a flat add-on.
 */
export type ProductOption = {
  id: string;
  /** Referenced by configuration rules and validation formulas as `option.<key>`. */
  key: string;
  name: string;
  description?: string;
  /** Added to the unit price when selected. May be negative. */
  priceDelta: number;
  /** Multiplies the unit price when selected. 1 (or absent) means no change. */
  priceFactor?: number;
  /** Preselected when the line is first configured. */
  default?: boolean;
};

/**
 * A set of options the buyer picks from.
 *
 * `select: "one"` is a radio group, `"many"` a checkbox list. `minSelect` and
 * `maxSelect` bound a `"many"` group; a required `"one"` group means exactly
 * one, which is the common case and needs no bounds.
 */
export type OptionGroup = {
  id: string;
  key: string;
  name: string;
  description?: string;
  select: "one" | "many";
  required: boolean;
  /** "many" groups only. Absent means unbounded. */
  minSelect?: number;
  maxSelect?: number;
  options: ProductOption[];
};

/**
 * A configuration rule, evaluated against the options selected on a line.
 *
 * - `requires`  — if everything in `when` is selected, everything in `then` must be too
 * - `excludes`  — if everything in `when` is selected, nothing in `then` may be
 * - `recommend` — same trigger, but advisory: it warns rather than blocks
 * - `validate`  — an arbitrary formula over the line that must hold
 *
 * `when` and `then` hold option *keys*, which is what makes a rule survive a
 * product being exported and re-imported with fresh ids.
 */
export type ProductRuleKind = "requires" | "excludes" | "recommend" | "validate";

export const PRODUCT_RULE_KINDS: ProductRuleKind[] = ["requires", "excludes", "recommend", "validate"];

export type ProductRule = {
  id: string;
  kind: ProductRuleKind;
  /** Option keys that trigger the rule. Empty means "always", for `validate`. */
  when: string[];
  /** Option keys the rule acts on. Unused by `validate`. */
  then: string[];
  /**
   * `validate` only: a formula that must evaluate to a non-zero (true) number.
   * Variables are `quantity`, `term`, and `option.<key>` as 1 or 0.
   */
  expression?: string;
  /** Shown to the person configuring the line when the rule fires. */
  message: string;
};

/**
 * A product pulled in by a bundle.
 *
 * A bundle prices as its own line plus one child line per component, so the
 * quote shows what the customer is actually getting rather than one opaque
 * number. A `required` component cannot be removed from the bundle.
 */
export type BundleComponent = {
  id: string;
  /** The component product's SKU — stable across export and import, unlike an id. */
  sku: string;
  quantity: number;
  required: boolean;
  /** A discount the bundle grants on this component, 0-100. */
  discountPercent?: number;
};

/**
 * One band of a volume-pricing table.
 *
 * Tiers are matched on the line's quantity and are *not* cumulative: the band
 * a quantity falls into sets the whole line's unit price. That is how
 * published price breaks read ("100-499 seats: $18") and it is what a customer
 * comparing two quotes expects.
 */
export type VolumeTier = {
  /** Inclusive lower bound. */
  minQuantity: number;
  /** Inclusive upper bound; null or absent is "and above". */
  maxQuantity?: number | null;
  /** `percent` and `amount` come off the unit price; `override` replaces it. */
  kind: "percent" | "amount" | "override";
  value: number;
};

export const TIER_KINDS: VolumeTier["kind"][] = ["percent", "amount", "override"];

export type Product = {
  id: string;
  /** The catalogue key. Unique per account, and what bundles and files reference. */
  sku: string;
  name: string;
  description: string;
  /** Free-text grouping — "Framing", "Roofing". Pricing rules can target it. */
  family: string;
  /** Material, labour, equipment, subcontract — how a job's cost report adds it up. */
  costType: CostType;
  chargeType: ChargeType;
  /** Recurring items only — equipment rented by the month, a service agreement. */
  billingPeriod: BillingPeriod;
  /** The unit it is bought, measured and billed in. */
  unitOfMeasure: UnitOfMeasure;
  /** The catalogue price, in `currency`. A price book overrides it per customer. */
  listPrice: number;
  /** What it costs to deliver one unit. Drives margin, and is never shown to a buyer. */
  cost: number;
  currency: CurrencyCode;
  active: boolean;
  minQuantity: number;
  /** 0 means unbounded. */
  maxQuantity: number;
  /** The most an estimator may discount this line before approval is needed, 0-100. */
  floorDiscountPercent: number;
  /**
   * How much more of this than the take-off measured you actually have to buy,
   * 0-100. Drywall gets cut to fit, tile breaks, lumber has crooked sticks in
   * every unit — a take-off is the finished quantity and this is the
   * difference between that and the delivery ticket.
   *
   * It is on the product because it is a property of the material (sheet goods
   * waste more than studs), and it is overridable on the line because it is
   * also a property of the job (a cut-up roof wastes more than a gable).
   */
  wasteFactorPercent: number;
  /**
   * The lot it is sold in. Concrete comes by the quarter yard, studs by the
   * stick, shingles by the bundle: an order quantity is rounded *up* to a
   * multiple of this, because a supplier will not break a pallet and an
   * estimate that assumes they will is short.
   *
   * 0 or 1 means it is sold in any quantity, which is the common case.
   */
  purchaseMultiple: number;
  /** What it physically is: division, manufacturer, size, grade, coverage. */
  material: MaterialSpec;
  /** Which feed last wrote to it, if any. Absent on anything hand-priced. */
  provenance?: CatalogProvenance | null;
  optionGroups: OptionGroup[];
  rules: ProductRule[];
  components: BundleComponent[];
  volumeTiers: VolumeTier[];
  /** Arbitrary catalogue metadata, rendered on proposals as a spec table. */
  attributes: Record<string, string>;
  ownerId: string;
  sharedWith: string[];
  createdAt: string;
  updatedAt: string;
};

/** True when the product pulls other products onto the quote with it. */
export const isBundle = (product: Pick<Product, "components">) => product.components.length > 0;

/* ------------------------------ price books ------------------------------ */

/**
 * One product's price in one price book.
 *
 * `minPrice` is a hard floor: no discount, tier or pricing rule may take the
 * line's unit price below it. That is the difference between a price book and
 * a discount — a floor is a commitment the business made to itself.
 */
export type PriceBookEntry = {
  /** The product's SKU, not its id: a price book survives a catalogue re-import. */
  sku: string;
  unitPrice: number;
  minPrice?: number | null;
  active?: boolean;
};

export type PriceBook = {
  id: string;
  name: string;
  description: string;
  currency: CurrencyCode;
  /** The book a new quote starts on when the account names none. */
  isDefault: boolean;
  active: boolean;
  /** ISO dates. Empty means no bound. A quote outside the window is warned about. */
  validFrom: string;
  validTo: string;
  entries: PriceBookEntry[];
  ownerId: string;
  sharedWith: string[];
  createdAt: string;
  updatedAt: string;
};

/* ----------------------------- pricing rules ----------------------------- */

/**
 * A pricing rule adjusts a line, or the quote as a whole, by formula.
 *
 * This is the escape hatch that stops a CPQ needing a code change for every
 * commercial policy: "20% off Platform above 500 seats", "add 8% uplift on
 * three-year terms", "cap Services at 15% of the software total". The formula
 * language is the one in `src/lib/formula.ts` — arithmetic, comparisons and
 * logic, parsed to an AST and evaluated by hand, so nothing here is `eval`.
 */
export type PricingRuleScope = "line" | "quote";

/**
 * What the rule's expression produces.
 *
 * - `unitPrice`       — replaces the unit price outright
 * - `discountPercent` — replaces the line or quote discount, 0-100
 * - `adjustment`      — an amount added to (or, negative, taken off) the net
 */
export type PricingRuleTarget = "unitPrice" | "discountPercent" | "adjustment";

export const PRICING_RULE_TARGETS: PricingRuleTarget[] = ["unitPrice", "discountPercent", "adjustment"];

export type PricingRule = {
  id: string;
  name: string;
  description: string;
  scope: PricingRuleScope;
  /**
   * A formula that must be non-zero for the rule to fire. Empty means always.
   * Line scope sees the line variables, quote scope the quote variables — both
   * listed by `PRICING_VARIABLES` in src/lib/pricing.ts.
   */
  condition: string;
  target: PricingRuleTarget;
  /** The formula producing the new value, over the same variables. */
  expression: string;
  /** Line scope only: limit the rule to one family, or one SKU. Empty is "any". */
  appliesToFamily: string;
  appliesToSku: string;
  /** Lowest first. Each rule sees the values the previous ones produced. */
  priority: number;
  active: boolean;
  /** Shown on the line it changed, so a surprising price explains itself. */
  message: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

/** What a rule did to one line or quote, kept so the UI can show its work. */
export type AppliedRule = {
  ruleId: string;
  name: string;
  target: PricingRuleTarget;
  from: number;
  to: number;
  message: string;
};

/* ---------------------------- approval rules ----------------------------- */

/**
 * The metric an approval rule watches.
 *
 * `custom` hands the decision to a formula instead, for policies no single
 * number expresses ("services above 20% of software needs the VP").
 */
export type ApprovalMetric =
  | "discountPercent"
  | "marginPercent"
  | "netTotal"
  | "termMonths"
  | "floorBreach"
  | "custom";

export const APPROVAL_METRICS: ApprovalMetric[] = [
  "discountPercent",
  "marginPercent",
  "netTotal",
  "termMonths",
  "floorBreach",
  "custom",
];

/** What each metric watches, for the rule editor and the API index. */
export const APPROVAL_METRIC_LABELS: Record<ApprovalMetric, string> = {
  discountPercent: "Effective discount off list, as a percentage",
  marginPercent: "Margin, as a percentage of what is charged",
  netTotal: "Value after every discount, before tax",
  termMonths: "Subscription length in months",
  floorBreach: "A line discounted past the ceiling its own product allows",
  custom: "A formula you write, over the same variables the pricing rules use",
};

export type Comparator = ">" | ">=" | "<" | "<=" | "==";

export const COMPARATORS: Comparator[] = [">", ">=", "<", "<=", "=="];

export type ApprovalRule = {
  id: string;
  name: string;
  /** `quote` weighs the whole document; `line` fires on any single line. */
  scope: PricingRuleScope;
  metric: ApprovalMetric;
  comparator: Comparator;
  threshold: number;
  /** `custom` only: a formula that triggers the rule when non-zero. */
  condition: string;
  /** Ascending. A quote needs every level at or below the highest it triggers. */
  level: number;
  /**
   * Everyone asked. They see the quote this rule fired on, and nothing else
   * of yours.
   */
  approvers: string[];
  /**
   * How many of them must approve before this rule is satisfied.
   *
   * 1 is "any one of them" — a rota, where whoever is at their desk answers.
   * `approvers.length` is "all of them" — a board, where everyone signs. The
   * numbers in between are the interesting ones: two of your three regional
   * directors, say.
   */
  approvalsRequired: number;
  /**
   * How many must reject before the quote comes back.
   *
   * Separate from `approvalsRequired` on purpose, and usually smaller: a deal
   * that needs two yeses very often needs only one no. Setting both to 1 on a
   * pair of approvers is "first answer wins", which is a real policy.
   */
  rejectionsRequired: number;
  message: string;
  active: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

/** One person's answer on one request. */
export type ApprovalDecision = {
  approverEmail: string;
  decision: "approved" | "rejected";
  decidedAt: string;
  comment: string;
};

/**
 * One approval a quote is waiting on, or has already had.
 *
 * A request is addressed to everyone on its rule at once and keeps every
 * answer it has been given, rather than being a single yes/no. Its own
 * `status` is derived from those answers against the two quorums — see
 * `requestStatus` in src/lib/approvals.ts, which is the only place that
 * decision is made.
 */
export type ApprovalRequest = {
  id: string;
  ruleId: string;
  ruleName: string;
  level: number;
  /** Everyone this request is addressed to. */
  approverEmails: string[];
  approvalsRequired: number;
  rejectionsRequired: number;
  /** Why it triggered, in numbers: "Discount 32.0% > 25%". */
  reason: string;
  status: "pending" | "approved" | "rejected";
  /** The line it fired on, for a line-scoped rule. */
  lineId?: string | null;
  /** Everyone who has answered so far, in the order they answered. */
  decisions: ApprovalDecision[];
  requestedAt: string;
};

/* -------------------------------- accounts ------------------------------- */

export type Address = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export const EMPTY_ADDRESS: Address = { line1: "", line2: "", city: "", state: "", postalCode: "", country: "" };

/**
 * What one person at a customer is there for.
 *
 * A deal is rarely one relationship: the person who negotiates is not the one
 * who pays the invoice, and neither is the one who signs. The role is what
 * lets a proposal be addressed to the right one of them without anybody
 * having to remember which line of the notes field said so.
 */
export type ContactRole = "commercial" | "billing" | "technical" | "signatory" | "other";

export const CONTACT_ROLES: ContactRole[] = ["commercial", "billing", "technical", "signatory", "other"];

export const CONTACT_ROLE_LABELS: Record<ContactRole, string> = {
  commercial: "Commercial",
  billing: "Billing",
  technical: "Technical",
  signatory: "Signatory",
  other: "Other",
};

/** One person at a customer. */
export type AccountContact = {
  id: string;
  name: string;
  /** Their job title — "VP Operations". Shown, never matched on. */
  title: string;
  email: string;
  phone: string;
  role: ContactRole;
  /**
   * The one a quote is addressed to. Exactly one contact carries it, which
   * `readAccount` enforces rather than trusting: a proposal addressed to two
   * people or to none is a document nobody can send.
   */
  primary: boolean;
};

export const EMPTY_CONTACT: Omit<AccountContact, "id"> = {
  name: "",
  title: "",
  email: "",
  phone: "",
  role: "commercial",
  primary: false,
};

/**
 * Where a customer stands with you.
 *
 * Three states rather than a pipeline: this is a quoting tool, not a CRM, and
 * the only distinction it can honestly make is between somebody you are
 * chasing, somebody who has bought, and somebody you have stopped quoting.
 * `inactive` is the useful one — it keeps a customer's history without
 * keeping them in the list you scroll every morning.
 */
export type AccountStatus = "prospect" | "customer" | "inactive";

export const ACCOUNT_STATUSES: AccountStatus[] = ["prospect", "customer", "inactive"];

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  prospect: "Prospect",
  customer: "Customer",
  inactive: "Inactive",
};

export type Account = {
  id: string;
  name: string;
  industry: string;
  website: string;
  status: AccountStatus;
  /** Free segmentation — "enterprise", "emea", "renewal-q3". Lowercased. */
  tags: string[];
  /** Everyone you deal with there. One of them is `primary`. */
  contacts: AccountContact[];
  billingAddress: Address;
  /**
   * Where the goods go, which is not always where the invoice does. Kept
   * equal to the billing address while `shippingSameAsBilling`, so everything
   * downstream can read it without asking which flag is set.
   */
  shippingAddress: Address;
  shippingSameAsBilling: boolean;
  currency: CurrencyCode;
  /** The price book quotes for this customer start on. Empty uses the default book. */
  priceBookId: string;
  /** "Net 30". Copied onto the quote and rendered on the proposal. */
  paymentTerms: string;
  /**
   * The same terms as a number, which is the form anything can calculate
   * with: an invoice's due date is its issue date plus this. Kept beside the
   * text rather than parsed out of it at the point of use, because "Net 30
   * from end of month" is a sentence no due-date function should be reading.
   * `readAccount` seeds it from the text when the text names a number.
   */
  paymentTermDays: number;
  /**
   * The most this customer may owe at once, in their currency. 0 is "no
   * limit set" rather than "no credit": a limit nobody has thought about
   * should not stop a sale, it should just not claim to be a limit.
   */
  creditLimit: number;
  /** A standing discount every quote for this account starts with, 0-100. */
  defaultDiscountPercent: number;
  taxExempt: boolean;
  /** Sales tax / VAT applied to this customer's quotes, 0-100. */
  taxPercent: number;
  notes: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * The contact a quote is addressed to.
 *
 * The flagged one, falling back to the first — an account read from a record
 * written before contacts existed, or one whose primary was just deleted in
 * the editor, still has somebody to address.
 */
export const primaryContact = (account: Pick<Account, "contacts">): AccountContact | null =>
  account.contacts.find(contact => contact.primary) ?? account.contacts[0] ?? null;

/**
 * The customer details a quote carries itself.
 *
 * Copied from the account when the quote is created or the account is
 * re-attached, and then frozen: a quote is a document about a moment, and the
 * address it was sent to does not change because the account record did.
 */
export type CustomerSnapshot = {
  accountId: string | null;
  name: string;
  /** The account's primary contact, flattened: a document addresses one person. */
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  contactPhone: string;
  billingAddress: Address;
  shippingAddress: Address;
  paymentTerms: string;
};

export const EMPTY_CUSTOMER: CustomerSnapshot = {
  accountId: null,
  name: "",
  contactName: "",
  contactTitle: "",
  contactEmail: "",
  contactPhone: "",
  billingAddress: { ...EMPTY_ADDRESS },
  shippingAddress: { ...EMPTY_ADDRESS },
  paymentTerms: "",
};

/**
 * A blank snapshot, addresses and all.
 *
 * Spreading `EMPTY_CUSTOMER` copies the top level and shares the two address
 * objects with every other quote that did the same — harmless while nothing
 * writes to them, and a very confusing bug the first time something does.
 */
export const emptyCustomer = (): CustomerSnapshot => ({
  ...EMPTY_CUSTOMER,
  billingAddress: { ...EMPTY_ADDRESS },
  shippingAddress: { ...EMPTY_ADDRESS },
});

/* --------------------------------- quotes -------------------------------- */

/**
 * Where a quote is in its life.
 *
 * `draft` → `in_review` (approvals outstanding) → `approved` → `sent` →
 * `accepted` / `declined`. `rejected` comes back from an approver and returns
 * the quote to the rep, and `expired` is what `validUntil` makes of a quote
 * nobody answered. The legal transitions live in `QUOTE_TRANSITIONS` below, so
 * the server and the UI agree on which buttons exist.
 */
export type QuoteStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "rejected"
  | "sent"
  | "accepted"
  | "declined"
  | "expired";

export const QUOTE_STATUSES: QuoteStatus[] = [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "sent",
  "accepted",
  "declined",
  "expired",
];

/**
 * Which statuses each status may move to, by an explicit request.
 *
 * Two of them are not in here because they are not anybody's to request:
 * `in_review` and `approved` are decided by the approval engine when a quote
 * is submitted, and `expired` by the clock.
 */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent"],
  in_review: ["draft"],
  approved: ["sent", "draft"],
  rejected: ["draft"],
  sent: ["accepted", "declined", "draft"],
  accepted: [],
  declined: ["draft"],
  expired: ["draft"],
};

/** A quote may only be edited while it is still the rep's to edit. */
export const isEditableStatus = (status: QuoteStatus) => status === "draft" || status === "rejected";

/**
 * One line as the person quoting entered it — everything the price is derived
 * *from*, and nothing derived. This is what the client sends and what is
 * stored; the numbers below are recomputed from it on every save.
 */
export type QuoteLineInput = {
  id: string;
  /** The product's id. The SKU is snapshotted beside it when priced. */
  productId: string;
  quantity: number;
  /** A manual discount the estimator applied, 0-100. */
  discountPercent: number;
  /** A negotiated unit price. `null` means "whatever the price book says". */
  unitPriceOverride: number | null;
  /**
   * This job's waste allowance for this line, 0-100, or `null` to use the
   * material's own. A cut-up hip roof and a plain gable take the same
   * shingle and waste quite different amounts of it.
   */
  wastePercentOverride: number | null;
  /** Selected option keys, across every group on the product. */
  selectedOptions: string[];
  /** Subscription length in months. Recurring lines only; 0 uses the quote's term. */
  termMonths: number;
  /** An estimator's note that replaces the catalogue description on the proposal. */
  description: string;
  /** The bundle line this came from, if any. Component lines are not editable. */
  parentId: string | null;
  sortOrder: number;
};

/**
 * A line with its price worked out.
 *
 * Every intermediate number is kept rather than just the total, because the
 * question a CPQ is always asked is "why is it that price" — the UI walks
 * these fields to answer it, and `appliedRules` names what moved it.
 */
export type PricedLine = QuoteLineInput & {
  /* --- catalogue snapshot, as it was when this line was priced --- */
  sku: string;
  name: string;
  family: string;
  costType: CostType;
  chargeType: ChargeType;
  billingPeriod: BillingPeriod;
  unitOfMeasure: UnitOfMeasure;
  /** Names of the selected options, for display and for the proposal. */
  optionNames: string[];

  /* --- the take-off, and what it turns into on a purchase order --- */
  /**
   * What is actually bought and billed: the take-off quantity plus waste,
   * rounded up to the material's purchase multiple.
   *
   * `quantity` above stays exactly what the estimator measured, and this is
   * derived from it on every pricing pass. Keeping the two apart is what stops
   * a re-save from applying the waste factor a second time — and it is what
   * lets the line show both numbers, which is the pair a superintendent
   * checking a delivery actually wants.
   */
  orderQuantity: number;
  /** The percentage used, after the line's override or the material's default. */
  wastePercent: number;
  /** `orderQuantity − quantity`: the allowance, in the line's own unit. */
  wasteQuantity: number;

  /* --- the price, step by step --- */
  /** The price book's price, or the product's list price when it has no entry. */
  listUnitPrice: number;
  /** What the selected options added to (or took off) one unit. */
  optionsUnitDelta: number;
  /** After options and the volume tier, before discounts and rules. */
  baseUnitPrice: number;
  /** The tier the quantity landed in, or null when the product has no tiers. */
  tier: VolumeTier | null;
  /** What is actually charged per unit, after everything. */
  unitPrice: number;
  /** `listUnitPrice` × quantity × periods — what it would cost undiscounted. */
  listTotal: number;
  /** Everything taken off `listTotal`, as one number. */
  discountAmount: number;
  /** What the customer pays for this line over the whole term. */
  netTotal: number;
  /** `discountAmount` as a percentage of `listTotal`. */
  effectiveDiscountPercent: number;
  /** Billing periods this line is charged for; 1 for one-time products. */
  periods: number;

  /* --- margin, never shown to a buyer --- */
  unitCost: number;
  costTotal: number;
  margin: number;
  marginPercent: number;

  /* --- revenue shape --- */
  oneTime: number;
  monthlyRecurring: number;
  annualRecurring: number;

  /* --- provenance --- */
  appliedRules: AppliedRule[];
  /** Configuration and floor problems. A quote with any of these cannot be sent. */
  issues: string[];
  /** Advisory notes: a recommended option not taken, a tier just out of reach. */
  warnings: string[];
};

export type QuoteTotals = {
  currency: CurrencyCode;
  lineCount: number;
  /** Undiscounted value of every line. */
  listTotal: number;
  /** Line-level discounts, tiers and rules. */
  lineDiscountAmount: number;
  /** After line discounts, before the quote-level discount. */
  subtotal: number;
  /** The whole-quote discount, in money. */
  quoteDiscountAmount: number;
  /**
   * What quote-scoped pricing rules added or took off, as one amount. Kept
   * apart from the discount because a surcharge is not a negative discount,
   * and a totals panel that says so confuses everyone who reads it.
   */
  quoteAdjustment: number;
  /** After every discount and adjustment, before tax. */
  netTotal: number;
  taxAmount: number;
  shipping: number;
  grandTotal: number;
  /** `listTotal` − `netTotal`, over `listTotal`. The number an approver reads. */
  effectiveDiscountPercent: number;
  costTotal: number;
  margin: number;
  marginPercent: number;
  /* Revenue shape, which is what a subscription business actually reports. */
  oneTimeTotal: number;
  monthlyRecurringTotal: number;
  annualRecurringTotal: number;
  /** One-time charges plus the full recurring value of the term. */
  totalContractValue: number;
};

export type Quote = {
  id: string;
  /** Human-facing and sequential per account: "EST-2026-0007". */
  number: string;
  name: string;
  status: QuoteStatus;
  /** 1 for the original; a revision of a sent quote increments it. */
  version: number;
  /** The quote this one revises, if any. */
  supersedesId: string | null;
  /**
   * The job this is for, if any.
   *
   * Empty is ordinary and stays supported: an estimate is very often written
   * before there is a project record to hang it on — that is what a bid *is* —
   * and forcing one into existence first would make the fast path the
   * awkward one.
   */
  projectId: string;
  /** Its name and number, snapshotted, so a list reads without a join. */
  projectName: string;
  customer: CustomerSnapshot;
  priceBookId: string;
  currency: CurrencyCode;
  /** Default subscription length for recurring lines that name none. */
  termMonths: number;
  /** A discount on the whole quote, applied after line discounts, 0-100. */
  discountPercent: number;
  taxPercent: number;
  shipping: number;
  /** ISO date. Past it, the quote reads as expired. */
  validUntil: string;
  notes: string;
  /** Not shown to the customer — the rep's own working notes. */
  internalNotes: string;
  lines: PricedLine[];
  totals: QuoteTotals;
  approvals: ApprovalRequest[];
  /** Who the quote is waiting on, flattened for PocketBase's access rules. */
  approverIds: string[];
  ownerId: string;
  sharedWith: string[];
  sentAt: string;
  decidedAt: string;
  createdAt: string;
  updatedAt: string;
};

/** A quote without its lines — what the list endpoint and the sidebar use. */
export type QuoteSummary = Omit<Quote, "lines" | "approvals"> & {
  lineCount: number;
  pendingApprovals: number;
};

/* ------------------------------- templates ------------------------------- */

/**
 * The customer-facing document a record is rendered into.
 *
 * A template is text with `{{token}}` placeholders in one of three formats,
 * or a `pdf` document description. Nothing is executed: rendering substitutes
 * strings, so a template is a document, never a program.
 */
export type ProposalFormat = "html" | "markdown" | "text" | "pdf";

export const PROPOSAL_FORMATS: ProposalFormat[] = ["html", "markdown", "text", "pdf"];

/**
 * The three text formats hold their document as text with `{{token}}` holes.
 * A `pdf` template holds a JSON document description instead — see
 * src/lib/pdfTemplate.ts for why a PDF cannot be described as text.
 */
export const isPdfFormat = (format: ProposalFormat): boolean => format === "pdf";

/**
 * What a template is *for*, which is what decides its token vocabulary.
 *
 * A quote template reaches `{{quote.number}}` and the pricing totals; an
 * invoice template reaches `{{invoice.dueDate}}` and the ledger. They are one
 * collection and one editor because a template is a template — the letterhead,
 * the address panel and the PDF block language are identical, and only the
 * meaning of a token differs. They are not one *vocabulary* because a token
 * that resolved to a blank half the time would be worse than one that does
 * not exist.
 *
 * The kinds live here rather than in either vocabulary so that neither has to
 * import the other.
 */
export type TemplateKind = "quote" | "invoice";

export const TEMPLATE_KINDS: TemplateKind[] = ["quote", "invoice"];

export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  quote: "Quote",
  invoice: "Invoice",
};

export type ProposalTemplate = {
  id: string;
  name: string;
  /** Which record it renders. A template written before invoices is a quote's. */
  kind: TemplateKind;
  format: ProposalFormat;
  body: string;
  ownerId: string;
  sharedWith: string[];
  createdAt: string;
  updatedAt: string;
};

/* ------------------------------ receivables ------------------------------ */

/**
 * An invoice: what a customer owes, and what has come back against it.
 *
 * A quote is an offer and an invoice is a demand, which is why they are
 * separate records rather than two states of one. The quote can be revised,
 * superseded and re-priced; the invoice is a number sent to an accounts
 * payable department, and the only honest way to change it is to credit it.
 *
 * Two conventions, both borrowed from elsewhere in this app because they
 * earned their keep there.
 *
 * **The invoice carries its own copy of everything.** The customer, their
 * address, the payment terms it was raised under, the price of every line.
 * The account can move to Net 60 tomorrow; an invoice already issued is still
 * due when it was always due.
 *
 * **Its status is derived, never assigned.** Only `state` is recorded — is it
 * a draft, has it been issued, was it voided — and everything a person
 * actually reads (open, part paid, paid, overdue) is worked out from the
 * ledger it carries and the date, by `invoiceStatus` in src/lib/receivable.ts.
 * The alternative is a stored status that disagrees with the arithmetic, and
 * in accounts receivable that is the one bug nobody forgives.
 */

/** How the money arrived. Reporting only — none of it changes the maths. */
export type PaymentMethod = "bank_transfer" | "card" | "cheque" | "cash" | "other";

export const PAYMENT_METHODS: PaymentMethod[] = ["bank_transfer", "card", "cheque", "cash", "other"];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  card: "Card",
  cheque: "Cheque",
  cash: "Cash",
  other: "Other",
};

/**
 * Cash actually received against one invoice.
 *
 * Its own record, in its own collection, rather than an entry in the
 * invoice's JSON. Three things follow from that and all three are the reason
 * for it:
 *
 * **Recording one is an insert.** It used to be a read-modify-write of the
 * whole invoice, so two people banking payments at the same moment could lose
 * one of them. An insert cannot.
 *
 * **Cash is answerable on its own.** "What came in last month" is a question
 * about payments, not about invoices, and it was previously unaskable without
 * opening every invoice in the workspace.
 *
 * **It has an identity and an audit trail** — an owner, a created date, a
 * durable id — like every other record here rather than an object inside
 * another record's field.
 */
export type InvoicePayment = {
  id: string;
  /** The invoice it settles. A payment always belongs to exactly one. */
  invoiceId: string;
  /**
   * ISO date the money arrived — not the day somebody keyed it in. Aging is
   * measured against the calendar, so the difference is a real one, and
   * `createdAt` is the day it was keyed in.
   */
  receivedOn: string;
  amount: number;
  method: PaymentMethod;
  /** Bank reference, cheque number, processor id — whatever ties it to a statement. */
  reference: string;
  note: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * Why an amount was taken off an invoice without anybody paying it.
 *
 * `write_off` is the one that matters to a finance team: it is the admission
 * that the money is not coming, and it is deliberately not the same thing as
 * an `adjustment` that corrects an invoice raised wrongly.
 */
export type CreditReason = "adjustment" | "return" | "goodwill" | "write_off";

export const CREDIT_REASONS: CreditReason[] = ["adjustment", "return", "goodwill", "write_off"];

export const CREDIT_REASON_LABELS: Record<CreditReason, string> = {
  adjustment: "Adjustment",
  return: "Return",
  goodwill: "Goodwill",
  write_off: "Write-off",
};

/**
 * An amount forgiven, corrected or written off. Reduces the balance; no cash
 * moved. Its own record, for the same reasons as a payment.
 */
export type InvoiceCredit = {
  id: string;
  invoiceId: string;
  issuedOn: string;
  amount: number;
  reason: CreditReason;
  note: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * One billable line.
 *
 * Tax is per line rather than per invoice, because a single invoice very
 * often mixes rates — zero-rated services beside standard-rated goods — and
 * an invoice that can only hold one rate forces the seller to split the
 * document to stay correct.
 */
export type InvoiceLine = {
  id: string;
  /** The quote line this was raised from, when it came from a quote. */
  sourceLineId: string | null;
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  /** `quantity × unitPrice`, rounded. Recomputed on every save, never trusted. */
  amount: number;
  taxPercent: number;
  taxAmount: number;
};

/**
 * What is recorded about an invoice — the whole of what anyone sets.
 *
 * `draft` is still the seller's to change. `issued` has gone to the customer
 * and is now a receivable. `void` is an invoice that should never have
 * existed; an invoice that existed and will not be paid is written off with a
 * credit instead, because the difference is one a finance team reports on.
 */
export type InvoiceState = "draft" | "issued" | "void";

export const INVOICE_STATES: InvoiceState[] = ["draft", "issued", "void"];

/**
 * What an invoice *is*, once the ledger and the calendar have had their say.
 *
 * Derived by `invoiceStatus`, never stored. `overdue` in particular cannot be
 * a stored value: nothing happens on the due date except the date arriving.
 */
export type InvoiceStatus = "draft" | "open" | "part_paid" | "paid" | "overdue" | "void";

export const INVOICE_STATUSES: InvoiceStatus[] = ["draft", "open", "part_paid", "paid", "overdue", "void"];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  open: "Open",
  part_paid: "Part paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

/**
 * What an invoice comes to.
 *
 * Split down the middle by where the numbers come from. `subtotal`,
 * `taxAmount` and `total` are a pure function of the invoice's own lines, and
 * are stored with it. `paidAmount`, `creditedAmount` and `balance` are a
 * function of its ledger, which lives in two other collections — so they are
 * **computed on every read** rather than cached on the invoice.
 *
 * That is deliberate. A cached balance is a number that can disagree with the
 * payments behind it, and a finance system is the last place to keep one.
 * Reading a page of invoices costs two extra queries for the whole page — not
 * one per invoice — which is a price worth paying to make drift impossible.
 */
export type InvoiceTotals = {
  currency: CurrencyCode;
  lineCount: number;
  /** Every line, before tax. */
  subtotal: number;
  taxAmount: number;
  /** What was demanded: subtotal plus tax. */
  total: number;
  /** Cash received. Summed from the `payments` collection at read time. */
  paidAmount: number;
  /** Amounts credited or written off. Summed from `credits` at read time. */
  creditedAmount: number;
  /**
   * `total − paid − credited`, and **allowed to be negative**: a customer who
   * pays an invoice twice is owed the difference, and clamping it at zero
   * would be the app quietly losing their money.
   */
  balance: number;
};

export type Invoice = {
  id: string;
  /** Human-facing and sequential per account: "INV-2026-0007". */
  number: string;
  /** The quote this was raised from, if any. */
  quoteId: string | null;
  /** Its number, snapshotted, so the link still reads after the quote is gone. */
  quoteNumber: string;
  /** The job this bills against, inherited from the quote it was raised from. */
  projectId: string;
  projectName: string;
  customer: CustomerSnapshot;
  currency: CurrencyCode;
  state: InvoiceState;
  /** ISO date. Empty until it is issued — a draft has no date on it. */
  issueDate: string;
  /** ISO date: `issueDate` plus the terms below. What aging is measured from. */
  dueDate: string;
  /**
   * The terms this invoice was raised under, in days, snapshotted from the
   * customer. Moving an account to Net 60 must not move a due date that an
   * accounts payable department has already diarised.
   */
  paymentTermDays: number;
  /** The customer's own purchase order reference. Many will not pay without it. */
  poNumber: string;
  /** Printed on the invoice. */
  notes: string;
  /** Never shown to the customer — the collections note. */
  internalNotes: string;
  lines: InvoiceLine[];
  /**
   * Its ledger, read from the `payments` and `credits` collections and
   * attached here for whoever is holding the invoice. Not stored on it — see
   * `InvoiceTotals`.
   */
  payments: InvoicePayment[];
  credits: InvoiceCredit[];
  totals: InvoiceTotals;
  ownerId: string;
  sharedWith: string[];
  createdAt: string;
  updatedAt: string;
};

/**
 * An invoice without its lines or its ledger rows — what the list endpoint
 * returns. Its `totals` are still whole, balance included: the list reads
 * every payment and credit in two queries and adds them up, because a list of
 * invoices with no balances on it is not worth returning.
 */
export type InvoiceSummary = Omit<Invoice, "lines" | "payments" | "credits"> & {
  lineCount: number;
  paymentCount: number;
  creditCount: number;
};

/* --------------------------- catalogue sources ---------------------------- */

/**
 * How a feed's payload is shaped.
 *
 * Two formats, because between them they cover every price list anybody
 * actually sends: a spreadsheet exported as CSV, and a JSON endpoint.
 */
export type SourceFormat = "csv" | "json";

export const SOURCE_FORMATS: SourceFormat[] = ["csv", "json"];

/**
 * What a feed's rows are matched against in the catalogue.
 *
 * Almost always the supplier's own SKU: a feed knows its own codes and knows
 * nothing about yours, and matching on your SKU works right up until the day
 * somebody in the office renames one. The manufacturer part number is the
 * other honest key, and is the one to use when several suppliers quote the
 * same manufactured item.
 */
export type MatchKey = "sku" | "supplierSku" | "manufacturerPartNumber";

export const MATCH_KEYS: MatchKey[] = ["sku", "supplierSku", "manufacturerPartNumber"];

export const MATCH_KEY_LABELS: Record<MatchKey, string> = {
  sku: "Our SKU",
  supplierSku: "Supplier SKU",
  manufacturerPartNumber: "Manufacturer part number",
};

/**
 * The fields a feed may be trusted with.
 *
 * This is the important half of the whole sync design. A feed owns the fields
 * you name here and **nothing else** — your waste factors, your option groups,
 * your assemblies, your margins and your discount ceilings are yours, and a
 * supplier's spreadsheet may not touch them however many columns it has.
 *
 * `cost` and `price` are separate entries on purpose. Most trade feeds quote
 * *your cost*, not your sell price, and a contractor who lets a supplier set
 * what they charge their client has made a mistake that this app should not
 * make easy.
 */
export type SyncField =
  | "name"
  | "description"
  | "cost"
  | "price"
  | "unitOfMeasure"
  | "family"
  | "division"
  | "manufacturer"
  | "manufacturerPartNumber"
  | "supplier"
  | "supplierSku"
  | "nominalSize"
  | "actualSize"
  | "grade"
  | "finish"
  | "weightPerUnit"
  | "coverage"
  | "coverageUnit"
  | "leadTimeDays"
  | "active";

export const SYNC_FIELDS: SyncField[] = [
  "name",
  "description",
  "cost",
  "price",
  "unitOfMeasure",
  "family",
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
  "active",
];

export const SYNC_FIELD_LABELS: Record<SyncField, string> = {
  name: "Name",
  description: "Description",
  cost: "Unit cost",
  price: "List price",
  unitOfMeasure: "Unit of measure",
  family: "Family",
  division: "CSI division",
  manufacturer: "Manufacturer",
  manufacturerPartNumber: "Manufacturer part number",
  supplier: "Supplier",
  supplierSku: "Supplier SKU",
  nominalSize: "Nominal size",
  actualSize: "Actual size",
  grade: "Grade / mix",
  finish: "Finish",
  weightPerUnit: "Weight per unit",
  coverage: "Coverage",
  coverageUnit: "Coverage unit",
  leadTimeDays: "Lead time",
  active: "Active",
};

/**
 * Which column in the feed supplies which field.
 *
 * Every value is a column name as it appears in the feed's own header row (or
 * a key in its JSON objects), and an empty string means "this feed does not
 * carry that". Nothing is inferred from column names at sync time — the
 * mapping is written once, reviewed, and then it is what runs. A feed that
 * silently re-guesses its own columns is a feed that reprices the catalogue
 * the week the supplier renames a heading.
 */
export type SourceMapping = {
  /** The column holding the key rows are matched on. Required. */
  key: string;
  /** What that key is compared against in the catalogue. */
  matchOn: MatchKey;
  /** The column that supplies the SKU for items this feed creates. */
  sku: string;
  name: string;
  description: string;
  family: string;
  unitOfMeasure: string;
  cost: string;
  price: string;
  active: string;
  division: string;
  manufacturer: string;
  manufacturerPartNumber: string;
  supplier: string;
  supplierSku: string;
  nominalSize: string;
  actualSize: string;
  grade: string;
  finish: string;
  weightPerUnit: string;
  coverage: string;
  coverageUnit: string;
  leadTimeDays: string;
};

export const EMPTY_MAPPING: SourceMapping = {
  key: "",
  matchOn: "supplierSku",
  sku: "",
  name: "",
  description: "",
  family: "",
  unitOfMeasure: "",
  cost: "",
  price: "",
  active: "",
  division: "",
  manufacturer: "",
  manufacturerPartNumber: "",
  supplier: "",
  supplierSku: "",
  nominalSize: "",
  actualSize: "",
  grade: "",
  finish: "",
  weightPerUnit: "",
  coverage: "",
  coverageUnit: "",
  leadTimeDays: "",
};

/**
 * What a sync is allowed to do, once it has read the feed.
 *
 * Every field here exists because the alternative is a supplier's spreadsheet
 * quietly rewriting a catalogue that estimates are being priced from.
 */
export type SyncPolicy = {
  /** The only fields this feed may write. Everything else is left alone. */
  fields: SyncField[];
  /** Whether rows with no match may be added to the catalogue. */
  createMissing: boolean;
  /**
   * Whether items this feed used to carry and no longer does are switched off.
   *
   * Off by default, and deliberately deactivation rather than deletion: an
   * item on a signed estimate must not vanish because a supplier trimmed
   * their catalogue.
   */
  deactivateMissing: boolean;
  /**
   * A price or cost move larger than this, as a percentage, is **flagged
   * instead of applied** — it appears in the plan, with both numbers, for a
   * person to accept or reject.
   *
   * This is the guard against the failure that actually happens: a feed with
   * a misplaced decimal point, a units change nobody announced, a currency
   * swap. 0 disables it, which is a choice somebody has to make deliberately.
   */
  maxPriceChangePercent: number;
  /**
   * The markup applied to a cost to produce a list price, as a percentage,
   * when the feed carries a cost and `price` is synced but has no column.
   * 0 leaves the price alone.
   */
  markupPercent: number;
  /** What a created item is filed under when the feed does not say. */
  defaultFamily: string;
  defaultCostType: CostType;
  /** The currency the feed's numbers are in. */
  currency: CurrencyCode;
};

export const DEFAULT_SYNC_POLICY: SyncPolicy = {
  // Cost and specification by default; the sell price is not a supplier's to set.
  fields: ["cost", "name", "manufacturer", "manufacturerPartNumber", "supplier", "leadTimeDays"],
  createMissing: false,
  deactivateMissing: false,
  maxPriceChangePercent: 25,
  markupPercent: 0,
  defaultFamily: "",
  defaultCostType: "material",
  currency: "USD",
};

/** What one sync run did, kept on the source so the last one is always visible. */
export type SyncRunSummary = {
  /** ISO timestamp the run finished. */
  ranAt: string;
  /** Who ran it. */
  byEmail: string;
  /** Whether it was applied or only previewed. */
  applied: boolean;
  rowsRead: number;
  created: number;
  updated: number;
  unchanged: number;
  flagged: number;
  deactivated: number;
  skipped: number;
  /** One sentence if the run could not complete at all. */
  error: string;
};

/**
 * A feed the catalogue is kept up to date from.
 *
 * A supplier price list at a URL, or a file somebody drops on the page. The
 * record holds where it comes from, how its columns map onto catalogue fields,
 * and what a sync is permitted to change — which is the part worth reviewing,
 * and the reason this is a stored record rather than a dialog you fill in
 * every time.
 */
export type CatalogSource = {
  id: string;
  name: string;
  description: string;
  format: SourceFormat;
  /**
   * Where to fetch it. Empty means this source is fed by upload only, which is
   * a perfectly ordinary way to run one — plenty of suppliers email a
   * spreadsheet and have no endpoint at all.
   */
  url: string;
  /**
   * JSON only: the dotted path to the array of records inside the payload,
   * for an endpoint that wraps its list in an envelope ("data.items"). Empty
   * means the payload is itself the array.
   */
  recordPath: string;
  mapping: SourceMapping;
  policy: SyncPolicy;
  active: boolean;
  lastRun: SyncRunSummary | null;
  ownerId: string;
  sharedWith: string[];
  createdAt: string;
  updatedAt: string;
};

/* -------------------------------- projects -------------------------------- */

/**
 * Where a job stands.
 *
 * Six states, and the shape of them is what makes this a contractor's app
 * rather than a sales one. `lead` and `bidding` are work you are chasing;
 * `awarded` is the moment a contract exists and the estimate stops being an
 * offer; `in_progress` is the long middle where the invoicing happens; and
 * `complete` is handover, not final payment — a job can be finished and still
 * be owed for, which is precisely why the receivables ledger is a separate
 * thing from this.
 */
export type ProjectStatus = "lead" | "bidding" | "awarded" | "in_progress" | "complete" | "cancelled";

export const PROJECT_STATUSES: ProjectStatus[] = [
  "lead",
  "bidding",
  "awarded",
  "in_progress",
  "complete",
  "cancelled",
];

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  lead: "Lead",
  bidding: "Bidding",
  awarded: "Awarded",
  in_progress: "In progress",
  complete: "Complete",
  cancelled: "Cancelled",
};

/** The statuses that mean somebody is building something. */
export const isLiveProject = (status: ProjectStatus): boolean =>
  status === "awarded" || status === "in_progress";

/**
 * How a job was bought, which is the single most useful thing to know about it.
 *
 * It decides what the estimate *is*: under `fixed_price` the estimate is the
 * price and the risk of a bad take-off is the contractor's; under
 * `cost_plus` it is a projection and the client carries the overrun; under
 * `time_and_materials` it is an authorisation to start. This app does not
 * enforce anything different for each — it records which conversation you are
 * in, which is what the estimator needs and what the client will ask.
 */
export type ContractType = "fixed_price" | "cost_plus" | "time_and_materials" | "unit_price";

export const CONTRACT_TYPES: ContractType[] = ["fixed_price", "cost_plus", "time_and_materials", "unit_price"];

export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  fixed_price: "Fixed price",
  cost_plus: "Cost plus",
  time_and_materials: "Time and materials",
  unit_price: "Unit price",
};

/**
 * A job.
 *
 * The record every estimate and every invoice hangs off, and the reason this
 * app is not a CPQ: a client is a relationship, but a *project* is the thing
 * that gets built, gets billed and gets argued about. Two buildings for the
 * same developer share an account and share nothing else — different site,
 * different permit, different superintendent, different money.
 *
 * Almost nothing here is calculated. The money a project has actually made is
 * a function of its estimates and its invoices, lives in `src/lib/projects.ts`
 * and is worked out on every read, for the same reason an invoice's balance
 * is: a stored contract value is a number that disagrees with the documents
 * underneath it the first time anybody revises one.
 */
export type Project = {
  id: string;
  /** Human-facing and sequential per account: "PRJ-2026-0007". */
  number: string;
  name: string;
  /** The client this is for. Empty for speculative work not yet attached to one. */
  accountId: string;
  /** Their name as it was when the project was created, so the list reads without a join. */
  accountName: string;
  status: ProjectStatus;
  contractType: ContractType;
  /** "Multifamily", "Tenant improvement", "Custom residential". Free text. */
  projectType: string;
  description: string;
  /** Where the work is, which is very often not where the invoice goes. */
  siteAddress: Address;
  /** ISO dates. Empty means not set rather than today. */
  startDate: string;
  targetCompletionDate: string;
  actualCompletionDate: string;
  /** The people on it, by email, so the directory picker can name them. */
  projectManager: string;
  superintendent: string;
  /** The building department's number for it. Printed on nearly everything. */
  permitNumber: string;
  /** The client's own job or contract reference. */
  clientReference: string;
  currency: CurrencyCode;
  /**
   * The contract sum, once there is one, in `currency`.
   *
   * Entered rather than derived, and that is deliberate: the awarded contract
   * is a negotiated number that very often differs from the estimate it came
   * from, and overwriting it with the estimate's total would erase the
   * negotiation. What the estimates and invoices actually say is reported
   * beside it by `projectStats`, so a disagreement is visible instead of
   * resolved by guessing.
   */
  contractValue: number;
  /** Free segmentation — "phase-2", "prevailing-wage". Lowercased. */
  tags: string[];
  notes: string;
  ownerId: string;
  sharedWith: string[];
  createdAt: string;
  updatedAt: string;
};
