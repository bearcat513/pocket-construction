/// <reference path="../pb_data/types.d.ts" />

/**
 * Projects, catalogue sources, and the columns the materials catalogue queries on.
 *
 * Three changes, and they are one migration because they are one change of
 * subject: this stopped being a catalogue of products sold to accounts and
 * became a catalogue of building materials bought for jobs.
 *
 * ## `projects`
 *
 * A collection of its own, and the record everything else now hangs off. A
 * client is a relationship; a project is the thing that gets built, gets
 * billed and gets argued about. Two buildings for the same developer share an
 * account and share nothing else — different site, different permit, different
 * superintendent, different money.
 *
 * Note what is *not* a column: anything derived. There is no `invoicedToDate`,
 * no `outstanding` and no `backlog`, for exactly the reason `invoices` has no
 * `balance` — a stored roll-up disagrees with the documents underneath it the
 * first time somebody voids an invoice, and it disagrees in front of a client.
 * `src/lib/projects.ts` computes all of it on every read. `contractValue` *is*
 * stored, because the awarded contract sum is a negotiated number rather than
 * a derived one; see the note on that field in src/lib/types.ts.
 *
 * ## `catalog_sources`
 *
 * A supplier feed: where it comes from, how its columns map onto catalogue
 * fields, and what a sync is permitted to change. The permission half is the
 * reason this is a reviewed record rather than a dialog: a feed owns the fields
 * you named and nothing else, and that decision should be durable and visible
 * rather than retyped under time pressure.
 *
 * ## Columns on `products` and `quotes`
 *
 * `costType`, `division` and `manufacturer` become real columns because the
 * materials list filters and groups by all three — a job cost report is always
 * broken down by cost type, and "every 06 item from Cascade Mills" is a query,
 * not a scan. Everything else the materials work added (waste factors,
 * purchase multiples, the specification, the sync provenance) lives in the
 * existing `definition` JSON and needs no schema change, which is the point of
 * keeping one JSON field per collection.
 *
 * `quotes` and `invoices` each gain a `project` relation. Nulls are fine and
 * expected: an estimate written before there was a job to hang it on, or a
 * one-off invoice, belongs to no project and should not be forced into one.
 *
 * ## Backfill
 *
 * There is none, deliberately, and the app is built to need none. Every
 * existing product reads back with `costType: "material"` and an empty
 * specification because `toProduct` in src/server/db.ts defaults them, exactly
 * the way `toAccount` repaired accounts written before contacts existed. A
 * backfill here would be a JSON-field mutation from the JSVM, which — see
 * 1750000004 — silently writes nothing.
 */
migrate(
  app => {
    const users = app.findCollectionByNameOrId("users");
    const accounts = app.findCollectionByNameOrId("accounts");
    const quotes = app.findCollectionByNameOrId("quotes");
    const invoices = app.findCollectionByNameOrId("invoices");
    const products = app.findCollectionByNameOrId("products");

    /** App-supplied id: `prj_<hex>`, matching every other collection here. */
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

    const created = { type: "autodate", name: "created", onCreate: true, onUpdate: false };
    const updated = { type: "autodate", name: "updated", onCreate: true, onUpdate: true };

    const ownerField = () => ({
      type: "relation",
      name: "owner",
      required: false,
      maxSelect: 1,
      collectionId: users.id,
      cascadeDelete: true,
    });

    const sharedWithField = () => ({
      type: "relation",
      name: "sharedWith",
      required: false,
      maxSelect: 50,
      collectionId: users.id,
      cascadeDelete: false,
    });

    const MINE = "owner = @request.auth.id";
    const MINE_OR_SHARED = `${MINE} || sharedWith.id ?= @request.auth.id`;
    const SIGNED_IN = '@request.auth.id != ""';

    const sharedRules = {
      listRule: MINE_OR_SHARED,
      viewRule: MINE_OR_SHARED,
      createRule: SIGNED_IN,
      updateRule: MINE,
      deleteRule: MINE,
    };

    /* -------------------------------- projects ------------------------------ */

    const projects = new Collection({
      name: "projects",
      type: "base",
      ...sharedRules,
      fields: [
        idField,
        { type: "text", name: "number", required: true, min: 1, max: 60 },
        { type: "text", name: "name", required: true, min: 1, max: 200 },
        // lead | bidding | awarded | in_progress | complete | cancelled
        { type: "text", name: "status", required: true, max: 20 },
        { type: "text", name: "currency", required: true, min: 3, max: 3 },
        // The negotiated contract sum. Everything else about the money on a
        // job is derived — see the note at the top of this file.
        { type: "number", name: "contractValue", required: false, min: 0 },
        // Plain text dates, not `date`: these are calendar days, and a
        // timestamp would drag a timezone into a start date that has none.
        { type: "text", name: "startDate", required: false, max: 10 },
        { type: "text", name: "targetCompletionDate", required: false, max: 10 },
        {
          type: "relation",
          name: "account",
          required: false,
          maxSelect: 1,
          collectionId: accounts.id,
          // Closing a client must not delete the buildings. A project keeps the
          // client's *name* in its own record for exactly this case.
          cascadeDelete: false,
        },
        // Site address, contract type, the people on it, permit number, notes.
        { type: "json", name: "details", required: false, maxSize: 131072 },
        ownerField(),
        sharedWithField(),
        created,
        updated,
      ],
      indexes: [
        // A project number identifies one job *per account*.
        "CREATE UNIQUE INDEX `idx_projects_owner_number` ON `projects` (`owner`, `number`)",
        "CREATE INDEX `idx_projects_owner_status` ON `projects` (`owner`, `status`)",
        "CREATE INDEX `idx_projects_account` ON `projects` (`account`)",
      ],
    });

    app.save(projects);

    /* ---------------------------- catalogue sources ------------------------- */

    const sources = new Collection({
      name: "catalog_sources",
      type: "base",
      ...sharedRules,
      fields: [
        idField,
        { type: "text", name: "name", required: true, min: 1, max: 200 },
        // csv | json
        { type: "text", name: "format", required: true, max: 10 },
        { type: "text", name: "url", required: false, max: 2000 },
        { type: "bool", name: "active", required: false },
        // Column mapping, sync policy, record path, description.
        { type: "json", name: "definition", required: false, maxSize: 262144 },
        // What the last run did. Kept on the source so the answer to "when did
        // this last run and what did it do" needs no second collection.
        { type: "json", name: "lastRun", required: false, maxSize: 16384 },
        ownerField(),
        sharedWithField(),
        created,
        updated,
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_catalog_sources_owner_name` ON `catalog_sources` (`owner`, `name`)",
      ],
    });

    app.save(sources);

    /* --------------------------- catalogue columns -------------------------- */

    // Queried on by the materials list, so real columns rather than JSON.
    products.fields.add(new Field({ type: "text", name: "costType", required: false, max: 20 }));
    products.fields.add(new Field({ type: "text", name: "division", required: false, max: 2 }));
    products.fields.add(new Field({ type: "text", name: "manufacturer", required: false, max: 200 }));
    products.indexes.push("CREATE INDEX `idx_products_owner_cost_type` ON `products` (`owner`, `costType`)");
    products.indexes.push("CREATE INDEX `idx_products_owner_division` ON `products` (`owner`, `division`)");
    app.save(products);

    /* ------------------------ the project on a document --------------------- */

    const projectRelation = () =>
      new Field({
        type: "relation",
        name: "project",
        required: false,
        maxSelect: 1,
        collectionId: projects.id,
        // Deleting a job must not delete what was billed for it. The money was
        // still owed.
        cascadeDelete: false,
      });

    quotes.fields.add(projectRelation());
    quotes.indexes.push("CREATE INDEX `idx_quotes_project` ON `quotes` (`project`)");
    app.save(quotes);

    invoices.fields.add(projectRelation());
    invoices.indexes.push("CREATE INDEX `idx_invoices_project` ON `invoices` (`project`)");
    app.save(invoices);
  },
  app => {
    // Down: the relations first, since they point at `projects`.
    const drop = (collection, fields, indexes) => {
      try {
        const found = app.findCollectionByNameOrId(collection);
        fields.forEach(name => found.fields.removeByName(name));
        found.indexes = found.indexes.filter(sql => !indexes.some(name => sql.indexOf(name) !== -1));
        app.save(found);
      } catch (err) {
        // Never created, or already gone.
      }
    };

    drop("quotes", ["project"], ["idx_quotes_project"]);
    drop("invoices", ["project"], ["idx_invoices_project"]);
    drop(
      "products",
      ["costType", "division", "manufacturer"],
      ["idx_products_owner_cost_type", "idx_products_owner_division"],
    );

    ["catalog_sources", "projects"].forEach(name => {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (err) {
        // Never created, or already dropped.
      }
    });
  },
);
