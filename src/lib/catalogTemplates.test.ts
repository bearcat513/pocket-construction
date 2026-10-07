/**
 * A template that will not import is worse than no template: it is the first
 * thing somebody tries, and it teaches them the importer is broken.
 */
import { describe, expect, test } from "bun:test";
import { parseCatalogCsv } from "./catalogCsv";
import { parseCatalogFile } from "./catalogFile";
import { parseTable } from "./csv";
import { CATALOG_TEMPLATES, catalogTemplate } from "./catalogTemplates";
import { SAMPLE_CATALOG_SOURCES, SAMPLE_PRODUCTS } from "./samples";

const body = (file: string) => catalogTemplate(file)!.body();

describe("the catalogue templates", () => {
  test("file names are unique and safe in a URL", () => {
    const names = CATALOG_TEMPLATES.map(template => template.file);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(encodeURIComponent(name)).toBe(name);
  });

  test("the example spreadsheet imports cleanly", () => {
    const result = parseCatalogCsv(body("catalog-template.csv"));
    if (!result.ok) throw new Error(result.error);
    expect(result.catalog.products.length).toBeGreaterThanOrEqual(4);
    expect(result.catalog.warnings).toEqual([]);
  });

  test("its examples are not the sample's, so importing it beside the sample creates something", () => {
    const result = parseCatalogCsv(body("catalog-template.csv"));
    if (!result.ok) throw new Error(result.error);
    const sampleSkus = new Set(SAMPLE_PRODUCTS.map(product => product.sku));
    for (const product of result.catalog.products) expect(sampleSkus.has(product.sku)).toBe(false);
  });

  test("the blank spreadsheet has the same headings and nothing else", () => {
    const blank = body("catalog-template-blank.csv");
    expect(blank.split("\n")).toHaveLength(1);
    expect(blank).toBe(body("catalog-template.csv").split("\n")[0]!);
    // Headings alone are refused as empty, not as malformed.
    const result = parseCatalogCsv(blank);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no items");
  });

  test("the catalogue file imports cleanly, assembly and price book included", () => {
    const result = parseCatalogFile(JSON.parse(body("catalog-template.catalog.json")));
    if (!result.ok) throw new Error(result.error);
    expect(result.catalog.warnings).toEqual([]);
    expect(result.catalog.priceBooks).toHaveLength(1);
    const assembly = result.catalog.products.find(product => product.components.length);
    expect(assembly?.optionGroups.length).toBeGreaterThan(0);
    expect(assembly?.rules.length).toBeGreaterThan(0);
    expect(assembly?.volumeTiers.length).toBeGreaterThan(0);
  });

  test("the supplier price list carries every column the sample feed is mapped to", () => {
    const { columns } = parseTable(body("supplier-feed-example.csv"));
    const mapped = Object.entries(SAMPLE_CATALOG_SOURCES[0]!.mapping)
      .filter(([key, column]) => key !== "matchOn" && column)
      .map(([, column]) => column);
    for (const column of mapped) expect(columns).toContain(column);
  });
});
