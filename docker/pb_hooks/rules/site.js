/// <reference path="../../pb_data/types.d.ts" />

/**
 * `siteEditor` is granted, never claimed.
 *
 * The flag decides who may change the public website (see
 * 1750000012_website.js), and the `users` rules let an account update its own
 * record — which is how preferences are saved. Without these hooks an account
 * could register with the flag already set, or set it on itself with an
 * ordinary update. Both are put back to what they were.
 *
 * The first account gets it from setup/adopt.js, which saves through the app
 * rather than a request, so it is untouched by this. Superusers are left alone:
 * the dashboard is where anyone else is made an editor.
 */
module.exports.register = () => {
  onRecordCreateRequest(e => {
    if (!e.hasSuperuserAuth()) e.record.set("siteEditor", false);
    e.next();
  }, "users");

  onRecordUpdateRequest(e => {
    if (!e.hasSuperuserAuth()) e.record.set("siteEditor", e.record.original().get("siteEditor"));
    e.next();
  }, "users");
};
