import { describe, expect, it } from "vitest";
import {
  getLocalDate,
  getLocalHour,
  localDatetimeToUtcMs,
  getLocalDateBoundsUtc,
} from "./dailySummary";

// ─── localDatetimeToUtcMs ─────────────────────────────────────────────────────

describe("localDatetimeToUtcMs", () => {
  it("Asia/Kolkata midnight → UTC-5:30 hours", () => {
    const utcMs = localDatetimeToUtcMs("2026-09-14", "00:00:00", "Asia/Kolkata");
    expect(new Date(utcMs).toISOString()).toBe("2026-09-13T18:30:00.000Z");
  });

  it("Asia/Kolkata end of day 23:59:59.999 → UTC", () => {
    const utcMs = localDatetimeToUtcMs("2026-09-14", "23:59:59", "Asia/Kolkata", 999);
    expect(new Date(utcMs).toISOString()).toBe("2026-09-14T18:29:59.999Z");
  });

  it("America/New_York midnight September (EDT, UTC-4)", () => {
    // September 2026: EDT in effect (UTC-4)
    const utcMs = localDatetimeToUtcMs("2026-09-14", "00:00:00", "America/New_York");
    expect(new Date(utcMs).toISOString()).toBe("2026-09-14T04:00:00.000Z");
  });

  it("America/New_York midnight January (EST, UTC-5)", () => {
    const utcMs = localDatetimeToUtcMs("2026-01-14", "00:00:00", "America/New_York");
    expect(new Date(utcMs).toISOString()).toBe("2026-01-14T05:00:00.000Z");
  });

  it("America/New_York midnight July (EDT, UTC-4)", () => {
    const utcMs = localDatetimeToUtcMs("2026-07-14", "00:00:00", "America/New_York");
    expect(new Date(utcMs).toISOString()).toBe("2026-07-14T04:00:00.000Z");
  });

  it("Europe/London winter (GMT, UTC+0)", () => {
    const utcMs = localDatetimeToUtcMs("2026-01-14", "00:00:00", "Europe/London");
    expect(new Date(utcMs).toISOString()).toBe("2026-01-14T00:00:00.000Z");
  });

  it("Europe/London summer (BST, UTC+1)", () => {
    const utcMs = localDatetimeToUtcMs("2026-07-14", "00:00:00", "Europe/London");
    expect(new Date(utcMs).toISOString()).toBe("2026-07-13T23:00:00.000Z");
  });

  it("Asia/Singapore midnight (SGT, UTC+8, no DST)", () => {
    const utcMs = localDatetimeToUtcMs("2026-09-14", "00:00:00", "Asia/Singapore");
    expect(new Date(utcMs).toISOString()).toBe("2026-09-13T16:00:00.000Z");
  });

  it("Australia/Sydney midnight September (AEST, UTC+10, before DST)", () => {
    // In September, Sydney is still on AEST (UTC+10); DST starts first Sun of Oct
    const utcMs = localDatetimeToUtcMs("2026-09-14", "00:00:00", "Australia/Sydney");
    expect(new Date(utcMs).toISOString()).toBe("2026-09-13T14:00:00.000Z");
  });

  it("Australia/Sydney midnight January (AEDT, UTC+11, DST active)", () => {
    const utcMs = localDatetimeToUtcMs("2026-01-14", "00:00:00", "Australia/Sydney");
    expect(new Date(utcMs).toISOString()).toBe("2026-01-13T13:00:00.000Z");
  });

  // DST transition: America/New_York spring-forward 2026-03-08 02:00→03:00
  it("America/New_York: 23:00 on spring-forward night (EDT after transition)", () => {
    // At 23:00 local on 2026-03-08, clocks already sprung forward at 2AM → EDT (UTC-4)
    const utcMs = localDatetimeToUtcMs("2026-03-08", "23:00:00", "America/New_York");
    expect(new Date(utcMs).toISOString()).toBe("2026-03-09T03:00:00.000Z");
  });

  // DST transition: America/New_York fall-back 2026-11-01 02:00→01:00
  it("America/New_York: 23:00 on fall-back night (EST after transition)", () => {
    // At 23:00 local on 2026-11-01, clocks already fell back at 2AM → EST (UTC-5)
    const utcMs = localDatetimeToUtcMs("2026-11-01", "23:00:00", "America/New_York");
    expect(new Date(utcMs).toISOString()).toBe("2026-11-02T04:00:00.000Z");
  });
});

// ─── getLocalDateBoundsUtc ────────────────────────────────────────────────────

describe("getLocalDateBoundsUtc", () => {
  it("IST: bounds cover exactly Sep 14 IST", () => {
    const { start, end } = getLocalDateBoundsUtc("2026-09-14", "Asia/Kolkata");
    expect(start).toBe("2026-09-13T18:30:00.000Z");
    expect(end).toBe("2026-09-14T18:29:59.999Z");
  });

  it("UTC: bounds are identity (00:00:00Z → 23:59:59.999Z)", () => {
    const { start, end } = getLocalDateBoundsUtc("2026-09-14", "UTC");
    expect(start).toBe("2026-09-14T00:00:00.000Z");
    expect(end).toBe("2026-09-14T23:59:59.999Z");
  });

  it("America/New_York (EDT): bounds for Sep 14 local", () => {
    const { start, end } = getLocalDateBoundsUtc("2026-09-14", "America/New_York");
    expect(start).toBe("2026-09-14T04:00:00.000Z");
    expect(end).toBe("2026-09-15T03:59:59.999Z");
  });
});

// ─── getLocalDate ─────────────────────────────────────────────────────────────

describe("getLocalDate", () => {
  it("IST: 23:59:59 IST on Sep 14 → local date is 2026-09-14", () => {
    // 23:59:59 IST = 18:29:59 UTC on Sep 14
    const now = new Date("2026-09-14T18:29:59.000Z");
    expect(getLocalDate("Asia/Kolkata", now)).toBe("2026-09-14");
  });

  it("IST: midnight IST (18:30 UTC Sep 13) → local date is 2026-09-14", () => {
    const now = new Date("2026-09-13T18:30:00.000Z");
    expect(getLocalDate("Asia/Kolkata", now)).toBe("2026-09-14");
  });

  it("IST: 18:29:59 UTC Sep 13 (23:59:59 IST Sep 13) → still Sep 13 IST", () => {
    const now = new Date("2026-09-13T18:29:59.000Z");
    expect(getLocalDate("Asia/Kolkata", now)).toBe("2026-09-13");
  });

  it("America/New_York (EDT): 04:00 UTC Sep 14 = midnight EST → Sep 14", () => {
    const now = new Date("2026-09-14T04:00:00.000Z");
    expect(getLocalDate("America/New_York", now)).toBe("2026-09-14");
  });

  it("America/New_York (EDT): 03:59:59 UTC Sep 14 = 23:59:59 Sep 13 EDT → Sep 13", () => {
    const now = new Date("2026-09-14T03:59:59.000Z");
    expect(getLocalDate("America/New_York", now)).toBe("2026-09-13");
  });

  it("Europe/London (BST): 23:00 UTC Jul 14 = midnight Jul 15 BST → Jul 15", () => {
    const now = new Date("2026-07-14T23:00:00.000Z");
    expect(getLocalDate("Europe/London", now)).toBe("2026-07-15");
  });

  it("Asia/Singapore: 15:59:59 UTC Sep 13 = 23:59:59 Sep 13 SGT → Sep 13", () => {
    const now = new Date("2026-09-13T15:59:59.000Z");
    expect(getLocalDate("Asia/Singapore", now)).toBe("2026-09-13");
  });

  it("Asia/Singapore: 16:00:00 UTC Sep 13 = 00:00:00 Sep 14 SGT → Sep 14", () => {
    const now = new Date("2026-09-13T16:00:00.000Z");
    expect(getLocalDate("Asia/Singapore", now)).toBe("2026-09-14");
  });
});

// ─── getLocalHour ─────────────────────────────────────────────────────────────

describe("getLocalHour — delivery window (hour 23 = should send)", () => {
  // IST = UTC+5:30; hour 23 local = 17:30 UTC
  it("Asia/Kolkata: 17:30 UTC → hour 23 IST → should send", () => {
    const now = new Date("2026-09-14T17:30:00.000Z");
    expect(getLocalHour("Asia/Kolkata", now)).toBe(23);
  });

  it("Asia/Kolkata: 18:00 UTC → hour 23 IST → should send", () => {
    const now = new Date("2026-09-14T18:00:00.000Z");
    expect(getLocalHour("Asia/Kolkata", now)).toBe(23);
  });

  it("Asia/Kolkata: 18:29 UTC → hour 23 IST → should send", () => {
    const now = new Date("2026-09-14T18:29:00.000Z");
    expect(getLocalHour("Asia/Kolkata", now)).toBe(23);
  });

  it("Asia/Kolkata: 18:30 UTC → hour 0 IST (midnight) → should NOT send", () => {
    const now = new Date("2026-09-14T18:30:00.000Z");
    expect(getLocalHour("Asia/Kolkata", now)).toBe(0);
  });

  it("Asia/Kolkata: 17:29 UTC → hour 22 IST → should NOT send", () => {
    const now = new Date("2026-09-14T17:29:00.000Z");
    expect(getLocalHour("Asia/Kolkata", now)).toBe(22);
  });

  // America/New_York September = EDT (UTC-4); hour 23 local = 03:00 UTC next day
  it("America/New_York (EDT): 03:00 UTC → hour 23 EDT → should send", () => {
    const now = new Date("2026-09-15T03:00:00.000Z");
    expect(getLocalHour("America/New_York", now)).toBe(23);
  });

  it("America/New_York (EDT): 03:59 UTC → hour 23 EDT → should send", () => {
    const now = new Date("2026-09-15T03:59:00.000Z");
    expect(getLocalHour("America/New_York", now)).toBe(23);
  });

  it("America/New_York (EDT): 04:00 UTC → hour 0 EDT (midnight) → should NOT send", () => {
    const now = new Date("2026-09-15T04:00:00.000Z");
    expect(getLocalHour("America/New_York", now)).toBe(0);
  });

  // America/New_York January = EST (UTC-5); hour 23 = 04:00 UTC next day
  it("America/New_York (EST): 04:00 UTC Jan → hour 23 EST → should send", () => {
    const now = new Date("2026-01-15T04:00:00.000Z");
    expect(getLocalHour("America/New_York", now)).toBe(23);
  });

  // Europe/London GMT (winter); hour 23 = 23:00 UTC
  it("Europe/London (GMT): 23:00 UTC → hour 23 → should send", () => {
    const now = new Date("2026-01-14T23:00:00.000Z");
    expect(getLocalHour("Europe/London", now)).toBe(23);
  });

  // Europe/London BST (summer, UTC+1); hour 23 = 22:00 UTC
  it("Europe/London (BST): 22:00 UTC → hour 23 BST → should send", () => {
    const now = new Date("2026-07-14T22:00:00.000Z");
    expect(getLocalHour("Europe/London", now)).toBe(23);
  });

  // Asia/Singapore (SGT = UTC+8, no DST); hour 23 = 15:00 UTC
  it("Asia/Singapore: 15:00 UTC → hour 23 SGT → should send", () => {
    const now = new Date("2026-09-14T15:00:00.000Z");
    expect(getLocalHour("Asia/Singapore", now)).toBe(23);
  });

  it("Asia/Singapore: 15:59 UTC → hour 23 SGT → should send", () => {
    const now = new Date("2026-09-14T15:59:00.000Z");
    expect(getLocalHour("Asia/Singapore", now)).toBe(23);
  });

  it("Asia/Singapore: 16:00 UTC → hour 0 SGT (midnight) → should NOT send", () => {
    const now = new Date("2026-09-14T16:00:00.000Z");
    expect(getLocalHour("Asia/Singapore", now)).toBe(0);
  });

  // Australia/Sydney September = AEST (UTC+10); hour 23 = 13:00 UTC
  it("Australia/Sydney (AEST): 13:00 UTC → hour 23 AEST → should send", () => {
    const now = new Date("2026-09-14T13:00:00.000Z");
    expect(getLocalHour("Australia/Sydney", now)).toBe(23);
  });

  // Australia/Sydney January = AEDT (UTC+11); hour 23 = 12:00 UTC
  it("Australia/Sydney (AEDT): 12:00 UTC → hour 23 AEDT → should send", () => {
    const now = new Date("2026-01-14T12:00:00.000Z");
    expect(getLocalHour("Australia/Sydney", now)).toBe(23);
  });

  // Midnight edge case: hour 0 is correctly not hour 23
  it("UTC midnight (00:00) is hour 0, not 24", () => {
    const now = new Date("2026-09-14T00:00:00.000Z");
    expect(getLocalHour("UTC", now)).toBe(0);
  });

  // DST: spring-forward for America/New_York on 2026-03-08 02:00 → 03:00
  // After spring-forward: 23:00 EDT = 03:00 UTC (UTC-4)
  it("America/New_York: 03:00 UTC on spring-forward day → hour 23 EDT → should send", () => {
    const now = new Date("2026-03-09T03:00:00.000Z");
    expect(getLocalHour("America/New_York", now)).toBe(23);
  });

  // DST: fall-back for America/New_York on 2026-11-01 02:00 → 01:00
  // After fall-back: 23:00 EST = 04:00 UTC (UTC-5)
  it("America/New_York: 04:00 UTC on fall-back day → hour 23 EST → should send", () => {
    const now = new Date("2026-11-02T04:00:00.000Z");
    expect(getLocalHour("America/New_York", now)).toBe(23);
  });
});
