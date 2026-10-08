import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  Building2,
  FileText,
  Globe,
  HardHat,
  LayoutList,
  LogOut,
  MoreHorizontal,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  ScrollText,
  Search,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AccountsView } from "@/components/app/AccountsView";
import { AttentionStrip } from "@/components/app/AttentionStrip";
import { BrandLockup, BrandMark } from "@/components/app/Brand";
import { AuthPanel } from "@/components/app/AuthPanel";
import { CommandPalette } from "@/components/app/CommandPalette";
import { Website } from "@/components/site/Website";
import { WebsiteView } from "@/components/app/WebsiteView";
import { CatalogView } from "@/components/app/CatalogView";
import { ProjectsView } from "@/components/app/ProjectsView";
import { ScreenSkeleton } from "@/components/app/common";
import { useFeedback } from "@/components/app/feedback";
import { QuoteEditor } from "@/components/app/QuoteEditor";
import { QuoteList } from "@/components/app/QuoteList";
import { ReceivablesView } from "@/components/app/ReceivablesView";
import { SettingsPanel, type SaveState } from "@/components/app/SettingsPanel";
import { ShareDialog } from "@/components/app/ShareDialog";
import { TemplatesView } from "@/components/app/TemplatesView";
import { api, isUnauthorized, type DirectoryUser, type Meta, type Shareable, type SessionUser } from "@/lib/api";
import { DEFAULT_PREFERENCES, normalizePreferences, type Preferences } from "@/lib/preferences";
import { HOME, parseRoute, routePath, sameRoute, type Route, type View } from "@/lib/route";
import type {
  Account,
  CatalogSource,
  Product,
  Project,
  ProposalTemplate,
  Quote,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import "./index.css";

/** The record whose share list is open, if any. */
type Sharing = { kind: Shareable; id: string; title: string } | null;

/** How long the app sits on a preference change before writing it. */
const PREFERENCE_SAVE_DELAY_MS = 500;

const NAV: { id: View; label: string; Icon: typeof LayoutList }[] = [
  { id: "projects", label: "Projects", Icon: HardHat },
  { id: "quotes", label: "Estimates", Icon: ScrollText },
  { id: "receivables", label: "Receivables", Icon: Receipt },
  { id: "catalog", label: "Materials", Icon: Package },
  { id: "customers", label: "Clients", Icon: Building2 },
  { id: "templates", label: "Templates", Icon: FileText },
];

/**
 * The four a phone's bottom bar has room for — the ones somebody on site
 * reaches for. Everything else is one tap further, under More.
 */
const PHONE_NAV: View[] = ["projects", "quotes", "receivables", "customers"];

/** Shown only to an account that may change the public website. */
const WEBSITE_NAV = { id: "website" as const, label: "Website", Icon: Globe };

/**
 * `/site` is the public website whoever is looking, so an editor can see the
 * page as a visitor does. Everywhere else, a visitor who has not signed in
 * sees it in place of the sign-in form.
 */
const SITE_PATH = "/site";

/** Matches the <title> in index.html. */
const APP_TITLE = "Sitelines — construction estimating and billing";

/** A plain click, as opposed to one asking for a new tab or window. */
const plainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

const currentRoute = () => (typeof window === "undefined" ? HOME : parseRoute(window.location.pathname));

export function App() {
  const feedback = useFeedback();

  // undefined while the session is still being checked, null when signed out.
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined);
  /** Signed out: the website, or the sign-in form someone asked for from it. */
  const [signingIn, setSigningIn] = useState(false);
  const onPublicSite = typeof window !== "undefined" && window.location.pathname === SITE_PATH;

  /**
   * Where you are is the URL — see `src/lib/route.ts`. Projects is home: on a
   * construction job everything else hangs off one, so the list of jobs is
   * the honest landing page.
   */
  const [route, setRoute] = useState<Route>(currentRoute);
  const routeRef = useRef(route);
  const [sharing, setSharing] = useState<Sharing>(null);
  const [palette, setPalette] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  /* Everything this account can see. */
  const [loaded, setLoaded] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [catalogSources, setCatalogSources] = useState<CatalogSource[]>([]);
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  /** Everyone with an account here, for the pickers that name a person. */
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);

  /** The estimate on screen: null for a new one, undefined while none is (or while it is being read). */
  const [openQuote, setOpenQuote] = useState<Quote | null | undefined>(undefined);
  const openQuoteRef = useRef(openQuote);
  openQuoteRef.current = openQuote;

  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [preferenceSave, setPreferenceSave] = useState<SaveState>("idle");
  const preferenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preferencePending = useRef<Preferences | null>(null);

  /**
   * Shows what went wrong — or drops back to the sign-in screen when the
   * session is the thing that went wrong.
   */
  const fail = useCallback(
    (error: unknown) => {
      if (isUnauthorized(error)) {
        setMe(null);
        return;
      }
      feedback.toast("error", error instanceof Error ? error.message : "Something went wrong.");
    },
    [feedback],
  );

  const notice = useCallback((lines: string[]) => feedback.toast("info", lines), [feedback]);

  /* ------------------------------ navigation ----------------------------- */

  /**
   * Moves to a route, asking first if a form has unsaved changes. `replace`
   * rewrites the current history entry rather than adding one — for a new
   * estimate that has just been given its id. `force` skips the question,
   * for moves the editor itself asked for after saving.
   */
  const navigate = useCallback(
    async (next: Route, { replace = false, force = false } = {}) => {
      if (sameRoute(next, routeRef.current)) return;
      if (!force && !(await feedback.leave())) return;
      routeRef.current = next;
      const path = routePath(next);
      if (replace) window.history.replaceState(null, "", path);
      else window.history.pushState(null, "", path);
      setRoute(next);
    },
    [feedback],
  );

  /** Props that make an element a real link, navigated in place on a plain click. */
  const linkTo = (next: Route) => ({
    href: routePath(next),
    onClick: (event: MouseEvent) => {
      if (!plainClick(event)) return;
      event.preventDefault();
      setMoreOpen(false);
      void navigate(next);
    },
  });

  // Back and Forward. The browser has already moved by the time this runs, so
  // refusing to leave puts the address back where the screen still is.
  useEffect(() => {
    const onPop = async () => {
      const next = currentRoute();
      if (!(await feedback.leave())) {
        window.history.pushState(null, "", routePath(routeRef.current));
        return;
      }
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [feedback]);

  // ⌘K / Ctrl+K from anywhere signed in.
  useEffect(() => {
    if (!me) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(open => !open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [me]);

  /* ------------------------------- loading ------------------------------- */

  const refresh = useCallback(async () => {
    const [nextProducts, nextAccounts, nextTemplates, nextProjects, nextSources] = await Promise.all([
      api.listProducts(),
      api.listAccounts(),
      api.listProposalTemplates(),
      api.listProjects(),
      api.listCatalogSources(),
    ]);

    setProducts(nextProducts);
    setAccounts(nextAccounts);
    setTemplates(nextTemplates);
    setProjects(nextProjects);
    setCatalogSources(nextSources);
  }, []);

  const loadWorkspace = useCallback(async () => {
    try {
      await refresh();
    } finally {
      // An empty list drawn before the data arrives reads as "you have
      // nothing"; until the first load settles, the screens show a skeleton.
      setLoaded(true);
    }

    // A directory is a convenience, not a dependency: an instance that has
    // dropped the hook still works, you just type the address.
    try {
      setDirectory((await api.directory()).users);
    } catch {
      setDirectory([]);
    }

    // The storage line doubles as an outage signal: PocketBase is a separate
    // service, and "unreachable" explains every other error on the page.
    try {
      setMeta(await api.meta());
    } catch {
      setMeta(null);
    }
  }, [refresh]);

  useEffect(() => {
    void api
      .me()
      .then(({ user }) => setMe(user))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (me) void loadWorkspace().catch(fail);
  }, [me, loadWorkspace, fail]);

  // The website titles the tab after the business; signed in, it is the app again.
  useEffect(() => {
    if (me && !onPublicSite) document.title = APP_TITLE;
  }, [me, onPublicSite]);

  /**
   * Preferences ride along on the session, so they are here before the first
   * paint rather than after a correction.
   */
  useEffect(() => {
    if (me) setPreferences(me.preferences);
  }, [me]);

  useEffect(() => feedback.setConfirmDestructive(preferences.confirmDestructive), [feedback, preferences.confirmDestructive]);

  /** The theme is a class on <html>; "system" follows the OS, live. */
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = preferences.theme === "dark" || (preferences.theme === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preferences.theme]);

  /**
   * The accent and the reading face are attributes on the same element, which
   * is all styles/globals.css needs: both are a handful of custom properties
   * keyed off `[data-accent]` / `[data-font]`, so changing one re-tints or
   * re-sets the whole app without a re-render.
   */
  useEffect(() => {
    document.documentElement.dataset.accent = preferences.accent;
    document.documentElement.dataset.font = preferences.font;
  }, [preferences.accent, preferences.font]);

  /* ---------------------------- preferences ----------------------------- */

  const writePreferences = useCallback(
    (next: Preferences) => {
      preferencePending.current = null;
      return api
        .savePreferences(next)
        .then(() => setPreferenceSave("saved"))
        .catch(error => {
          setPreferenceSave("idle");
          fail(error);
        });
    },
    [fail],
  );

  /**
   * A save still waiting out its delay is written now rather than dropped —
   * when the page is going away, or the session is about to end.
   */
  const flushPreferences = useCallback(() => {
    clearTimeout(preferenceTimer.current ?? undefined);
    const pending = preferencePending.current;
    return pending ? writePreferences(pending) : Promise.resolve();
  }, [writePreferences]);

  useEffect(() => {
    const onHide = () => void flushPreferences();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      clearTimeout(preferenceTimer.current ?? undefined);
    };
  }, [flushPreferences]);

  /**
   * Preferences save themselves a beat after the last change. Normalizing here
   * rather than trusting the response keeps the controls from jumping: the
   * server applies the same clamps to the same object and has nothing left to
   * correct.
   */
  const applyPreferences = (next: Preferences) => {
    setPreferences(next);
    setPreferenceSave("saving");
    preferencePending.current = next;
    clearTimeout(preferenceTimer.current ?? undefined);
    preferenceTimer.current = setTimeout(() => void writePreferences(next), PREFERENCE_SAVE_DELAY_MS);
  };

  const updatePreferences = (patch: Partial<Preferences>) =>
    applyPreferences(normalizePreferences({ ...preferences, ...patch }));

  /* ------------------------------- estimates ------------------------------ */

  const quoteId = route.view === "quotes" ? route.id : undefined;

  // The estimate in the URL, read when it changes — unless it is the one
  // already on screen, which is what happens when a new one is first saved.
  useEffect(() => {
    if (!me) return;
    if (!quoteId) return setOpenQuote(undefined);
    if (quoteId === "new") return setOpenQuote(null);
    if (openQuoteRef.current?.id === quoteId) return;

    let stale = false;
    setOpenQuote(undefined);
    api
      .getQuote(quoteId)
      .then(quote => !stale && setOpenQuote(quote))
      .catch(error => {
        if (stale) return;
        fail(error);
        void navigate({ view: "quotes" }, { replace: true, force: true });
      });
    return () => {
      stale = true;
    };
  }, [me, quoteId, fail, navigate]);

  const openQuoteById = (id: string) => void navigate({ view: "quotes", id });

  const onQuoteSaved = (quote: Quote) => {
    openQuoteRef.current = quote;
    setOpenQuote(quote);
    void navigate({ view: "quotes", id: quote.id }, { replace: true, force: true });
    void refresh().catch(fail);
  };

  async function signOut() {
    if (!(await feedback.leave())) return;
    feedback.flush();
    await flushPreferences();
    try {
      await api.logout();
    } catch {
      // The cookie is being dropped either way.
    }
    window.history.replaceState(null, "", "/");
    routeRef.current = HOME;
    setRoute(HOME);
    setLoaded(false);
    setMe(null);
    setOpenQuote(undefined);
  }

  /* -------------------------------- render ------------------------------- */

  if (onPublicSite) {
    return (
      <Website
        signInLabel={me ? "Back to the app" : "Sign in"}
        onSignIn={() => window.location.assign("/")}
      />
    );
  }

  if (me === undefined) {
    return (
      <div className="slab min-h-screen p-4 lg:pl-60">
        <ScreenSkeleton />
      </div>
    );
  }

  if (me === null) {
    return signingIn ? (
      <AuthPanel
        onSignedIn={user => {
          setSigningIn(false);
          setMe(user);
        }}
        onBack={() => setSigningIn(false)}
      />
    ) : (
      <Website signInLabel="Sign in" onSignIn={() => setSigningIn(true)} />
    );
  }

  const view = route.view === "website" && !me.siteEditor ? "projects" : route.view;
  const navCollapsed = preferences.navCollapsed;
  const screens = [...NAV, ...(me.siteEditor ? [WEBSITE_NAV] : [])];

  return (
    <div className="slab min-h-screen text-foreground">
      <div className="mx-auto flex max-w-[110rem] flex-col gap-0 lg:flex-row">
        {/* --------------------------- desktop nav -------------------------- */}

        <aside
          className={cn(
            "bg-sidebar/70 text-sidebar-foreground hidden shrink-0 backdrop-blur-[2px]",
            "transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
            "lg:rail lg:flex lg:h-screen lg:flex-col lg:border-r",
            navCollapsed ? "lg:w-16" : "lg:w-56",
          )}
        >
          <div className={cn("flex items-center px-4 py-3.5", navCollapsed && "justify-center px-0")}>
            {navCollapsed ? (
              <span className="group">
                <BrandMark />
              </span>
            ) : (
              <BrandLockup />
            )}
          </div>

          <div className="px-2 pb-2">
            <button
              type="button"
              onClick={() => setPalette(true)}
              title={navCollapsed ? "Search (⌘K)" : undefined}
              aria-label="Search"
              className={cn(
                "flex w-full items-center gap-2 rounded-md border bg-card/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent/60",
                navCollapsed && "justify-center px-0",
              )}
            >
              <Search className="size-4 shrink-0" />
              {!navCollapsed && (
                <>
                  <span className="flex-1 text-left">Search</span>
                  <kbd className="font-mono text-[10px]">⌘K</kbd>
                </>
              )}
            </button>
          </div>

          <nav className="flex flex-col gap-1 px-2 pb-2">
            {screens.map(({ id, label, Icon }) => {
              const active = view === id;

              return (
                <a
                  key={id}
                  {...linkTo({ view: id })}
                  // The label is gone when collapsed, so the tooltip and the
                  // accessible name have to carry it instead.
                  title={navCollapsed ? label : undefined}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap",
                    "transition-[color,background-color,transform] duration-200",
                    "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
                    navCollapsed && "justify-center px-0",
                    active
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground motion-safe:hover:translate-x-0.5",
                  )}
                >
                  {/* The page you are on is marked the way a leaf is veined:
                      a stroke drawn down its length, not a filled block. */}
                  {active && (
                    <span
                      aria-hidden="true"
                      className="bg-primary motion-safe:animate-weld absolute top-1.5 bottom-1.5 left-0 w-[3px] origin-top rounded-full"
                    />
                  )}
                  <Icon
                    className={cn(
                      "size-4 shrink-0 transition-transform duration-200",
                      active ? "text-primary" : "motion-safe:group-hover:scale-110",
                    )}
                  />
                  {!navCollapsed && <span>{label}</span>}
                </a>
              );
            })}
          </nav>

          <div className="mt-auto border-t px-2 py-2">
            <a
              {...linkTo({ view: "settings" })}
              title={navCollapsed ? (me.name || me.email) : undefined}
              aria-label="Settings"
              aria-current={view === "settings" ? "page" : undefined}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                navCollapsed && "justify-center px-0",
                view === "settings" ? "bg-accent font-medium" : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              <Settings className="size-4 shrink-0" />
              {!navCollapsed && <span className="min-w-0 flex-1 truncate text-left">{me.name || me.email}</span>}
            </a>

            <button
              type="button"
              onClick={() => void signOut()}
              title={navCollapsed ? "Sign out" : undefined}
              aria-label="Sign out"
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60",
                navCollapsed && "justify-center px-0",
              )}
            >
              <LogOut className="size-4 shrink-0" />
              {!navCollapsed && "Sign out"}
            </button>

            <button
              type="button"
              onClick={() => updatePreferences({ navCollapsed: !navCollapsed })}
              title={navCollapsed ? "Expand the navigation" : "Collapse the navigation"}
              aria-label={navCollapsed ? "Expand the navigation" : "Collapse the navigation"}
              aria-expanded={!navCollapsed}
              className={cn(
                "mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/60",
                navCollapsed && "justify-center px-0",
              )}
            >
              {navCollapsed ? (
                <PanelLeftOpen className="size-4 shrink-0" />
              ) : (
                <>
                  <PanelLeftClose className="size-4 shrink-0" /> Collapse
                </>
              )}
            </button>
          </div>
        </aside>

        {/* ---------------------------- phone header ------------------------ */}

        <header className="bg-sidebar/70 sticky top-0 z-30 flex items-center justify-between border-b px-4 py-2.5 backdrop-blur-[2px] lg:hidden">
          <BrandLockup />
          <Button variant="ghost" size="icon-sm" onClick={() => setPalette(true)} aria-label="Search">
            <Search />
          </Button>
        </header>

        {/* ----------------------------- content --------------------------- */}

        <main className="min-w-0 flex-1 space-y-4 p-4 pb-24 lg:h-screen lg:overflow-y-auto lg:pb-4">
          {/*
           * Keyed on what is being shown, so React remounts the whole screen
           * when you move between them and the entrance animation runs again.
           * Without the key the class is applied once, at first paint, and
           * every view after that arrives without ceremony.
           */}
          <div key={quoteId ? `quote:${quoteId}` : view} className="motion-safe:animate-extend space-y-4">
            {!loaded && view !== "settings" ? (
              <ScreenSkeleton />
            ) : quoteId ? (
              openQuote === undefined ? (
                <ScreenSkeleton />
              ) : (
                <QuoteEditor
                  quote={openQuote}
                  preferences={preferences}
                  products={products}
                  accounts={accounts}
                  projects={projects}
                  templates={templates}
                  onSaved={onQuoteSaved}
                  onDeleted={() => {
                    void navigate({ view: "quotes" }, { replace: true, force: true });
                    void refresh().catch(fail);
                  }}
                  onBack={() => void navigate({ view: "quotes" })}
                  onShare={(id, title) => setSharing({ kind: "quotes", id, title })}
                  onError={fail}
                  onNotice={notice}
                />
              )
            ) : view === "quotes" ? (
              <QuoteList
                preferences={preferences}
                hrefFor={id => routePath({ view: "quotes", id })}
                onOpen={openQuoteById}
                onNew={() => void navigate({ view: "quotes", id: "new" })}
                onError={fail}
              />
            ) : view === "receivables" ? (
              <ReceivablesView
                accounts={accounts}
                templates={templates}
                preferences={preferences}
                openId={route.id ?? null}
                onOpen={id => void navigate(id ? { view: "receivables", id } : { view: "receivables" })}
                onError={fail}
                onNotice={notice}
              />
            ) : view === "projects" ? (
              <>
                {!route.id && (
                  <AttentionStrip preferences={preferences} linkTo={linkTo} />
                )}
                <ProjectsView
                  projects={projects}
                  accounts={accounts}
                  directory={directory}
                  preferences={preferences}
                  myId={me.id}
                  openId={route.id ?? null}
                  onOpen={id => void navigate(id ? { view: "projects", id } : { view: "projects" })}
                  onChanged={refresh}
                  onOpenQuote={openQuoteById}
                  onShare={(kind, id, title) => setSharing({ kind, id, title })}
                  onError={fail}
                />
              </>
            ) : view === "catalog" ? (
              <CatalogView
                products={products}
                catalogSources={catalogSources}
                preferences={preferences}
                myId={me.id}
                onChanged={refresh}
                onShare={(kind, id, title) => setSharing({ kind, id, title })}
                onError={fail}
                onNotice={notice}
              />
            ) : view === "customers" ? (
              <AccountsView
                accounts={accounts}
                preferences={preferences}
                openId={route.id ?? null}
                onOpen={id => void navigate(id ? { view: "customers", id } : { view: "customers" })}
                onChanged={refresh}
                onError={fail}
                onOpenQuote={openQuoteById}
                onOpenReceivables={() => void navigate({ view: "receivables" })}
              />
            ) : view === "templates" ? (
              <TemplatesView
                templates={templates}
                sellerName={me.name}
                sellerEmail={me.email}
                locale={preferences.locale}
                myId={me.id}
                onChanged={refresh}
                onShare={(kind, id, title) => setSharing({ kind, id, title })}
                onError={fail}
              />
            ) : view === "website" ? (
              <WebsiteView onError={fail} onNotice={notice} />
            ) : (
              <SettingsPanel
                me={me}
                tab={route.id}
                onTab={tab => void navigate({ view: "settings", id: tab }, { replace: true })}
                preferences={preferences}
                saveState={preferenceSave}
                templates={templates}
                meta={meta}
                hasCatalogue={products.length > 0}
                onChange={updatePreferences}
                onReset={() => applyPreferences({ ...DEFAULT_PREFERENCES })}
                onSampleInstalled={refresh}
                onError={fail}
                onNotice={notice}
              />
            )}
          </div>
        </main>
      </div>

      {/* --------------------------- phone tab bar -------------------------- */}

      <nav
        aria-label="Main"
        className="bg-sidebar/90 fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        {PHONE_NAV.map(id => {
          const { label, Icon } = NAV.find(entry => entry.id === id)!;
          const active = view === id;
          return (
            <a
              key={id}
              {...linkTo({ view: id })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[11px]",
                active ? "text-primary font-medium" : "text-muted-foreground",
              )}
            >
              <Icon className="size-5" />
              {label}
            </a>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="More"
          className={cn(
            "relative flex flex-col items-center gap-0.5 py-2 text-[11px]",
            !PHONE_NAV.includes(view) ? "text-primary font-medium" : "text-muted-foreground",
          )}
        >
          <MoreHorizontal className="size-5" />
          More
        </button>
      </nav>

      {moreOpen && (
        <Dialog title="More" onClose={() => setMoreOpen(false)}>
          <div className="-mx-2 grid gap-0.5">
            {[...screens.filter(screen => !PHONE_NAV.includes(screen.id)), { id: "settings" as const, label: "Settings", Icon: Settings }].map(
              ({ id, label, Icon }) => (
                <a
                  key={id}
                  {...linkTo({ view: id })}
                  aria-current={view === id ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm",
                    view === id ? "bg-accent font-medium" : "hover:bg-accent/60",
                  )}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  <span className="flex-1">{label}</span>
                </a>
              ),
            )}
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                void signOut();
              }}
              className="flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-muted-foreground hover:bg-accent/60"
            >
              <LogOut className="size-4" />
              Sign out <span className="truncate text-xs">({me.email})</span>
            </button>
          </div>
        </Dialog>
      )}

      {palette && (
        <CommandPalette
          screens={[...screens, { id: "settings", label: "Settings", Icon: Settings }]}
          projects={projects}
          accounts={accounts}
          products={products}
          onGo={next => void navigate(next)}
          onClose={() => setPalette(false)}
        />
      )}

      {sharing && (
        <ShareDialog
          kind={sharing.kind}
          id={sharing.id}
          title={sharing.title}
          viewerEmail={me.email}
          directory={directory}
          onClose={() => setSharing(null)}
          onChanged={() => void refresh().catch(fail)}
        />
      )}
    </div>
  );
}
