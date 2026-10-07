import { describe, expect, test } from "bun:test";
import { parseBoolean, parseDelimited, parseNumber, parseTable, sniffDelimiter } from "./csv";

describe("delimited parsing", () => {
  test("a quoted field keeps its delimiters", () => {
    // The failure this guards is silent: split(",") shifts every column after
    // the quote by one, which puts a weight in a price field.
    const rows = parseDelimited('sku,name,price\nA1,"Board, 2x4, 8ft",4.28');
    expect(rows[1]).toEqual(["A1", "Board, 2x4, 8ft", "4.28"]);
  });

  test("a doubled quote is one literal quote", () => {
    const rows = parseDelimited('sku,name\nA1,"5/8"" Type X"');
    expect(rows[1]).toEqual(["A1", '5/8" Type X']);
  });

  test("a quoted field may contain a newline", () => {
    const rows = parseDelimited('sku,note\nA1,"line one\nline two"\nA2,plain');
    expect(rows).toHaveLength(3);
    expect(rows[1]![1]).toBe("line one\nline two");
    expect(rows[2]).toEqual(["A2", "plain"]);
  });

  test("CRLF and a byte-order mark survive Excel", () => {
    const rows = parseDelimited("﻿sku,name\r\nA1,Stud\r\n");
    expect(rows[0]).toEqual(["sku", "name"]);
    expect(rows[1]).toEqual(["A1", "Stud"]);
  });

  test("an unterminated quote closes itself rather than eating the file", () => {
    const rows = parseDelimited('sku,name\nA1,"unterminated');
    expect(rows[1]).toEqual(["A1", "unterminated"]);
  });

  test("an empty field is kept, not collapsed", () => {
    expect(parseDelimited("a,b,c\n1,,3")[1]).toEqual(["1", "", "3"]);
  });
});

describe("delimiter sniffing", () => {
  test("a semicolon file is not read as one column", () => {
    expect(sniffDelimiter("sku;name;price\nA1;Stud;4,28")).toBe(";");
  });

  test("tabs win over commas inside descriptions", () => {
    expect(sniffDelimiter("sku\tname\nA1\tBoard, 2x4, 8ft")).toBe("\t");
  });

  test("commas inside quotes do not vote", () => {
    expect(sniffDelimiter('sku;name\nA1;"Board, 2x4, 8ft"')).toBe(";");
  });
});

describe("tables", () => {
  test("rows are keyed by trimmed column names", () => {
    const table = parseTable(" sku , name \nA1,Stud");
    expect(table.columns).toEqual(["sku", "name"]);
    expect(table.rows[0]).toEqual({ sku: "A1", name: "Stud" });
  });

  test("a short row is padded rather than refused", () => {
    // A trailing empty column is the commonest thing wrong with an export and
    // is not worth losing a price list over.
    const table = parseTable("sku,name,price\nA1,Stud");
    expect(table.rows[0]).toEqual({ sku: "A1", name: "Stud", price: "" });
  });

  test("duplicate column names stay addressable", () => {
    const table = parseTable("sku,price,price\nA1,4.28,3.35");
    expect(table.columns).toEqual(["sku", "price", "price (2)"]);
    expect(table.rows[0]!["price (2)"]).toBe("3.35");
  });
});

describe("numbers as a feed writes them", () => {
  test("currency symbols and thousands separators come off", () => {
    expect(parseNumber("$1,234.56")).toBe(1234.56);
    expect(parseNumber(" 4.28 ")).toBe(4.28);
  });

  test("a European decimal comma is read as a decimal point", () => {
    expect(parseNumber("1.234,56")).toBe(1234.56);
    expect(parseNumber("4,28")).toBe(4.28);
  });

  test("an unreadable cell is null, never zero", () => {
    // Zero is a real price. A sync that turns "call for pricing" into a free
    // item is the worst available outcome.
    expect(parseNumber("call for pricing")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(parseNumber("0")).toBe(0);
  });

  test("a negative price is read, not discarded", () => {
    expect(parseNumber("-12.50")).toBe(-12.5);
  });
});

describe("booleans as a feed writes them", () => {
  test("the usual spellings are understood", () => {
    expect(parseBoolean("Y", false)).toBe(true);
    expect(parseBoolean("discontinued", true)).toBe(false);
    expect(parseBoolean("active", false)).toBe(true);
  });

  test("anything else keeps the fallback", () => {
    expect(parseBoolean("maybe", true)).toBe(true);
    expect(parseBoolean("", false)).toBe(false);
  });
});
