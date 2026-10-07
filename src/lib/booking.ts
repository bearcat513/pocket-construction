/**
 * Appointment booking: when a visitor may book a visit, and whether a time
 * they asked for is one of those.
 *
 * Pure, so the public page and the server run the same function — the page to
 * draw the calendar, the server to check the time somebody picked from it.
 * Never fork them: a calendar that offers a time the server then refuses is
 * the worst booking form there is.
 *
 * ## Time
 *
 * Opening hours are wall-clock times in the *business's* time zone, not the
 * visitor's and not the server's: "Tuesdays 8 to 5" means 8 to 5 in Cincinnati
 * whoever is looking and wherever the container runs. Every instant that
 * leaves this file is a UTC ISO string; every date and time *in* it is the
 * business's local one. `zonedTime` is the one bridge between the two, and it
 * uses `Intl` rather than a fixed offset, so a day after the clocks change is
 * still right.
 *
 * ## Slots
 *
 * A day's slots start at opening time and step by the visit's length plus the
 * buffer after it — the schedule a contractor doing site visits actually runs,
 * travel included. A slot is offered when it ends by closing time, starts
 * after the notice period, and comes no closer than the buffer to any visit
 * already booked. The buffer applies on both sides, so the PocketBase hook
 * that refuses a double booking (docker/pb_hooks/lib/booking.js) checks the
 * same overlap with the same arithmetic.
 *
 * Nothing about an appointment's standing is stored beyond its `state`: an
 * "upcoming" visit and one "awaiting an outcome" differ only in the clock, so
 * `appointmentStanding` derives it, the way receivables derive "overdue".
 */

/* --------------------------------- settings -------------------------------- */

/** One day's opening hours. Times are "HH:MM", local to the business. */
export type DayHours = { open: boolean; start: string; end: string };

export type BookingSettings = {
  /** Off by default: a fresh instance should not take bookings nobody set up. */
  enabled: boolean;
  /** What the visitor is booking — "Free in-home estimate". */
  title: string;
  description: string;
  /** IANA zone the hours are in. */
  timezone: string;
  durationMinutes: number;
  /** Kept free after each visit, for travel and overrun. */
  bufferMinutes: number;
  /** How far ahead a visit must be booked. */
  noticeHours: number;
  /** How far ahead the calendar reaches. */
  horizonDays: number;
  /** Seven entries, Sunday first — the way `Date.getDay` counts. */
  hours: DayHours[];
  /** "YYYY-MM-DD" days with no bookings at all: holidays, a week away. */
  closedDates: string[];
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export const BOOKING_LIMITS = {
  durationMinutes: { min: 15, max: 480 },
  bufferMinutes: { min: 0, max: 240 },
  noticeHours: { min: 0, max: 720 },
  horizonDays: { min: 1, max: 180 },
  title: 120,
  description: 1000,
  closedDates: 366,
} as const;

const weekdayHours = (start: string, end: string): DayHours[] =>
  WEEKDAYS.map((_, day) => ({ open: day >= 1 && day <= 5, start, end }));

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  enabled: false,
  title: "Free in-home estimate",
  description: "Pick a time and we’ll come out, look at the job and talk it through. No obligation.",
  timezone: "America/New_York",
  durationMinutes: 60,
  bufferMinutes: 30,
  noticeHours: 24,
  horizonDays: 30,
  hours: weekdayHours("09:00", "17:00"),
  closedDates: [],
};

/** "HH:MM", 00:00–23:59. */
export const isClockTime = (value: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function isTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/* ----------------------------------- time ---------------------------------- */

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const formatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(zone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, formatter);
  }
  return formatter;
}

/** The wall clock in `zone` at an instant, read as if it were UTC. */
function wallClock(instant: number, zone: string): number {
  const parts = Object.fromEntries(
    partsFormatter(zone)
      .formatToParts(new Date(instant))
      .map(part => [part.type, part.value]),
  );
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
}

const offsetAt = (instant: number, zone: string) => wallClock(instant, zone) - Math.floor(instant / 1000) * 1000;

/**
 * The instant a local date and time happen in `zone`.
 *
 * Two passes, because the offset to subtract is the one in force at the
 * answer, not at the guess — they differ only across a clock change, which is
 * exactly when it matters.
 */
export function zonedTime(date: string, time: string, zone: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naive = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const guess = naive - offsetAt(naive, zone);
  return naive - offsetAt(guess, zone);
}

/** The business's local date ("YYYY-MM-DD") and time ("HH:MM") at an instant. */
export function zonedParts(instant: number, zone: string): { date: string; time: string; weekday: number } {
  const iso = new Date(wallClock(instant, zone)).toISOString();
  const date = iso.slice(0, 10);
  return { date, time: iso.slice(11, 16), weekday: weekdayOf(date) };
}

export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/* ----------------------------------- slots --------------------------------- */

/** When somebody is already booked. Only the times — never who. */
export type BusyInterval = { start: string; end: string };

export type BookingSlot = {
  /** UTC instants. */
  start: string;
  end: string;
  /** "HH:MM", local to the business — what the button says. */
  time: string;
};

export type BookingDay = { date: string; slots: BookingSlot[] };

/** What `GET /api/site/booking` answers: the settings, and what is free. */
export type BookingAvailability = { settings: BookingSettings; days: BookingDay[] };

/** Busy intervals, widened by the buffer on both sides. */
const blockedBy = (busy: BusyInterval[], bufferMinutes: number): [number, number][] =>
  busy
    .map(entry => [Date.parse(entry.start) - bufferMinutes * MINUTE, Date.parse(entry.end) + bufferMinutes * MINUTE])
    .filter((pair): pair is [number, number] => pair.every(Number.isFinite));

const overlaps = (start: number, end: number, blocked: [number, number][]) =>
  blocked.some(([from, to]) => start < to && end > from);

/**
 * Every day with something free, from today to the horizon, each with its
 * free slots in order. A day with nothing free is left out — the calendar has
 * no use for it.
 */
export function availableDays(settings: BookingSettings, busy: BusyInterval[], now: number): BookingDay[] {
  if (!settings.enabled || !isTimeZone(settings.timezone)) return [];

  const zone = settings.timezone;
  const duration = settings.durationMinutes * MINUTE;
  const step = (settings.durationMinutes + settings.bufferMinutes) * MINUTE;
  if (duration <= 0 || step <= 0) return [];

  const earliest = now + settings.noticeHours * 60 * MINUTE;
  const blocked = blockedBy(busy, settings.bufferMinutes);
  const closed = new Set(settings.closedDates);
  const today = zonedParts(now, zone).date;

  const days: BookingDay[] = [];
  for (let offset = 0; offset <= settings.horizonDays; offset++) {
    const date = addDays(today, offset);
    const hours = settings.hours[weekdayOf(date)];
    if (closed.has(date) || !hours?.open || !isClockTime(hours.start) || !isClockTime(hours.end)) continue;

    const opens = zonedTime(date, hours.start, zone);
    const closes = zonedTime(date, hours.end, zone);
    const slots: BookingSlot[] = [];
    for (let start = opens; start + duration <= closes; start += step) {
      if (start < earliest || overlaps(start, start + duration, blocked)) continue;
      slots.push({
        start: new Date(start).toISOString(),
        end: new Date(start + duration).toISOString(),
        time: zonedParts(start, zone).time,
      });
    }
    if (slots.length) days.push({ date, slots });
  }
  return days;
}

/** The window `availableDays` could fill, for asking what is booked in it. */
export function bookingWindow(settings: BookingSettings, now: number): { from: string; to: string } {
  return {
    from: new Date(now - DAY).toISOString(),
    to: new Date(now + (settings.horizonDays + 2) * DAY).toISOString(),
  };
}

export type SlotRefusal = { code: "closed" | "taken" | "unavailable"; message: string };

/**
 * Why a requested start is not one the calendar offers — or null when it is.
 *
 * Decided by asking `availableDays` rather than by re-deriving its rules, so
 * the two can never disagree. The reasons are only there to word the answer.
 */
export function slotRefusal(
  settings: BookingSettings,
  busy: BusyInterval[],
  now: number,
  start: string,
): SlotRefusal | null {
  if (!settings.enabled) return { code: "closed", message: "Online booking is not open just now — please give us a call." };

  const at = Date.parse(start);
  if (!Number.isFinite(at)) return { code: "unavailable", message: "Choose a time from the calendar." };
  const iso = new Date(at).toISOString();

  if (availableDays(settings, busy, now).some(day => day.slots.some(slot => slot.start === iso))) return null;

  const end = at + settings.durationMinutes * MINUTE;
  if (at >= now && overlaps(at, end, blockedBy(busy, settings.bufferMinutes))) {
    return { code: "taken", message: "Somebody has just booked that time. Please pick another." };
  }
  return { code: "unavailable", message: "That time is not one we can offer. Please pick one from the calendar." };
}

/* -------------------------------- appointments ----------------------------- */

/**
 * The one stored fact about how a visit went. `booked` is stored as an empty
 * value, the way a contact request's "new" is.
 */
export const APPOINTMENT_STATES = ["booked", "completed", "cancelled", "no_show"] as const;
export type AppointmentState = (typeof APPOINTMENT_STATES)[number];

export const APPOINTMENT_STATE_LABELS: Record<AppointmentState, string> = {
  booked: "Booked",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export type Appointment = {
  id: string;
  start: string;
  end: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  /** Where the job is. */
  address: string;
  notes: string;
  state: AppointmentState;
  createdAt: string;
  updatedAt: string;
};

/** What a visitor sends. The end is the server's to work out. */
export type BookingRequest = {
  start: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
};

export const MAX_BOOKING_NOTES = 2_000;

/** The hidden field, as on the contact form — see CONTACT_HONEYPOT. */
export const BOOKING_HONEYPOT = "website";

/** What `POST /api/site/booking` answers. */
export type BookingConfirmation = { id: string; start: string; end: string };

/** Where a visit stands, derived from its state and the clock. */
export type AppointmentStanding = "upcoming" | "awaiting" | Exclude<AppointmentState, "booked">;

export function appointmentStanding(appointment: Pick<Appointment, "state" | "end">, now: number): AppointmentStanding {
  if (appointment.state !== "booked") return appointment.state;
  // Booked and over, with nobody saying how it went.
  return Date.parse(appointment.end) < now ? "awaiting" : "upcoming";
}

export const STANDING_LABELS: Record<AppointmentStanding, string> = {
  upcoming: "Upcoming",
  awaiting: "Needs an outcome",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/* --------------------------------- display --------------------------------- */

/** "Tuesday, October 7" for a local date, whatever zone the reader is in. */
export const formatBookingDate = (date: string, locale?: string, style: "long" | "short" = "long"): string =>
  new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    ...(style === "long" ? { weekday: "long", month: "long", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" }),
  }).format(new Date(`${date}T12:00:00Z`));

/** "9:30 AM" for an instant, on the business's clock. */
export const formatBookingTime = (instant: string, zone: string, locale?: string): string =>
  new Intl.DateTimeFormat(locale, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(instant));

/** "Eastern Daylight Time", for saying which clock the times are on. */
export function zoneName(zone: string, at: number, locale?: string): string {
  const part = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "long" })
    .formatToParts(new Date(at))
    .find(entry => entry.type === "timeZoneName");
  return part?.value ?? zone;
}

/* ----------------------------------- .ics ---------------------------------- */

const icsStamp = (instant: string) => new Date(instant).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const icsText = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** RFC 5545 folds lines at 75 octets; a continuation starts with a space. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const width = new TextEncoder().encode(char).length;
    if (size + width > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += width;
  }
  out.push(current);
  return out.join("\r\n ");
}

/** A one-event calendar file, so a visitor can put the visit in their own calendar. */
export function appointmentIcs(event: {
  id: string;
  start: string;
  end: string;
  title: string;
  description?: string;
  location?: string;
  now?: number;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//sitelines//booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@sitelines`,
    `DTSTAMP:${icsStamp(new Date(event.now ?? Date.now()).toISOString())}`,
    `DTSTART:${icsStamp(event.start)}`,
    `DTEND:${icsStamp(event.end)}`,
    `SUMMARY:${icsText(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${icsText(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${icsText(event.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/* ---------------------------------- embed ---------------------------------- */

/** Where the bare booking calendar lives, for an iframe on another site. */
export const BOOKING_EMBED_PATH = "/book";

/** The message the embedded calendar posts to its parent when its height changes. */
export const BOOKING_HEIGHT_MESSAGE = "sitelines:booking-height";

/**
 * What to paste into another website: the iframe, and a few lines that let it
 * grow with the calendar instead of scrolling inside a box. The listener only
 * believes messages from this origin.
 */
export function bookingEmbedSnippet(origin: string): string {
  const src = `${origin}${BOOKING_EMBED_PATH}`;
  return [
    `<iframe id="sitelines-booking" src="${src}" title="Book an appointment" loading="lazy"`,
    `  style="width:100%;height:640px;border:0;"></iframe>`,
    `<script>`,
    `  window.addEventListener("message", function (event) {`,
    `    if (event.origin !== ${JSON.stringify(origin)} || !event.data || event.data.type !== ${JSON.stringify(BOOKING_HEIGHT_MESSAGE)}) return;`,
    `    document.getElementById("sitelines-booking").style.height = event.data.height + "px";`,
    `  });`,
    `</script>`,
  ].join("\n");
}
