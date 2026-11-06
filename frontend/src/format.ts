import type { City, Unit } from "./types";

/** "2026-11-07" -> Date at UTC midnight so formatting never shifts the day. */
const isoDate = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`);

export const fmtWeekday = (iso: string) =>
  isoDate(iso).toLocaleDateString(undefined, { weekday: "long", timeZone: "UTC" });

export const fmtDayMonth = (iso: string) =>
  isoDate(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" });

export const fmtShortDate = (iso: string) =>
  isoDate(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export function fmtWeekendRange(sat: string, sun: string) {
  const a = isoDate(sat);
  const b = isoDate(sun);
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: "long", timeZone: "UTC" });
  const year = b.getUTCFullYear();
  return a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${month(b)} ${year}`
    : `${a.getUTCDate()} ${month(a)} – ${b.getUTCDate()} ${month(b)} ${year}`;
}

/** Wall-clock "HH:MM" from a naive local ISO string returned by Open-Meteo. */
export const fmtLocalClock = (naive: string) => {
  const [h, m] = naive.slice(11, 16).split(":").map(Number);
  return new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
};

export const fmtHour = (naive: string) => {
  const h = Number(naive.slice(11, 13));
  return new Date(Date.UTC(2000, 0, 1, h)).toLocaleTimeString(undefined, { hour: "numeric", timeZone: "UTC" });
};

export const fmtCityNow = (tz: string, now = new Date()) =>
  now.toLocaleString(undefined, { weekday: "long", hour: "numeric", minute: "2-digit", timeZone: tz });

export const fmtCityDate = (tz: string, now = new Date()) =>
  now.toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: tz });

export function fmtRetrieved(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export const temp = (c: number, unit: Unit) => Math.round(unit === "imperial" ? (c * 9) / 5 + 32 : c);
export const tempUnit = (unit: Unit) => (unit === "imperial" ? "°F" : "°C");
export const wind = (kmh: number, unit: Unit) =>
  unit === "imperial" ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`;
export const precip = (mm: number, unit: Unit) =>
  unit === "imperial" ? `${(mm / 25.4).toFixed(2)} in` : `${mm.toFixed(1)} mm`;
export const distance = (km: number, unit: Unit) =>
  unit === "imperial" ? `${(km * 0.621371).toFixed(1)} mi` : `${km.toFixed(1)} km`;

export function flag(code: string | null) {
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

export const regionLine = (c: City) => [c.admin1, c.country].filter(Boolean).join(", ");

export function compactPopulation(n: number | null) {
  if (!n) return null;
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export const appleMapsUrl = (name: string, lat: number, lon: number) =>
  `https://maps.apple.com/?q=${encodeURIComponent(name)}&ll=${lat},${lon}`;

export const hostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
