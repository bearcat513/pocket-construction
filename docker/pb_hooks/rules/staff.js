/// <reference path="../../pb_data/types.d.ts" />

/**
 * `staff` is granted, never claimed.
 *
 * The flag opens the company catalogue (see 1750000015_staff.js), and the
 * `users` rules let an account update its own record — which is how
 * preferences are saved. Without these hooks an account could register with
 * the flag already set, or set it on itself with an ordinary update. Both are
 * put back to what they were.
 *
 * lib/staff.js grants it by saving through the app rather than a request, so it
 * is untouched by this; so is setup/adopt.js. Superusers are left alone.
 */
module.exports.register = () => {
  onRecordCreateRequest(e => {
    if (!e.hasSuperuserAuth()) e.record.set("staff", false);
    e.next();
  }, "users");

  onRecordUpdateRequest(e => {
    if (!e.hasSuperuserAuth()) e.record.set("staff", e.record.original().get("staff"));
    e.next();
  }, "users");
};
