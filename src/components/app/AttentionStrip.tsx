/**
 * What needs somebody today, across the top of the projects screen.
 *
 * Three questions a contractor opens the app with — who owes me past their
 * date, what is waiting on my say-so, and which bids are about to lapse — each
 * answered with a number that links to the list behind it. Every figure is
 * derived from records the app already reads, the same way the receivables
 * screen derives them; nothing here is stored.
 *
 * Money is reported per currency and never summed across two, for the reason
 * in `src/lib/receivable.ts`.
 */
import { useEffect, useState, type MouseEvent } from "react";
import { AlarmClock, Receipt, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import type { Preferences } from "@/lib/preferences";
import { invoiceStatus, today } from "@/lib/receivable";
import type { Route } from "@/lib/route";
import type { CurrencyCode } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatters } from "./common";

type Props = {
  awaiting: number;
  preferences: Preferences;
  linkTo: (route: Route) => { href: string; onClick: (event: MouseEvent) => void };
};

/** A bid this close to its valid-until date counts as about to lapse. */
const EXPIRING_DAYS = 7;

type Facts = {
  overdue: { count: number; byCurrency: [CurrencyCode, number][] };
  expiring: number;
};

const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

export function AttentionStrip({ awaiting, preferences, linkTo }: Props) {
  const [facts, setFacts] = useState<Facts | null>(null);

  useEffect(() => {
    let stale = false;
    const asOf = today();
    const horizon = addDays(asOf, EXPIRING_DAYS);

    Promise.all([
      api.listInvoices(),
      api.searchQuotes({ status: "sent", sort: "validUntil", ascending: true, perPage: 100 }),
    ])
      .then(([invoices, sent]) => {
        if (stale) return;
        const owed = new Map<CurrencyCode, number>();
        let count = 0;
        for (const invoice of invoices) {
          if (invoiceStatus(invoice, asOf) !== "overdue") continue;
          count += 1;
          owed.set(invoice.currency, (owed.get(invoice.currency) ?? 0) + invoice.totals.balance);
        }
        setFacts({
          overdue: { count, byCurrency: [...owed.entries()] },
          expiring: sent.items.filter(quote => quote.validUntil && quote.validUntil <= horizon).length,
        });
      })
      // The strip is a convenience; the screen below it is the point, and it
      // reports its own failures.
      .catch(() => !stale && setFacts(null));

    return () => {
      stale = true;
    };
  }, []);

  if (!facts) return null;
  if (!facts.overdue.count && !awaiting && !facts.expiring) return null;

  const money = (currency: CurrencyCode, value: number) =>
    formatters(currency, preferences.locale).money(value);

  return (
    <div className="grid gap-2 sm:grid-cols-3" role="region" aria-label="Needs attention">
      <Tile
        {...linkTo({ view: "receivables" })}
        Icon={Receipt}
        tone="alert"
        live={facts.overdue.count > 0}
        figure={
          facts.overdue.byCurrency.length
            ? facts.overdue.byCurrency.map(([currency, value]) => money(currency, value)).join(" · ")
            : "Nothing"
        }
        label={facts.overdue.count === 1 ? "1 invoice overdue" : `${facts.overdue.count} invoices overdue`}
      />
      <Tile
        {...linkTo({ view: "approvals" })}
        Icon={ShieldCheck}
        tone="hazard"
        live={awaiting > 0}
        figure={String(awaiting)}
        label={awaiting === 1 ? "estimate waiting on your approval" : "estimates waiting on your approval"}
      />
      <Tile
        {...linkTo({ view: "quotes" })}
        Icon={AlarmClock}
        tone="hazard"
        live={facts.expiring > 0}
        figure={String(facts.expiring)}
        label={`sent estimate${facts.expiring === 1 ? "" : "s"} lapsing within ${EXPIRING_DAYS} days`}
      />
    </div>
  );
}

function Tile({
  href,
  onClick,
  Icon,
  tone,
  live,
  figure,
  label,
}: {
  href: string;
  onClick: (event: MouseEvent) => void;
  Icon: typeof Receipt;
  tone: "alert" | "hazard";
  live: boolean;
  figure: string;
  label: string;
}) {
  return (
    <a
      href={href}
      onClick={onClick}
      className={cn(
        "panel motion-safe:animate-rise items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:border-primary/40",
        // A phone has no room for a tile that says "0"; a desk keeps all three
        // so the row reads the same every morning.
        live ? "flex" : "hidden sm:flex",
        "focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
      )}
    >
      <Icon className={cn("size-5 shrink-0", live ? (tone === "alert" ? "text-alert" : "text-hazard") : "text-muted-foreground")} />
      <div className="min-w-0">
        <p className={cn("truncate font-display text-lg leading-tight font-semibold tabular-nums", !live && "text-muted-foreground")}>
          {figure}
        </p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </a>
  );
}
