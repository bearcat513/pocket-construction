/// <reference path="../pb_data/types.d.ts" />

/**
 * The catalogue and its rules, cut down to what one company uses.
 *
 * The app grew out of a multi-tenant CPQ, and kept the machinery a software
 * vendor prices with: per-customer price books, formula pricing rules, a
 * multi-level approval ladder with quorums, and catalogue items that could be
 * shared between accounts. One contractor needs none of it. What replaces the
 * rules is three numbers in the account's settings — markup, overhead and tax
 * — copied onto each quote when it is created (see `Quote.markupPercent`).
 *
 * **This deletes data.** `price_books`, `pricing_rules` and `approval_rules`
 * go with everything in them, and so does every quote's approval history.
 * Take a `GET /api/export` first if any of it still matters.
 *
 * In order, because PocketBase refuses to drop a collection something still
 * points at, and refuses to save a rule naming a field that is gone:
 *
 *   1. quotes waiting on, or sent back by, an approver go back to `draft` —
 *      the one status every one of them could honestly be in now
 *   2. the quote rules stop naming `approvers`
 *   3. the fields go: `quotes.approvals`, `quotes.approvers`,
 *      `quotes.priceBook`, `accounts.priceBook`, `products.currency`,
 *      `products.sharedWith` (and the rules that read it)
 *   4. the three collections go
 *
 * Nothing in a JSON field is touched. A product's `definition` still holds
 * `chargeType`, `minQuantity` and the rest until it is next saved, and
 * `toProduct` simply does not read them.
 */
migrate(
  app => {
    const MINE = "owner = @request.auth.id";
    const MINE_OR_SHARED = `${MINE} || sharedWith.id ?= @request.auth.id`;

    /*
     * Exported as a constant because src/server/migration.test.ts runs this
     * exact statement against a throwaway database.
     */
    const REOPEN_APPROVAL_STATUSES = "UPDATE quotes SET status = 'draft' WHERE status IN ('in_review', 'approved', 'rejected')";

    app.db().newQuery(REOPEN_APPROVAL_STATUSES).execute();

    /* --- quotes --- */

    const quotes = app.findCollectionByNameOrId("quotes");
    quotes.listRule = MINE_OR_SHARED;
    quotes.viewRule = MINE_OR_SHARED;
    quotes.updateRule = MINE;
    for (const name of ["approvals", "approvers", "priceBook"]) {
      if (quotes.fields.getByName(name)) quotes.fields.removeByName(name);
    }
    app.save(quotes);

    /* --- accounts --- */

    const accounts = app.findCollectionByNameOrId("accounts");
    if (accounts.fields.getByName("priceBook")) {
      accounts.fields.removeByName("priceBook");
      app.save(accounts);
    }

    /* --- products: the owner's own, in the one currency --- */

    const products = app.findCollectionByNameOrId("products");
    products.listRule = MINE;
    products.viewRule = MINE;
    for (const name of ["currency", "sharedWith"]) {
      if (products.fields.getByName(name)) products.fields.removeByName(name);
    }
    app.save(products);

    /* --- the collections nothing reads any more --- */

    for (const name of ["pricing_rules", "approval_rules", "price_books"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (err) {
        // Already gone.
      }
    }
  },
  app => {
    // Down: the shape comes back, the data does not. The collections are
    // recreated empty and the fields unset; approval history is not
    // reconstructed, and a quote reopened here stays a draft.
    const users = app.findCollectionByNameOrId("users");
    const MINE = "owner = @request.auth.id";
    const MINE_OR_SHARED = `${MINE} || sharedWith.id ?= @request.auth.id`;
    const SIGNED_IN = '@request.auth.id != ""';

    const idField = {
      type: "text",
      name: "id",
      system: true,
      primaryKey: true,
      required: true,
      min: 3,
      max: 40,
      pattern: "^[a-z0-9_]+$",
      autogeneratePattern: "[a-z0-9]{15}",
    };
    const stamps = [
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ];
    const owner = { type: "relation", name: "owner", required: false, maxSelect: 1, collectionId: users.id, cascadeDelete: true };
    const sharedWith = () => ({
      type: "relation",
      name: "sharedWith",
      required: false,
      maxSelect: 50,
      collectionId: users.id,
      cascadeDelete: false,
    });
    const privateRules = { listRule: MINE, viewRule: MINE, createRule: SIGNED_IN, updateRule: MINE, deleteRule: MINE };

    const priceBooks = new Collection({
      name: "price_books",
      type: "base",
      ...privateRules,
      listRule: MINE_OR_SHARED,
      viewRule: MINE_OR_SHARED,
      fields: [
        idField,
        { type: "text", name: "name", required: true, min: 1, max: 200 },
        { type: "text", name: "description", required: false, max: 2000 },
        { type: "text", name: "currency", required: false, max: 3 },
        { type: "bool", name: "isDefault", required: false },
        { type: "bool", name: "active", required: false },
        { type: "text", name: "validFrom", required: false, max: 10 },
        { type: "text", name: "validTo", required: false, max: 10 },
        { type: "json", name: "entries", required: false, maxSize: 4194304 },
        owner,
        sharedWith(),
        ...stamps,
      ],
    });
    app.save(priceBooks);

    for (const name of ["pricing_rules", "approval_rules"]) {
      app.save(
        new Collection({
          name,
          type: "base",
          ...privateRules,
          fields: [
            idField,
            { type: "text", name: "name", required: true, min: 1, max: 200 },
            { type: "number", name: name === "pricing_rules" ? "priority" : "level", required: false },
            { type: "bool", name: "active", required: false },
            { type: "json", name: "definition", required: false, maxSize: 65536 },
            owner,
            ...stamps,
          ],
        }),
      );
    }

    const products = app.findCollectionByNameOrId("products");
    if (!products.fields.getByName("currency")) {
      products.fields.add(new Field({ type: "text", name: "currency", required: false, max: 3 }));
    }
    if (!products.fields.getByName("sharedWith")) products.fields.add(new Field(sharedWith()));
    app.save(products);
    products.listRule = MINE_OR_SHARED;
    products.viewRule = MINE_OR_SHARED;
    app.save(products);

    const accounts = app.findCollectionByNameOrId("accounts");
    if (!accounts.fields.getByName("priceBook")) {
      accounts.fields.add(
        new Field({ type: "relation", name: "priceBook", required: false, maxSelect: 1, collectionId: priceBooks.id, cascadeDelete: false }),
      );
      app.save(accounts);
    }

    const quotes = app.findCollectionByNameOrId("quotes");
    if (!quotes.fields.getByName("priceBook")) {
      quotes.fields.add(
        new Field({ type: "relation", name: "priceBook", required: false, maxSelect: 1, collectionId: priceBooks.id, cascadeDelete: false }),
      );
    }
    if (!quotes.fields.getByName("approvals")) {
      quotes.fields.add(new Field({ type: "json", name: "approvals", required: false, maxSize: 262144 }));
    }
    if (!quotes.fields.getByName("approvers")) {
      quotes.fields.add(
        new Field({ type: "relation", name: "approvers", required: false, maxSelect: 50, collectionId: users.id, cascadeDelete: false }),
      );
    }
    app.save(quotes);
    quotes.listRule = `${MINE_OR_SHARED} || approvers.id ?= @request.auth.id`;
    quotes.viewRule = `${MINE_OR_SHARED} || approvers.id ?= @request.auth.id`;
    quotes.updateRule = `${MINE} || approvers.id ?= @request.auth.id`;
    app.save(quotes);
  },
);
