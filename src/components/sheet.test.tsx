/**
 * The shape of the editing surface.
 *
 * Every form in this app is a right-hand panel, and everything meant to be
 * *read* — a rendered proposal, a PDF — is still a wide modal. That split is
 * easy to break by reaching for the nearest component, so it is asserted here
 * rather than left to review.
 *
 * These render to static markup, which is enough to catch the two things that
 * actually go wrong: a form that throws on first paint, and a form that sizes
 * itself against the window instead of against the panel it is in.
 */
import { expect, test, describe } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Sheet } from "@/components/ui/sheet";
import { LineConfigurator } from "@/components/app/LineConfigurator";
import { CatalogSourceEditor } from "@/components/app/CatalogSourceEditor";
import { ProductEditor } from "@/components/app/ProductEditor";
import { ProjectEditor } from "@/components/app/ProjectEditor";
import { ProductPicker } from "@/components/app/ProductPicker";
import { ShareDialog } from "@/components/app/ShareDialog";
import { SiteImageEditor, SiteTextEditor, SlotEditor } from "@/components/app/WebsiteView";
import { BookingSettingsEditor } from "@/components/app/Appointments";
import { DEFAULT_BOOKING_SETTINGS } from "@/lib/booking";
import { SITE_SLOTS } from "@/lib/site";
import { specimenQuote } from "@/lib/samples";
import { EMPTY_MATERIAL, type Product } from "@/lib/types";

const product = (): Product => ({
  id: "prd_1",
  sku: "PLAT",
  name: "Platform",
  description: "Core platform",
  family: "Software",
  unitOfMeasure: "EA",
  listPrice: 120,
  cost: 28,
  active: true,
  costType: "material",
  wasteFactorPercent: 0,
  purchaseMultiple: 0,
  material: { ...EMPTY_MATERIAL },
  optionGroups: [
    {
      id: "g",
      key: "tier",
      name: "Edition",
      select: "one",
      required: true,
      options: [
        { id: "o1", key: "std", name: "Standard", priceDelta: 0, default: true },
        { id: "o2", key: "ent", name: "Enterprise", priceDelta: 0, priceFactor: 1.8 },
      ],
    },
  ],
  rules: [],
  components: [],
  volumeTiers: [{ minQuantity: 25, maxQuantity: null, kind: "percent", value: 10 }],
  ownerId: "u",
  createdAt: "",
  updatedAt: "",
});

const noop = () => {};
const asyncNoop = async () => {};

describe("the panel", () => {
  test("is pinned right, full height, and a third of the window", () => {
    const html = renderToStaticMarkup(
      <Sheet title="Edit" description="A description" onClose={noop} footer={<button>Save</button>}>
        <p>body</p>
      </Sheet>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("justify-end");
    expect(html).toContain("h-full");
    expect(html).toContain("sm:w-[35%]");
    // A floor, so it stays a usable form on a laptop rather than a column.
    expect(html).toContain("sm:min-w-[26rem]");
    expect(html).toContain("slide-in-from-right");

    // Header, scrolling body and footer are separate: only the middle moves.
    expect(html).toContain("@container");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("body");
    expect(html).toContain("Save");
  });
});

describe("every form is a panel", () => {
  const cases: [string, () => string][] = [
    [
      "product editor",
      () => renderToStaticMarkup(<ProductEditor product={product()} products={[product()]} onSave={asyncNoop} onClose={noop} />),
    ],
    [
      "product picker",
      () =>
        renderToStaticMarkup(
          <ProductPicker products={[product()]} currency="USD" locale="en-US" markupPercent={15} onPick={noop} onClose={noop} />,
        ),
    ],
    [
      "line configurator",
      () =>
        renderToStaticMarkup(
          <LineConfigurator
            product={product()}
            line={{ ...specimenQuote().lines[0]!, productId: "prd_1", selectedOptions: ["std"] }}
            currency="USD"
            locale="en-US"
            markupPercent={15}
            onSave={noop}
            onClose={noop}
          />,
        ),
    ],
    [
      "project editor",
      () =>
        renderToStaticMarkup(
          <ProjectEditor project={null} accounts={[]} directory={[]} onSave={asyncNoop} onClose={noop} />,
        ),
    ],
    [
      "catalogue source editor",
      () => renderToStaticMarkup(<CatalogSourceEditor source={null} onSave={asyncNoop} onClose={noop} />),
    ],
    [
      "share dialog",
      () =>
        renderToStaticMarkup(
          <ShareDialog
            kind="quotes"
            id="qte_1"
            title="EST-2026-0001"
            viewerEmail="me@example.com"
            directory={[{ id: "u1", email: "other@example.com", name: "Other Person" }]}
            onClose={noop}
            onChanged={noop}
          />,
        ),
    ],
    [
      "website slot editor",
      () =>
        renderToStaticMarkup(
          <SlotEditor
            slot={SITE_SLOTS.find(slot => slot.key === "projects.gallery")!}
            content={{ texts: [], images: [], placements: [] }}
            onClose={noop}
            onSaved={noop}
            onError={noop}
          />,
        ),
    ],
    [
      "website text editor",
      () => renderToStaticMarkup(<SiteTextEditor text={null} onClose={noop} onSaved={noop} onError={noop} />),
    ],
    [
      "website image editor",
      () => renderToStaticMarkup(<SiteImageEditor image={null} onClose={noop} onSaved={noop} onError={noop} />),
    ],
    [
      "booking settings editor",
      () =>
        renderToStaticMarkup(
          <BookingSettingsEditor settings={DEFAULT_BOOKING_SETTINGS} onClose={noop} onSaved={noop} onError={noop} />,
        ),
    ],
  ];

  for (const [name, render] of cases) {
    test(`the ${name} renders as a panel, sized against the panel`, () => {
      const html = render();

      expect(html).toContain("sm:w-[35%]");
      // A viewport breakpoint inside a panel is the bug this guards: on a wide
      // screen `sm:grid-cols-4` is still four columns in a 500px panel.
      expect(html).not.toContain("sm:grid-cols-");
    });
  }

  test("a product editor's dense form lays out against the panel", () => {
    const html = renderToStaticMarkup(<ProductEditor product={product()} products={[product()]} onSave={asyncNoop} onClose={noop} />);

    expect(html).toContain("@md:grid-cols-2");
    expect(html).toContain("Platform");
    // The tab row stays put while the form under it scrolls.
    expect(html).toContain("sticky");
  });
});

describe("what stays a modal", () => {
  test("forms use the panel and only the previews use the dialog", async () => {
    // Expressed here because it is a rule about the app rather than about any
    // one component, and the easiest way to break it is to import the nearest
    // thing to hand.
    const forms = [
      "app/ProductEditor",
      "app/AccountsView",
      "app/ProjectEditor",
      "app/CatalogSourceEditor",
      "app/LineConfigurator",
      "app/ProductPicker",
      "app/ShareDialog",
      "app/WebsiteView",
      "app/Appointments",
    ];

    for (const name of forms) {
      const source = await Bun.file(new URL(`./${name}.tsx`, import.meta.url)).text();
      expect(source).toContain("components/ui/sheet");
      expect(source).not.toContain("components/ui/dialog");
    }

    // The quote editor renders a proposal and a PDF, which need the width.
    const quoteEditor = await Bun.file(new URL("./app/QuoteEditor.tsx", import.meta.url)).text();
    expect(quoteEditor).toContain("components/ui/dialog");

    // A sync plan is the other thing meant to be read rather than filled in:
    // a list of proposed changes checked over before it is accepted.
    const plan = await Bun.file(new URL("./app/SyncPlanDialog.tsx", import.meta.url)).text();
    expect(plan).toContain("components/ui/dialog");
    expect(plan).not.toContain("components/ui/sheet");

    // So is the template list: a column guide to read, with nothing to fill in.
    const templates = await Bun.file(new URL("./app/CatalogTemplatesDialog.tsx", import.meta.url)).text();
    expect(templates).toContain("components/ui/dialog");
    expect(templates).not.toContain("components/ui/sheet");
  });

  test("the customer editor sizes itself against the panel it is in", async () => {
    // Contacts and two addresses make it the densest form in the app, and
    // the one most likely to reach for a viewport breakpoint by habit.
    const source = await Bun.file(new URL("./app/AccountsView.tsx", import.meta.url)).text();
    expect(source).toContain("@md:grid-cols-2");
    expect(source).not.toContain("sm:grid-cols-");
  });

  test("a customer's own page is a page, not a modal", async () => {
    // It is read at length and linked out of — into a quote — which is
    // everything a dialog is bad at.
    const source = await Bun.file(new URL("./app/CustomerDetail.tsx", import.meta.url)).text();
    expect(source).not.toContain("components/ui/dialog");
    expect(source).not.toContain("components/ui/sheet");
  });
});
