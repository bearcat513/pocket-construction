/**
 * Telegram notifications: the settings, their normalizer, and what a message
 * says.
 *
 * The first thing worth a notification here was a supplier-feed sync — the one
 * job in this app that runs unattended. A sync run from the feed screen has its
 * result on the screen already; one run by a scheduled script at 3am, against
 * a feed whose supplier renamed a column overnight, is why this exists.
 *
 * The same reasoning covers anything an integration does with your API key
 * while nobody is looking at the screen: an e-signature service marking an
 * estimate accepted, or the accounting system posting a payment it banked.
 * Those two are off until somebody switches them on — an accounting sync that
 * posts three hundred payments a day would otherwise be three hundred
 * messages nobody asked for.
 *
 * Split across three places, deliberately:
 *
 *   src/lib/telegram.ts      — this file: pure, shared with the browser. When to
 *                              notify and what to say. Never a bot token.
 *   src/server/telegram.ts   — decides, after a sync, whether to send, and relays
 *                              to PocketBase with the caller's own token.
 *   docker/pb_hooks/lib/telegram.js — the bot token and every call to Telegram.
 *
 * The token lives in PocketBase because a pasted bot token is a credential:
 * it is stored in a hidden field no user token can read, so it never reaches
 * the browser and the Bun server never holds it either.
 */
import { formatMoney } from "./money";
import type { CurrencyCode } from "./types";

/** Which events are news. */
export type TelegramEvents = {
  /** A sync that ran to the end — with its counts, and anything waiting for review. */
  finished: boolean;
  /** A sync that could not run at all: the feed was unreachable or unreadable. */
  failed: boolean;
  /** An estimate marked accepted or declined — the client's answer. */
  quoteDecided: boolean;
  /** A payment recorded against an invoice, with what is still outstanding. */
  paymentReceived: boolean;
};

export type TelegramEvent = keyof TelegramEvents;

/** What an account decides about its notifications. */
export type TelegramSettings = {
  enabled: boolean;
  /** Set by pairing, never typed: nobody knows their own chat id. */
  chatId: string;
  /** "Sam Ortiz", "Estimating team" — for the settings page to show. */
  chatLabel: string;
  events: TelegramEvents;
  /**
   * A finished sync of fewer rows than this says nothing. A 25-row feed is
   * not news; a 4,000-row price list is. Failures are always news.
   */
  minRows: number;
  /**
   * Only notify for what was done with an API key. Whatever is done on screen
   * has its result on screen already.
   */
  apiKeyOnly: boolean;
};

export const DEFAULT_TELEGRAM_SETTINGS: TelegramSettings = {
  enabled: true,
  chatId: "",
  chatLabel: "",
  events: { finished: true, failed: true, quoteDecided: false, paymentReceived: false },
  minRows: 0,
  apiKeyOnly: true,
};

/** The largest row threshold worth offering; past it, nothing would ever be sent. */
export const MAX_MIN_ROWS = 1_000_000;

/** Where a bot comes from. An account's own wins over the operator's. */
export type BotSource = "account" | "operator" | "none";

/** What `GET /api/telegram` answers with. Never the token itself. */
export type TelegramStatus = {
  settings: TelegramSettings;
  bot: {
    source: BotSource;
    /** Without the @. Empty until the bot has been asked who it is. */
    username: string;
  };
  /** A pairing in progress, if there is one. */
  pairing: { code: string; expiresAt: string } | null;
  /** The last thing that went wrong, as one sentence. Cleared by the next success. */
  lastError: string;
  lastSentAt: string;
};

/**
 * The alphabet a pairing code is drawn from: no O/0 or I/1, so it cannot be
 * read back wrong off a screen.
 */
export const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const PAIRING_CODE_LENGTH = 6;

/** How long a pairing code stays good. */
export const PAIRING_TTL_MINUTES = 10;

/**
 * Whether a pasted value is shaped like a bot token, so a mistake is refused
 * by name rather than at the first notification that never arrives.
 */
export const isBotToken = (value: string): boolean => /^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(value.trim());

/** A deep link that opens the bot and sends it the code, so nothing is typed. */
export const pairingLink = (username: string, code: string): string =>
  username ? `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(code)}` : "";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const flag = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

/**
 * Settings from anywhere — a request body, a stored record — made whole.
 *
 * Repairs rather than refuses, like every other reader of stored JSON here: a
 * missing event is its default, and a threshold that is not a number is zero.
 */
export function readTelegramSettings(raw: unknown): TelegramSettings {
  const input = record(raw);
  const events = record(input.events);
  const rows = Math.floor(Number(input.minRows));

  return {
    enabled: flag(input.enabled, DEFAULT_TELEGRAM_SETTINGS.enabled),
    chatId: String(input.chatId ?? "").trim().slice(0, 40),
    chatLabel: String(input.chatLabel ?? "").trim().slice(0, 200),
    events: {
      finished: flag(events.finished, DEFAULT_TELEGRAM_SETTINGS.events.finished),
      failed: flag(events.failed, DEFAULT_TELEGRAM_SETTINGS.events.failed),
      quoteDecided: flag(events.quoteDecided, DEFAULT_TELEGRAM_SETTINGS.events.quoteDecided),
      paymentReceived: flag(events.paymentReceived, DEFAULT_TELEGRAM_SETTINGS.events.paymentReceived),
    },
    minRows: Number.isFinite(rows) ? Math.min(Math.max(rows, 0), MAX_MIN_ROWS) : 0,
    apiKeyOnly: flag(input.apiKeyOnly, DEFAULT_TELEGRAM_SETTINGS.apiKeyOnly),
  };
}

/** What happened to one sync, as much as a message needs. */
export type SyncOutcome =
  | {
      event: "finished";
      sourceName: string;
      rowsRead: number;
      created: number;
      updated: number;
      flagged: number;
      deactivated: number;
      /** Rows that were skipped or could not be saved. */
      skipped: number;
    }
  | { event: "failed"; sourceName: string; error: string };

/** The client's answer to an estimate. */
export type QuoteDecision = {
  event: "quoteDecided";
  decision: "accepted" | "declined";
  number: string;
  name: string;
  clientName: string;
  total: number;
  currency: CurrencyCode;
};

/** Money in, and where the invoice stands after it. */
export type PaymentReceipt = {
  event: "paymentReceived";
  invoiceNumber: string;
  clientName: string;
  amount: number;
  /** After this payment. Negative when overpaid — see src/lib/receivable.ts. */
  balance: number;
  currency: CurrencyCode;
};

/** Anything a message can be about. */
export type Outcome = SyncOutcome | QuoteDecision | PaymentReceipt;

/**
 * Whether this outcome is worth a message under these settings.
 *
 * A failure ignores the row threshold: a feed that could not be read has no
 * rows, and it is the one outcome that is always news.
 */
export function shouldNotify(settings: TelegramSettings, outcome: Outcome, viaApiKey: boolean): boolean {
  if (!settings.enabled || !settings.chatId) return false;
  if (!settings.events[outcome.event]) return false;
  if (settings.apiKeyOnly && !viaApiKey) return false;
  if (outcome.event === "finished" && outcome.rowsRead < settings.minRows) return false;
  return true;
}

/** Always en-US, like the counts: a message reads the same whoever's server sends it. */
const money = (value: number, currency: CurrencyCode) => formatMoney(value, currency, "en-US");

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/**
 * The message itself. Plain text — no Markdown, so a feed called
 * "Smith_&_Sons *NEW*" cannot break the formatting or the send.
 */
export function syncMessage(outcome: SyncOutcome): string {
  if (outcome.event === "failed") {
    return `Supplier feed "${outcome.sourceName}" could not sync.\n${outcome.error}`;
  }

  const parts = [
    outcome.created && `${plural(outcome.created, "item")} added`,
    outcome.updated && `${plural(outcome.updated, "item")} updated`,
    outcome.deactivated && `${plural(outcome.deactivated, "item")} switched off`,
    outcome.skipped && `${plural(outcome.skipped, "row")} skipped`,
  ].filter(Boolean);

  const lines = [
    `Supplier feed "${outcome.sourceName}" synced: ${plural(outcome.rowsRead, "row")} read.`,
    parts.length ? `${parts.join(", ")}.` : "Nothing in the catalogue changed.",
  ];

  // The line somebody has to act on goes last, where a phone's preview cuts off least.
  if (outcome.flagged) {
    lines.push(`${plural(outcome.flagged, "price move")} past the feed's limit ${outcome.flagged === 1 ? "is" : "are"} waiting for review.`);
  }

  return lines.join("\n");
}

const quoted = (name: string) => (name.trim() ? ` "${name.trim()}"` : "");

const forClient = (name: string) => (name.trim() ? ` for ${name.trim()}` : "");

export function quoteDecisionMessage(outcome: QuoteDecision): string {
  return (
    `Estimate ${outcome.number}${quoted(outcome.name)}${forClient(outcome.clientName)} was ${outcome.decision}: ` +
    `${money(outcome.total, outcome.currency)}.`
  );
}

export function paymentMessage(outcome: PaymentReceipt): string {
  const from = outcome.clientName.trim() ? ` from ${outcome.clientName.trim()}` : "";
  const standing =
    outcome.balance > 0
      ? `${money(outcome.balance, outcome.currency)} still outstanding.`
      : outcome.balance < 0
        ? // An overpayment is money owed back, and the one line here somebody has to act on.
          `Overpaid by ${money(-outcome.balance, outcome.currency)} — that is owed back.`
        : "Paid in full.";

  return `Payment of ${money(outcome.amount, outcome.currency)} received against ${outcome.invoiceNumber}${from}.\n${standing}`;
}

/** The message for any outcome. Plain text, for the reason on `syncMessage`. */
export function outcomeMessage(outcome: Outcome): string {
  switch (outcome.event) {
    case "quoteDecided":
      return quoteDecisionMessage(outcome);
    case "paymentReceived":
      return paymentMessage(outcome);
    default:
      return syncMessage(outcome);
  }
}
