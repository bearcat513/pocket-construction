import { useEffect, useState, type MouseEvent } from "react";
import { Loader2, Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SortTh, Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { EmptyState, Section, SkeletonRows, StatusBadge, formatters, statusLabel } from "./common";
import { api } from "@/lib/api";
import type { QuoteSortKey } from "@/lib/quoteSearch";
import { QUOTE_STATUSES, type QuoteStatus, type QuoteSummary } from "@/lib/types";
import type { Preferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";

type Props = {
  preferences: Preferences;
  /** The link an estimate's row carries, so it can be opened in a new tab. */
  hrefFor: (id: string) => string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onError: (error: unknown) => void;
};

/** How long typing has to pause before the server is asked. */
const SEARCH_DELAY_MS = 250;

/**
 * Every estimate, newest first — searched, filtered and paged by the server.
 *
 * The status filter is a row of counts rather than a dropdown, because the
 * question a rep opens this screen with is almost always "what is waiting on
 * something" — and a count answers it before anything is clicked. The counts
 * are the account's, not the page's: they come back with every search.
 *
 * A page is `quoteListLimit` long, and "Load more" fetches the next one,
 * so the heading always says how many there are in all and how many are shown.
 */
export function QuoteList({ preferences, hrefFor, onOpen, onNew, onError }: Props) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<QuoteStatus | "all">("all");
  const [sort, setSort] = useState<{ key: QuoteSortKey; ascending: boolean }>({ key: "updated", ascending: false });

  const [items, setItems] = useState<QuoteSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Partial<Record<QuoteStatus, number>>>({});
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);

  const perPage = preferences.quoteListLimit;

  // Typing is debounced; everything else asks at once.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let stale = false;
    api
      .searchQuotes({ q: query, status, sort: sort.key, ascending: sort.ascending, page: 1, perPage })
      .then(result => {
        if (stale) return;
        setItems(result.items);
        setTotal(result.total);
        setCounts(result.counts);
        setPage(1);
      })
      .catch(error => {
        if (stale) return;
        setItems([]);
        onError(error);
      });
    return () => {
      stale = true;
    };
  }, [query, status, sort, perPage, onError]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const next = await api.searchQuotes({
        q: query,
        status,
        sort: sort.key,
        ascending: sort.ascending,
        page: page + 1,
        perPage,
      });
      // Something saved since the first page can shift a row across the
      // boundary; an id seen twice is shown once.
      setItems(current => {
        const seen = new Set((current ?? []).map(quote => quote.id));
        return [...(current ?? []), ...next.items.filter(quote => !seen.has(quote.id))];
      });
      setTotal(next.total);
      setPage(next.page);
    } catch (error) {
      onError(error);
    } finally {
      setLoadingMore(false);
    }
  };

  const onSort = (key: QuoteSortKey) =>
    setSort(current =>
      current.key === key ? { key, ascending: !current.ascending } : { key, ascending: key !== "updated" },
    );

  const allCount = Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);
  const shown = items?.length ?? 0;

  const open = (event: MouseEvent, id: string) => {
    // A modified click is the browser's: a new tab, a new window.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onOpen(id);
  };

  return (
    <Section
      title="Estimates"
      description={
        items === null
          ? "Loading…"
          : shown < total
            ? `Showing ${shown} of ${total}`
            : `${total} estimate${total === 1 ? "" : "s"}`
      }
      actions={
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search name, number, client"
              aria-label="Search estimates"
              className="h-8 w-56 pl-8"
            />
          </div>
          <Button size="sm" onClick={onNew}>
            <Plus /> New estimate
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap gap-1.5 border-b px-4 py-2" role="group" aria-label="Filter by status">
        <FilterChip label="All" count={allCount} on={status === "all"} onClick={() => setStatus("all")} />
        {QUOTE_STATUSES.filter(candidate => counts[candidate] || candidate === status).map(candidate => (
          <FilterChip
            key={candidate}
            label={statusLabel(candidate)}
            count={counts[candidate] ?? 0}
            on={status === candidate}
            onClick={() => setStatus(candidate)}
          />
        ))}
      </div>

      {items === null ? (
        <SkeletonRows />
      ) : items.length === 0 ? (
        <EmptyState title={query || status !== "all" ? "Nothing matches" : "No estimates yet"}>
          {query || status !== "all"
            ? "Try a different search, or clear the status filter."
            : "Start one from a project, or install the worked example from Settings to see the whole thing running."}
        </EmptyState>
      ) : (
        <>
          <Table>
            <Thead>
              <Tr>
                <SortTh column="name" sort={sort} onSort={onSort}>
                  Estimate
                </SortTh>
                <Th>Client</Th>
                <SortTh column="status" sort={sort} onSort={onSort}>
                  Status
                </SortTh>
                <Th numeric>Lines</Th>
                <Th numeric>Discount</Th>
                <Th numeric>Total</Th>
                <SortTh column="validUntil" sort={sort} onSort={onSort}>
                  Valid until
                </SortTh>
                <SortTh column="updated" sort={sort} onSort={onSort}>
                  Updated
                </SortTh>
              </Tr>
            </Thead>
            <Tbody>
              {items.map(quote => {
                const format = formatters(quote.currency, preferences.locale);
                return (
                  <Tr key={quote.id} onClick={() => onOpen(quote.id)} className="cursor-pointer">
                    <Td>
                      {/* The name is the row's real link: focusable, announced as
                          a link, and openable in a new tab. */}
                      <a
                        href={hrefFor(quote.id)}
                        onClick={event => {
                          event.stopPropagation();
                          open(event, quote.id);
                        }}
                        className="focus-visible:ring-ring/50 block rounded-sm font-medium outline-none hover:underline focus-visible:ring-[3px]"
                      >
                        {quote.name}
                      </a>
                      <span className="font-mono text-xs text-muted-foreground">
                        {quote.number}
                        {quote.version > 1 ? ` · rev ${quote.version}` : ""}
                      </span>
                    </Td>
                    <Td>{quote.customer.name || <span className="text-muted-foreground">—</span>}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={quote.status} />
                        {quote.pendingApprovals > 0 && <Badge tone="pending">{quote.pendingApprovals} pending</Badge>}
                      </div>
                    </Td>
                    <Td numeric className="text-muted-foreground">
                      {quote.lineCount}
                    </Td>
                    <Td numeric className="text-muted-foreground">
                      {format.percent(quote.totals?.effectiveDiscountPercent ?? 0)}
                    </Td>
                    <Td numeric className="font-medium">
                      {format.money(quote.totals?.grandTotal ?? 0)}
                    </Td>
                    <Td className="text-muted-foreground">{format.date(quote.validUntil)}</Td>
                    <Td className="text-muted-foreground">{format.date(quote.updatedAt)}</Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>

          {shown < total && (
            <div className="flex items-center justify-center gap-3 border-t px-4 py-3 text-xs text-muted-foreground">
              <span>
                {shown} of {total}
              </span>
              <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore && <Loader2 className="animate-spin" />} Load {Math.min(perPage, total - shown)} more
              </Button>
            </div>
          )}
        </>
      )}
    </Section>
  );
}

function FilterChip({
  label,
  count,
  on,
  onClick,
}: {
  label: string;
  count: number;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
        on ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-accent",
      )}
    >
      {label} <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}
