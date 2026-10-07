import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TELEGRAM_SETTINGS,
  isBotToken,
  MAX_MIN_ROWS,
  PAIRING_ALPHABET,
  outcomeMessage,
  pairingLink,
  paymentMessage,
  quoteDecisionMessage,
  readTelegramSettings,
  shouldNotify,
  syncMessage,
  type PaymentReceipt,
  type QuoteDecision,
  type SyncOutcome,
  type TelegramSettings,
} from "./telegram";

const linked: TelegramSettings = { ...DEFAULT_TELEGRAM_SETTINGS, chatId: "12345", chatLabel: "Sam" };

const finished = (rowsRead: number, extra: Partial<Extract<SyncOutcome, { event: "finished" }>> = {}): SyncOutcome => ({
  event: "finished",
  sourceName: "ABC Supply",
  rowsRead,
  created: 0,
  updated: 0,
  flagged: 0,
  deactivated: 0,
  skipped: 0,
  ...extra,
});

const failed: SyncOutcome = { event: "failed", sourceName: "ABC Supply", error: "The feed answered 503." };

const accepted: QuoteDecision = {
  event: "quoteDecided",
  decision: "accepted",
  number: "EST-2026-0007",
  name: "Harbor Lofts shell",
  clientName: "Ortiz Development",
  total: 184_200,
  currency: "USD",
};

const payment = (amount: number, balance: number): PaymentReceipt => ({
  event: "paymentReceived",
  invoiceNumber: "INV-2026-0031",
  clientName: "Ortiz Development",
  amount,
  balance,
  currency: "USD",
});

describe("readTelegramSettings", () => {
  test("anything at all comes back whole, with the defaults", () => {
    expect(readTelegramSettings(undefined)).toEqual(DEFAULT_TELEGRAM_SETTINGS);
    expect(readTelegramSettings("nonsense")).toEqual(DEFAULT_TELEGRAM_SETTINGS);
    expect(readTelegramSettings([])).toEqual(DEFAULT_TELEGRAM_SETTINGS);
  });

  test("a missing event keeps its default rather than switching off", () => {
    expect(readTelegramSettings({ events: { finished: false } }).events).toEqual({
      finished: false,
      failed: true,
      quoteDecided: false,
      paymentReceived: false,
    });
  });

  test("the row threshold is a whole number inside its bounds", () => {
    expect(readTelegramSettings({ minRows: "250.7" }).minRows).toBe(250);
    expect(readTelegramSettings({ minRows: -4 }).minRows).toBe(0);
    expect(readTelegramSettings({ minRows: "lots" }).minRows).toBe(0);
    expect(readTelegramSettings({ minRows: 1e12 }).minRows).toBe(MAX_MIN_ROWS);
  });

  test("a flag has to be a boolean to count", () => {
    expect(readTelegramSettings({ enabled: "false" }).enabled).toBe(true);
    expect(readTelegramSettings({ apiKeyOnly: false }).apiKeyOnly).toBe(false);
  });
});

describe("shouldNotify", () => {
  test("nothing is sent with no chat linked", () => {
    expect(shouldNotify(DEFAULT_TELEGRAM_SETTINGS, failed, true)).toBe(false);
  });

  test("nothing is sent while switched off", () => {
    expect(shouldNotify({ ...linked, enabled: false }, failed, true)).toBe(false);
  });

  test("a sync run from the screen is not news by default — its result is on the screen", () => {
    expect(shouldNotify(linked, finished(5_000), false)).toBe(false);
    expect(shouldNotify(linked, finished(5_000), true)).toBe(true);
    expect(shouldNotify({ ...linked, apiKeyOnly: false }, finished(5_000), false)).toBe(true);
  });

  test("a small sync says nothing, but a failure always does", () => {
    const settings = { ...linked, minRows: 100 };
    expect(shouldNotify(settings, finished(99), true)).toBe(false);
    expect(shouldNotify(settings, finished(100), true)).toBe(true);
    expect(shouldNotify(settings, failed, true)).toBe(true);
  });

  test("each event can be switched off on its own", () => {
    const events = DEFAULT_TELEGRAM_SETTINGS.events;
    expect(shouldNotify({ ...linked, events: { ...events, finished: false } }, finished(10), true)).toBe(false);
    expect(shouldNotify({ ...linked, events: { ...events, failed: false } }, failed, true)).toBe(false);
  });

  test("estimates and payments are off until switched on, so an accounting sync is not a flood", () => {
    expect(shouldNotify(linked, accepted, true)).toBe(false);
    expect(shouldNotify(linked, payment(100, 0), true)).toBe(false);

    const on = { ...linked, events: { ...linked.events, quoteDecided: true, paymentReceived: true } };
    expect(shouldNotify(on, accepted, true)).toBe(true);
    expect(shouldNotify(on, payment(100, 0), true)).toBe(true);
  });

  test("the API-key rule covers estimates and payments too, and the row threshold does not", () => {
    const on = { ...linked, minRows: 1_000, events: { ...linked.events, quoteDecided: true, paymentReceived: true } };
    expect(shouldNotify(on, accepted, false)).toBe(false);
    expect(shouldNotify(on, payment(100, 0), false)).toBe(false);
    expect(shouldNotify({ ...on, apiKeyOnly: false }, accepted, false)).toBe(true);
  });
});

describe("syncMessage", () => {
  test("a failure says which feed and why", () => {
    expect(syncMessage(failed)).toBe('Supplier feed "ABC Supply" could not sync.\nThe feed answered 503.');
  });

  test("a sync lists only what happened, and puts the review last", () => {
    const text = syncMessage(finished(4_210, { created: 1, updated: 312, flagged: 3 }));
    expect(text.split("\n")).toEqual([
      'Supplier feed "ABC Supply" synced: 4,210 rows read.',
      "1 item added, 312 items updated.",
      "3 price moves past the feed's limit are waiting for review.",
    ]);
  });

  test("a sync that changed nothing says so", () => {
    expect(syncMessage(finished(1))).toBe('Supplier feed "ABC Supply" synced: 1 row read.\nNothing in the catalogue changed.');
  });
});

describe("quoteDecisionMessage", () => {
  test("names the estimate, the client and the total", () => {
    expect(quoteDecisionMessage(accepted)).toBe(
      'Estimate EST-2026-0007 "Harbor Lofts shell" for Ortiz Development was accepted: $184,200.00.',
    );
  });

  test("a blank name or client leaves no empty quotes behind", () => {
    expect(quoteDecisionMessage({ ...accepted, decision: "declined", name: " ", clientName: "" })).toBe(
      "Estimate EST-2026-0007 was declined: $184,200.00.",
    );
  });
});

describe("paymentMessage", () => {
  test("says what came in and what is left", () => {
    expect(paymentMessage(payment(12_000, 4_500.5))).toBe(
      "Payment of $12,000.00 received against INV-2026-0031 from Ortiz Development.\n$4,500.50 still outstanding.",
    );
  });

  test("a zero balance is paid in full", () => {
    expect(paymentMessage(payment(4_500, 0)).split("\n")[1]).toBe("Paid in full.");
  });

  test("an overpayment is money owed back, not a zero", () => {
    expect(paymentMessage(payment(5_000, -500)).split("\n")[1]).toBe("Overpaid by $500.00 — that is owed back.");
  });
});

describe("outcomeMessage", () => {
  test("picks the message for each kind of outcome", () => {
    expect(outcomeMessage(failed)).toBe(syncMessage(failed));
    expect(outcomeMessage(accepted)).toBe(quoteDecisionMessage(accepted));
    expect(outcomeMessage(payment(1, 0))).toBe(paymentMessage(payment(1, 0)));
  });
});

describe("pairing", () => {
  test("the alphabet cannot be read back wrong", () => {
    for (const ambiguous of ["O", "0", "I", "1"]) expect(PAIRING_ALPHABET).not.toContain(ambiguous);
  });

  test("the deep link sends the code as /start, and needs a bot to point at", () => {
    expect(pairingLink("sitelines_bot", "ABC234")).toBe("https://t.me/sitelines_bot?start=ABC234");
    expect(pairingLink("", "ABC234")).toBe("");
  });

  test("a bot token is recognised by shape", () => {
    expect(isBotToken("123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw_")).toBe(true);
    expect(isBotToken("  123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw_  ")).toBe(true);
    expect(isBotToken("AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw")).toBe(false);
    expect(isBotToken("123456789:short")).toBe(false);
  });
});
