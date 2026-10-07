import { useMemo, useState } from "react";
import { Check, Download, FileUp, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Field, Notice } from "./common";
import { api, type FeedInspection } from "@/lib/api";
import type { CatalogSourceInput } from "@/lib/validate";
import {
  COST_TYPE_LABELS,
  COST_TYPES,
  CURRENCIES,
  DEFAULT_SYNC_POLICY,
  EMPTY_MAPPING,
  MATCH_KEYS,
  MATCH_KEY_LABELS,
  SOURCE_FORMATS,
  SYNC_FIELDS,
  SYNC_FIELD_LABELS,
  type CatalogSource,
  type SourceMapping,
  type SyncField,
  type SyncPolicy,
} from "@/lib/types";

type Props = {
  /** null when a source is being created. */
  source: CatalogSource | null;
  onSave: (input: CatalogSourceInput) => Promise<void>;
  onClose: () => void;
};

type Tab = "where" | "columns" | "permissions";

/**
 * Which mapping fields to offer, and in the order somebody fills them in.
 *
 * Only these are editable: `key` and `matchOn` have their own controls at the
 * top, because they decide whether anything matches at all and everything else
 * is moot until they are right.
 */
const MAPPABLE: { field: keyof SourceMapping; label: string; hint?: string }[] = [
  { field: "sku", label: "Our SKU", hint: "Used when this feed creates an item. Falls back to the key." },
  { field: "name", label: "Name" },
  { field: "description", label: "Description" },
  { field: "family", label: "Family" },
  { field: "unitOfMeasure", label: "Unit of measure" },
  { field: "cost", label: "Unit cost" },
  { field: "price", label: "List price", hint: "Most trade feeds do not carry one — and should not set yours." },
  { field: "active", label: "Active / discontinued" },
  { field: "division", label: "CSI division" },
  { field: "manufacturer", label: "Manufacturer" },
  { field: "manufacturerPartNumber", label: "Manufacturer part number" },
  { field: "supplier", label: "Supplier" },
  { field: "supplierSku", label: "Supplier SKU" },
  { field: "nominalSize", label: "Nominal size" },
  { field: "actualSize", label: "Actual size" },
  { field: "grade", label: "Grade / mix" },
  { field: "finish", label: "Finish" },
  { field: "weightPerUnit", label: "Weight per unit" },
  { field: "coverage", label: "Coverage" },
  { field: "coverageUnit", label: "Coverage unit" },
  { field: "leadTimeDays", label: "Lead time (days)" },
];

const BLANK: CatalogSourceInput = {
  name: "",
  description: "",
  format: "csv",
  url: "",
  recordPath: "",
  mapping: { ...EMPTY_MAPPING },
  policy: { ...DEFAULT_SYNC_POLICY, fields: [...DEFAULT_SYNC_POLICY.fields] },
  active: true,
  lastRun: null,
};

const toInput = (source: CatalogSource | null): CatalogSourceInput =>
  source
    ? {
        name: source.name,
        description: source.description,
        format: source.format,
        url: source.url,
        recordPath: source.recordPath,
        mapping: { ...source.mapping },
        policy: { ...source.policy, fields: [...source.policy.fields] },
        active: source.active,
        lastRun: source.lastRun,
      }
    : { ...BLANK, mapping: { ...EMPTY_MAPPING }, policy: { ...DEFAULT_SYNC_POLICY, fields: [...DEFAULT_SYNC_POLICY.fields] } };

/**
 * A supplier feed, and what it is allowed to do to the catalogue.
 *
 * Three tabs, in the order the questions actually arrive: where the data comes
 * from, which of its columns mean what, and — the one worth slowing down on —
 * what a sync may change. The permissions tab is last because it is the one
 * people should read rather than skip, and putting it beside the Save button
 * is the only layout that achieves that.
 *
 * The columns tab can read the feed before anything is saved, so a mapping is
 * written against the feed's real headings rather than against a memory of
 * them. That needs a saved source to inspect through, so it offers the reading
 * only once there is one.
 */
export function CatalogSourceEditor({ source, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<CatalogSourceInput>(() => toInput(source));
  const [tab, setTab] = useState<Tab>("where");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  /** What the feed's header row actually says, once somebody has looked. */
  const [inspection, setInspection] = useState<FeedInspection | null>(null);
  const [inspecting, setInspecting] = useState(false);

  const patch = (changes: Partial<CatalogSourceInput>) => setDraft(current => ({ ...current, ...changes }));
  const patchMapping = (changes: Partial<SourceMapping>) =>
    setDraft(current => ({ ...current, mapping: { ...current.mapping, ...changes } }));
  const patchPolicy = (changes: Partial<SyncPolicy>) =>
    setDraft(current => ({ ...current, policy: { ...current.policy, ...changes } }));

  const toggleField = (field: SyncField) =>
    setDraft(current => ({
      ...current,
      policy: {
        ...current.policy,
        fields: current.policy.fields.includes(field)
          ? current.policy.fields.filter(entry => entry !== field)
          : [...current.policy.fields, field],
      },
    }));

  /**
   * Column names for the pickers.
   *
   * From the feed when it has been read, and from what the mapping already
   * names when it has not — so an existing source's mapping is editable
   * offline, rather than showing every field as empty until somebody fetches.
   */
  const columns = useMemo(() => {
    const known = new Set<string>(inspection?.columns ?? []);
    for (const value of Object.values(draft.mapping)) if (typeof value === "string" && value) known.add(value);
    return [...known].sort().map(name => ({ value: name, label: name }));
  }, [inspection, draft.mapping]);

  const read = async (body?: string) => {
    if (!source) return;
    setInspecting(true);
    setError("");
    try {
      setInspection(await api.inspectCatalogSource(source.id, body));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not read that feed.");
    } finally {
      setInspecting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSave(draft);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save this source.");
    } finally {
      setSaving(false);
    }
  };

  const mapped = MAPPABLE.filter(entry => draft.mapping[entry.field]).length;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "where", label: "Where it comes from" },
    { id: "columns", label: "Columns", count: mapped },
    { id: "permissions", label: "What it may change", count: draft.policy.fields.length },
  ];

  return (
    <Sheet
      title={source ? `Edit ${source.name}` : "New catalogue source"}
      description={
        source
          ? source.url || "Fed by uploaded file"
          : "A supplier's price list, and the rules for what it may change in your catalogue."
      }
      onClose={onClose}
      className="sm:max-w-3xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !draft.name || !draft.mapping.key}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            {source ? "Save source" : "Create source"}
          </Button>
        </>
      }
    >
      {error && <Notice kind="error" lines={[error]} className="mb-3" />}

      <div className="mb-4 flex flex-wrap gap-1">
        {tabs.map(entry => (
          <Button
            key={entry.id}
            variant={tab === entry.id ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
            {entry.count ? <Badge tone="outline">{entry.count}</Badge> : null}
          </Button>
        ))}
      </div>

      <div className="space-y-4">
        {tab === "where" && (
          <>
            <div className="grid gap-3 @md:grid-cols-2">
              <Field label="Name" hint="What you call this supplier's list.">
                <Input value={draft.name} onChange={event => patch({ name: event.target.value })} autoFocus />
              </Field>
              <Field label="Format">
                <Select value={draft.format} onValueChange={value => patch({ format: value as CatalogSourceInput["format"] })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SOURCE_FORMATS.map(format => (
                      <SelectItem key={format} value={format}>
                        {format.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field label="Description">
              <Textarea
                value={draft.description}
                onChange={event => patch({ description: event.target.value })}
                rows={2}
              />
            </Field>

            <Field
              label="URL"
              hint="Leave it empty to feed this source by dropping a file on it — plenty of suppliers email a spreadsheet and have no endpoint at all."
            >
              <Input
                value={draft.url}
                onChange={event => patch({ url: event.target.value })}
                placeholder="https://supplier.example.com/pricelist.csv"
                className="font-mono text-xs"
              />
            </Field>

            {draft.format === "json" && (
              <Field label="Path to the list" hint="For a payload that wraps its items in an envelope: “data.items”. Empty means the payload is itself the array.">
                <Input
                  value={draft.recordPath}
                  onChange={event => patch({ recordPath: event.target.value })}
                  placeholder="data.items"
                  className="font-mono text-xs"
                />
              </Field>
            )}

            <Field label="Active" hint="A switched-off source refuses to run, and says so rather than doing nothing.">
              <div className="flex h-9 items-center">
                <Switch checked={draft.active} onChange={event => patch({ active: event.target.checked })} />
              </div>
            </Field>
          </>
        )}

        {tab === "columns" && (
          <>
            <div className="rounded-md border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium">Read the feed</p>
                {source ? (
                  <div className="flex gap-2">
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        accept=".csv,.json,.txt,text/csv,application/json,text/plain"
                        className="hidden"
                        onChange={async event => {
                          const file = event.target.files?.[0];
                          event.target.value = "";
                          if (file) await read(await file.text());
                        }}
                      />
                      <span className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs">
                        <FileUp className="size-3.5" /> From a file
                      </span>
                    </label>
                    {draft.url && (
                      <Button variant="outline" size="sm" onClick={() => void read()} disabled={inspecting}>
                        {inspecting ? <Loader2 className="animate-spin" /> : <Download />} Fetch
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {source
                  ? inspection
                    ? `${inspection.rowCount} row${inspection.rowCount === 1 ? "" : "s"}, ${inspection.columns.length} columns.`
                    : "Read it once and the pickers below fill with its real headings, rather than your memory of them."
                  : "Save the source first, then come back and read the feed to fill these pickers in."}
              </p>

              {inspection && inspection.sample.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        {inspection.columns.slice(0, 8).map(column => (
                          <th key={column} className="px-2 py-1 font-medium whitespace-nowrap">
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inspection.sample.slice(0, 3).map((row, index) => (
                        <tr key={index} className="border-t">
                          {inspection.columns.slice(0, 8).map(column => (
                            <td key={column} className="max-w-40 truncate px-2 py-1 font-mono whitespace-nowrap">
                              {row[column]}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="rounded-md border border-primary/30 bg-primary/5 p-3">
              <p className="mb-3 text-xs font-medium">How a row finds its item</p>
              <div className="grid gap-3 @md:grid-cols-2">
                <Field label="Key column" hint="The code in the feed that identifies each row.">
                  <Combobox
                    value={draft.mapping.key}
                    onChange={key => patchMapping({ key })}
                    options={columns}
                    emptyLabel="Not set"
                    placeholder="Choose or type a column"
                    allowCustom
                    aria-label="Key column"
                  />
                </Field>
                <Field label="Matched against" hint="Usually their SKU: they know their codes and nothing about yours.">
                  <Select
                    value={draft.mapping.matchOn}
                    onValueChange={value => patchMapping({ matchOn: value as SourceMapping["matchOn"] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MATCH_KEYS.map(key => (
                        <SelectItem key={key} value={key}>
                          {MATCH_KEY_LABELS[key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
              {!draft.mapping.key && (
                <Notice
                  kind="warning"
                  className="mt-3"
                  lines={["Without a key column nothing can be matched, and the source cannot be saved."]}
                />
              )}
            </div>

            <div className="grid gap-3 @md:grid-cols-2">
              {MAPPABLE.map(entry => (
                <Field key={entry.field} label={entry.label} hint={entry.hint}>
                  <Combobox
                    value={(draft.mapping[entry.field] as string) ?? ""}
                    onChange={value => patchMapping({ [entry.field]: value } as Partial<SourceMapping>)}
                    options={columns}
                    emptyLabel="Not carried"
                    placeholder="Choose or type a column"
                    allowCustom
                    aria-label={`${entry.label} column`}
                  />
                </Field>
              ))}
            </div>
          </>
        )}

        {tab === "permissions" && (
          <>
            <Notice
              kind="info"
              lines={[
                "A feed writes the fields you tick here and nothing else. Your waste factors, option groups, " +
                  "assemblies, discount ceilings and margins are never a supplier's to set.",
              ]}
            />

            <div className="rounded-md border p-3">
              <p className="mb-2 text-xs font-medium">Fields this source may write</p>
              <div className="grid gap-1.5 @md:grid-cols-2">
                {SYNC_FIELDS.map(field => {
                  const on = draft.policy.fields.includes(field);
                  return (
                    <label
                      key={field}
                      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted/50"
                    >
                      <span className={on ? "font-medium" : "text-muted-foreground"}>
                        {SYNC_FIELD_LABELS[field]}
                        {field === "price" && <span className="ml-1 text-muted-foreground">— usually yours, not theirs</span>}
                      </span>
                      <Switch checked={on} onChange={() => toggleField(field)} aria-label={SYNC_FIELD_LABELS[field]} />
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 @md:grid-cols-2">
              <Field
                label="Hold a price move larger than (%)"
                hint="A bigger move is reported for review rather than applied. 0 turns the guard off."
              >
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.policy.maxPriceChangePercent}
                  onChange={event => patchPolicy({ maxPriceChangePercent: Number(event.target.value) })}
                />
              </Field>
              <Field
                label="Markup on cost (%)"
                hint="Only used when list price is synced and the feed has no price column. 0 leaves prices alone."
              >
                <Input
                  type="number"
                  min={0}
                  value={draft.policy.markupPercent}
                  onChange={event => patchPolicy({ markupPercent: Number(event.target.value) })}
                />
              </Field>
            </div>

            <div className="rounded-md border p-3">
              <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
                <span className="text-xs">
                  <span className="font-medium">Add items it lists that you do not have</span>
                  <span className="block text-muted-foreground">
                    New items arrive unpriced unless this source may set a price, so price them before quoting them.
                  </span>
                </span>
                <Switch
                  checked={draft.policy.createMissing}
                  onChange={event => patchPolicy({ createMissing: event.target.checked })}
                  aria-label="Create missing items"
                />
              </label>
              <label className="flex cursor-pointer items-start justify-between gap-3 border-t py-1.5">
                <span className="text-xs">
                  <span className="font-medium">Switch off items it has stopped carrying</span>
                  <span className="block text-muted-foreground">
                    Deactivated, never deleted: an item stays on every estimate that already quotes it.
                  </span>
                </span>
                <Switch
                  checked={draft.policy.deactivateMissing}
                  onChange={event => patchPolicy({ deactivateMissing: event.target.checked })}
                  aria-label="Deactivate missing items"
                />
              </label>
            </div>

            {draft.policy.createMissing && (
              <div className="grid gap-3 @md:grid-cols-3">
                <Field label="New items go in family">
                  <Input
                    value={draft.policy.defaultFamily}
                    onChange={event => patchPolicy({ defaultFamily: event.target.value })}
                    placeholder="Sundries"
                  />
                </Field>
                <Field label="As cost type">
                  <Select
                    value={draft.policy.defaultCostType}
                    onValueChange={value => patchPolicy({ defaultCostType: value as SyncPolicy["defaultCostType"] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COST_TYPES.map(type => (
                        <SelectItem key={type} value={type}>
                          {COST_TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Feed's currency">
                  <Select
                    value={draft.policy.currency}
                    onValueChange={value => patchPolicy({ currency: value as SyncPolicy["currency"] })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map(code => (
                        <SelectItem key={code} value={code}>
                          {code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}

            {draft.policy.fields.length === 0 && (
              <Notice
                kind="warning"
                lines={["This source may not write anything, so every matched row will read as unchanged."]}
              />
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}
