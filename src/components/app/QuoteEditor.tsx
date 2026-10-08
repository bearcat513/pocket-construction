import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Download,
  FileDown,
  FileText,
  GitBranch,
  Link2,
  Loader2,
  Plus,
  Save,
  Send,
  Share2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Field, Notice, Section, StatusBadge, formatters } from "./common";
import { useFeedback, useUnsavedChanges } from "./feedback";
import { QuoteProgress } from "./QuoteProgress";
import { LineConfigurator } from "./LineConfigurator";
import { ProductPicker } from "./ProductPicker";
import { QuoteLines } from "./QuoteLines";
import { TotalsPanel } from "./TotalsPanel";
import { api, type QuoteBody } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { defaultSelection } from "@/lib/configurator";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { MAX_MARKUP_PERCENT, expandBundle, priceQuote } from "@/lib/pricing";
import { localId } from "@/lib/validate";
import type { Preferences } from "@/lib/preferences";
import {
  QUOTE_TRANSITIONS,
  isEditableStatus,
  type Account,
  type Product,
  type Project,
  type ProposalTemplate,
  type Quote,
  type QuoteLineInput,
  type QuoteStatus,
} from "@/lib/types";

type Props = {
  /** null while a brand-new quote is being written. */
  quote: Quote | null;
  preferences: Preferences;
  products: Product[];
  accounts: Account[];
  projects: Project[];
  templates: ProposalTemplate[];
  onSaved: (quote: Quote) => void;
  onDeleted: () => void;
  onBack: () => void;
  onShare: (id: string, title: string) => void;
  onError: (error: unknown) => void;
  onNotice: (lines: string[]) => void;
};

type Draft = {
  name: string;
  accountId: string | null;
  projectId: string;
  markupPercent: number;
  overheadPercent: number;
  discountPercent: number;
  taxPercent: number;
  shipping: number;
  validUntil: string;
  notes: string;
  internalNotes: string;
  lines: QuoteLineInput[];
};

const validUntilFrom = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

function draftFrom(quote: Quote | null, preferences: Preferences): Draft {
  if (!quote) {
    return {
      name: "",
      accountId: null,
      projectId: "",
      // The company's standing numbers, which this estimate keeps from here on.
      markupPercent: preferences.markupPercent,
      overheadPercent: preferences.overheadPercent,
      discountPercent: 0,
      taxPercent: preferences.defaultTaxPercent,
      shipping: 0,
      validUntil: validUntilFrom(preferences.quoteValidDays),
      notes: "",
      internalNotes: "",
      lines: [],
    };
  }

  return {
    name: quote.name,
    accountId: quote.customer.accountId,
    projectId: quote.projectId,
    markupPercent: quote.markupPercent,
    overheadPercent: quote.overheadPercent,
    discountPercent: quote.discountPercent,
    taxPercent: quote.taxPercent,
    shipping: quote.shipping,
    validUntil: quote.validUntil,
    notes: quote.notes,
    internalNotes: quote.internalNotes,
    // The stored lines carry their snapshot; the engine reprices them from
    // the live catalogue anyway, so only the input fields matter here.
    lines: quote.lines.map(line => ({
      id: line.id,
      productId: line.productId,
      quantity: line.quantity,
      discountPercent: line.discountPercent,
      unitPriceOverride: line.unitPriceOverride,
      wastePercentOverride: line.wastePercentOverride ?? null,
      selectedOptions: line.selectedOptions,
      description: line.description,
      parentId: line.parentId,
      sortOrder: line.sortOrder,
    })),
  };
}

/**
 * Writing a quote.
 *
 * Everything on screen is priced **locally**, by the same engine the server
 * runs (`src/lib/pricing.ts`), so a discount typed into a box moves the total
 * and the margin on the same keystroke rather than after a
 * round trip. The server prices it again on save and its answer replaces this
 * one — the local copy is for the estimator's eyes, the stored copy is the truth.
 *
 * A quote stops being editable the moment it is sent. That is
 * enforced by the server; here it just means the inputs go away, so nobody
 * types into a form that is going to refuse them.
 */
export function QuoteEditor(props: Props) {
  const { quote, preferences, products, accounts, projects } = props;

  // Only a quote template renders a quote: an invoice one would resolve every
  // token to a blank, and the server refuses it for that reason.
  const templates = props.templates.filter(template => template.kind === "quote");

  const [draft, setDraft] = useState<Draft>(() => draftFrom(quote, preferences));
  const [dirty, setDirty] = useState(false);
  const feedback = useFeedback();
  // Leaving with unsaved lines asks first — the back arrow, the nav, Back in
  // the browser and closing the tab alike.
  useUnsavedChanges(dirty);
  const [busy, setBusy] = useState("");
  const [picking, setPicking] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [document, setDocument] = useState<{ text: string; name: string } | null>(null);
  /** A PDF preview is the PDF itself, shown in the browser's own viewer. */
  const [pdfPreview, setPdfPreview] = useState<{ url: string; name: string } | null>(null);

  // A different quote arriving (saved, revised, opened) resets the form.
  useEffect(() => {
    setDraft(draftFrom(quote, preferences));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote?.id, quote?.updatedAt]);

  const editable = !quote || isEditableStatus(quote.status);
  const currency = DEFAULT_CURRENCY;
  const format = formatters(currency, preferences.locale);

  const byId = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const bySku = useMemo(() => new Map(products.map(product => [product.sku, product])), [products]);

  /** The live price, recomputed whenever anything it depends on changes. */
  const priced = useMemo(
    () =>
      priceQuote(
        draft.lines,
        {
          currency,
          markupPercent: draft.markupPercent,
          overheadPercent: draft.overheadPercent,
          discountPercent: draft.discountPercent,
          taxPercent: draft.taxPercent,
          shipping: draft.shipping,
        },
        { products: byId },
      ),
    [draft, currency, byId],
  );

  const patch = (changes: Partial<Draft>) => {
    setDraft(current => ({ ...current, ...changes }));
    setDirty(true);
  };

  /* ------------------------------- the lines ----------------------------- */

  const addProduct = (product: Product) => {
    setPicking(false);

    const line: QuoteLineInput = {
      id: localId("ln"),
      productId: product.id,
      quantity: 1,
      discountPercent: 0,
      unitPriceOverride: null,
      wastePercentOverride: null,
      selectedOptions: defaultSelection(product),
      description: "",
      parentId: null,
      sortOrder: draft.lines.length,
    };

    // A bundle brings its components in as their own lines, exactly as the
    // server would — the quote stores what it prices.
    const children = expandBundle(line, product, bySku, () => localId("ln"));

    patch({ lines: [...draft.lines, line, ...children] });
    // Straight into the configurator when there is something to configure.
    if (product.optionGroups.length) setConfiguring(line.id);
  };

  const changeLine = (id: string, changes: Partial<QuoteLineInput>) =>
    patch({ lines: draft.lines.map(line => (line.id === id ? { ...line, ...changes } : line)) });

  const removeLine = (id: string) =>
    // A bundle's components go with it; they have no meaning on their own.
    patch({ lines: draft.lines.filter(line => line.id !== id && line.parentId !== id) });

  /* -------------------------------- actions ------------------------------ */

  const bodyOf = (source: Draft): QuoteBody => ({
    name: source.name.trim() || "Untitled estimate",
    accountId: source.accountId,
    projectId: source.projectId,
    markupPercent: source.markupPercent,
    overheadPercent: source.overheadPercent,
    discountPercent: source.discountPercent,
    taxPercent: source.taxPercent,
    shipping: source.shipping,
    validUntil: source.validUntil,
    notes: source.notes,
    internalNotes: source.internalNotes,
    lines: source.lines,
  });

  const run = useCallback(
    async (label: string, action: () => Promise<void>) => {
      setBusy(label);
      try {
        await action();
      } catch (error) {
        props.onError(error);
      } finally {
        setBusy("");
      }
    },
    [props],
  );

  const save = () =>
    run("Saving", async () => {
      const result = quote
        ? await api.updateQuote(quote.id, bodyOf(draft))
        : await api.createQuote(bodyOf(draft));
      setDirty(false);
      props.onSaved(result.quote);
      if (result.warnings.length) props.onNotice(result.warnings);
    });

  /**
   * Saves, then marks the estimate sent. Saved first, always: what is sent is
   * what is stored, and an unsaved change would go out in a form nobody has
   * seen priced by the server.
   */
  const send = () =>
    run("Sending", async () => {
      const saved = quote ? await api.updateQuote(quote.id, bodyOf(draft)) : await api.createQuote(bodyOf(draft));
      setDirty(false);
      props.onSaved(await api.setQuoteStatus(saved.quote.id, "sent"));
    });

  const moveTo = (status: QuoteStatus) =>
    quote &&
    run(status === "sent" ? "Sending" : "Updating", async () => {
      props.onSaved(await api.setQuoteStatus(quote.id, status));
    });

  const revise = () =>
    quote &&
    run("Revising", async () => {
      const result = await api.reviseQuote(quote.id);
      props.onSaved(result.quote);
      props.onNotice([`Revision ${result.quote.version} created as ${result.quote.number}. The original is untouched.`]);
    });

  const remove = async () => {
    if (!quote) return;
    const sure = await feedback.confirm({
      title: `Delete ${quote.number}?`,
      message: "The estimate and every line on it are removed for good. This cannot be undone.",
      confirmLabel: "Delete estimate",
    });
    if (!sure) return;
    // Cleared first, so leaving the deleted estimate does not ask about it.
    setDirty(false);
    await run("Deleting", async () => {
      await api.deleteQuote(quote.id);
      props.onDeleted();
    });
  };

  // ⌘S / Ctrl+S saves, rather than offering to save the web page.
  useEffect(() => {
    if (!editable) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!busy) void save();
      }
    };
    // `window.` because `document` here is the rendered proposal's state.
    window.document.addEventListener("keydown", onKey);
    return () => window.document.removeEventListener("keydown", onKey);
  });

  const preview = (template: ProposalTemplate) =>
    quote &&
    run("Rendering", async () => {
      // A PDF is handed to the browser's viewer rather than pulled apart into
      // text — the point of a preview is to see the document that will be sent.
      if (template.format === "pdf") {
        setPdfPreview({ url: api.documentInlineUrl(quote.id, template.id), name: template.name });
        return;
      }

      const rendered = await api.renderDocument(quote.id, template.id);
      setDocument({ text: rendered.text, name: rendered.templateName });
      if (rendered.unknownTokens.length) {
        props.onNotice([`“${rendered.templateName}” uses tokens this app does not know: ${rendered.unknownTokens.join(", ")}.`]);
      }
    });

  /* -------------------------------- render ------------------------------- */

  // The template the header's PDF button uses: the account's preferred one
  // when it is a PDF, otherwise the first PDF template there is.
  const pdfTemplate =
    templates.find(entry => entry.id === preferences.defaultProposalTemplateId && entry.format === "pdf") ??
    templates.find(entry => entry.format === "pdf");

  const configuringLine = configuring ? draft.lines.find(line => line.id === configuring) : undefined;
  const configuringProduct = configuringLine ? byId.get(configuringLine.productId) : undefined;
  const transitions = quote ? (QUOTE_TRANSITIONS[quote.status] ?? []) : [];
  const blocked = priced.issues.length > 0;

  return (
    <div className="space-y-4">
      {/* ------------------------------ header ----------------------------- */}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Button variant="ghost" size="icon-sm" onClick={props.onBack} aria-label="Back to estimates" title="Back to estimates">
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold">{draft.name || "New estimate"}</h1>
              {quote && <StatusBadge status={quote.status} />}
              {quote && quote.version > 1 && <Badge tone="outline">rev {quote.version}</Badge>}
              {dirty && <Badge tone="pending">unsaved</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {quote ? `${quote.number} · ` : ""}
              {priced.totals.lineCount} line{priced.totals.lineCount === 1 ? "" : "s"} ·{" "}
              {format.money(priced.totals.grandTotal)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* One next step for where the estimate is now; the rest under ⋯. */}
          {editable && (
            <Button
              variant="outline"
              onClick={() => void save()}
              disabled={Boolean(busy)}
              title="Save (⌘S)"
            >
              {busy === "Saving" ? <Loader2 className="animate-spin" /> : <Save />} Save
            </Button>
          )}

          {editable && (
            <Button
              onClick={() => void send()}
              disabled={Boolean(busy) || blocked || !draft.lines.length}
              title="Save, and mark the estimate as sent to the client"
            >
              {busy === "Sending" ? <Loader2 className="animate-spin" /> : <Send />} Mark as sent
            </Button>
          )}
          {transitions.includes("accepted") && (
            <Button onClick={() => void moveTo("accepted")} disabled={Boolean(busy)}>
              <Check /> Accepted
            </Button>
          )}
          {transitions.includes("declined") && (
            <Button variant="outline" onClick={() => void moveTo("declined")} disabled={Boolean(busy)}>
              <X /> Declined
            </Button>
          )}

          {quote && pdfTemplate && (
            <Button variant="outline" asChild title={`Download as PDF — ${pdfTemplate.name}`}>
              <a href={api.documentUrl(quote.id, pdfTemplate.id)}>
                <FileDown /> PDF
              </a>
            </Button>
          )}

          {quote && (
            <Menu>
              {transitions.includes("draft") && (
                <MenuItem onSelect={() => void moveTo("draft")} disabled={Boolean(busy)}>
                  <Undo2 /> Reopen as draft
                </MenuItem>
              )}
              <MenuItem onSelect={() => void revise()} disabled={Boolean(busy)}>
                <GitBranch /> New revision
              </MenuItem>
              <MenuItem onSelect={() => props.onShare(quote.id, quote.number)}>
                <Share2 /> Share…
              </MenuItem>
              <MenuItem onSelect={() => void copyText(window.location.href).then(() => feedback.toast("success", "Link copied."))}>
                <Link2 /> Copy link
              </MenuItem>
              <MenuItem href={api.quoteExportUrl(quote.id, "csv")}>
                <Download /> Download as CSV
              </MenuItem>
              {editable && (
                <>
                  <MenuSeparator />
                  <MenuItem destructive onSelect={() => void remove()} disabled={Boolean(busy)}>
                    <Trash2 /> Delete estimate
                  </MenuItem>
                </>
              )}
            </Menu>
          )}
        </div>
      </div>

      {quote && <QuoteProgress status={quote.status} />}

      <Notice kind="error" lines={priced.issues} />
      <Notice kind="warning" lines={priced.warnings} />

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {/* ---------------------------- details --------------------------- */}

          <Section title="Details">
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Estimate name" className="sm:col-span-2 lg:col-span-1">
                <Input
                  value={draft.name}
                  onChange={event => patch({ name: event.target.value })}
                  placeholder="Cedar Row — shell and envelope"
                  disabled={!editable}
                />
              </Field>

              <Field label="Client">
                <Select
                  value={draft.accountId ?? "none"}
                  onValueChange={value => patch({ accountId: value === "none" ? null : value })}
                  disabled={!editable}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No client yet</SelectItem>
                    {accounts.map(account => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {/* Choosing the job fills in the client when one is not set
                  already — a bid is very often written against a job before
                  anybody thinks about which account it bills to. */}
              <Field label="Project" hint="A bid often precedes the job record. Leave it empty and attach it later.">
                <Select
                  value={draft.projectId || "none"}
                  onValueChange={value => {
                    const projectId = value === "none" ? "" : value;
                    const project = projects.find(entry => entry.id === projectId) ?? null;
                    patch({
                      projectId,
                      ...(project?.accountId && !draft.accountId ? { accountId: project.accountId } : {}),
                    });
                  }}
                  disabled={!editable}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No project</SelectItem>
                    {projects.map(project => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.number} — {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Markup %" hint="On cost, for items with no list price of their own.">
                <Input
                  type="number"
                  min={0}
                  max={MAX_MARKUP_PERCENT}
                  step="0.5"
                  value={draft.markupPercent}
                  onChange={event => patch({ markupPercent: Number(event.target.value) })}
                  disabled={!editable}
                />
              </Field>

              <Field label="Overhead %" hint="On the subtotal, after the estimate discount.">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={draft.overheadPercent}
                  onChange={event => patch({ overheadPercent: Number(event.target.value) })}
                  disabled={!editable}
                />
              </Field>

              <Field label="Valid until">
                <Input
                  type="date"
                  value={draft.validUntil}
                  onChange={event => patch({ validUntil: event.target.value })}
                  disabled={!editable}
                />
              </Field>

              <Field label="Estimate discount %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={draft.discountPercent}
                  onChange={event => patch({ discountPercent: Number(event.target.value) })}
                  disabled={!editable}
                />
              </Field>

              <Field label="Tax %">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.25"
                  value={draft.taxPercent}
                  onChange={event => patch({ taxPercent: Number(event.target.value) })}
                  disabled={!editable}
                />
              </Field>

              <Field label="Shipping">
                <Input
                  type="number"
                  min={0}
                  value={draft.shipping}
                  onChange={event => patch({ shipping: Number(event.target.value) })}
                  disabled={!editable}
                />
              </Field>
            </div>
          </Section>

          {/* ----------------------------- lines ---------------------------- */}

          <Section
            title="Lines"
            description={editable ? undefined : "This quote is no longer editable — create a revision to change it."}
            actions={
              editable && (
                <Button size="sm" onClick={() => setPicking(true)}>
                  <Plus /> Add item
                </Button>
              )
            }
          >
            <QuoteLines
              priced={priced.lines}
              format={format}
              editable={editable}
              showMargin={preferences.showMargin}
              onChange={changeLine}
              onConfigure={setConfiguring}
              onRemove={removeLine}
            />
          </Section>

          {/* ----------------------------- notes ---------------------------- */}

          <Section title="Notes">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Field label="On the proposal" hint="The customer reads this.">
                <Textarea
                  value={draft.notes}
                  onChange={event => patch({ notes: event.target.value })}
                  disabled={!editable}
                  rows={4}
                />
              </Field>
              <Field label="Internal" hint="Never rendered into a document.">
                <Textarea
                  value={draft.internalNotes}
                  onChange={event => patch({ internalNotes: event.target.value })}
                  disabled={!editable}
                  rows={4}
                />
              </Field>
            </div>
          </Section>

          {/* --------------------------- proposal --------------------------- */}

          {quote && (
            <Section title="Proposal" description="Render this estimate through a template.">
              <div className="flex flex-wrap items-center gap-2 p-4">
                {templates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No proposal templates yet — create one under <strong>Templates</strong>.
                  </p>
                ) : (
                  templates.map(template => (
                    <div key={template.id} className="flex items-center gap-1 rounded-md border px-2 py-1">
                      <FileText className="size-3.5 text-muted-foreground" />
                      <span className="text-xs">{template.name}</span>
                      <Badge tone="outline">{template.format}</Badge>
                      <Button variant="ghost" size="sm" onClick={() => preview(template)} disabled={Boolean(busy)}>
                        Preview
                      </Button>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={api.documentUrl(quote.id, template.id)}>Download</a>
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </Section>
          )}

        </div>

        {/* ----------------------------- totals ----------------------------- */}

        <div className="lg:sticky lg:top-4 lg:self-start">
          <TotalsPanel
            totals={priced.totals}
            format={format}
            showMargin={preferences.showMargin}
            overheadPercent={draft.overheadPercent}
          />
        </div>
      </div>

      {/* ----------------------------- dialogs ------------------------------ */}

      {picking && (
        <ProductPicker
          products={products}
          currency={currency}
          locale={preferences.locale}
          markupPercent={draft.markupPercent}
          onPick={addProduct}
          onClose={() => setPicking(false)}
        />
      )}

      {configuringLine && configuringProduct && (
        <LineConfigurator
          product={configuringProduct}
          line={configuringLine}
          currency={currency}
          locale={preferences.locale}
          markupPercent={draft.markupPercent}
          onSave={line => {
            changeLine(line.id, line);
            setConfiguring(null);
          }}
          onClose={() => setConfiguring(null)}
        />
      )}

      {pdfPreview && (
        <Dialog
          title={pdfPreview.name}
          description="Rendered from the stored quote, by the same code that produces the download."
          onClose={() => setPdfPreview(null)}
          className="max-w-5xl"
          footer={
            <Button variant="outline" asChild>
              <a href={pdfPreview.url.replace("&inline", "")}>
                <FileDown /> Download
              </a>
            </Button>
          }
        >
          <iframe src={pdfPreview.url} title={pdfPreview.name} className="h-[70vh] w-full rounded-md border bg-muted" />
        </Dialog>
      )}

      {document && (
        <Dialog
          title={document.name}
          description="Rendered from the stored quote."
          onClose={() => setDocument(null)}
          className="max-w-4xl"
          footer={
            <Button variant="outline" onClick={() => void copyText(document.text)}>
              <Copy /> Copy
            </Button>
          }
        >
          <pre className="max-h-[65vh] overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
            {document.text}
          </pre>
        </Dialog>
      )}
    </div>
  );
}
