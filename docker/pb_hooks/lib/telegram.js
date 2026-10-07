/**
 * Telegram: the bot token, and every call to Telegram.
 *
 * This lives in PocketBase rather than in the Bun server because a bot token
 * is a credential. An account's own is stored in a hidden field of a
 * collection whose rules are all closed (1750000011_telegram.js), so it never
 * reaches the browser and the Bun server never holds it. An operator may set
 * TELEGRAM_BOT_TOKEN on this container instead, and then nobody has to make a
 * bot at all; an account's own token wins over it.
 *
 * *When* to send, and what to say, is not decided here — that is pure and
 * lives in src/lib/telegram.ts. This file only stores, pairs and sends.
 *
 * A hook body cannot see its own file's scope, so every handler registered in
 * telegram/routes.js `require`s this module inside itself.
 */

/** No O/0 or I/1, so a code cannot be read back wrong. Matches src/lib/telegram.ts. */
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 6;
const PAIRING_TTL_MS = 10 * 60 * 1000;

/** Telegram either answers quickly or is not going to. */
const TIMEOUT_SECONDS = 8;

/** Telegram's own limit is 4096; a little room for anything it counts differently. */
const MAX_MESSAGE_LENGTH = 4000;

/** How many pages of getUpdates a pairing check will read before giving up. */
const MAX_UPDATE_PAGES = 5;

const BOT_TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;

/** PocketBase stores dates as "2026-01-31 12:00:00.000Z". */
function toPocketBaseDate(date) {
  return date.toISOString().replace("T", " ");
}

function fromPocketBaseDate(value) {
  const text = String(value || "");
  if (!text) return null;
  const parsed = new Date(text.replace(" ", "T"));
  return isNaN(parsed.getTime()) ? null : parsed;
}

function findLink(app, userId) {
  try {
    return app.findFirstRecordByFilter("telegram_links", "user = {:user}", { user: userId });
  } catch (err) {
    return null;
  }
}

/** The caller's row, created on first write. */
function linkFor(app, userId) {
  const existing = findLink(app, userId);
  if (existing) return existing;

  const record = new Record(app.findCollectionByNameOrId("telegram_links"));
  record.set("id", "tg_" + $security.randomStringWithAlphabet(16, "0123456789abcdefghijklmnopqrstuvwxyz"));
  record.set("user", userId);
  record.set("settings", "{}");
  return record;
}

/** The bot this account sends through: its own, the operator's, or none. */
function botFor(link) {
  const own = link ? String(link.getString("bot_token") || "").trim() : "";
  if (own) return { token: own, source: "account" };

  const operator = String($os.getenv("TELEGRAM_BOT_TOKEN") || "").trim();
  if (operator) return { token: operator, source: "operator" };

  return { token: "", source: "none" };
}

/**
 * One call to the Bot API.
 *
 * Every failure comes back as one sentence, because that sentence is what the
 * settings page shows and what `last_error` keeps. Telegram's own
 * `description` is the useful part; a status code alone is not.
 */
function callTelegram(token, method, payload) {
  let response;
  try {
    response = $http.send({
      url: "https://api.telegram.org/bot" + token + "/" + method,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
      timeout: TIMEOUT_SECONDS,
    });
  } catch (err) {
    return { ok: false, error: "Could not reach Telegram — " + String(err).slice(0, 200) };
  }

  const json = response.json || {};
  if (response.statusCode === 200 && json.ok) return { ok: true, result: json.result };

  const description = String(json.description || "");
  if (response.statusCode === 401 || response.statusCode === 404) {
    return { ok: false, error: "Telegram refused the bot token. Check it with BotFather, or paste a new one." };
  }
  if (response.statusCode === 403) {
    return { ok: false, error: "The bot cannot post to that chat — it was blocked or removed from it. Link the chat again." };
  }
  if (response.statusCode === 409) {
    return {
      ok: false,
      error: "That bot has a webhook set, so its messages cannot be read here. Remove the webhook, or use another bot.",
    };
  }
  return {
    ok: false,
    error: description ? "Telegram said: " + description : "Telegram answered " + response.statusCode + ".",
  };
}

/** What a caller may know. Never the token, and never a lapsed pairing code. */
function describe(link) {
  const bot = botFor(link);

  let settings = {};
  try {
    settings = JSON.parse((link && link.getString("settings")) || "{}") || {};
  } catch (err) {
    settings = {};
  }
  settings.chatId = link ? link.getString("chat_id") : "";
  settings.chatLabel = link ? link.getString("chat_label") : "";

  const code = link ? link.getString("pairing_code") : "";
  const expires = link ? fromPocketBaseDate(link.getString("pairing_expires")) : null;
  const pairing = code && expires && expires.getTime() > Date.now() ? { code: code, expiresAt: expires.toISOString() } : null;

  const lastSent = link ? fromPocketBaseDate(link.getString("last_sent")) : null;

  return {
    settings: settings,
    bot: { source: bot.source, username: bot.source === "none" || !link ? "" : link.getString("bot_username") },
    pairing: pairing,
    lastError: link ? link.getString("last_error") : "",
    lastSentAt: lastSent ? lastSent.toISOString() : "",
  };
}

function body(e) {
  const info = e.requestInfo();
  return (info && info.body) || {};
}

/** Sends, and records how it went on the row either way. */
function sendTo(app, link, text) {
  const chatId = link.getString("chat_id");
  if (!chatId) return { ok: false, error: "No chat is linked." };

  const bot = botFor(link);
  if (bot.source === "none") return { ok: false, error: "No bot is set up to send with." };

  const result = callTelegram(bot.token, "sendMessage", {
    chat_id: chatId,
    text: String(text || "").slice(0, MAX_MESSAGE_LENGTH),
    disable_web_page_preview: true,
  });

  if (result.ok) {
    link.set("last_sent", toPocketBaseDate(new Date()));
    link.set("last_error", "");
  } else {
    link.set("last_error", result.error.slice(0, 1000));
  }
  app.save(link);
  return result;
}

function clearChat(link) {
  link.set("chat_id", "");
  link.set("chat_label", "");
  link.set("pairing_code", "");
  link.set("pairing_expires", "");
}

/* --------------------------------- handlers -------------------------------- */

function status(e) {
  return e.json(200, describe(findLink(e.app, e.auth.id)));
}

/**
 * The settings that are the caller's to choose. The chat is not one of them —
 * it is set by pairing alone, so a body cannot redirect anybody's messages.
 */
function saveSettings(e) {
  const input = body(e);
  const events = input.events || {};
  const rows = Math.floor(Number(input.minRows));

  const link = linkFor(e.app, e.auth.id);
  link.set(
    "settings",
    JSON.stringify({
      enabled: input.enabled !== false,
      // The sync events are on unless switched off; the rest are off unless
      // switched on. Matches DEFAULT_TELEGRAM_SETTINGS in src/lib/telegram.ts.
      events: {
        finished: events.finished !== false,
        failed: events.failed !== false,
        quoteDecided: events.quoteDecided === true,
        paymentReceived: events.paymentReceived === true,
      },
      minRows: isFinite(rows) ? Math.min(Math.max(rows, 0), 1000000) : 0,
      apiKeyOnly: input.apiKeyOnly !== false,
    }),
  );
  e.app.save(link);
  return e.json(200, describe(link));
}

/**
 * Sets or clears the account's own bot.
 *
 * The token is checked with Telegram before it is stored, so a pasted mistake
 * is refused here by name rather than at the first notification that never
 * arrives. Changing bots forgets the chat: a chat that started one bot has
 * never spoken to the other, and Telegram will not let it post there.
 */
function setBot(e) {
  const token = String(body(e).token || "").trim();
  const link = linkFor(e.app, e.auth.id);

  if (token) {
    if (!BOT_TOKEN.test(token)) {
      throw new BadRequestError(
        "That does not look like a bot token. BotFather's are digits, a colon, then a long code.",
      );
    }
    const me = callTelegram(token, "getMe");
    if (!me.ok) throw new BadRequestError(me.error);

    link.set("bot_token", token);
    link.set("bot_username", String(me.result.username || ""));
  } else {
    link.set("bot_token", "");
    link.set("bot_username", "");
  }

  clearChat(link);
  link.set("last_error", "");
  e.app.save(link);
  return e.json(200, describe(link));
}

/** Starts a pairing: a short code the caller sends to the bot. */
function pair(e) {
  const link = linkFor(e.app, e.auth.id);
  const bot = botFor(link);
  if (bot.source === "none") {
    throw new BadRequestError(
      "No bot is set up. Paste a bot token from BotFather, or ask whoever runs this server to set TELEGRAM_BOT_TOKEN.",
    );
  }

  // Asked every time, because the operator's bot can be swapped under us and
  // the username is what the pairing instructions name.
  const me = callTelegram(bot.token, "getMe");
  if (!me.ok) throw new BadRequestError(me.error);

  link.set("bot_username", String(me.result.username || ""));
  link.set("pairing_code", $security.randomStringWithAlphabet(PAIRING_CODE_LENGTH, PAIRING_ALPHABET));
  link.set("pairing_expires", toPocketBaseDate(new Date(Date.now() + PAIRING_TTL_MS)));
  e.app.save(link);
  return e.json(200, describe(link));
}

/**
 * Looks for the pairing code among the bot's recent messages.
 *
 * Updates are read without confirming them, so on a bot several accounts
 * share, one person's check does not swallow somebody else's code. Telegram
 * hands back the oldest hundred first, so a busy bot is paged through — and a
 * page that has been read past *is* confirmed, which is the only way to reach
 * the newer ones.
 */
function checkPair(e) {
  const link = findLink(e.app, e.auth.id);
  const described = link ? describe(link) : null;
  if (!link || !described.pairing) {
    throw new BadRequestError("There is no pairing in progress, or its code has expired. Start again.");
  }

  const code = described.pairing.code;
  const bot = botFor(link);
  let offset = 0;
  let chat = null;

  for (let page = 0; page < MAX_UPDATE_PAGES && !chat; page++) {
    const request = { allowed_updates: ["message"], limit: 100, timeout: 0 };
    if (offset) request.offset = offset;

    const updates = callTelegram(bot.token, "getUpdates", request);
    if (!updates.ok) throw new BadRequestError(updates.error);

    const batch = updates.result || [];
    for (let i = batch.length - 1; i >= 0; i--) {
      const message = batch[i].message;
      if (message && String(message.text || "").toUpperCase().indexOf(code) !== -1) {
        chat = message.chat;
        break;
      }
    }

    if (batch.length < 100) break;
    offset = batch[batch.length - 1].update_id + 1;
  }

  if (!chat) return e.json(200, { paired: false, status: described });

  const person = [chat.first_name, chat.last_name].filter(Boolean).join(" ");
  link.set("chat_id", String(chat.id));
  link.set("chat_label", String(chat.title || person || (chat.username ? "@" + chat.username : "Telegram chat")).slice(0, 200));
  link.set("pairing_code", "");
  link.set("pairing_expires", "");
  e.app.save(link);

  // A confirmation in the chat itself, so both ends agree it worked. Its
  // failure is recorded rather than undoing a link that did succeed.
  sendTo(e.app, link, "Linked to Sitelines. The notifications you have switched on will be reported here.");

  return e.json(200, { paired: true, status: describe(link) });
}

function unlink(e) {
  const link = findLink(e.app, e.auth.id);
  if (link) {
    clearChat(link);
    link.set("last_error", "");
    e.app.save(link);
  }
  return e.json(200, describe(link));
}

function test(e) {
  const link = findLink(e.app, e.auth.id);
  if (!link || !link.getString("chat_id")) throw new BadRequestError("Link a chat first.");

  const result = sendTo(e.app, link, "A test from Sitelines. Your notifications will arrive here.");
  if (!result.ok) throw new BadRequestError(result.error);
  return e.json(200, describe(link));
}

/**
 * Sends one message to the caller's own linked chat.
 *
 * Answers 200 whether or not it was delivered: the Bun server calls this after
 * a sync, a transition or a payment has already succeeded, and a notification
 * that failed must not read as the thing itself failing. How it went is on the row, as `last_error`.
 */
function send(e) {
  const link = findLink(e.app, e.auth.id);
  if (!link) return e.json(200, { sent: false, error: "No chat is linked." });

  const result = sendTo(e.app, link, String(body(e).text || ""));
  return e.json(200, { sent: result.ok, error: result.ok ? "" : result.error });
}

module.exports = {
  status: status,
  saveSettings: saveSettings,
  setBot: setBot,
  pair: pair,
  checkPair: checkPair,
  unlink: unlink,
  test: test,
  send: send,
};
