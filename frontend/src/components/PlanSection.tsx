import { AnimatePresence, motion } from "framer-motion";
import { CalendarPlus, Check, Share } from "lucide-react";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { fmtShortDate } from "../format";
import { buildPlan, downloadICS, fmtClock } from "../plan";
import type { Activity, City, Restaurant, WeatherDay } from "../types";
import { easeOutExpo, fadeUp, stagger } from "./ui";

const MapView = lazy(() => import("./MapView").then((m) => ({ default: m.MapView })));

export function PlanSection({
  city,
  weekend,
  activities,
  restaurant,
  days,
}: {
  city: City;
  weekend: { saturday: string; sunday: string };
  activities: Activity[];
  restaurant: Restaurant | null;
  days: WeatherDay[] | null;
}) {
  const events = useMemo(() => buildPlan(weekend, activities, restaurant, days), [weekend, activities, restaurant, days]);
  const [active, setActive] = useState<string | null>(null);
  const [shared, setShared] = useState<string | null>(null);

  const points = useMemo(
    () => events.map((e) => ({ id: e.id, label: e.marker, title: e.place.name, kind: e.kind, lat: e.place.latitude, lon: e.place.longitude })),
    [events],
  );
  const center = useMemo<[number, number]>(() => [city.latitude, city.longitude], [city.latitude, city.longitude]);
  const select = useCallback((id: string) => {
    setActive(id);
    document.getElementById(`plan-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  if (!events.length) return null;

  const share = async () => {
    const text = `Our weekend in ${city.name}: ${events.map((e) => (e.kind === "dinner" ? `dinner at ${e.place.name}` : e.place.name)).join(", ")}.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Weekend in ${city.name}`, text, url: window.location.href });
        return;
      }
      await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
      setShared("Link copied.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setShared("Couldn’t share from this browser.");
    }
    setTimeout(() => setShared(null), 2500);
  };

  const byDay = [weekend.saturday, weekend.sunday].map((date) => ({ date, items: events.filter((e) => e.date === date) }));

  return (
    <section className="section" aria-labelledby="plan-title" id="plan">
      <div className="section__head">
        <div>
          <div className="section__eyebrow">Your weekend</div>
          <h3 id="plan-title">All planned. All in one place.</h3>
          <p className="section__sub">Outdoor ideas land on the drier day. Tap a pin or a stop to find it on the map.</p>
        </div>
        <div className="plan__actions">
          <button className="btn btn--ghost btn--small" onClick={() => downloadICS(events, city)}>
            <CalendarPlus size={14} /> Add to Calendar
          </button>
          <button className="btn btn--small" onClick={share}>
            <Share size={14} /> Share
          </button>
        </div>
      </div>

      <div className="plan glass">
        <motion.ol className="timeline" variants={stagger(0.1)} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
          {byDay.map(({ date, items }) => (
            <li key={date} className="timeline__day">
              <motion.div className="timeline__date" variants={fadeUp}>
                {fmtShortDate(date)}
              </motion.div>
              {items.length === 0 && (
                <motion.p className="timeline__free" variants={fadeUp}>
                  Free day. Keep it slow, or swap in another idea above.
                </motion.p>
              )}
              <ul>
                {items.map((e) => (
                  <motion.li key={e.id} variants={fadeUp}>
                    <button
                      id={`plan-${e.id}`}
                      className={`stop ${active === e.id ? "stop--active" : ""}`}
                      onClick={() => setActive(e.id)}
                      aria-pressed={active === e.id}
                    >
                      <span className={`stop__pin pin pin--${e.kind}`} aria-hidden>
                        {e.marker}
                      </span>
                      <span className="stop__body">
                        <span className="stop__time">
                          {fmtClock(e.start)}–{fmtClock(e.end)}
                        </span>
                        <span className="stop__title">{e.kind === "dinner" ? `Dinner at ${e.place.name}` : e.place.name}</span>
                        {e.note && <span className="stop__note">{e.note}</span>}
                      </span>
                    </button>
                  </motion.li>
                ))}
              </ul>
            </li>
          ))}
        </motion.ol>

        <div className="plan__map">
          <Suspense fallback={<div className="map" />}>
            <MapView points={points} center={center} active={active} onSelect={select} />
          </Suspense>
        </div>
      </div>

      <AnimatePresence>
        {shared && (
          <motion.div
            className="toast-pill material"
            role="status"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.4, ease: easeOutExpo }}
          >
            <Check size={14} /> {shared}
          </motion.div>
        )}
      </AnimatePresence>
      <p className="plan__fine">Times are suggestions in the city’s local time. Check opening hours and book ahead where you can.</p>
    </section>
  );
}
