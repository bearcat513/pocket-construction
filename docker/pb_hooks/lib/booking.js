/**
 * Booking a visit, and the busy times the public calendar is drawn around.
 *
 * Both are anonymous by design — the visitor has no account — and both need
 * to read `appointments`, which only a website editor may. So they live here,
 * where the app's own authority does the reading, and they hand back only
 * what a stranger may know:
 *
 *   busy  — start and end of every visit not cancelled. Never who.
 *   book  — one new visit, refused if it comes within the buffer of another.
 *
 * `book` checks and writes inside one transaction. PocketBase serialises
 * transactions on its write connection, so two visitors clicking the same
 * slot at the same moment get one booking and one 409, never two bookings.
 *
 * Everything else about the time — opening hours, notice, horizon, closed
 * days, the slot grid — is checked by the Bun server with the same function
 * that drew the calendar (src/lib/booking.ts, `slotRefusal`), and is not
 * repeated here: two copies of the rules would drift. What this file
 * guarantees is the one thing only the database can: no two visits overlap.
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** The widest window `busy` answers for — a little past the longest horizon. */
const MAX_RANGE = 200 * DAY;

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const OVERLAP = "start < {:to} && end > {:from} && state != 'cancelled'";

/** PocketBase's own date format, which is what the columns compare against. */
function toPocketBaseDate(ms) {
  return new Date(ms).toISOString().replace("T", " ");
}

function toIso(value) {
  const parsed = Date.parse(String(value || "").replace(" ", "T"));
  return isNaN(parsed) ? "" : new Date(parsed).toISOString();
}

function instant(value) {
  const parsed = Date.parse(String(value || ""));
  return isNaN(parsed) ? null : parsed;
}

function body(e) {
  const info = e.requestInfo();
  return (info && info.body) || {};
}

function text(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function busy(e) {
  const query = e.request.url.query();
  const from = instant(query.get("from"));
  const to = instant(query.get("to"));
  if (from === null || to === null || to <= from) throw new BadRequestError("Send ?from= and ?to= as ISO instants.");
  if (to - from > MAX_RANGE) throw new BadRequestError("Ask for at most 200 days at a time.");

  let records;
  try {
    records = e.app.findRecordsByFilter("appointments", OVERLAP, "start", 5000, 0, {
      from: toPocketBaseDate(from),
      to: toPocketBaseDate(to),
    });
  } catch (err) {
    records = [];
  }

  const intervals = [];
  for (const record of records) {
    if (!record) continue;
    intervals.push({ start: toIso(record.getString("start")), end: toIso(record.getString("end")) });
  }
  return e.json(200, { busy: intervals });
}

function book(e) {
  const input = body(e);
  const start = instant(input.start);
  if (start === null) throw new BadRequestError("Choose a time from the calendar.");

  const fields = {
    firstName: text(input.firstName, 100),
    lastName: text(input.lastName, 100),
    email: text(input.email, 200).toLowerCase(),
    phone: text(input.phone, 40),
    address: text(input.address, 300),
    notes: text(input.notes, 2000),
  };
  if (!fields.firstName || !fields.lastName || !fields.email || !fields.phone) {
    throw new BadRequestError("A name, an email address and a phone number are required.");
  }

  // Decided inside the transaction, answered outside it: an error thrown in
  // there reaches the client as a generic failure rather than this sentence.
  let outcome = null;

  e.app.runInTransaction(tx => {
    let settings;
    try {
      settings = tx.findRecordById("booking_settings", "booking");
    } catch (err) {
      settings = null;
    }
    if (!settings || !settings.getBool("enabled")) {
      outcome = { status: 409, message: "Online booking is not open just now — please give us a call." };
      return;
    }
    if (start < Date.now()) {
      outcome = { status: 400, message: "That time has already passed. Please pick another." };
      return;
    }

    const end = start + settings.getInt("durationMinutes") * MINUTE;
    const buffer = settings.getInt("bufferMinutes") * MINUTE;

    const clash = tx.findRecordsByFilter("appointments", OVERLAP, "", 1, 0, {
      from: toPocketBaseDate(start - buffer),
      to: toPocketBaseDate(end + buffer),
    });
    if (clash.length) {
      outcome = { status: 409, message: "Somebody has just booked that time. Please pick another." };
      return;
    }

    const record = new Record(tx.findCollectionByNameOrId("appointments"));
    record.set("id", `apt_${$security.randomStringWithAlphabet(12, ID_ALPHABET)}`);
    record.set("start", toPocketBaseDate(start));
    record.set("end", toPocketBaseDate(end));
    for (const name in fields) record.set(name, fields[name]);
    tx.save(record);

    outcome = {
      status: 201,
      body: { id: record.id, start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    };
  });

  if (!outcome || outcome.status !== 201) {
    throw new ApiError(outcome ? outcome.status : 500, outcome ? outcome.message : "The booking could not be saved.");
  }
  return e.json(201, outcome.body);
}

module.exports = { busy, book, MAX_RANGE };
