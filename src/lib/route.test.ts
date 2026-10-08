import { describe, expect, test } from "bun:test";
import { HOME, parseRoute, routePath, sameRoute } from "./route";

describe("routes", () => {
  test("paths use the words on screen", () => {
    expect(routePath({ view: "quotes", id: "qte_1" })).toBe("/estimates/qte_1");
    expect(routePath({ view: "customers" })).toBe("/clients");
    expect(routePath({ view: "catalog" })).toBe("/materials");
  });

  test("every path reads back to the route it came from", () => {
    for (const route of [
      { view: "projects" as const, id: "prj_1" },
      { view: "quotes" as const, id: "new" },
      { view: "receivables" as const, id: "inv_9" },
      { view: "settings" as const, id: "api" },
      { view: "catalog" as const },
    ]) {
      expect(parseRoute(routePath(route))).toEqual(route);
    }
  });

  test("an unknown path is home, and an id where none belongs is dropped", () => {
    expect(parseRoute("/")).toEqual(HOME);
    expect(parseRoute("/nonsense/1")).toEqual(HOME);
    expect(parseRoute("/materials/abc")).toEqual({ view: "catalog" });
  });

  test("a retired screen's bookmark lands where its job went", () => {
    expect(parseRoute("/rules")).toEqual({ view: "settings", id: "documents" });
    expect(parseRoute("/approvals")).toEqual({ view: "quotes" });
  });

  test("an id survives characters a URL has to escape", () => {
    expect(parseRoute(routePath({ view: "customers", id: "a b/c" }))).toEqual({ view: "customers", id: "a b/c" });
  });

  test("sameRoute treats a missing id as none", () => {
    expect(sameRoute({ view: "catalog" }, { view: "catalog", id: "" })).toBe(true);
    expect(sameRoute({ view: "quotes", id: "1" }, { view: "quotes" })).toBe(false);
  });
});
