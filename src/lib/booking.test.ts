import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BOOKING_SETTINGS,
  addDays,
  appointmentIcs,
  appointmentStanding,
  availableDays,
  bookingEmbedSnippet,
  slotRefusal,
  zonedParts,
  zonedTime,
  type BookingSettings,
} from "./booking";

const ZONE = "America/New_York";

/** Open, 9 to 5 weekdays, hour visits with half an hour between, no notice. */
const settings = (patch: Partial<BookingSettings> = {}): BookingSettings => ({
  ...DEFAULT_BOOKING_SETTINGS,
  enabled: true,
  timezone: ZONE,
  noticeHours: 0,
  horizonDays: 6,
  ...patch,
});

// Monday 6 October 2025, 7am in New York (EDT, UTC-4).
const MONDAY_7AM = Date.parse("2025-10-06T11:00:00Z");

describe("the business's clock", () => {
  test("turns a local time into the right instant on both sides of a clock change", () => {
    expect(new Date(zonedTime("2025-10-06", "09:00", ZONE)).toISOString()).toBe("2025-10-06T13:00:00.000Z");
    // After the clocks go back on 2 November, 9am is an hour later in UTC.
    expect(new Date(zonedTime("2025-11-03", "09:00", ZONE)).toISOString()).toBe("2025-11-03T14:00:00.000Z");
    expect(new Date(zonedTime("2025-03-10", "09:00", ZONE)).toISOString()).toBe("2025-03-10T13:00:00.000Z");
  });

  test("reads an instant back as a local date, time and weekday", () => {
    // 3am UTC on the 7th is still the evening of Monday the 6th in New York.
    expect(zonedParts(Date.parse("2025-10-07T03:00:00Z"), ZONE)).toEqual({ date: "2025-10-06", time: "23:00", weekday: 1 });
  });

  test("steps over month ends", () => {
    expect(addDays("2025-10-31", 1)).toBe("2025-11-01");
  });
});

describe("the calendar", () => {
  test("steps by the visit plus the buffer, and nothing runs past closing", () => {
    const [monday] = availableDays(settings(), [], MONDAY_7AM);
    expect(monday!.date).toBe("2025-10-06");
    expect(monday!.slots.map(slot => slot.time)).toEqual(["09:00", "10:30", "12:00", "13:30", "15:00"]);
    expect(monday!.slots[0]).toMatchObject({ start: "2025-10-06T13:00:00.000Z", end: "2025-10-06T14:00:00.000Z" });
  });

  test("skips the weekend, closed dates, and the days past the horizon", () => {
    const days = availableDays(settings({ closedDates: ["2025-10-08"] }), [], MONDAY_7AM);
    // Mon 6 … Sun 12: the 8th is closed and the weekend is shut.
    expect(days.map(day => day.date)).toEqual(["2025-10-06", "2025-10-07", "2025-10-09", "2025-10-10"]);
  });

  test("holds back the notice period", () => {
    const [first] = availableDays(settings({ noticeHours: 4 }), [], MONDAY_7AM);
    // 7am plus four hours is 11am; 10:30 is too soon, noon is not.
    expect(first!.slots[0]!.time).toBe("12:00");
  });

  test("keeps the buffer clear on both sides of a visit already booked", () => {
    const busy = [{ start: "2025-10-06T16:00:00Z", end: "2025-10-06T17:00:00Z" }]; // noon–1pm local
    const [monday] = availableDays(settings(), busy, MONDAY_7AM);
    // 10:30–11:30 ends exactly where the buffer before noon starts, so it stays.
    expect(monday!.slots.map(slot => slot.time)).toEqual(["09:00", "10:30", "13:30", "15:00"]);

    const tight = availableDays(settings(), [{ start: "2025-10-06T15:45:00Z", end: "2025-10-06T16:15:00Z" }], MONDAY_7AM);
    // 11:45–12:15 local, plus half an hour each side, reaches back into 10:30–11:30.
    expect(tight[0]!.slots.map(slot => slot.time)).toEqual(["09:00", "13:30", "15:00"]);
  });

  test("is empty while booking is switched off, or the zone is nonsense", () => {
    expect(availableDays(settings({ enabled: false }), [], MONDAY_7AM)).toEqual([]);
    expect(availableDays(settings({ timezone: "Mars/Olympus" }), [], MONDAY_7AM)).toEqual([]);
  });
});

describe("checking a requested time", () => {
  test("accepts exactly what the calendar offers", () => {
    expect(slotRefusal(settings(), [], MONDAY_7AM, "2025-10-06T13:00:00.000Z")).toBeNull();
    // The same instant written another way is the same slot.
    expect(slotRefusal(settings(), [], MONDAY_7AM, "2025-10-06T09:00:00-04:00")).toBeNull();
  });

  test("says why it refuses", () => {
    expect(slotRefusal(settings({ enabled: false }), [], MONDAY_7AM, "2025-10-06T13:00:00Z")?.code).toBe("closed");
    expect(slotRefusal(settings(), [], MONDAY_7AM, "not a time")?.code).toBe("unavailable");
    // Off the grid, in the past, on a Saturday.
    expect(slotRefusal(settings(), [], MONDAY_7AM, "2025-10-06T13:15:00Z")?.code).toBe("unavailable");
    expect(slotRefusal(settings(), [], MONDAY_7AM, "2025-10-03T13:00:00Z")?.code).toBe("unavailable");
    expect(slotRefusal(settings(), [], MONDAY_7AM, "2025-10-11T13:00:00Z")?.code).toBe("unavailable");

    const busy = [{ start: "2025-10-06T13:00:00Z", end: "2025-10-06T14:00:00Z" }];
    expect(slotRefusal(settings(), busy, MONDAY_7AM, "2025-10-06T13:00:00Z")?.code).toBe("taken");
  });
});

describe("an appointment's standing", () => {
  test("is derived from the clock until somebody records an outcome", () => {
    const visit = { end: "2025-10-06T14:00:00Z" };
    expect(appointmentStanding({ ...visit, state: "booked" }, MONDAY_7AM)).toBe("upcoming");
    expect(appointmentStanding({ ...visit, state: "booked" }, Date.parse("2025-10-06T15:00:00Z"))).toBe("awaiting");
    expect(appointmentStanding({ ...visit, state: "cancelled" }, MONDAY_7AM)).toBe("cancelled");
  });
});

describe("the calendar file", () => {
  test("is UTC, escaped and folded", () => {
    const ics = appointmentIcs({
      id: "apt_1",
      start: "2025-10-06T13:00:00.000Z",
      end: "2025-10-06T14:00:00.000Z",
      title: "Estimate; kitchen, maybe",
      description: "Line one\nLine two " + "x".repeat(100),
      now: MONDAY_7AM,
    });
    expect(ics).toContain("DTSTART:20251006T130000Z\r\n");
    expect(ics).toContain("SUMMARY:Estimate\\; kitchen\\, maybe\r\n");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two");
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("the embed snippet", () => {
  test("points at this server and only listens to it", () => {
    const snippet = bookingEmbedSnippet("https://jobs.example.com");
    expect(snippet).toContain('src="https://jobs.example.com/book"');
    expect(snippet).toContain('event.origin !== "https://jobs.example.com"');
  });
});
