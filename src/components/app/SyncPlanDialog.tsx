import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Check, Loader2, PlayCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Notice } from "./common";
import { SYNC_ACTION_LABELS, type SyncAction, type SyncChange } from "@/lib/catalogSync";
import type { SyncResult } from "@/lib/api";
import type { CatalogSource } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  source: CatalogSource;
  /** The previewed plan, or the result of a run that has already happened. */
  result: SyncResult;
  /** Applies the plan, letting through the flagged keys named. */
  onApply: (acceptedKeys: string[]) => Promise<void>;
  onClose: () => void;
};

const ACTION_TONE: Record<SyncAction, "neutral" | "info" | "pending" | "success" | "danger" | "outline"> = {
  flagged: "pending",
  create: "success",
  update: "info",
  deactivate: "danger",
  skip: "neutral",
  unchanged: "outline",
};

/** The order a person reads a plan in: decisions first, noise last. */
const ORDER: SyncAction[] = ["flagged", "create", "update", "deactivate", "skip", "unchanged"];

/**
 * What a sync would do, before it does it.
 *
 * A modal rather than a panel because it is a document to be *read* — the one
 * place in this app where the point is to check something over rather than fill
 * it in. It is also the screen that justifies the whole design: a feed that
 * applied itself silently would never need this, and the first time a supplier
 * shifted a decimal point you would find out from a margin report.
 *
 * Flagged rows carry a switch each. Nothing flagged is written unless somebody
 * turns one on, and the Apply button counts them out loud so an accidental
 * "accept everything" is not one click away.
 */
export function SyncPlanDialog({ source, result, onApply, onClose }: Props) {
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [showUnchanged, setShowUnchanged] = useState(false);

  const { plan } = result;

  const grouped = useMemo(() => {
    const groups = new Map<SyncAction, SyncChange[]>();
    for (const change of plan.changes) {
      const list = groups.get(change.action) ?? [];
      list.push(change);
      groups.set(change.action, list);
    }
    return groups;
  }, [plan.changes]);

  const toggle = (key: string) =>
    setAccepted(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const flagged = grouped.get("flagged") ?? [];
  const willWrite = plan.counts.create + plan.counts.update + plan.counts.deactivate + accepted.size;

  const apply = async () => {
    setApplying(true);
    setError("");
    try {
      await onApply([...accepted]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The sync could not be applied.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog
      title={result.applied ? `Synced from ${source.name}` : `What ${source.name} would change`}
      description={
        result.applied
          ? `${plan.rowsRead} row${plan.rowsRead === 1 ? "" : "s"} read. This has been applied.`
          : `${plan.rowsRead} row${plan.rowsRead === 1 ? "" : "s"} read. Nothing has been changed yet.`
      }
      onClose={onClose}
      className="max-w-4xl"
      footer={
        result.applied ? (
          <Button onClick={onClose}>
            <Check /> Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void apply()} disabled={applying || willWrite === 0}>
              {applying ? <Loader2 className="animate-spin" /> : <PlayCircle />}
              {willWrite === 0
                ? "Nothing to apply"
                : `Apply ${willWrite} change${willWrite === 1 ? "" : "s"}${accepted.size ? ` (${accepted.size} accepted)` : ""}`}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4">
        {error && <Notice kind="error" lines={[error]} />}
        {plan.warnings.length > 0 && <Notice kind="warning" lines={plan.warnings} />}
        {result.failures.length > 0 && (
          <Notice
            kind="error"
            lines={result.failures.map(failure => `${failure.sku}: ${failure.error}`)}
          />
        )}

        {/* The count row: what the feed found, at a glance. */}
        <div className="flex flex-wrap gap-2">
          {ORDER.filter(action => plan.counts[action] > 0).map(action => (
            <Badge key={action} tone={ACTION_TONE[action]}>
              {plan.counts[action]} {SYNC_ACTION_LABELS[action].toLowerCase()}
            </Badge>
          ))}
          {plan.changes.length === 0 && <Badge tone="outline">nothing matched</Badge>}
        </div>

        {flagged.length > 0 && !result.applied && (
          <Notice
            kind="warning"
            lines={[
              `${flagged.length} row${flagged.length === 1 ? "" : "s"} move a price further than this source may ` +
                `change unattended (${source.policy.maxPriceChangePercent}%). Each one waits for you below.`,
            ]}
          />
        )}

        {ORDER.map(action => {
          const changes = grouped.get(action) ?? [];
          if (!changes.length) return null;
          if (action === "unchanged" && !showUnchanged) return null;

          return (
            <div key={action} className="rounded-md border">
              <div className="seam flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <p className="text-xs font-medium">
                  {SYNC_ACTION_LABELS[action]}
                  <span className="ml-1.5 text-muted-foreground">
                    {changes.length} item{changes.length === 1 ? "" : "s"}
                  </span>
                </p>
                {action === "flagged" && !result.applied && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setAccepted(current =>
                        current.size === changes.length ? new Set() : new Set(changes.map(change => change.key)),
                      )
                    }
                  >
                    {accepted.size === changes.length ? "Accept none" : "Accept all"}
                  </Button>
                )}
              </div>

              <ul className="divide-y">
                {changes.slice(0, 200).map(change => (
                  <li key={`${action}-${change.key}`} className="px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="font-medium">{change.name || change.sku || change.key}</span>
                          {change.sku && <span className="font-mono text-muted-foreground">{change.sku}</span>}
                          <span className="text-muted-foreground">·</span>
                          <span className="font-mono text-muted-foreground">{change.key}</span>
                        </p>
                        {change.notes.map((note, index) => (
                          <p key={index} className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
                            {action === "flagged" && <AlertTriangle className="mt-px size-3 shrink-0" />}
                            {note}
                          </p>
                        ))}
                      </div>

                      {action === "flagged" && !result.applied && (
                        <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs">
                          <span className={accepted.has(change.key) ? "font-medium" : "text-muted-foreground"}>
                            {accepted.has(change.key) ? "Will apply" : "Held"}
                          </span>
                          <Switch
                            checked={accepted.has(change.key)}
                            onChange={() => toggle(change.key)}
                            aria-label={`Accept the change to ${change.sku || change.key}`}
                          />
                        </label>
                      )}
                    </div>

                    {change.changes.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {change.changes.map(field => (
                          <li key={field.field} className="flex flex-wrap items-center gap-1.5 text-xs">
                            <span className="min-w-28 text-muted-foreground">{field.label}</span>
                            {field.from ? (
                              <>
                                <span className="font-mono text-muted-foreground line-through">{field.from}</span>
                                <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
                              </>
                            ) : null}
                            <span className="font-mono font-medium">{field.to || "—"}</span>
                            {field.changePercent !== undefined && field.changePercent > 0 && (
                              <span
                                className={cn(
                                  "text-muted-foreground",
                                  field.changePercent > source.policy.maxPriceChangePercent &&
                                    source.policy.maxPriceChangePercent > 0 &&
                                    "font-medium text-chart-3",
                                )}
                              >
                                ({field.changePercent}%)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>

              {changes.length > 200 && (
                <p className="border-t px-3 py-2 text-xs text-muted-foreground">
                  …and {changes.length - 200} more. All of them are applied; this list is trimmed for reading.
                </p>
              )}
            </div>
          );
        })}

        {(grouped.get("unchanged") ?? []).length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowUnchanged(current => !current)}>
            {showUnchanged ? "Hide" : "Show"} {(grouped.get("unchanged") ?? []).length} unchanged
          </Button>
        )}
      </div>
    </Dialog>
  );
}
