import type { Activity, City, Restaurant, WeatherDay } from "./types";

export interface PlanEvent {
  id: string;
  date: string; // YYYY-MM-DD, city-local
  start: string; // HH:MM, city-local
  end: string;
  kind: "activity" | "dinner";
  place: Activity | Restaurant;
  marker: string; // label shown on the map pin and timeline
  note: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (h: number, m = 0) => `${pad(h)}:${pad(m)}`;

/**
 * Lay the picks out over the weekend:
 *  - an outdoor idea goes on the day with the better outdoor forecast,
 *    starting in that day's driest window when there is one;
 *  - an indoor idea takes the other day;
 *  - dinner is an early, family-friendly Saturday evening.
 */
export function buildPlan(
  weekend: { saturday: string; sunday: string },
  activities: Activity[],
  restaurant: Restaurant | null,
  days: WeatherDay[] | null,
): PlanEvent[] {
  const dates = [weekend.saturday, weekend.sunday];
  const byDate = new Map(days?.map((d) => [d.date, d]) ?? []);

  const outdoorDay = (() => {
    if (!days?.length) return weekend.saturday;
    const ranked = [...days].sort(
      (a, b) =>
        Number(b.assessment.outdoor_friendly) - Number(a.assessment.outdoor_friendly) ||
        (a.precip_probability ?? 0) - (b.precip_probability ?? 0),
    );
    return ranked[0].date;
  })();
  const otherDay = dates.find((d) => d !== outdoorDay) ?? weekend.sunday;

  const [a, b] = activities;
  const assignments: [Activity, string][] = [];
  if (a && b && a.indoor !== b.indoor) {
    const outdoor = a.indoor ? b : a;
    const indoor = a.indoor ? a : b;
    assignments.push([outdoor, outdoorDay], [indoor, otherDay]);
  } else {
    if (a) assignments.push([a, outdoorDay]);
    if (b) assignments.push([b, otherDay]);
  }

  const events: PlanEvent[] = assignments.map(([act, date], i) => {
    const day = byDate.get(date);
    let startH = 10;
    let note: string | null = act.indoor ? "Indoors, so the weather won’t matter." : null;
    if (!act.indoor && day?.best_window) {
      const w = Number(day.best_window.start.slice(11, 13));
      startH = Math.min(Math.max(w, 9), 14);
      note = windowHours(day.best_window) >= 10
        ? "Dry all day, so go whenever suits."
        : `Driest stretch: ${fmtClock(day.best_window.start.slice(11, 16))}–${fmtClock(day.best_window.end.slice(11, 16))}.`;
    } else if (!act.indoor && day && !day.assessment.outdoor_friendly) {
      note = "Not ideal outdoor weather. Keep a backup in mind.";
    }
    return {
      id: act.id,
      date,
      start: hhmm(startH),
      end: hhmm(startH + 3),
      kind: "activity",
      place: act,
      marker: String(i + 1),
      note,
    };
  });

  if (restaurant) {
    events.push({
      id: restaurant.id,
      date: weekend.saturday,
      start: "18:00",
      end: "19:30",
      kind: "dinner",
      place: restaurant,
      marker: String(events.length + 1),
      note: "An early table suits little ones. Book ahead if you can.",
    });
  }

  return events.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start)).map((e, i) => ({ ...e, marker: String(i + 1) }));
}

export const windowHours = (w: { start: string; end: string }) => Number(w.end.slice(11, 13)) - Number(w.start.slice(11, 13));

export function fmtClock(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

// --------------------------------------------------------------------------- iCalendar export

const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold lines at 75 octets as RFC 5545 requires. */
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let current = "";
  for (const ch of line) {
    if (new TextEncoder().encode(current + ch).length > (out.length ? 74 : 75)) {
      out.push(current);
      current = ch;
    } else current += ch;
  }
  out.push(current);
  return out.join("\r\n ");
}

const icsLocal = (date: string, time: string) => `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;

export function toICS(events: PlanEvent[], city: City): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Weekender//Weekend plan//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const e of events) {
    const p = e.place;
    const title = e.kind === "dinner" ? `Dinner at ${p.name}` : p.name;
    const desc = [p.why, e.note, p.source.url ? `Source: ${p.source.url}` : null, "Planned with Weekender. Check opening hours before you go."]
      .filter(Boolean)
      .join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id.replace(/[^\w.-]/g, "-")}-${e.date}@weekender`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${city.timezone}:${icsLocal(e.date, e.start)}`,
      `DTEND;TZID=${city.timezone}:${icsLocal(e.date, e.end)}`,
      `SUMMARY:${icsEscape(title)}`,
      `LOCATION:${icsEscape([p.name, p.address].filter(Boolean).join(", "))}`,
      `GEO:${p.latitude.toFixed(6)};${p.longitude.toFixed(6)}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      ...(p.source.url ? [`URL:${p.source.url}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function downloadICS(events: PlanEvent[], city: City) {
  const blob = new Blob([toICS(events, city)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `weekend-in-${city.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
