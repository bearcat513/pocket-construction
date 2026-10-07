/**
 * ⌘K: go anywhere, open anything, start an estimate — without the mouse.
 *
 * Estimators live on the keyboard. The palette searches what the app already
 * holds (screens, projects, clients, materials) as you type, and asks the
 * server for estimates, because the estimates list is paged and the one you
 * want is very often not on the first page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, CornerDownLeft, FileText, HardHat, Loader2, Package, Plus, Search, ScrollText } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { Route, View } from "@/lib/route";
import type { Account, Product, Project, QuoteSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { StatusBadge } from "./common";

type Command = {
  key: string;
  group: string;
  label: string;
  detail?: string;
  Icon: typeof Search;
  badge?: React.ReactNode;
  run: () => void;
};

type Props = {
  screens: { id: View; label: string; Icon: typeof Search }[];
  projects: Project[];
  accounts: Account[];
  products: Product[];
  onGo: (route: Route) => void;
  onClose: () => void;
};

/** How many of each kind are listed before the rest are left for a sharper search. */
const PER_GROUP = 6;

/** Every word typed appears somewhere in the text, in any order. */
const matches = (terms: string[], ...fields: (string | undefined)[]) => {
  const haystack = fields.join(" ").toLowerCase();
  return terms.every(term => haystack.includes(term));
};

export function CommandPalette({ screens, projects, accounts, products, onGo, onClose }: Props) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [estimates, setEstimates] = useState<QuoteSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const terms = useMemo(() => text.trim().toLowerCase().split(/\s+/).filter(Boolean), [text]);

  // Estimates come from the server, a beat after typing stops.
  useEffect(() => {
    let stale = false;
    setSearching(true);
    const timer = setTimeout(() => {
      api
        .searchQuotes({ q: text.trim(), perPage: PER_GROUP })
        .then(page => !stale && setEstimates(page.items))
        .catch(() => !stale && setEstimates([]))
        .finally(() => !stale && setSearching(false));
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [text]);

  const go = (route: Route) => () => {
    onClose();
    onGo(route);
  };

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];

    if (!terms.length || matches(terms, "new estimate quote create")) {
      list.push({ key: "new", group: "Actions", label: "New estimate", Icon: Plus, run: go({ view: "quotes", id: "new" }) });
    }

    for (const screen of screens) {
      if (!terms.length || matches(terms, screen.label, "go to")) {
        list.push({ key: `screen:${screen.id}`, group: "Go to", label: screen.label, Icon: screen.Icon, run: go({ view: screen.id }) });
      }
    }

    if (terms.length) {
      for (const quote of estimates) {
        list.push({
          key: `quote:${quote.id}`,
          group: "Estimates",
          label: quote.name,
          detail: [quote.number, quote.customer.name].filter(Boolean).join(" · "),
          Icon: ScrollText,
          badge: <StatusBadge status={quote.status} />,
          run: go({ view: "quotes", id: quote.id }),
        });
      }

      projects
        .filter(project => matches(terms, project.number, project.name, project.accountName))
        .slice(0, PER_GROUP)
        .forEach(project =>
          list.push({
            key: `project:${project.id}`,
            group: "Projects",
            label: project.name,
            detail: [project.number, project.accountName].filter(Boolean).join(" · "),
            Icon: HardHat,
            run: go({ view: "projects", id: project.id }),
          }),
        );

      accounts
        .filter(account => matches(terms, account.name, account.industry, ...account.tags))
        .slice(0, PER_GROUP)
        .forEach(account =>
          list.push({
            key: `client:${account.id}`,
            group: "Clients",
            label: account.name,
            detail: account.industry,
            Icon: Building2,
            run: go({ view: "customers", id: account.id }),
          }),
        );

      products
        .filter(product => matches(terms, product.sku, product.name, product.material.manufacturer))
        .slice(0, PER_GROUP)
        .forEach(product =>
          list.push({
            key: `item:${product.id}`,
            group: "Materials",
            label: product.name,
            detail: product.sku,
            Icon: Package,
            run: go({ view: "catalog" }),
          }),
        );
    } else {
      // Nothing typed: the most recently touched estimates, as a starting point.
      for (const quote of estimates) {
        list.push({
          key: `quote:${quote.id}`,
          group: "Recent estimates",
          label: quote.name,
          detail: [quote.number, quote.customer.name].filter(Boolean).join(" · "),
          Icon: FileText,
          badge: <StatusBadge status={quote.status} />,
          run: go({ view: "quotes", id: quote.id }),
        });
      }
    }

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terms, estimates, screens, projects, accounts, products]);

  useEffect(() => setActive(0), [text]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(index => Math.min(index + 1, commands.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(index => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commands[active]?.run();
    }
  };

  let lastGroup = "";

  return (
    <Dialog title="Go to anything" onClose={onClose} className="max-w-xl">
      <div className="-mx-4 -my-3">
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search estimates, projects, clients, materials…"
            aria-label="Search"
            aria-controls="palette-results"
            aria-activedescendant={commands[active] ? `palette-${active}` : undefined}
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {searching && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />}
        </div>

        <ul ref={listRef} id="palette-results" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {commands.length === 0 && !searching && (
            <li className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing matches “{text}”.</li>
          )}
          {commands.map((command, index) => {
            const heading = command.group !== lastGroup ? command.group : "";
            lastGroup = command.group;
            return (
              <li key={command.key} role="presentation">
                {heading && (
                  <p className="px-4 pt-2 pb-1 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                    {heading}
                  </p>
                )}
                <button
                  type="button"
                  id={`palette-${index}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={command.run}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm",
                    index === active && "bg-accent text-accent-foreground",
                  )}
                >
                  <command.Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {command.label}
                    {command.detail && <span className="ml-2 text-xs text-muted-foreground">{command.detail}</span>}
                  </span>
                  {command.badge}
                  {index === active && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="flex gap-3 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ to move</span>
          <span>↵ to open</span>
          <span>esc to close</span>
        </p>
      </div>
    </Dialog>
  );
}
