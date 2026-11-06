import type { City } from "./types";

/** Recently viewed cities, kept on this device only. */
const KEY = "recent-cities";
const MAX = 5;

export type RecentCity = Pick<City, "id" | "name" | "admin1" | "country" | "country_code">;

export function loadRecent(): RecentCity[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c?.id === "number" && typeof c?.name === "string").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberCity(c: City) {
  try {
    const entry: RecentCity = { id: c.id, name: c.name, admin1: c.admin1, country: c.country, country_code: c.country_code };
    const next = [entry, ...loadRecent().filter((r) => r.id !== c.id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: recents are a nicety */
  }
}
