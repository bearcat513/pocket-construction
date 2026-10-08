/// <reference path="../../pb_data/types.d.ts" />

/**
 * `owner` and `sharedWith` are set here, never by the request body.
 *
 * The collection rules decide who may touch a record; these hooks decide what
 * the record says about itself. Without them a caller could create a record
 * already owned by someone else, or widen its share list by hand on an
 * ordinary update.
 *
 * Only *request* hooks are registered, so the sharing endpoints —
 * which save records directly through the app — are unaffected. Superusers are
 * left alone too: the dashboard, migrations and maintenance scripts are the
 * one place ownership is set by hand.
 */
const OWNED = [
  "accounts",
  "products",
  "proposal_templates",
  "projects",
  "catalog_sources",
  "quotes",
  "invoices",
  // A ledger row records who keyed it in. What it may do is decided by its
  // invoice's owner, in the collection rules — see 1750000007.
  "payments",
  "credits",
];

module.exports.register = () => {
  OWNED.forEach(collection => {
    onRecordCreateRequest(e => {
      if (e.hasSuperuserAuth()) return e.next();

      // The create rule already requires a token; this is the belt to its braces.
      if (!e.auth) throw new UnauthorizedError("Sign in to continue.");

      e.record.set("owner", e.auth.id);

      // Sharing is done afterwards, through /api/build/shares, which checks the
      // address resolves to a real account.
      if (e.record.collection().fields.getByName("sharedWith")) e.record.set("sharedWith", []);

      e.next();
    }, collection);
  });

  OWNED.forEach(collection => {
    onRecordUpdateRequest(e => {
      if (e.hasSuperuserAuth()) return e.next();

      const original = e.record.original();

      // A record cannot change hands, and the share list cannot be edited by
      // smuggling it into an update — both are restored to what they were.
      e.record.set("owner", original.get("owner"));
      if (e.record.collection().fields.getByName("sharedWith")) {
        e.record.set("sharedWith", original.get("sharedWith"));
      }

      e.next();
    }, collection);
  });
};
