import { useEffect, useState, type FormEvent } from "react";
import { ExternalLink, Loader2, Send, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "./common";
import { api } from "@/lib/api";
import { isBotToken, MAX_MIN_ROWS, pairingLink, type TelegramSettings, type TelegramStatus } from "@/lib/telegram";

/** How often a pairing in progress asks whether the code has arrived. */
const PAIRING_POLL_MS = 3000;

const message = (failure: unknown, fallback: string) => (failure instanceof Error ? failure.message : fallback);

const formatWhen = (iso: string) => (iso ? new Date(iso).toLocaleString() : "");

/** The bot, the chat, and the rules for what counts as news. */
export function TelegramNotifications() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [error, setError] = useState("");
  /** Which action is in flight, so only its own button spins. */
  const [busy, setBusy] = useState("");
  const [botToken, setBotToken] = useState("");
  const [minRows, setMinRows] = useState("0");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await api.telegramStatus();
        if (!cancelled) {
          setStatus(loaded);
          setMinRows(String(loaded.settings.minRows));
        }
      } catch (failure) {
        if (!cancelled) setError(message(failure, "Could not read your Telegram settings."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pairing = status && !status.settings.chatId ? status.pairing : null;

  // While a code is out, ask whether it has arrived. Stops on success, on an
  // error, and when the code lapses — an expired code can never match.
  useEffect(() => {
    if (!pairing) return;
    const expires = new Date(pairing.expiresAt).getTime();
    let stopped = false;

    const timer = setInterval(async () => {
      if (stopped) return;
      if (Date.now() > expires) {
        clearInterval(timer);
        setStatus(current => (current ? { ...current, pairing: null } : current));
        setError("The pairing code expired before it reached the bot. Start again.");
        return;
      }
      try {
        const result = await api.checkTelegramPairing();
        if (!stopped && result.paired) {
          clearInterval(timer);
          setStatus(result.status);
        }
      } catch (failure) {
        clearInterval(timer);
        if (!stopped) setError(message(failure, "Could not check for the pairing code."));
      }
    }, PAIRING_POLL_MS);

    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pairing?.code, pairing?.expiresAt]);

  async function run(action: string, call: () => Promise<TelegramStatus>, fallback: string) {
    setBusy(action);
    setError("");
    try {
      const next = await call();
      setStatus(next);
      setMinRows(String(next.settings.minRows));
      return true;
    } catch (failure) {
      setError(message(failure, fallback));
      return false;
    } finally {
      setBusy("");
    }
  }

  function save(patch: Partial<TelegramSettings>) {
    if (!status) return;
    const settings = { ...status.settings, ...patch };
    // Shown at once; the server's answer replaces it.
    setStatus({ ...status, settings });
    void run("settings", () => api.saveTelegramSettings(settings), "Could not save your Telegram settings.");
  }

  async function saveBot(event: FormEvent) {
    event.preventDefault();
    const token = botToken.trim();
    if (!isBotToken(token)) {
      setError("That does not look like a bot token. BotFather's are digits, a colon, then a long code.");
      return;
    }
    if (await run("bot", () => api.setTelegramBot(token), "Could not save that bot.")) setBotToken("");
  }

  if (!status) {
    return (
      <p className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
        {error || (
          <>
            <Loader2 className="size-3.5 animate-spin" /> Loading…
          </>
        )}
      </p>
    );
  }

  const { settings, bot } = status;
  const botName = bot.username ? `@${bot.username}` : "the bot";
  const link = pairing ? pairingLink(bot.username, pairing.code) : "";

  return (
    <div className="divide-y">
      {/* ------------------------------- the bot ------------------------------ */}
      <div className="space-y-3 p-4">
        <p className="text-sm">
          {bot.source === "account" && <>Sending through your own bot{bot.username && <>, {botName}</>}.</>}
          {bot.source === "operator" && <>Sending through this server's bot{bot.username && <>, {botName}</>}.</>}
          {bot.source === "none" && (
            <span className="text-muted-foreground">
              No bot is set up. Make one with BotFather and paste its token here, or ask whoever runs this server to set{" "}
              <span className="font-mono">TELEGRAM_BOT_TOKEN</span>.
            </span>
          )}
        </p>

        <form onSubmit={event => void saveBot(event)} className="flex flex-wrap items-end gap-3">
          <Field
            label={bot.source === "account" ? "Replace your bot token" : "Your own bot token"}
            className="min-w-56 flex-1"
          >
            <Input
              className="h-8 font-mono text-xs"
              type="password"
              autoComplete="off"
              placeholder="123456789:AA…"
              value={botToken}
              onChange={event => setBotToken(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="outline" size="sm" disabled={!botToken.trim() || busy === "bot"}>
            {busy === "bot" && <Loader2 className="animate-spin" />}
            Save bot
          </Button>
          {bot.source === "account" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy === "bot"}
              onClick={() => void run("bot", () => api.setTelegramBot(""), "Could not remove your bot.")}
            >
              Remove it
            </Button>
          )}
          <p className="w-full text-[11px] text-muted-foreground">
            Checked with Telegram before it is kept, and never shown again. Changing bots unlinks the chat — a chat has
            to start a bot before that bot may post to it.
          </p>
        </form>
      </div>

      {/* ------------------------------- the chat ----------------------------- */}
      <div className="space-y-3 p-4">
        {settings.chatId ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              Linked to <span className="font-medium">{settings.chatLabel || "a Telegram chat"}</span>
              {status.lastSentAt && (
                <span className="text-xs text-muted-foreground"> · last sent {formatWhen(status.lastSentAt)}</span>
              )}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={busy === "test"}
                onClick={() => void run("test", api.sendTelegramTest, "Could not send a test message.")}
              >
                {busy === "test" ? <Loader2 className="animate-spin" /> : <Send />}
                Send a test
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy === "unlink"}
                onClick={() => void run("unlink", api.unlinkTelegram, "Could not unlink the chat.")}
              >
                <Unlink /> Unlink
              </Button>
            </div>
          </div>
        ) : pairing ? (
          <div className="motion-safe:animate-settle space-y-2 border-l-2 border-l-primary bg-primary/5 px-4 py-3">
            <p className="text-xs">
              Send this code to {botName} in Telegram — from your own chat, or from a group the bot has been added to:
            </p>
            <p className="font-display text-2xl tracking-[0.3em] select-all">{pairing.code}</p>
            <div className="flex flex-wrap items-center gap-3">
              {link && (
                <Button variant="outline" size="sm" asChild>
                  <a href={link} target="_blank" rel="noreferrer">
                    <ExternalLink /> Open {botName}
                  </a>
                </Button>
              )}
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="size-3 animate-spin" /> Waiting for it to arrive · good until{" "}
                {new Date(pairing.expiresAt).toLocaleTimeString()}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">No chat is linked, so nothing is sent.</p>
            <Button
              variant="outline"
              size="sm"
              disabled={bot.source === "none" || busy === "pair"}
              onClick={() => void run("pair", api.startTelegramPairing, "Could not start pairing.")}
            >
              {busy === "pair" ? <Loader2 className="animate-spin" /> : <Send />}
              Link a chat
            </Button>
          </div>
        )}
      </div>

      {/* --------------------------- what counts as news ---------------------- */}
      <div className="grid gap-4 p-4 sm:grid-cols-2">
        <Field label="Notifications on">
          <div className="flex h-9 items-center">
            <Switch checked={settings.enabled} onChange={event => save({ enabled: event.target.checked })} />
          </div>
        </Field>

        <Field label="Only for what an API key does" hint="Whatever you do on screen, you already know about.">
          <div className="flex h-9 items-center">
            <Switch checked={settings.apiKeyOnly} onChange={event => save({ apiKeyOnly: event.target.checked })} />
          </div>
        </Field>

        <Field label="When a feed syncs">
          <div className="flex h-9 items-center">
            <Switch
              checked={settings.events.finished}
              onChange={event => save({ events: { ...settings.events, finished: event.target.checked } })}
            />
          </div>
        </Field>

        <Field label="When a feed cannot sync" hint="Unreachable or unreadable. Always news, whatever its size.">
          <div className="flex h-9 items-center">
            <Switch
              checked={settings.events.failed}
              onChange={event => save({ events: { ...settings.events, failed: event.target.checked } })}
            />
          </div>
        </Field>

        <Field label="When an estimate is accepted or declined" hint="The client's answer, with the estimate's total.">
          <div className="flex h-9 items-center">
            <Switch
              checked={settings.events.quoteDecided}
              onChange={event => save({ events: { ...settings.events, quoteDecided: event.target.checked } })}
            />
          </div>
        </Field>

        <Field label="When a payment is received" hint="The amount, and what is still outstanding on the invoice.">
          <div className="flex h-9 items-center">
            <Switch
              checked={settings.events.paymentReceived}
              onChange={event => save({ events: { ...settings.events, paymentReceived: event.target.checked } })}
            />
          </div>
        </Field>

        <Field label="Smallest sync worth a message" hint="In rows read. 0 reports every one.">
          <Input
            type="number"
            min={0}
            max={MAX_MIN_ROWS}
            value={minRows}
            onChange={event => setMinRows(event.target.value)}
            onBlur={() => {
              const rows = Math.max(0, Math.floor(Number(minRows) || 0));
              if (rows !== settings.minRows) save({ minRows: rows });
              else setMinRows(String(rows));
            }}
          />
        </Field>
      </div>

      {(error || status.lastError) && (
        <p className="px-4 py-3 text-xs text-destructive">{error || `The last message failed: ${status.lastError}`}</p>
      )}
    </div>
  );
}
