import { useMemo, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  FileUp,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Rss,
  Share2,
  Trash2,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SortTh, Table, Tbody, Td, Th, Thead, Tr, sortRows, useSort } from "@/components/ui/table";
import { EmptyState, Section, formatters } from "./common";
import { useFeedback } from "./feedback";
import { CatalogSourceEditor } from "./CatalogSourceEditor";
import { CatalogTemplatesDialog } from "./CatalogTemplatesDialog";
import { ProductEditor } from "./ProductEditor";
import { SyncPlanDialog } from "./SyncPlanDialog";
import { api, type Shareable, type SyncResult } from "@/lib/api";
import type { Preferences } from "@/lib/preferences";
import { sellPrice } from "@/lib/pricing";
import { DEFAULT_CURRENCY } from "@/lib/money";
import {
  COST_TYPE_LABELS,
  COST_TYPES,
  MATCH_KEY_LABELS,
  SYNC_FIELD_LABELS,
  divisionLabel,
  type CatalogSource,
  type CostType,
  type Product,
} from "@/lib/types";
import type { CatalogSourceInput, ProductInput } from "@/lib/validate";
import { cn } from "@/lib/utils";

type Props = {
  products: Product[];
  catalogSources: CatalogSource[];
  preferences: Preferences;
  myId: string;
  onChanged: () => Promise<void>;
  onShare: (kind: Shareable, id: string, title: string) => void;
  onError: (error: unknown) => void;
  onNotice: (lines: string[]) => void;
};

type MaterialSort = "name" | "division" | "costType" | "listPrice" | "margin";

/** What an item sells for: its list price, or its cost plus the company markup. */
const priceOf = (product: Product, markupPercent: number) => sellPrice(product, markupPercent, DEFAULT_CURRENCY).price;

const marginOf = (product: Product, markupPercent: number) => {
  const price = priceOf(product, markupPercent);
  return price ? ((price - product.cost) / price) * 100 : 0;
};

/** What each sortable column sorts by. */
function materialValue(product: Product, key: MaterialSort, markupPercent: number): string | number {
  switch (key) {
    case "name":
      return product.name;
    case "division":
      return product.material.division || product.family;
    case "costType":
      return COST_TYPE_LABELS[product.costType];
    case "listPrice":
      return priceOf(product, markupPercent);
    case "margin":
      return marginOf(product, markupPercent);
  }
}

/**
 * The catalogue: what a job is built out of, what it costs, and where those
 * costs come from.
 *
 * Two things on one screen because they are maintained together — an item
 * needs a cost and a price, and a supplier feed is how they stop being a year
 * out of date.
 */
export function CatalogView(props: Props) {
  const { preferences, myId } = props;
  const { pending, removeWithUndo } = useFeedback();
  // Anything waiting out its undo window is already gone as far as the screen is concerned.
  const products = useMemo(() => props.products.filter(entry => !pending.has(entry.id)), [props.products, pending]);
  const catalogSources = useMemo(
    () => props.catalogSources.filter(entry => !pending.has(entry.id)),
    [props.catalogSources, pending],
  );
  const { sort, onSort } = useSort<MaterialSort>("name", true, key => key === "name" || key === "division" || key === "costType");
  const [editingProduct, setEditingProduct] = useState<Product | null | undefined>(undefined);
  const [editingSource, setEditingSource] = useState<CatalogSource | null | undefined>(undefined);
  const importRef = useRef<HTMLInputElement>(null);
  const [showTemplates, setShowTemplates] = useState(false);

  /** The plan on screen, and which source produced it. */
  const [plan, setPlan] = useState<{ source: CatalogSource; result: SyncResult; body?: string } | null>(null);
  const [syncing, setSyncing] = useState("");

  /* Filtering the materials list: a real catalogue is long, and the two
     questions asked of it are "what kind of cost is this" and "where is the
     06 stuff". */
  const [search, setSearch] = useState("");
  const [costType, setCostType] = useState<CostType | "all">("all");

  const format = formatters(DEFAULT_CURRENCY, preferences.locale);
  const markup = preferences.markupPercent;

  const visible = useMemo(() => {
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
    const matching = products.filter(product => {
      if (costType !== "all" && product.costType !== costType) return false;
      if (!terms.length) return true;
      const haystack = [
        product.sku,
        product.name,
        product.family,
        product.material.manufacturer,
        product.material.manufacturerPartNumber,
        product.material.supplier,
        product.material.supplierSku,
        product.material.grade,
        product.material.nominalSize,
        divisionLabel(product.material.division),
      ]
        .join(" ")
        .toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
    return sortRows(matching, sort, (product, key) => materialValue(product, key, markup));
  }, [products, search, costType, sort, markup]);

  const saveSource = async (input: CatalogSourceInput) => {
    if (editingSource) await api.updateCatalogSource(editingSource.id, input);
    else await api.createCatalogSource(input);
    await props.onChanged();
    setEditingSource(undefined);
  };

  const removeSource = (source: CatalogSource) =>
    removeWithUndo({
      id: source.id,
      label: `Deleted the source “${source.name}”. The items it synced stay as they are.`,
      remove: () => api.deleteCatalogSource(source.id),
      done: props.onChanged,
    });

  /** Previews a source, from its URL or from a file somebody dropped on it. */
  const preview = async (source: CatalogSource, body?: string) => {
    setSyncing(source.id);
    try {
      setPlan({ source, result: await api.previewCatalogSync(source.id, body), body });
    } catch (error) {
      props.onError(error);
    } finally {
      setSyncing("");
    }
  };

  /**
   * Applies the plan on screen.
   *
   * The body is sent again rather than remembered on the server: a preview
   * holds no state, so an apply is a fresh read of the same feed. That means a
   * feed which changed between the two is re-planned rather than applied from a
   * stale plan — which is the behaviour you want, and the plan shown afterwards
   * says what actually happened.
   */
  const applyPlan = async (acceptedKeys: string[]) => {
    if (!plan) return;
    const result = await api.runCatalogSync(plan.source.id, { body: plan.body, accept: acceptedKeys });
    await props.onChanged();
    setPlan({ ...plan, result });
  };

  const saveProduct = async (input: ProductInput) => {
    if (editingProduct) await api.updateProduct(editingProduct.id, input);
    else await api.createProduct(input);
    await props.onChanged();
    setEditingProduct(undefined);
  };

  const removeProduct = (product: Product) =>
    removeWithUndo({
      id: product.id,
      label: `Deleted ${product.sku}. Estimates that use it keep the price they were given.`,
      remove: () => api.deleteProduct(product.id),
      done: props.onChanged,
    });

  /** Importing a `*.catalog.json` file or a spreadsheet: read it here, validate on the server. */
  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const isCsv = /\.(csv|tsv|txt)$/i.test(file.name) || file.type === "text/csv";
      const report = isCsv ? await api.importCatalogCsv(text) : await api.importCatalog(JSON.parse(text));
      await props.onChanged();
      const created = Object.entries(report.created)
        .map(([what, count]) => `${count} ${what}`)
        .join(", ");
      props.onNotice([
        created ? `Imported ${created}.` : "Nothing new to import — everything in that file is already here.",
        ...(report.skipped.length ? [`Left alone, already present: ${report.skipped.join(", ")}.`] : []),
        ...report.warnings,
      ]);
    } catch (error) {
      props.onError(error);
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Materials and costs"
        description={
          visible.length === products.length
            ? `${products.length} item${products.length === 1 ? "" : "s"}`
            : `${visible.length} of ${products.length} items`
        }
        actions={
          <>
            <input
              ref={importRef}
              type="file"
              accept=".json,.csv,.tsv,application/json,text/csv"
              className="hidden"
              onChange={event => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void importFile(file);
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => setShowTemplates(true)}>
              <FileSpreadsheet /> Templates
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => importRef.current?.click()}
              title="A spreadsheet (.csv) or a *.catalog.json file"
            >
              <Upload /> Import
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={api.catalogExportUrl} title="The whole catalogue as one file">
                <Download /> Export
              </a>
            </Button>
            <Button size="sm" onClick={() => setEditingProduct(null)}>
              <Plus /> New item
            </Button>
          </>
        }
      >
        {products.length === 0 ? (
          <EmptyState title="The catalogue is empty">
            Add an item, import a spreadsheet or a <code>*.catalog.json</code> file —{" "}
            <button type="button" className="underline underline-offset-2" onClick={() => setShowTemplates(true)}>
              the templates
            </button>{" "}
            show the columns — connect a supplier feed below, or install the worked example from Settings.
          </EmptyState>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search by SKU, name, manufacturer, part number, size or division"
                className="h-8 max-w-sm text-xs"
                aria-label="Search the catalogue"
              />
              <Select value={costType} onValueChange={value => setCostType(value as CostType | "all")}>
                <SelectTrigger className="h-8 w-auto min-w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Every cost type</SelectItem>
                  {COST_TYPES.map(type => (
                    <SelectItem key={type} value={type}>
                      {COST_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {visible.length === 0 ? (
              <EmptyState title="Nothing matches that">Clear the search, or widen the cost type.</EmptyState>
            ) : (
          <Table>
            <Thead>
              <Tr>
                <SortTh column="name" sort={sort} onSort={onSort}>
                  Item
                </SortTh>
                <SortTh column="division" sort={sort} onSort={onSort}>
                  Division
                </SortTh>
                <SortTh column="costType" sort={sort} onSort={onSort}>
                  Cost type
                </SortTh>
                <SortTh column="listPrice" sort={sort} onSort={onSort} numeric>
                  Price
                </SortTh>
                <SortTh column="margin" sort={sort} onSort={onSort} numeric>
                  Margin
                </SortTh>
                <Th>Ordering</Th>
                <Th className="w-28" aria-label="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {visible.map(product => {
                const margin = marginOf(product, markup);

                return (
                  <Tr key={product.id} className={product.active ? undefined : "opacity-60"}>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Package className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{product.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">{product.sku}</span>
                        {!product.active && <Badge tone="neutral">inactive</Badge>}
                      </div>
                      {product.description && (
                        <p className="line-clamp-1 text-xs text-muted-foreground">{product.description}</p>
                      )}
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      {product.material.division ? divisionLabel(product.material.division) : product.family || "—"}
                      {product.material.manufacturer && (
                        <span className="block">{product.material.manufacturer}</span>
                      )}
                    </Td>
                    <Td className="text-muted-foreground">
                      {COST_TYPE_LABELS[product.costType]}
                    </Td>
                    <Td numeric>
                      {format.money(priceOf(product, markup))}
                      <span className="block text-xs text-muted-foreground">
                        per {product.unitOfMeasure}
                        {product.listPrice > 0 ? "" : " · cost + markup"}
                      </span>
                    </Td>
                    <Td numeric className="text-muted-foreground">
                      {format.percent(margin)}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {product.wasteFactorPercent > 0 && (
                          <Badge tone="pending">{product.wasteFactorPercent}% waste</Badge>
                        )}
                        {product.purchaseMultiple > 0 && product.purchaseMultiple !== 1 && (
                          <Badge tone="outline">
                            × {product.purchaseMultiple} {product.unitOfMeasure}
                          </Badge>
                        )}
                        {product.material.coverage > 0 && product.material.coverageUnit && (
                          <Badge tone="outline">
                            {product.material.coverage} {product.material.coverageUnit}
                          </Badge>
                        )}
                        {product.material.leadTimeDays > 0 && (
                          <Badge tone="outline">{product.material.leadTimeDays} day lead</Badge>
                        )}
                        {product.material.submittalRequired && <Badge tone="info">submittal</Badge>}
                        {product.optionGroups.length > 0 && (
                          <Badge tone="outline">
                            {product.optionGroups.length} option group{product.optionGroups.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {product.volumeTiers.length > 0 && (
                          <Badge tone="outline">
                            {product.volumeTiers.length} tier{product.volumeTiers.length === 1 ? "" : "s"}
                          </Badge>
                        )}
                        {product.components.length > 0 && <Badge tone="info">assembly</Badge>}
                        {product.provenance && <Badge tone="outline">synced</Badge>}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditingProduct(product)}
                          aria-label={`Edit ${product.name}`}
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => void removeProduct(product)}
                          aria-label={`Delete ${product.name}`}
                        >
                          <Trash2 className="text-muted-foreground hover:text-destructive" />
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
            )}
          </>
        )}
      </Section>

      <Section
        title="Supplier feeds"
        description="Where the catalogue's costs come from, and what each supplier is allowed to change."
        actions={
          <Button size="sm" onClick={() => setEditingSource(null)}>
            <Plus /> New source
          </Button>
        }
      >
        {catalogSources.length === 0 ? (
          <EmptyState title="No supplier feeds">
            A feed keeps costs current without anybody retyping a price list. Nothing is ever applied without a
            review, and a feed only writes the fields you give it.
          </EmptyState>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Source</Th>
                <Th>Matched on</Th>
                <Th>May change</Th>
                <Th>Last run</Th>
                <Th className="w-44" aria-label="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {catalogSources.map(source => {
                const mine = source.ownerId === myId;
                const run = source.lastRun;

                return (
                  <Tr key={source.id} className={source.active ? undefined : "opacity-60"}>
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Rss className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="font-medium">{source.name}</span>
                        <Badge tone="outline">{source.format.toUpperCase()}</Badge>
                        {!source.active && <Badge tone="neutral">off</Badge>}
                        {!mine && <Badge tone="info">shared with you</Badge>}
                      </div>
                      <p className="line-clamp-1 text-xs text-muted-foreground">
                        {source.url || "Fed by uploaded file"}
                      </p>
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      <span className="font-mono">{source.mapping.key || "—"}</span>
                      <span className="block">{MATCH_KEY_LABELS[source.mapping.matchOn]}</span>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {source.policy.fields.length === 0 && <Badge tone="neutral">nothing</Badge>}
                        {source.policy.fields.slice(0, 3).map(field => (
                          <Badge key={field} tone="outline">
                            {SYNC_FIELD_LABELS[field]}
                          </Badge>
                        ))}
                        {source.policy.fields.length > 3 && (
                          <Badge tone="outline">+{source.policy.fields.length - 3}</Badge>
                        )}
                        {source.policy.createMissing && <Badge tone="success">may add</Badge>}
                        {source.policy.deactivateMissing && <Badge tone="pending">may switch off</Badge>}
                      </div>
                    </Td>
                    <Td className="text-xs text-muted-foreground">
                      {run ? (
                        <>
                          <span className="block">{format.date(run.ranAt)}</span>
                          {run.error ? (
                            <span className="text-destructive">{run.error}</span>
                          ) : (
                            <span>
                              {run.updated} updated, {run.created} added
                              {run.flagged ? `, ${run.flagged} held` : ""}
                            </span>
                          )}
                        </>
                      ) : (
                        "Never run"
                      )}
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-0.5">
                        {/* A file drop and a fetch are the same review, from
                            two different places the data might live. */}
                        <label
                          className={cn(
                            "inline-flex size-8 cursor-pointer items-center justify-center rounded-md hover:bg-muted",
                            !source.active && "pointer-events-none opacity-50",
                          )}
                          title={`Preview ${source.name} from a file`}
                        >
                          <input
                            type="file"
                            accept=".csv,.json,.txt,text/csv,application/json,text/plain"
                            className="hidden"
                            onChange={async event => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (file) await preview(source, await file.text());
                            }}
                          />
                          <FileUp className="size-4" />
                        </label>
                        {source.url && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={!source.active || syncing === source.id}
                            onClick={() => void preview(source)}
                            aria-label={`Fetch and preview ${source.name}`}
                          >
                            <RefreshCw className={syncing === source.id ? "animate-spin" : undefined} />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => setEditingSource(source)}
                          aria-label={`Edit ${source.name}`}
                        >
                          <Pencil />
                        </Button>
                        {mine && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => props.onShare("catalog-sources", source.id, source.name)}
                              aria-label={`Share ${source.name}`}
                            >
                              <Share2 />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => void removeSource(source)}
                              aria-label={`Delete ${source.name}`}
                            >
                              <Trash2 className="text-muted-foreground hover:text-destructive" />
                            </Button>
                          </>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        )}
      </Section>

      {editingSource !== undefined && (
        <CatalogSourceEditor source={editingSource} onSave={saveSource} onClose={() => setEditingSource(undefined)} />
      )}

      {showTemplates && <CatalogTemplatesDialog onClose={() => setShowTemplates(false)} />}

      {plan && (
        <SyncPlanDialog
          source={plan.source}
          result={plan.result}
          onApply={applyPlan}
          onClose={() => setPlan(null)}
        />
      )}

      {editingProduct !== undefined && (
        <ProductEditor
          product={editingProduct}
          products={products}
          onSave={saveProduct}
          onClose={() => setEditingProduct(undefined)}
        />
      )}

    </div>
  );
}
