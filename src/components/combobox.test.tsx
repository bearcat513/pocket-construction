/**
 * Reference fields.
 *
 * Anywhere this app asks which *existing* product, family or approver you
 * mean, it offers the list rather than an empty box. A typo in one of those
 * does not fail loudly — a bundle component whose SKU matches nothing is
 * silently skipped when the bundle is expanded, and the quote simply comes out
 * missing a line — so these assert that the list is actually offered.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Combobox, familyOptions, productOptions } from "@/components/ui/combobox";
import type { Product } from "@/lib/types";

const product = (sku: string, name: string, overrides: Partial<Product> = {}): Product =>
  ({
    id: `prd_${sku}`,
    sku,
    name,
    description: "",
    family: "Framing",
    chargeType: "recurring",
    billingPeriod: "monthly",
    unitOfMeasure: "EA",
    listPrice: 100,
    cost: 30,
    currency: "USD",
    active: true,
    minQuantity: 1,
    maxQuantity: 0,
    floorDiscountPercent: 0,
    optionGroups: [],
    rules: [],
    components: [],
    volumeTiers: [],
    attributes: {},
    ownerId: "u",
    sharedWith: [],
    createdAt: "",
    updatedAt: "",
    ...overrides,
  }) as Product;

describe("the option lists", () => {
  const catalogue = [
    product("STOR", "Managed Storage"),
    product("PLAT", "Platform"),
    product("OLD", "Retired thing", { active: false }),
    product("SUITE", "Enterprise suite", { components: [{ id: "c", sku: "PLAT", quantity: 1, required: true }] }),
  ];

  test("products are offered by SKU, with the name as the hint", () => {
    const options = productOptions(catalogue);

    // Sorted, so a long catalogue is scannable rather than in insertion order.
    expect(options.map(option => option.value)).toEqual(["OLD", "PLAT", "STOR", "SUITE"]);
    expect(options.find(option => option.value === "PLAT")?.hint).toBe("Platform");
  });

  test("what a product is gets a badge, so the list says more than the SKU", () => {
    const options = productOptions(catalogue);
    expect(options.find(option => option.value === "OLD")?.badge).toBe("inactive");
    expect(options.find(option => option.value === "SUITE")?.badge).toBe("bundle");
    expect(options.find(option => option.value === "PLAT")?.badge).toBeUndefined();
  });

  test("families are the distinct ones actually in use", () => {
    const options = familyOptions([
      product("A", "A", { family: "Services" }),
      product("B", "B", { family: "Software" }),
      product("C", "C", { family: "Software" }),
      product("D", "D", { family: "  " }),
    ]);

    expect(options.map(option => option.value)).toEqual(["Services", "Software"]);
  });
});

describe("the control", () => {
  const options = [
    { value: "PLAT", label: "PLAT", hint: "Platform" },
    { value: "STOR", label: "STOR", hint: "Managed Storage" },
  ];

  test("renders as a combobox showing the chosen option", () => {
    const html = renderToStaticMarkup(
      <Combobox value="PLAT" onChange={() => {}} options={options} aria-label="Component product" />,
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Component product"');
    expect(html).toContain("PLAT");
    // It is a button, not a text input: there is nothing to mistype into.
    expect(html).not.toContain("<input");
  });

  test("a value the list does not have is still shown, never hidden", () => {
    // A price book may legitimately price a SKU this workspace has not created
    // yet — the importer warns about that rather than refusing it, so the UI
    // must not quietly blank the field either.
    const html = renderToStaticMarkup(<Combobox value="FROM-ELSEWHERE" onChange={() => {}} options={options} />);
    expect(html).toContain("FROM-ELSEWHERE");
  });

  test("an empty value shows the placeholder", () => {
    const html = renderToStaticMarkup(
      <Combobox value="" onChange={() => {}} options={options} placeholder="Any product" />,
    );
    expect(html).toContain("Any product");
  });
});

describe("no reference field is left as an open text box", () => {
  /** Every field that names another record, and the binding that proves it. */
  const references: { file: string; binding: string; what: string }[] = [
    { file: "ProductEditor", binding: "value={component.sku}", what: "an assembly component" },
    { file: "ProductEditor", binding: "value={draft.family}", what: "a catalogue item's family" },
    { file: "PriceBookEditor", binding: "value={entry.sku}", what: "a price book entry" },
    { file: "RulesView", binding: "value={draft.appliesToSku}", what: "a pricing rule's product" },
    { file: "RulesView", binding: "value={draft.appliesToFamily}", what: "a pricing rule's family" },
    // An approval rule names a list now, so the dropdown is what adds to it.
    { file: "RulesView", binding: 'aria-label="Add an approver"', what: "an approval rule's approvers" },
    // A project names a client and two people.
    { file: "ProjectEditor", binding: "value={draft.accountId}", what: "a project's client" },
    { file: "ProjectEditor", binding: "value={draft.projectManager}", what: "a project's manager" },
    { file: "ProjectEditor", binding: "value={draft.superintendent}", what: "a project's superintendent" },
    // A catalogue source names columns in somebody else's spreadsheet. Those
    // are references too: a mapping pointing at a heading that does not exist
    // fails the same silent way a bundle component with a bad SKU does — the
    // field is simply never written, and the sync reads as "unchanged".
    { file: "CatalogSourceEditor", binding: "value={draft.mapping.key}", what: "a feed's key column" },
    {
      file: "CatalogSourceEditor",
      binding: "value={(draft.mapping[entry.field] as string) ?? \"\"}",
      what: "a feed's mapped columns",
    },
    // A website slot names the text or picture that goes in it.
    { file: "WebsiteView", binding: "value={ids[0] ?? \"\"}", what: "a single website slot's content" },
    { file: "WebsiteView", binding: "options={siteContentOptions(entries, ids)}", what: "a website list slot's next entry" },
  ];

  for (const { file, binding, what } of references) {
    test(`${what} is a searchable dropdown`, async () => {
      const source = await Bun.file(new URL(`./app/${file}.tsx`, import.meta.url)).text();

      const at = source.indexOf(binding);
      expect(at).toBeGreaterThan(-1);

      // Walk back to the tag that owns the binding: it has to be a Combobox.
      const tag = source.lastIndexOf("<", at);
      expect(source.slice(tag, at)).toContain("Combobox");
    });
  }

  test("a catalogue source offers the feed's real headings once it has read one", async () => {
    // The pickers are filled from the feed itself, not from a list this app
    // invented: a mapping written against remembered column names is a mapping
    // that silently stops working when the supplier renames a heading.
    const source = await Bun.file(new URL("./app/CatalogSourceEditor.tsx", import.meta.url)).text();
    expect(source).toContain("inspectCatalogSource");
    expect(source).toContain("inspection?.columns");
  });

  test("the datalist the price book leaned on is gone", async () => {
    // A datalist is a suggestion on a text box, not a list — it still accepts
    // anything and offers nothing on a touch keyboard.
    const source = await Bun.file(new URL("./app/PriceBookEditor.tsx", import.meta.url)).text();
    expect(source).not.toContain("datalist");
  });
});
