export interface City {
  id: number;
  name: string;
  admin1: string | null;
  admin2: string | null;
  country: string | null;
  country_code: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  population: number | null;
}

export interface Overview {
  city: City;
  local_time: string;
  weekend: { saturday: string; sunday: string };
}

export type WeatherIconKey = "clear" | "partly" | "cloudy" | "fog" | "drizzle" | "rain" | "snow" | "storm";

export interface HourPoint {
  time: string;
  temp: number;
  precip_probability: number | null;
  icon: WeatherIconKey;
}

export interface WeatherDay {
  date: string;
  code: number;
  condition: string;
  icon: WeatherIconKey;
  temp_max: number;
  temp_min: number;
  precip_sum: number | null;
  precip_probability: number | null;
  wind_max: number | null;
  uv_max: number | null;
  sunrise: string;
  sunset: string;
  hourly: HourPoint[];
  best_window: { start: string; end: string } | null;
  uv_note: string | null;
  assessment: { wet: boolean; cold: boolean; hot: boolean; outdoor_friendly: boolean };
}

export interface SourceInfo {
  name: string;
  url: string | null;
  license?: string;
  retrieved_at?: string;
  cached?: boolean;
  stale?: boolean;
}

export interface Weather {
  days: WeatherDay[];
  units: { temperature: string; precipitation: string; wind: string };
  source: SourceInfo;
}

export interface Attempt {
  provider: string;
  ok: boolean;
  detail: string;
}

export interface Photo {
  url: string;
  width: number | null;
  height: number | null;
  credit: string;
  license: string | null;
  page: string | null;
}

export interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  distance_km: number | null;
  address: string | null;
  website: string | null;
  opening_hours: string | null;
  phone?: string | null;
  rating?: number | null;
  rating_count?: number;
  source: SourceInfo;
  why: string;
  photo?: Photo | null;
}

export interface Activity extends Place {
  category: string;
  category_label: string;
  indoor: boolean;
  icon: string;
  weather_note: string | null;
}

export interface Restaurant extends Place {
  cuisine: string | null;
  cuisine_kind: "italian" | "pizza";
}

interface PlacesMeta {
  status: "ok" | "none_found";
  retrieved_at: string;
  cached: boolean;
  stale?: boolean;
  attempts: Attempt[];
}

export interface Activities extends PlacesMeta {
  items: Activity[];
  alternates: Activity[];
  weather_summary: string | null;
  weather_considered: boolean;
}

export interface Dining extends PlacesMeta {
  item: Restaurant | null;
  alternates: Restaurant[];
}

export type Unit = "metric" | "imperial";
