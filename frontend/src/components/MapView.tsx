import { MapPinned } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, Marker } from "maplibre-gl";

export interface MapPoint {
  id: string;
  label: string;
  title: string;
  kind: "activity" | "dinner";
  lat: number;
  lon: number;
}

const STYLE = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

const isDark = () => document.documentElement.dataset.theme === "dark" ||
  (!document.documentElement.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);

/**
 * Vector map with numbered pins. MapLibre (~200 kB gzipped) is loaded only
 * when the map is about to scroll into view.
 */
export function MapView({ points, center, active, onSelect }: {
  points: MapPoint[];
  center: [number, number];
  active: string | null;
  onSelect: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const markers = useRef<Map<string, Marker>>(new Map());
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Create the map once it's near the viewport.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let cancelled = false;
    const io = new IntersectionObserver(async ([entry]) => {
      if (!entry.isIntersecting) return;
      io.disconnect();
      try {
        const [{ default: maplibregl }] = await Promise.all([import("maplibre-gl"), import("maplibre-gl/dist/maplibre-gl.css")]);
        if (cancelled) return;
        const m = new maplibregl.Map({
          container: el,
          style: isDark() ? STYLE.dark : STYLE.light,
          center: [center[1], center[0]],
          zoom: 11,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        m.on("error", (e) => console.warn("map:", e.error?.message));
        m.once("load", () => !cancelled && setReady(true));
        map.current = m;
        lib.current = maplibregl;
      } catch {
        setFailed(true);
      }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => {
      cancelled = true;
      io.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, [center]);

  // Follow the light/dark toggle.
  useEffect(() => {
    if (!ready) return;
    const sync = () => map.current?.setStyle(isDark() ? STYLE.dark : STYLE.light);
    const obs = new MutationObserver(sync);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", sync);
    return () => {
      obs.disconnect();
      mq.removeEventListener("change", sync);
    };
  }, [ready]);

  // (Re)draw pins and frame them.
  useEffect(() => {
    const m = map.current;
    const ml = lib.current;
    if (!ready || !m || !ml) return;
    markers.current.forEach((mk) => mk.remove());
    markers.current.clear();
    if (!points.length) return;
    const bounds = new ml.LngLatBounds();
    points.forEach((p) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = `pin pin--${p.kind}`;
      el.textContent = p.label;
      el.setAttribute("aria-label", `${p.label}. ${p.title}`);
      el.addEventListener("click", () => onSelect(p.id));
      const mk = new ml.Marker({ element: el, anchor: "center" }).setLngLat([p.lon, p.lat]).addTo(m);
      markers.current.set(p.id, mk);
      bounds.extend([p.lon, p.lat]);
    });
    m.fitBounds(bounds, { padding: { top: 70, bottom: 50, left: 50, right: 50 }, maxZoom: 14, duration: 900 });
  }, [ready, points, onSelect]);

  // Highlight the selected pin.
  useEffect(() => {
    markers.current.forEach((mk, id) => mk.getElement().classList.toggle("pin--active", id === active));
    const mk = active ? markers.current.get(active) : null;
    if (mk && map.current) map.current.easeTo({ center: mk.getLngLat(), duration: 600 });
  }, [active, ready]);

  if (failed) {
    return (
      <div className="map map--fallback">
        <MapPinned size={22} />
        <span>The map couldn’t load on this device. Every place still has a Directions link.</span>
      </div>
    );
  }
  // MapLibre adds its own classes to its container, so React must never re-render
  // that element's className: the map lives in an inner div React leaves alone.
  return (
    <div className={`map ${ready ? "map--ready" : ""}`} role="region" aria-label="Map of your weekend plan">
      <div ref={box} className="map__canvas" />
    </div>
  );
}
