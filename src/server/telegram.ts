/**
 * Telegram notifications, from the Bun side.
 *
 * This server never holds a bot token — an account's own is in a hidden
 * PocketBase field and the operator's is in PocketBase's environment — so every
 * call here is a relay to docker/pb_hooks/lib/telegram.js with the caller's own
 * credential, exactly as sharing is. What this file adds is the decision: after
 * a sync, an estimate's answer or a payment, whether the outcome is news under
 * the caller's settings, and what the message says, both from the pure
 * functions in src/lib/telegram.ts.
 */
import {
  outcomeMessage,
  readTelegramSettings,
  shouldNotify,
  type Outcome,
  type PaymentReceipt,
  type QuoteDecision,
  type SyncOutcome,
  type TelegramSettings,
  type TelegramStatus,
} from "../lib/telegram";
import type { Invoice, Quote } from "../lib/types";
import type { SyncResult } from "./catalogSync";
import { relay } from "./share";

const BASE = "/api/build/telegram";

const json = (method: string, payload: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

/** The hook's answer, normalized, so a row written by an older hook still reads whole. */
function toStatus(raw: TelegramStatus): TelegramStatus {
  return {
    settings: readTelegramSettings(raw?.settings),
    bot: {
      source: raw?.bot?.source === "account" || raw?.bot?.source === "operator" ? raw.bot.source : "none",
      username: String(raw?.bot?.username ?? ""),
    },
    pairing: raw?.pairing?.code ? { code: raw.pairing.code, expiresAt: raw.pairing.expiresAt } : null,
    lastError: String(raw?.lastError ?? ""),
    lastSentAt: String(raw?.lastSentAt ?? ""),
  };
}

export const telegramStatus = async (token: string) => toStatus(await relay<TelegramStatus>(token, BASE));

/** Saves what is the caller's to choose. The chat is set by pairing, never here. */
export async function saveTelegramSettings(token: string, raw: unknown) {
  const { enabled, events, minRows, apiKeyOnly }: TelegramSettings = readTelegramSettings(raw);
  return toStatus(await relay<TelegramStatus>(token, BASE, json("PUT", { enabled, events, minRows, apiKeyOnly })));
}

/** Sets the account's own bot, or clears it with an empty token. */
export const setTelegramBot = async (token: string, botToken: string) =>
  toStatus(await relay<TelegramStatus>(token, `${BASE}/bot`, json("PUT", { token: botToken })));

export const startTelegramPairing = async (token: string) =>
  toStatus(await relay<TelegramStatus>(token, `${BASE}/pair`, { method: "POST" }));

export async function checkTelegramPairing(token: string) {
  const result = await relay<{ paired: boolean; status: TelegramStatus }>(token, `${BASE}/pair/check`, { method: "POST" });
  return { paired: Boolean(result.paired), status: toStatus(result.status) };
}

export const unlinkTelegram = async (token: string) =>
  toStatus(await relay<TelegramStatus>(token, `${BASE}/chat`, { method: "DELETE" }));

export const sendTelegramTest = async (token: string) =>
  toStatus(await relay<TelegramStatus>(token, `${BASE}/test`, { method: "POST" }));

/** What a finished sync tells a notification. */
export const finishedOutcome = (sourceName: string, result: SyncResult): SyncOutcome => ({
  event: "finished",
  sourceName,
  rowsRead: result.summary.rowsRead,
  created: result.summary.created,
  updated: result.summary.updated,
  flagged: result.summary.flagged,
  deactivated: result.summary.deactivated,
  skipped: result.summary.skipped,
});

/** What an accepted or declined estimate tells a notification. */
export const quoteDecision = (quote: Quote, decision: QuoteDecision["decision"]): QuoteDecision => ({
  event: "quoteDecided",
  decision,
  number: quote.number,
  name: quote.name,
  clientName: quote.customer.name,
  total: quote.totals.grandTotal,
  currency: quote.currency,
});

/** What a recorded payment tells a notification, from the invoice as re-read after it. */
export const paymentReceipt = (invoice: Invoice, amount: number): PaymentReceipt => ({
  event: "paymentReceived",
  invoiceNumber: invoice.number,
  clientName: invoice.customer.name,
  amount,
  balance: invoice.totals.balance,
  currency: invoice.currency,
});

/**
 * Tells the caller's chat what happened, if their settings say it is news.
 *
 * Never throws and is never awaited by a route: the sync, the transition or
 * the payment has already succeeded or failed on its own terms, and a
 * notification that could not be delivered must not change the answer. A
 * delivery failure lands on the caller's row as `last_error`, where the
 * settings page shows it.
 */
export async function notify(token: string, outcome: Outcome, viaApiKey: boolean): Promise<void> {
  try {
    const { settings } = await telegramStatus(token);
    if (!shouldNotify(settings, outcome, viaApiKey)) return;
    await relay(token, `${BASE}/send`, json("POST", { text: outcomeMessage(outcome) }));
  } catch {
    // Nothing to tell anybody: see above.
  }
}
