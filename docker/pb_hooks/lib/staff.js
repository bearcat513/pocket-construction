/**
 * Who is on staff, and making somebody so.
 *
 * Staff keep the company catalogue (1750000015_staff.js). Granting it means
 * writing another account's `users` record, which no user token may do, so it
 * happens here — and only for a caller who is staff already. Like issuing an
 * API key, it takes a real sign-in: a leaked key that could make its holder's
 * friends staff would outlive being revoked.
 *
 * Nobody can take the flag off themselves. That is not modesty: it is what
 * guarantees the company always has at least one person who can grant it
 * back, without anyone having to open the PocketBase dashboard.
 *
 * A hook body cannot see its own file's scope, so every route registered in
 * staff/routes.js `require`s this module inside itself.
 */

/** Enough for a company; the same cap the directory uses. */
const MAX_RESULTS = 200;

function requireStaff(e) {
  if (e.auth.get("staff") !== true) {
    throw new ForbiddenError("Only staff can see or change who is on staff.");
  }
}

function describe(record) {
  return {
    id: record.id,
    email: record.email(),
    name: String(record.get("name") || ""),
    staff: record.get("staff") === true,
  };
}

/** Every account, staff first — the list Settings → Team draws. */
function list(e) {
  requireStaff(e);

  let records;
  try {
    records = e.app.findRecordsByFilter("users", "id != ''", "-staff,email", MAX_RESULTS, 0);
  } catch (err) {
    records = [];
  }

  const users = [];
  for (const record of records) if (record) users.push(describe(record));
  return e.json(200, { users: users, truncated: users.length >= MAX_RESULTS });
}

/** `{ staff: true|false }` for one account. */
function set(e) {
  if (e.request.header.get("X-Api-Key")) {
    throw new ForbiddenError("An API key cannot change who is on staff — sign in to do it.");
  }
  requireStaff(e);

  const body = new DynamicModel({ staff: false });
  try {
    e.bindBody(body);
  } catch (err) {
    throw new BadRequestError('Send { "staff": true } or { "staff": false }.');
  }
  const staff = body.staff === true;

  const id = e.request.pathValue("id");
  if (id === e.auth.id && !staff) {
    throw new BadRequestError("You can't take yourself off staff. Ask another staff member to do it.");
  }

  let record;
  try {
    record = e.app.findRecordById("users", id);
  } catch (err) {
    throw new NotFoundError("No account has that id.");
  }

  record.set("staff", staff);
  e.app.save(record);
  return e.json(200, describe(record));
}

module.exports = { list, set, MAX_RESULTS };
