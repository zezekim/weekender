import { AnimatePresence, motion, useScroll, useTransform } from "framer-motion";
import { CalendarDays, Clock, CloudSun, Link2, Pizza, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useApi } from "../api";
import { CitySearch } from "../components/CitySearch";
import { ActivitiesSection, DiningSection } from "../components/places";
import { PlanSection } from "../components/PlanSection";
import { ErrorState, Reveal, Skeleton, UnitToggle, easeOutExpo, fadeUp, stagger } from "../components/ui";
import { WeatherIcon } from "../components/WeatherIcon";
import { WeatherSection } from "../components/WeatherSection";
import { flag, fmtCityDate, fmtCityNow, fmtWeekendRange, regionLine } from "../format";
import { loadRecent, rememberCity } from "../recent";
import type { Activities, Dining, Overview, Restaurant, Unit, Weather, WeatherIconKey } from "../types";

function useUnit(): [Unit, (u: Unit) => void] {
  const [unit, setUnit] = useState<Unit>(() => {
    try {
      const saved = localStorage.getItem("unit");
      if (saved === "metric" || saved === "imperial") return saved;
    } catch {
      /* storage blocked */
    }
    return navigator.language === "en-US" ? "imperial" : "metric";
  });
  return [
    unit,
    (u) => {
      setUnit(u);
      try {
        localStorage.setItem("unit", u);
      } catch {
        /* storage blocked */
      }
    },
  ];
}

function useTick(ms: number) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/**
 * The picks currently on screen plus a queue of runners-up. Swapping a slot
 * brings in the next runner-up and sends the old pick to the back of the queue.
 */
function useSwappable<T extends { id: string }>(items: T[] | undefined, alternates: T[] | undefined, slots: number) {
  const [shown, setShown] = useState<T[]>([]);
  const queue = useRef<T[]>([]);
  useEffect(() => {
    setShown((items ?? []).slice(0, slots));
    queue.current = [...(items ?? []).slice(slots), ...(alternates ?? [])];
  }, [items, alternates, slots]);
  const swap = useCallback(
    (slot: number) => {
      const q = queue.current;
      if (!q.length || !shown[slot]) return;
      const next = [...shown];
      const incoming = q.shift()!;
      q.push(next[slot]);
      next[slot] = incoming;
      setShown(next);
    },
    [shown],
  );
  return { shown, swap, canSwap: (alternates?.length ?? 0) > 0 };
}

const GLYPHS: WeatherIconKey[] = ["clear", "partly", "rain", "cloudy", "snow"];

/** App-icon style tile that quietly cycles through the weather. */
function GlyphCycler() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % GLYPHS.length), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="hero__glyph" aria-hidden>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={GLYPHS[i]}
          className="hero__glyph-inner"
          initial={{ opacity: 0, scale: 0.6, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 1.25, filter: "blur(8px)" }}
          transition={{ duration: 0.7, ease: easeOutExpo }}
        >
          <WeatherIcon kind={GLYPHS[i]} />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

/** Each line slides up from behind a mask, one after another. */
function MaskedLine({ children, className, delay }: { children: string; className?: string; delay: number }) {
  return (
    <span className="mask">
      <motion.span
        className={className}
        style={{ display: "inline-block" }}
        initial={{ y: "105%" }}
        animate={{ y: "0%" }}
        transition={{ duration: 1.1, ease: easeOutExpo, delay }}
      >
        {children}
      </motion.span>
    </span>
  );
}

const FEATURES = [
  {
    icon: CloudSun,
    title: "Weather that plans ahead.",
    body: "Saturday and Sunday, hour by hour, in the city’s own time zone. Rain, wind and daylight included.",
  },
  {
    icon: Sparkles,
    title: "Made for little explorers.",
    body: "Two outings picked for ages 4 to 8. Rain on the way? We lean indoors automatically.",
  },
  {
    icon: Pizza,
    title: "Pasta night, sorted.",
    body: "One Italian spot near the centre. Only if a source confirms it — we never guess.",
  },
  {
    icon: Link2,
    title: "Every pick, sourced.",
    body: "Each recommendation links to where it came from, with the time we checked.",
  },
];

function Home({ onSelect }: { onSelect: (id: number) => void }) {
  const [recent] = useState(loadRecent);
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const opacity = useTransform(scrollYProgress, [0, 0.7], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 0.7], [1, 0.94]);
  const y = useTransform(scrollYProgress, [0, 0.7], [0, -40]);

  return (
    <div className="shell">
      <motion.section ref={heroRef} className="hero" style={{ opacity, scale, y }}>
        <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1, ease: easeOutExpo }}>
          <GlyphCycler />
        </motion.div>
        <motion.div className="hero__eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.15 }}>
          Weekender
        </motion.div>
        <h1>
          <MaskedLine delay={0.2}>The weekend.</MaskedLine>
          <MaskedLine delay={0.32} className="muted">
            Sorted.
          </MaskedLine>
        </h1>
        <motion.p
          className="lead"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: easeOutExpo, delay: 0.55 }}
        >
          The forecast, two outings the kids will love and an Italian table for dinner. For any city on Earth.
        </motion.p>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, ease: easeOutExpo, delay: 0.7 }}>
          <CitySearch onSelect={(c) => onSelect(c.id)} autoFocus suggestions />
          {recent.length > 0 && (
            <div className="suggestions suggestions--recent">
              <div className="suggestions__label">Recently viewed</div>
              {recent.map((c) => (
                <button key={c.id} className="chip" onClick={() => onSelect(c.id)} title={[c.admin1, c.country].filter(Boolean).join(", ")}>
                  <span aria-hidden>{flag(c.country_code)}</span> {c.name}
                </button>
              ))}
            </div>
          )}
        </motion.div>
      </motion.section>

      <Reveal className="features-head">
        <h2>Everything for the weekend. Nothing you don’t need.</h2>
      </Reveal>
      <motion.div
        className="features"
        variants={stagger(0.1)}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
      >
        {FEATURES.map((f) => (
          <motion.div key={f.title} className="feature glass" variants={fadeUp} whileHover={{ y: -4, transition: { duration: 0.4, ease: easeOutExpo } }}>
            <f.icon size={26} strokeWidth={1.6} className="feature__icon" />
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}

export function Planner() {
  const [params, setParams] = useSearchParams();
  const cityId = params.get("city");
  const [unit, setUnit] = useUnit();
  const [searching, setSearching] = useState(false);
  const now = useTick(30_000);

  const base = cityId && /^\d+$/.test(cityId) ? `/api/cities/${cityId}` : null;
  const overview = useApi<Overview>(base);
  const ready = overview.data ? base : null; // load sections only once the city resolved
  const weather = useApi<Weather>(ready && `${ready}/weather`);
  const activities = useApi<Activities>(ready && `${ready}/activities`);
  const dining = useApi<Dining>(ready && `${ready}/restaurant`);
  const acts = useSwappable(activities.data?.items, activities.data?.alternates, 2);
  const mealItems = useMemo<Restaurant[]>(() => (dining.data?.item ? [dining.data.item] : []), [dining.data]);
  const meal = useSwappable(mealItems, dining.data?.alternates, 1);

  useEffect(() => {
    if (overview.data) rememberCity(overview.data.city);
  }, [overview.data]);

  useEffect(() => {
    document.title = overview.data ? `${overview.data.city.name} — Weekender` : "Weekender — The weekend. Sorted.";
  }, [overview.data]);

  const select = (id: number) => {
    setSearching(false);
    setParams({ city: String(id) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const city = overview.data?.city;

  if (!cityId) return <Home onSelect={select} />;

  return (
    <div className="shell">
      <AnimatePresence initial={false}>
        {searching && (
          <motion.div
            className="hero hero--compact"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.6, ease: easeOutExpo }}
            style={{ overflow: "visible" }}
          >
            <CitySearch onSelect={(c) => select(c.id)} autoFocus />
          </motion.div>
        )}
      </AnimatePresence>

      {overview.loading && (
        <div className="city" aria-busy>
          <div style={{ display: "grid", gap: 12 }}>
            <Skeleton w={36} h={36} r={10} />
            <Skeleton w={280} h={52} r={14} />
            <Skeleton w={220} h={18} />
          </div>
        </div>
      )}

      {overview.error && (
        <div className="glass card" style={{ marginTop: 28 }}>
          <ErrorState title="We couldn’t load that city." message={overview.error.message} onRetry={overview.reload} />
          <div style={{ display: "flex", justifyContent: "center", paddingBottom: 12 }}>
            <button className="btn btn--ghost btn--small" onClick={() => setParams({})}>
              Start Over
            </button>
          </div>
        </div>
      )}

      {city && overview.data && (
        <>
          <motion.header className="city" key={city.id} initial="hidden" animate="show" variants={stagger(0.07)}>
            <div>
              <motion.span className="city__flag" aria-hidden variants={fadeUp}>
                {flag(city.country_code)}
              </motion.span>
              <span className="mask">
                <motion.h2 initial={{ y: "105%" }} animate={{ y: "0%" }} transition={{ duration: 1, ease: easeOutExpo }}>
                  {city.name}
                </motion.h2>
              </span>
              <motion.div className="city__region" variants={fadeUp}>
                {[city.admin2 && city.admin2 !== city.name ? city.admin2 : null, regionLine(city)].filter(Boolean).join(", ")}
              </motion.div>
              <motion.div className="city__facts" variants={fadeUp}>
                <span className="chip chip--blue">
                  <CalendarDays size={13} /> Sat–Sun, {fmtWeekendRange(overview.data.weekend.saturday, overview.data.weekend.sunday)}
                </span>
                <span className="chip" title={city.timezone}>
                  <Clock size={13} /> It’s {fmtCityNow(city.timezone, now)}, {fmtCityDate(city.timezone, now)} there
                </span>
              </motion.div>
            </div>
            <motion.div className="city__aside" variants={fadeUp}>
              <UnitToggle unit={unit} onChange={setUnit} />
              <button className="btn btn--ghost btn--small" onClick={() => setSearching((s) => !s)} aria-expanded={searching}>
                {searching ? <X size={14} /> : <Search size={14} />} {searching ? "Close" : "Change City"}
              </button>
            </motion.div>
          </motion.header>

          <WeatherSection state={weather} unit={unit} />
          <Reveal>
            <ActivitiesSection
              state={activities}
              unit={unit}
              city={city.name}
              shown={acts.shown}
              onSwap={acts.canSwap ? acts.swap : undefined}
            />
          </Reveal>
          <Reveal>
            <DiningSection
              state={dining}
              unit={unit}
              city={city.name}
              shown={meal.shown[0] ?? null}
              onSwap={meal.canSwap ? () => meal.swap(0) : undefined}
            />
          </Reveal>
          {!activities.loading && !dining.loading && (acts.shown.length > 0 || meal.shown.length > 0) && (
            <Reveal>
              <PlanSection
                city={city}
                weekend={overview.data.weekend}
                activities={acts.shown}
                restaurant={meal.shown[0] ?? null}
                days={weather.data?.days ?? null}
              />
            </Reveal>
          )}
        </>
      )}
    </div>
  );
}

