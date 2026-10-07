import { describe, expect, test } from "bun:test";
import { quoteFilter, quoteSearchQuery, quoteSort, readQuoteSearch } from "./quoteSearch";

describe("quoteFilter", () => {
  test("binds the search text rather than splicing it in", () => {
    const filter = quoteFilter(`x" || owner != "`, "all", "2026-10-07");
    expect(filter.expr).toBe("(name ~ {:q} || number ~ {:q} || header.customer.name ~ {:q})");
    expect(filter.params.q).toBe(`x" || owner != "`);
  });

  test("an empty search and every status is no filter at all", () => {
    expect(quoteFilter("  ", "all", "2026-10-07").expr).toBe("");
  });

  test("expired and sent split on the date the way withExpiry does", () => {
    expect(quoteFilter("", "expired", "2026-10-07").expr).toContain("validUntil < {:today}");
    expect(quoteFilter("", "sent", "2026-10-07").expr).toContain("validUntil >= {:today}");
  });

  test("any other status is an equality", () => {
    expect(quoteFilter("", "draft", "2026-10-07")).toMatchObject({ expr: "status = {:status}", params: { status: "draft" } });
  });
});

describe("sorting and the query string", () => {
  test("updated is newest first, everything else A–Z, and id breaks ties", () => {
    expect(quoteSort()).toBe("-updated,id");
    expect(quoteSort("name")).toBe("name,id");
    expect(quoteSort("name", false)).toBe("-name,id");
  });

  test("reads back what it writes, and repairs nonsense", () => {
    const search = { q: "roof", status: "sent" as const, sort: "number" as const, ascending: false, page: 3, perPage: 25 };
    expect(readQuoteSearch(new URLSearchParams(quoteSearchQuery(search)))).toEqual(search);
    expect(readQuoteSearch(new URLSearchParams("status=bogus&sort=owner&page=-2&perPage=9999"))).toEqual({
      q: "",
      status: "all",
      sort: "updated",
      ascending: false,
      page: 1,
      perPage: 200,
    });
  });
});
