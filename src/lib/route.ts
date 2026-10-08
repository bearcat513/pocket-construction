/**
 * Where you are in the app, as a URL.
 *
 * The screen and the open record used to live only in React state: Back left
 * the app, a refresh landed on Projects, and nothing could be linked to or
 * bookmarked. Now the address bar is the source of truth — `/estimates/qte_…`
 * opens that estimate from a cold start, and a shared record has a link to
 * send with it.
 *
 * Pure, so the mapping is tested without a browser. Paths use the words on
 * screen (estimates, clients, materials) rather than the stored type names,
 * for the reason in CLAUDE.md: a URL is user-facing.
 */

export type View =
  | "projects"
  | "quotes"
  | "receivables"
  | "catalog"
  | "customers"
  | "templates"
  | "website"
  | "settings";

export type Route = {
  view: View;
  /**
   * The record open on that screen: a project, an estimate (`new` for an
   * unsaved one), an invoice, a client — or, on settings, the tab.
   */
  id?: string;
};

const SEGMENTS: Record<View, string> = {
  projects: "projects",
  quotes: "estimates",
  receivables: "receivables",
  catalog: "materials",
  customers: "clients",
  templates: "templates",
  website: "website",
  settings: "settings",
};

const VIEWS = new Map(Object.entries(SEGMENTS).map(([view, segment]) => [segment, view as View]));

/** Screens whose path can carry an id. */
const WITH_ID = new Set<View>(["projects", "quotes", "receivables", "customers", "settings"]);

export const HOME: Route = { view: "projects" };

/**
 * Screens that are gone, and where their bookmarks land instead. Rules became
 * the markup, overhead and tax under settings; approvals went with them.
 */
const RETIRED: Record<string, Route> = {
  rules: { view: "settings", id: "documents" },
  approvals: { view: "quotes" },
};

export function parseRoute(pathname: string): Route {
  const [segment = "", id = ""] = pathname.split("/").filter(Boolean).map(part => decodeURIComponent(part));
  if (RETIRED[segment]) return RETIRED[segment];
  const view = VIEWS.get(segment);
  if (!view) return HOME;
  return id && WITH_ID.has(view) ? { view, id } : { view };
}

export function routePath(route: Route): string {
  const base = `/${SEGMENTS[route.view]}`;
  return route.id && WITH_ID.has(route.view) ? `${base}/${encodeURIComponent(route.id)}` : base;
}

export const sameRoute = (a: Route, b: Route) => a.view === b.view && (a.id ?? "") === (b.id ?? "");
