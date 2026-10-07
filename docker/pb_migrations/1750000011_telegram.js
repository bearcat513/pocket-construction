/// <reference path="../pb_data/types.d.ts" />

/**
 * Telegram notifications: one row per account, holding where its messages go
 * and, optionally, its own bot.
 *
 * Every rule is closed. The row carries a bot token — a credential — and a
 * pairing code that proves who owns a chat, so it is read and written only by
 * docker/pb_hooks/lib/telegram.js, which answers with a status that leaves
 * both out. Hidden as well as closed, so not even an export of the collection
 * API hands the token back.
 *
 * Nothing here is backfilled: an account with no row has notifications off,
 * and the hook creates the row the first time anything is saved.
 */
migrate(
  app => {
    const users = app.findCollectionByNameOrId("users");

    const links = new Collection({
      name: "telegram_links",
      type: "base",
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: "text",
          name: "id",
          system: true,
          primaryKey: true,
          required: true,
          min: 3,
          max: 40,
          pattern: "^[a-z0-9_]+$",
          autogeneratePattern: "[a-z0-9]{15}",
        },
        {
          type: "relation",
          name: "user",
          required: true,
          maxSelect: 1,
          collectionId: users.id,
          cascadeDelete: true, // closing an account forgets its chat and its bot
        },
        // The chat is set by pairing alone, never by a settings body, so it has
        // columns of its own rather than a key in `settings` a client could post.
        { type: "text", name: "chat_id", required: false, max: 40 },
        { type: "text", name: "chat_label", required: false, max: 200 },
        // The rest of the settings, as JSON text — see readTelegramSettings in
        // src/lib/telegram.ts. Text rather than a json field because a json
        // field reaches the JSVM as a byte array, and reading one back there
        // is the trap the CLAUDE.md warns about.
        { type: "text", name: "settings", required: false, max: 4000 },
        { type: "text", name: "bot_token", required: false, hidden: true, max: 200 },
        { type: "text", name: "bot_username", required: false, max: 100 },
        { type: "text", name: "pairing_code", required: false, hidden: true, max: 20 },
        { type: "date", name: "pairing_expires", required: false },
        { type: "text", name: "last_error", required: false, max: 1000 },
        { type: "date", name: "last_sent", required: false },
        { type: "autodate", name: "created", onCreate: true, onUpdate: false },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_telegram_links_user` ON `telegram_links` (`user`)"],
    });

    app.save(links);
  },
  app => {
    app.delete(app.findCollectionByNameOrId("telegram_links"));
  },
);
