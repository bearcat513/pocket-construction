/// <reference path="../pb_data/types.d.ts" />

/**
 * Appointment booking: a visitor picks a time on the public website and books
 * a visit.
 *
 * - `booking_settings` — one row, id `booking`: whether booking is open, how
 *   long a visit is, the weekly hours and the days closed. Public to read,
 *   because the calendar is drawn from it; editors write it. Nobody creates or
 *   deletes it — it is seeded here, switched off.
 * - `appointments` — the visits. Like `contact_requests` they are the
 *   instance's, not an account's, so neither is in `OWNED`.
 *
 * ## Why nobody may create an appointment
 *
 * `createRule` is null, so not even an editor can create one through the
 * records API. Every booking goes through `POST /api/build/booking`
 * (pb_hooks/lib/booking.js), which checks for an overlapping visit and writes
 * the new one inside one transaction. A collection rule cannot do that — it
 * sees one record, never the others — and a check in the Bun server and a
 * write afterwards would let two visitors take the same slot at the same
 * moment. The busy times the calendar needs come through the hook too
 * (`GET /api/build/booking/busy`), as bare intervals: who booked them is not
 * public.
 *
 * `state` is empty for a booked visit, the way a contact request's status is
 * empty while new. Whether a booked visit is upcoming or over is the clock's
 * to say, not a column's (src/lib/booking.ts, `appointmentStanding`).
 */
migrate(
  app => {
    const EDITOR = "@request.auth.siteEditor = true";

    const stamps = () => [
      { type: "autodate", name: "created", onCreate: true, onUpdate: false },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ];

    const idField = () => ({
      type: "text",
      name: "id",
      system: true,
      primaryKey: true,
      required: true,
      min: 3,
      max: 40,
      pattern: "^[a-z0-9_]+$",
      autogeneratePattern: "[a-z0-9]{15}",
    });

    const settings = new Collection({
      name: "booking_settings",
      type: "base",
      listRule: "",
      viewRule: "",
      createRule: null,
      updateRule: EDITOR,
      deleteRule: null,
      fields: [
        idField(),
        { type: "bool", name: "enabled", required: false },
        { type: "text", name: "title", required: false, max: 120 },
        { type: "text", name: "description", required: false, max: 1000 },
        { type: "text", name: "timezone", required: true, max: 100 },
        // Real columns, because the booking hook reads these three.
        { type: "number", name: "durationMinutes", required: true, onlyInt: true, min: 15, max: 480 },
        { type: "number", name: "bufferMinutes", required: false, onlyInt: true, min: 0, max: 240 },
        { type: "number", name: "noticeHours", required: false, onlyInt: true, min: 0, max: 720 },
        { type: "number", name: "horizonDays", required: true, onlyInt: true, min: 1, max: 180 },
        // Read only by Bun (src/lib/booking.ts), never by a hook, so JSON is
        // safe here — see CLAUDE.md on JSON in the JSVM.
        { type: "json", name: "hours", required: false, maxSize: 4000 },
        { type: "json", name: "closedDates", required: false, maxSize: 10000 },
        ...stamps(),
      ],
    });
    app.save(settings);

    // Mirrors DEFAULT_BOOKING_SETTINGS in src/lib/booking.ts. Off until an
    // editor has looked at the hours and switched it on.
    const row = new Record(settings);
    row.set("id", "booking");
    row.set("enabled", false);
    row.set("title", "Free in-home estimate");
    row.set("description", "Pick a time and we’ll come out, look at the job and talk it through. No obligation.");
    row.set("timezone", "America/New_York");
    row.set("durationMinutes", 60);
    row.set("bufferMinutes", 30);
    row.set("noticeHours", 24);
    row.set("horizonDays", 30);
    row.set(
      "hours",
      [0, 1, 2, 3, 4, 5, 6].map(day => ({ open: day >= 1 && day <= 5, start: "09:00", end: "17:00" })),
    );
    row.set("closedDates", []);
    app.save(row);

    const appointments = new Collection({
      name: "appointments",
      type: "base",
      listRule: EDITOR,
      viewRule: EDITOR,
      createRule: null,
      updateRule: EDITOR,
      deleteRule: EDITOR,
      fields: [
        idField(),
        { type: "date", name: "start", required: true },
        { type: "date", name: "end", required: true },
        { type: "text", name: "firstName", required: true, max: 100 },
        { type: "text", name: "lastName", required: true, max: 100 },
        { type: "email", name: "email", required: true },
        { type: "text", name: "phone", required: true, max: 40 },
        { type: "text", name: "address", required: false, max: 300 },
        { type: "text", name: "notes", required: false, max: 2000 },
        // Empty means booked.
        { type: "select", name: "state", required: false, maxSelect: 1, values: ["completed", "cancelled", "no_show"] },
        ...stamps(),
      ],
      indexes: ["CREATE INDEX `idx_appointments_start` ON `appointments` (`start`)"],
    });
    app.save(appointments);
  },
  app => {
    for (const name of ["appointments", "booking_settings"]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // already gone
      }
    }
  },
);
