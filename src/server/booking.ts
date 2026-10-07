/**
 * Appointment booking's storage, and the one check that needs the clock.
 *
 * Like the rest of the website it holds no credential. The settings are
 * public by rule and read anonymously; editors write them with their own
 * token. The busy times and the booking itself go through PocketBase's hook
 * routes (docker/pb_hooks/lib/booking.js), because only there can the
 * appointments be read without exposing who made them, and only there can
 * "is it free?" and "book it" happen as one step.
 *
 * The order on a booking is: the validator (is it a booking at all?), then
 * `slotRefusal` with the same function that drew the calendar (is it a time
 * we offer?), then the hook (is it still free, right now?). The first two
 * give the visitor a sentence; the last is the guarantee.
 */
import {
  APPOINTMENT_STATES,
  DEFAULT_BOOKING_SETTINGS,
  availableDays,
  bookingWindow,
  slotRefusal,
  type Appointment,
  type AppointmentState,
  type BookingAvailability,
  type BookingConfirmation,
  type BookingRequest,
  type BookingSettings,
  type BusyInterval,
} from "../lib/booking";
import { readBookingSettings as validateBookingSettings } from "../lib/validate";
import { readMany, readOne, remove, write } from "./db";
import { ApiError } from "./http";
import { toIso } from "./pocketbase";
import { relay } from "./share";
import { rateLimiter } from "./site";

type Row = Record<string, unknown>;

/** The one row `booking_settings` holds. */
const SETTINGS_ID = "booking";

/* -------------------------------- settings ------------------------------- */

/**
 * The stored row, read through the same validator a request body is, so a
 * row edited by hand in the dashboard into something odd is repaired on read
 * rather than drawn as a broken calendar.
 */
function toBookingSettings(row: Row | null): BookingSettings {
  if (!row) return DEFAULT_BOOKING_SETTINGS;
  const read = validateBookingSettings({
    ...row,
    hours: Array.isArray(row.hours) ? row.hours : undefined,
    closedDates: Array.isArray(row.closedDates) ? row.closedDates : [],
  });
  return read.ok ? read.value : { ...DEFAULT_BOOKING_SETTINGS, enabled: false };
}

export const readBookingSettings = async (token = ""): Promise<BookingSettings> =>
  toBookingSettings(await readOne(token, "booking_settings", SETTINGS_ID));

export async function saveBookingSettings(token: string, settings: BookingSettings): Promise<BookingSettings> {
  const row = await write(token, "booking_settings", SETTINGS_ID, { ...settings }, "Could not save the booking settings");
  if (!row) throw new ApiError("Only a website editor can change the booking settings.", 403);
  return toBookingSettings(row);
}

/* ------------------------------ availability ----------------------------- */

async function busyBetween(from: string, to: string): Promise<BusyInterval[]> {
  const search = new URLSearchParams({ from, to });
  const { busy } = await relay<{ busy: BusyInterval[] }>("", `/api/build/booking/busy?${search}`);
  return busy;
}

/** What the public calendar draws: the settings, and every free slot. */
export async function bookingAvailability(now = Date.now()): Promise<BookingAvailability> {
  const settings = await readBookingSettings();
  if (!settings.enabled) return { settings, days: [] };
  const { from, to } = bookingWindow(settings, now);
  return { settings, days: availableDays(settings, await busyBetween(from, to), now) };
}

/** A few bookings per sender per quarter hour — the contact form's brake. */
export const bookingAllowed = rateLimiter(5, 15 * 60 * 1000);

/** A visitor's booking. Anonymous, by design: they have no account. */
export async function bookAppointment(request: BookingRequest, now = Date.now()): Promise<BookingConfirmation> {
  const settings = await readBookingSettings();
  const { from, to } = bookingWindow(settings, now);
  const busy = settings.enabled ? await busyBetween(from, to) : [];

  const refusal = slotRefusal(settings, busy, now, request.start);
  if (refusal) throw new ApiError(refusal.message, refusal.code === "unavailable" ? 400 : 409);

  return relay<BookingConfirmation>("", "/api/build/booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
}

/* ------------------------------ appointments ----------------------------- */

function toAppointment(row: Row): Appointment {
  const state = String(row.state ?? "");
  return {
    id: String(row.id),
    start: toIso(row.start),
    end: toIso(row.end),
    firstName: String(row.firstName ?? ""),
    lastName: String(row.lastName ?? ""),
    email: String(row.email ?? ""),
    phone: String(row.phone ?? ""),
    address: String(row.address ?? ""),
    notes: String(row.notes ?? ""),
    // Stored empty while booked.
    state: (APPOINTMENT_STATES as readonly string[]).includes(state) ? (state as AppointmentState) : "booked",
    createdAt: toIso(row.created),
    updatedAt: toIso(row.updated),
  };
}

/** Every visit, soonest first. PocketBase refuses anyone but an editor. */
export const listAppointments = async (token: string): Promise<Appointment[]> =>
  (await readMany(token, "appointments", { limit: 0, sort: "start" })).map(toAppointment);

/**
 * Cancelling one frees its slot: the busy times leave cancelled visits out.
 * Putting a cancelled one back is not checked against what was booked since —
 * an editor may double-book on purpose, and the hook only polices strangers.
 */
export async function setAppointmentState(token: string, id: string, state: AppointmentState): Promise<Appointment | null> {
  const row = await write(token, "appointments", id, { state: state === "booked" ? "" : state }, "Could not update the appointment");
  return row ? toAppointment(row) : null;
}

export const deleteAppointment = (token: string, id: string) => remove(token, "appointments", id);
