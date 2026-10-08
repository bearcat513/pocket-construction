/// <reference path="../pb_data/types.d.ts" />

/**
 * One catalogue for the company, kept by its staff.
 *
 * Until now every account had its own catalogue, which is right for a
 * multi-tenant product and wrong for one contractor: two estimators pricing
 * the same job from two copies of the same price list is how a bid goes out
 * at last month's cost. The catalogue — `products` and the supplier feeds in
 * `catalog_sources` that keep it current — is now read and written by anyone
 * with `staff` on their account, and by nobody else.
 *
 * Sign-up stays open, which is why this is a flag rather than "every signed-in
 * account": a stranger who registers sees an empty catalogue and can change
 * none of it. `staff` is granted, never claimed — rules/staff.js strips it from
 * any request that tries to set it, and lib/staff.js is the only way an
 * account gets it after this: an existing staff member, signed in, turning it
 * on from Settings → Team.
 *
 * ## Who starts as staff
 *
 * The first account, and anyone who already edits the website — the same
 * people setup/adopt.js and 1750000012_website.js already trusted. Nobody
 * else is guessed at: owning a quote is not evidence of working here.
 *
 * ## The SKU
 *
 * A SKU used to be unique per owner. In one catalogue it has to be unique, full
 * stop — so the index changes, but only when the data allows it. Two accounts
 * that each created `PLY-34` before this would fail the new index and take the
 * migration down with them; in that case the old index stays, the clash is
 * logged, and the importer's own SKU check (which now sees every staff
 * member's items) keeps new duplicates out until somebody merges the two.
 */
migrate(
  app => {
    const STAFF = "@request.auth.staff = true";

    const users = app.findCollectionByNameOrId("users");
    if (!users.fields.getByName("staff")) {
      users.fields.add(new Field({ type: "bool", name: "staff", required: false }));
      app.save(users);
    }

    /*
     * Exported as a constant because src/server/migration.test.ts runs this
     * exact statement against a throwaway database.
     */
    const BACKFILL_STAFF = "UPDATE users SET staff = 1 WHERE siteEditor = 1 OR id = (SELECT id FROM users ORDER BY created ASC LIMIT 1)";

    app.db().newQuery(BACKFILL_STAFF).execute();

    for (const name of ["products", "catalog_sources"]) {
      const collection = app.findCollectionByNameOrId(name);
      collection.listRule = STAFF;
      collection.viewRule = STAFF;
      collection.createRule = STAFF;
      collection.updateRule = STAFF;
      collection.deleteRule = STAFF;
      app.save(collection);
    }

    const DUPLICATE_SKUS = "SELECT COUNT(*) AS n FROM (SELECT sku FROM products GROUP BY sku HAVING COUNT(*) > 1)";
    const duplicates = new DynamicModel({ n: 0 });
    app.db().newQuery(DUPLICATE_SKUS).one(duplicates);

    if (Number(duplicates.n) === 0) {
      const products = app.findCollectionByNameOrId("products");
      products.indexes = products.indexes.filter(sql => sql.indexOf("idx_products_owner_sku") === -1);
      products.indexes.push("CREATE UNIQUE INDEX `idx_products_sku` ON `products` (`sku`)");
      app.save(products);
    } else {
      console.log(
        `[migrate] ${duplicates.n} SKU(s) exist under more than one account; ` +
          "kept the per-account SKU index. Merge them, then make `sku` unique by hand.",
      );
    }
  },
  app => {
    // Down: back to one catalogue each. Nothing is moved between owners — an
    // item a colleague created stays theirs.
    const MINE = "owner = @request.auth.id";
    const SIGNED_IN = '@request.auth.id != ""';

    for (const name of ["products", "catalog_sources"]) {
      const collection = app.findCollectionByNameOrId(name);
      collection.listRule = name === "catalog_sources" ? `${MINE} || sharedWith.id ?= @request.auth.id` : MINE;
      collection.viewRule = collection.listRule;
      collection.createRule = SIGNED_IN;
      collection.updateRule = MINE;
      collection.deleteRule = MINE;
      app.save(collection);
    }

    const products = app.findCollectionByNameOrId("products");
    if (products.indexes.some(sql => sql.indexOf("idx_products_sku") !== -1)) {
      products.indexes = products.indexes.filter(sql => sql.indexOf("idx_products_sku") === -1);
      products.indexes.push("CREATE UNIQUE INDEX `idx_products_owner_sku` ON `products` (`owner`, `sku`)");
      app.save(products);
    }

    const users = app.findCollectionByNameOrId("users");
    if (users.fields.getByName("staff")) {
      users.fields.removeByName("staff");
      app.save(users);
    }
  },
);
