import { useState, type FormEvent, type ReactNode } from "react";
import {
  Bell,
  BookOpen,
  Check,
  Copy,
  Database,
  Download,
  FileText,
  KeyRound,
  Loader2,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiKeys } from "./ApiKeys";
import { TelegramNotifications } from "./TelegramNotifications";
import { Section } from "./common";
import { api, type Meta, type SessionUser } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { ACCENTS, CURRENCIES, FONTS, PREFERENCE_LIMITS, THEMES, type Preferences } from "@/lib/preferences";
import type { PriceBook, ProposalTemplate } from "@/lib/types";
import {
  SAMPLE_ACCOUNTS,
  SAMPLE_INVOICES,
  SAMPLE_PRICE_BOOKS,
  SAMPLE_PRODUCTS,
  SAMPLE_PROJECTS,
  SAMPLE_TEMPLATES,
} from "@/lib/samples";
import { cn } from "@/lib/utils";

/** Counted from the sample itself, so the sentence cannot fall behind it. */
const SAMPLE_SUMMARY =
  `${SAMPLE_PRODUCTS.length} catalogue items, ${SAMPLE_PRICE_BOOKS.length} price books, ` +
  `${SAMPLE_ACCOUNTS.length} clients with ${SAMPLE_PROJECTS.length} jobs, an estimate that needs approval, ` +
  `${SAMPLE_INVOICES.length} invoices and ${SAMPLE_TEMPLATES.length} document templates.`;

export type SaveState = "idle" | "saving" | "saved";

type Props = {
  me: SessionUser;
  preferences: Preferences;
  saveState: SaveState;
  priceBooks: PriceBook[];
  templates: ProposalTemplate[];
  meta: Meta | null;
  hasCatalogue: boolean;
  onChange: (patch: Partial<Preferences>) => void;
  onReset: () => void;
  onSampleInstalled: () => Promise<void>;
  onError: (error: unknown) => void;
  onNotice: (lines: string[]) => void;
};

type Tab = "general" | "appearance" | "documents" | "account" | "api" | "notifications" | "data";

/**
 * The sections, in the order a settings page is usually read: what the app
 * does, how it looks, who you are, then the plumbing. `autosaves` marks the
 * ones made of preferences, which show the save state in their header.
 */
const TABS: { id: Tab; label: string; Icon: LucideIcon; description: string; autosaves?: boolean }[] = [
  {
    id: "general",
    label: "General",
    Icon: SlidersHorizontal,
    description: "How lists, numbers and confirmations behave. Saved automatically.",
    autosaves: true,
  },
  {
    id: "appearance",
    label: "Appearance",
    Icon: Palette,
    description: "How the app looks while you work. Saved automatically.",
    autosaves: true,
  },
  {
    id: "documents",
    label: "Estimates & invoices",
    Icon: FileText,
    description: "What a new estimate or invoice starts as. Saved automatically.",
    autosaves: true,
  },
  { id: "account", label: "Account", Icon: UserRound, description: "Who you are signed in as, and your password." },
  {
    id: "api",
    label: "API keys",
    Icon: KeyRound,
    description: "A long-lived credential for a script, in place of a session that expires in a week.",
  },
  {
    id: "notifications",
    label: "Notifications",
    Icon: Bell,
    description: "Messages about what happened while you were not looking.",
  },
  { id: "data", label: "Data", Icon: Database, description: "Moving everything in and out of this workspace." },
];

/**
 * Preferences, the account, its credentials and the workspace's data — one
 * section at a time, chosen from a list down the side.
 *
 * Preferences save themselves a beat after the last change, so there is no
 * Save button for them — a settings page with one is a page people leave
 * without pressing it.
 */
export function SettingsPanel(props: Props) {
  const [tab, setTab] = useState<Tab>("general");
  const current = TABS.find(entry => entry.id === tab)!;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6">
      <aside className="space-y-2 lg:sticky lg:top-4 lg:self-start">
        <h1 className="hidden px-3 font-display text-lg font-semibold tracking-tight lg:block">Settings</h1>
        <nav
          role="tablist"
          aria-label="Settings"
          aria-orientation="vertical"
          className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
        >
          {TABS.map(({ id, label, Icon }) => {
            const active = id === tab;
            return (
              <button
                key={id}
                id={`settings-tab-${id}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="settings-panel"
                onClick={() => setTab(id)}
                className={cn(
                  "relative flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="motion-safe:animate-weld absolute top-1.5 bottom-1.5 left-0 hidden w-[3px] origin-top rounded-full bg-primary lg:block"
                  />
                )}
                <Icon className="size-4 shrink-0" />
                {label}
              </button>
            );
          })}
        </nav>
      </aside>

      <div
        id="settings-panel"
        role="tabpanel"
        aria-labelledby={`settings-tab-${tab}`}
        // Keyed, so each section settles in on its own rather than swapping
        // in place under a header that did not move.
        key={tab}
        className="@container min-w-0 space-y-4"
      >
        <header className="flex flex-wrap items-end justify-between gap-2 px-1">
          <div className="min-w-0">
            <h2 className="font-display text-lg leading-tight font-semibold tracking-tight">{current.label}</h2>
            <p className="text-xs text-muted-foreground">{current.description}</p>
          </div>
          {current.autosaves && <SaveIndicator state={props.saveState} />}
        </header>

        {tab === "general" ? (
          <GeneralTab preferences={props.preferences} onChange={props.onChange} onReset={props.onReset} />
        ) : tab === "appearance" ? (
          <AppearanceTab preferences={props.preferences} onChange={props.onChange} />
        ) : tab === "documents" ? (
          <DocumentsTab
            preferences={props.preferences}
            priceBooks={props.priceBooks}
            templates={props.templates}
            onChange={props.onChange}
          />
        ) : tab === "account" ? (
          <AccountTab me={props.me} onError={props.onError} onNotice={props.onNotice} />
        ) : tab === "api" ? (
          <Section
            title="Your keys"
            description="Each one acts as you, with exactly your access. Revoke one the moment it may have leaked."
            actions={
              <Button variant="outline" size="sm" asChild>
                <a href="/docs" target="_blank" rel="noreferrer">
                  <BookOpen /> API reference
                </a>
              </Button>
            }
          >
            <ApiKeys confirmDestructive={props.preferences.confirmDestructive} />
          </Section>
        ) : tab === "notifications" ? (
          <Section
            title="Telegram"
            description="A message when a supplier feed syncs — or cannot — so a 3am run that failed is news by breakfast. Estimates answered and payments received too, if you want them."
          >
            <TelegramNotifications />
          </Section>
        ) : (
          <DataTab
            meta={props.meta}
            hasCatalogue={props.hasCatalogue}
            onSampleInstalled={props.onSampleInstalled}
            onError={props.onError}
            onNotice={props.onNotice}
          />
        )}
      </div>
    </div>
  );
}

/* --------------------------------- layout --------------------------------- */

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span className="flex h-5 items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
      {state === "saving" ? (
        <>
          <Loader2 className="size-3 animate-spin" /> Saving…
        </>
      ) : state === "saved" ? (
        <>
          <Check className="size-3 text-signal" /> Saved
        </>
      ) : null}
    </span>
  );
}

/** A panel of related settings, one row each. */
function SettingsGroup({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Section title={title} description={description} actions={actions}>
      <div className="divide-y">{children}</div>
    </Section>
  );
}

/**
 * One setting: what it is and why on the left, the control on the right.
 * Stacked when the panel is narrow — measured against the panel, not the
 * window, since the nav takes a column of its own on a desktop.
 */
function SettingRow({
  label,
  hint,
  htmlFor,
  children,
  wide,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
  /** For controls that need more than an input's width, like the swatches. */
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid gap-2 px-4 py-3 @xl:items-center @xl:gap-6",
        wide ? "@xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]" : "@xl:grid-cols-[minmax(0,1fr)_18rem]",
      )}
    >
      <div className="min-w-0">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A toggle sits at the right edge of its row, where a settings page puts one. */
const ToggleCell = ({ children }: { children: ReactNode }) => (
  <div className="flex h-9 items-center @xl:justify-end">{children}</div>
);

type PreferenceProps = {
  preferences: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
};

/* --------------------------------- general -------------------------------- */

function GeneralTab({ preferences, onChange, onReset }: PreferenceProps & { onReset: () => void }) {
  return (
    <>
      <SettingsGroup title="Region">
        <SettingRow label="Locale" hint="How dates and numbers are written. Empty follows the browser — e.g. en-GB, de-DE." htmlFor="pref-locale">
          <Input
            id="pref-locale"
            value={preferences.locale}
            onChange={event => onChange({ locale: event.target.value })}
            placeholder="Browser default"
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Lists and screens">
        <SettingRow label="Estimates listed" hint="How many the estimates screen loads at once." htmlFor="pref-quote-list">
          <Input
            id="pref-quote-list"
            type="number"
            min={PREFERENCE_LIMITS.quoteList.min}
            max={PREFERENCE_LIMITS.quoteList.max}
            value={preferences.quoteListLimit}
            onChange={event => onChange({ quoteListLimit: Number(event.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Show cost and margin" hint="Off is the safer default on a shared screen." htmlFor="pref-margin">
          <ToggleCell>
            <Switch
              id="pref-margin"
              checked={preferences.showMargin}
              onChange={event => onChange({ showMargin: event.target.checked })}
            />
          </ToggleCell>
        </SettingRow>
        <SettingRow label="Ask before deleting" hint="A confirmation before anything is removed." htmlFor="pref-confirm">
          <ToggleCell>
            <Switch
              id="pref-confirm"
              checked={preferences.confirmDestructive}
              onChange={event => onChange({ confirmDestructive: event.target.checked })}
            />
          </ToggleCell>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Reset">
        <SettingRow label="Reset all preferences" hint="Every setting on General, Appearance and Estimates & invoices goes back to how it started.">
          <div className="@xl:flex @xl:justify-end">
            <Button variant="outline" size="sm" onClick={onReset}>
              <RotateCcw /> Reset to defaults
            </Button>
          </div>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

/* ------------------------------- appearance ------------------------------- */

/**
 * The three choices that change nothing but the look of the place: light or
 * dark, which of the seven signal colours carries anything live, and the face
 * it is all read in.
 *
 * The swatches paint themselves — each carries its own `data-accent`, so the
 * colour on the button is the colour the app will wear, out of the stylesheet
 * rather than out of a second list here that could disagree with it.
 */
function AppearanceTab({ preferences, onChange }: PreferenceProps) {
  const accent = ACCENTS.find(one => one.id === preferences.accent);
  const font = FONTS.find(one => one.id === preferences.font);

  return (
    <SettingsGroup title="Theme and type">
      <SettingRow label="Theme" hint="System follows this machine, live." htmlFor="pref-theme">
        <Select value={preferences.theme} onValueChange={value => onChange({ theme: value as Preferences["theme"] })}>
          <SelectTrigger id="pref-theme" className="w-full capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEMES.map(theme => (
              <SelectItem key={theme} value={theme} className="capitalize">
                {theme}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>

      <SettingRow label="Accent" hint={accent ? `${accent.label}. The colour of anything live — status colours keep their meaning.` : undefined} wide>
        <div className="flex flex-wrap items-center gap-2 @xl:justify-end">
          {ACCENTS.map(one => {
            const chosen = one.id === preferences.accent;
            return (
              <button
                key={one.id}
                type="button"
                data-accent={one.id}
                title={one.label}
                aria-pressed={chosen}
                onClick={() => onChange({ accent: one.id })}
                className={cn(
                  "bg-primary ring-primary ring-offset-card flex size-7 items-center justify-center rounded-full",
                  "border border-black/10 ring-offset-2 dark:border-white/10",
                  "motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-px",
                  chosen && "ring-2",
                )}
              >
                {chosen && <Check className="text-primary-foreground size-3.5" />}
                <span className="sr-only">{one.label}</span>
              </button>
            );
          })}
        </div>
      </SettingRow>

      <SettingRow label="Font" hint={font ? `${font.hint}. Headings keep their own face.` : undefined} htmlFor="pref-font">
        <Select value={preferences.font} onValueChange={value => onChange({ font: value as Preferences["font"] })}>
          <SelectTrigger id="pref-font" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* Each option is set in the face it names — the attribute is all
                the stylesheet needs, portalled menu or not. */}
            {FONTS.map(one => (
              <SelectItem key={one.id} value={one.id} data-font={one.id} className="font-sans">
                {one.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    </SettingsGroup>
  );
}

/* ---------------------------- estimates, invoices --------------------------- */

function DocumentsTab({
  preferences,
  priceBooks,
  templates,
  onChange,
}: PreferenceProps & { priceBooks: PriceBook[]; templates: ProposalTemplate[] }) {
  const templateSelect = (
    id: string,
    kind: ProposalTemplate["kind"],
    value: string,
    set: (value: string) => void,
  ) => (
    <Select value={value || "first"} onValueChange={next => set(next === "first" ? "" : next)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="first">The first one</SelectItem>
        {templates
          .filter(template => template.kind === kind)
          .map(template => (
            <SelectItem key={template.id} value={template.id}>
              {template.name}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );

  return (
    <>
      <SettingsGroup title="Pricing">
        <SettingRow label="Currency" hint="What a new estimate is written in." htmlFor="pref-currency">
          <Select
            value={preferences.defaultCurrency}
            onValueChange={value => onChange({ defaultCurrency: value as Preferences["defaultCurrency"] })}
          >
            <SelectTrigger id="pref-currency" className="w-full">
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
        </SettingRow>
        <SettingRow label="Price book" hint="Where a new estimate's prices come from." htmlFor="pref-book">
          <Select
            value={preferences.defaultPriceBookId || "default"}
            onValueChange={value => onChange({ defaultPriceBookId: value === "default" ? "" : value })}
          >
            <SelectTrigger id="pref-book" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Whichever book is marked default</SelectItem>
              {priceBooks.map(book => (
                <SelectItem key={book.id} value={book.id}>
                  {book.name} ({book.currency})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow label="Tax rate" hint="In percent. A client's own rate wins over this." htmlFor="pref-tax">
          <Input
            id="pref-tax"
            type="number"
            min={0}
            max={100}
            step="0.25"
            value={preferences.defaultTaxPercent}
            onChange={event => onChange({ defaultTaxPercent: Number(event.target.value) })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Estimates">
        <SettingRow label="Term" hint="In months — how long rentals and other recurring lines run." htmlFor="pref-term">
          <Input
            id="pref-term"
            type="number"
            min={PREFERENCE_LIMITS.termMonths.min}
            max={PREFERENCE_LIMITS.termMonths.max}
            value={preferences.defaultTermMonths}
            onChange={event => onChange({ defaultTermMonths: Number(event.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Valid for" hint="In days, from the day the estimate is written." htmlFor="pref-valid">
          <Input
            id="pref-valid"
            type="number"
            min={PREFERENCE_LIMITS.validDays.min}
            max={PREFERENCE_LIMITS.validDays.max}
            value={preferences.quoteValidDays}
            onChange={event => onChange({ quoteValidDays: Number(event.target.value) })}
          />
        </SettingRow>
        <SettingRow label="Proposal template" hint="What an estimate is rendered with unless you pick another." htmlFor="pref-proposal">
          {templateSelect("pref-proposal", "quote", preferences.defaultProposalTemplateId, value =>
            onChange({ defaultProposalTemplateId: value }),
          )}
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Invoices">
        <SettingRow label="Invoice template" hint="What an invoice is rendered with unless you pick another." htmlFor="pref-invoice">
          {templateSelect("pref-invoice", "invoice", preferences.defaultInvoiceTemplateId, value =>
            onChange({ defaultInvoiceTemplateId: value }),
          )}
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

/* --------------------------------- account -------------------------------- */

function AccountTab({
  me,
  onError,
  onNotice,
}: {
  me: SessionUser;
  onError: (error: unknown) => void;
  onNotice: (lines: string[]) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      // PocketBase invalidates every existing token on a password change, so
      // the server hands back a fresh session and nothing here has to reload.
      onNotice(["Password changed. Your session was renewed; anything else signed in as you was signed out."]);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsGroup title="Profile">
        <SettingRow label="Email" hint="What you sign in with, and what approvers and shares are addressed to.">
          <p className="truncate text-sm @xl:text-right">{me.email}</p>
        </SettingRow>
        {me.name && (
          <SettingRow label="Name">
            <p className="truncate text-sm @xl:text-right">{me.name}</p>
          </SettingRow>
        )}
        {me.createdAt && (
          <SettingRow label="Member since">
            <p className="text-sm @xl:text-right">{new Date(me.createdAt).toLocaleDateString()}</p>
          </SettingRow>
        )}
      </SettingsGroup>

      <form onSubmit={submit}>
        <SettingsGroup
          title="Password"
          description="Changing it signs out everywhere else you are signed in."
        >
          <SettingRow label="Current password" htmlFor="account-current">
            <Input
              id="account-current"
              type="password"
              value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
            />
          </SettingRow>
          <SettingRow label="New password" hint="At least eight characters." htmlFor="account-new">
            <Input
              id="account-new"
              type="password"
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              autoComplete="new-password"
            />
          </SettingRow>
          <div className="flex justify-end px-4 py-3">
            <Button type="submit" size="sm" disabled={busy || newPassword.length < 8 || !currentPassword}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Change password
            </Button>
          </div>
        </SettingsGroup>
      </form>
    </>
  );
}

/* ---------------------------------- data ---------------------------------- */

function DataTab({
  meta,
  hasCatalogue,
  onSampleInstalled,
  onError,
  onNotice,
}: {
  meta: Meta | null;
  hasCatalogue: boolean;
  onSampleInstalled: () => Promise<void>;
  onError: (error: unknown) => void;
  onNotice: (lines: string[]) => void;
}) {
  const [installing, setInstalling] = useState(false);

  const installSample = async () => {
    setInstalling(true);
    try {
      const report = await api.installSample();
      await onSampleInstalled();
      const created = Object.entries(report.created)
        .map(([what, count]) => `${count} ${what}`)
        .join(", ");
      onNotice([created ? `Installed ${created}.` : "Everything in the sample was already here.", ...report.notes]);
    } catch (error) {
      onError(error);
    } finally {
      setInstalling(false);
    }
  };

  const cell = "flex flex-wrap gap-2 @xl:justify-end";

  return (
    <>
      <SettingsGroup title="Export" description="Everything this account can see, as files you keep.">
        <SettingRow label="Whole workspace" hint="Catalogue, policy, clients, templates, estimates and invoices, as one JSON file." wide>
          <div className={cell}>
            <Button variant="outline" size="sm" asChild>
              <a href={api.workspaceExportUrl}>
                <Download /> Download
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void api
                  .workspaceExportText()
                  .then(copyText)
                  .catch(onError)
              }
            >
              <Copy /> Copy
            </Button>
          </div>
        </SettingRow>
        <SettingRow label="Catalogue" hint="Items, price books and rules as *.catalog.json — imports into another workspace." wide>
          <div className={cell}>
            <Button variant="outline" size="sm" asChild>
              <a href={api.catalogExportUrl}>
                <Download /> Download
              </a>
            </Button>
          </div>
        </SettingRow>
        <SettingRow label="Catalogue items as a spreadsheet" hint="One row per item, for Excel or a supplier." wide>
          <div className={cell}>
            <Button variant="outline" size="sm" asChild>
              <a href={api.productsCsvUrl}>
                <Download /> Download CSV
              </a>
            </Button>
          </div>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="The worked example">
        <SettingRow
          label="Install the sample"
          hint={
            hasCatalogue
              ? "Additive — anything already here by the same SKU or name is left exactly as it is."
              : SAMPLE_SUMMARY
          }
          wide
        >
          <div className={cell}>
            <Button size="sm" onClick={() => void installSample()} disabled={installing}>
              {installing ? <Loader2 className="animate-spin" /> : <Sparkles />} Install
            </Button>
          </div>
        </SettingRow>
      </SettingsGroup>

      {meta && (
        <SettingsGroup title="Storage">
          {meta.reachable ? (
            <>
              <SettingRow label="Database" hint="Where this workspace is kept.">
                <code className="block truncate text-xs @xl:text-right">{meta.url}</code>
              </SettingRow>
              <div className="grid grid-cols-2 gap-px bg-border @md:grid-cols-3">
                {[
                  ["Items", meta.products],
                  ["Price books", meta.priceBooks],
                  ["Clients", meta.accounts],
                  ["Estimates", meta.quotes],
                  ["Invoices", meta.invoices],
                  ["Templates", meta.proposalTemplates],
                ].map(([label, count]) => (
                  <div key={label as string} className="panel px-4 py-3">
                    <div className="font-display text-lg tabular-nums">{count ?? 0}</div>
                    <div className="text-xs text-muted-foreground">{label}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="px-4 py-3 text-xs text-alert">
              PocketBase is unreachable at <code>{meta.url}</code>.
            </p>
          )}
        </SettingsGroup>
      )}
    </>
  );
}
