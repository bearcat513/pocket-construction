/**
 * A spreadsheet is the way most catalogues actually arrive, and the way most
 * of them arrive wrong. What matters is that a bad cell stops the import with
 * the row it is on, rather than becoming a free item or a sheet priced per
 * square foot.
 */
import { describe, expect, test } from "bun:test";
import { CATALOG_CSV_COLUMNS, catalogCsvRow, parseCatalogCsv } from "./catalogCsv";
import { writeCsv } from "./csv";
import { SAMPLE_PRODUCTS } from "./samples";

const HEADER = "sku,name,unitOfMeasure,listPrice";

const parse = (text: string) => {
  const result = parseCatalogCsv(text);
  if (!result.ok) throw new Error(result.error);
  return result.catalog;
};

const refusal = (text: string) => {
  const result = parseCatalogCsv(text);
  if (result.ok) throw new Error("expected the file to be refused");
  return result.error;
};

describe("reading a catalogue spreadsheet", () => {
  test("the four required columns are a catalogue", () => {
    const catalog = parse(`${HEADER}\nply-34,Plywood 3/4,sht,48.50`);
    expect(catalog.products).toHaveLength(1);
    const [item] = catalog.products;
    expect(item!.sku).toBe("PLY-34");
    // Codes are case-blind on the way in and stored as the list spells them.
    expect(item!.unitOfMeasure).toBe("SHT");
    expect(item!.listPrice).toBe(48.5);
    expect(item!.active).toBe(true);
  });

  test("headings are matched however a person typed them", () => {
    const catalog = parse(
      "Item Code,Item Name,UOM,List Price,Unit Cost,Waste %,CSI Division,Lot Size\n" +
        "CONC,Ready mix,CY,168,142,5,3,0.25",
    );
    const [item] = catalog.products;
    expect(item!.cost).toBe(142);
    expect(item!.wasteFactorPercent).toBe(5);
    expect(item!.purchaseMultiple).toBe(0.25);
    expect(item!.material.division).toBe("03");
  });

  test("a price list written the way people write them is read", () => {
    // Quoted commas, a currency symbol, a thousands separator, Excel's BOM,
    // CRLF and a blank line where an example row was deleted.
    const catalog = parse(
      `﻿${HEADER},description\r\nSUB,"Rough-in, plumbing",LS,"$18,600.00","Tested, inspected"\r\n,,,,\r\n`,
    );
    expect(catalog.products).toHaveLength(1);
    expect(catalog.products[0]!.listPrice).toBe(18_600);
    expect(catalog.products[0]!.description).toBe("Tested, inspected");
  });

  test("a semicolon-delimited European sheet is read", () => {
    const catalog = parse("sku;name;unitOfMeasure;listPrice\nGYP;Gypsum board;SHT;1.019,20");
    expect(catalog.products[0]!.listPrice).toBe(1019.2);
  });

  test("specification and attributes land in the right place", () => {
    const catalog = parse(
      `${HEADER},manufacturer,coverage,coverageUnit,submittalRequired,attributes\n` +
        `OSB,OSB 7/16,SHT,18.9,Cascade,32,sf,yes,Span=24/16; Exposure=Exposure 1`,
    );
    const [item] = catalog.products;
    expect(item!.material.manufacturer).toBe("Cascade");
    expect(item!.material.coverage).toBe(32);
    expect(item!.material.coverageUnit).toBe("SF");
    expect(item!.material.submittalRequired).toBe(true);
    expect(item!.attributes).toEqual({ Span: "24/16", Exposure: "Exposure 1" });
  });
});

describe("what is refused", () => {
  test("an unreadable price is an error, never a free item", () => {
    expect(refusal(`${HEADER}\nA,Alpha,EA,10\nB,Bravo,EA,call us`)).toBe('Row 3 (B): listPrice "call us" is not a number.');
  });

  test("an empty price is an error too", () => {
    expect(refusal(`${HEADER}\nA,Alpha,EA,`)).toContain("listPrice is empty");
  });

  test("a unit off the list is an error, never EA", () => {
    expect(refusal(`${HEADER}\nA,Alpha,sq ft,10`)).toContain('"sq ft" is not a unit of measure');
  });

  test("a missing required column is named", () => {
    expect(refusal("sku,name,listPrice\nA,Alpha,10")).toContain("no unitOfMeasure column");
  });

  test("coverage without a unit is refused", () => {
    expect(refusal(`${HEADER},coverage\nA,Alpha,SHT,10,32`)).toContain("coverage needs a coverageUnit");
  });

  test("two rows with one SKU are refused", () => {
    expect(refusal(`${HEADER}\nA,Alpha,EA,10\na,Again,EA,11`)).toContain("Two products share the SKU A");
  });

  test("a bad enum value says what it should have been", () => {
    expect(refusal(`${HEADER},costType\nA,Alpha,EA,10,materials`)).toContain("material, labor");
  });

  test("two columns that mean the same thing are refused rather than guessed between", () => {
    expect(refusal("sku,name,uom,unit,listPrice\nA,Alpha,EA,SF,10")).toContain("Two columns both mean unitOfMeasure");
  });
});

describe("warnings", () => {
  test("an unknown column is reported, not dropped in silence", () => {
    const catalog = parse(`${HEADER},colour code\nA,Alpha,EA,10,RAL 9010`);
    expect(catalog.warnings.join(" ")).toContain("colour code");
  });

  test("an exported sheet with options in it says what it could not carry", () => {
    const catalog = parse(`${HEADER},volumeTiers,marginPercent\nA,Alpha,EA,10,"1-∞: percent 0",20`);
    expect(catalog.warnings.join(" ")).toContain("options, volume tiers or assembly components");
  });
});

describe("the round trip", () => {
  test("the whole sample catalogue survives a spreadsheet, flat fields and all", () => {
    const text = writeCsv(SAMPLE_PRODUCTS.map(catalogCsvRow), CATALOG_CSV_COLUMNS.map(spec => spec.column));
    const catalog = parse(text);
    expect(catalog.products).toHaveLength(SAMPLE_PRODUCTS.length);

    for (const [index, original] of SAMPLE_PRODUCTS.entries()) {
      const back = catalog.products[index]!;
      expect(catalogCsvRow(back)).toEqual(catalogCsvRow(original));
    }
  });
});
