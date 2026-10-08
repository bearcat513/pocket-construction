import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuoteTotals } from "@/lib/types";
import type { Formatter } from "./common";

type Props = {
  totals: QuoteTotals;
  format: Formatter;
  showMargin: boolean;
  /** The estimate's own overhead rate, for the line's label. */
  overheadPercent: number;
};

/**
 * The totals, in the order they are worked out, and — when margin is on
 * screen — what the job leaves once it is built.
 */
export function TotalsPanel({ totals, format, showMargin, overheadPercent }: Props) {
  return (
    <div className="space-y-4">
      <div className="panel rounded-lg border shadow-[0_1px_2px_var(--cast)]">
        <div className="space-y-1 px-4 py-3 text-sm">
          <Line label="List price" value={format.money(totals.listTotal)} muted />
          {totals.lineDiscountAmount !== 0 && (
            <Line label="Line discounts" value={`−${format.money(totals.lineDiscountAmount)}`} muted />
          )}
          <Line label="Subtotal" value={format.money(totals.subtotal)} />
          {totals.quoteDiscountAmount !== 0 && (
            <Line label="Estimate discount" value={`−${format.money(totals.quoteDiscountAmount)}`} muted />
          )}
          {totals.overheadAmount !== 0 && (
            <Line label={`Overhead (${format.percent(overheadPercent)})`} value={format.money(totals.overheadAmount)} muted />
          )}
          {totals.shipping !== 0 && <Line label="Shipping" value={format.money(totals.shipping)} muted />}
          {totals.taxAmount !== 0 && <Line label="Tax" value={format.money(totals.taxAmount)} muted />}

          {/* The one number the customer will read back to you, set the way a
              printed proposal sets it. */}
          <div className="border-primary/30 mt-2 flex items-baseline justify-between border-t-2 pt-2">
            <span className="font-medium">Total</span>
            <span className="text-primary font-display text-xl font-semibold tabular-nums">
              {format.money(totals.grandTotal)}
            </span>
          </div>

          {totals.effectiveDiscountPercent > 0 && (
            <p className="text-right text-xs text-muted-foreground">
              {format.percent(totals.effectiveDiscountPercent)} off list
            </p>
          )}
        </div>
      </div>

      {/* The numbers the business reads, not the client. */}
      {showMargin && totals.lineCount > 0 && (
        <div className="panel rounded-lg border px-4 py-3 text-sm">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <TrendingUp className="size-3.5" /> Margin
          </p>
          <Line label="Cost" value={format.money(totals.costTotal)} muted />
          <Line
            label="Margin"
            value={`${format.money(totals.margin)} · ${format.percent(totals.marginPercent)}`}
            className={cn(totals.marginPercent < 30 && "text-destructive")}
          />
        </div>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  muted,
  className,
}: {
  label: string;
  value: string;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <span className={cn(muted && "text-muted-foreground")}>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
