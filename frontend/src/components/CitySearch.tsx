import { AnimatePresence, motion } from "framer-motion";
import { LocateFixed, MapPin, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { compactPopulation, flag } from "../format";
import type { City } from "../types";

const SUGGESTIONS = ["Springfield", "Paris", "Tokyo", "Sydney", "Portland"];

export function CitySearch({
  onSelect,
  autoFocus,
  suggestions,
}: {
  onSelect: (c: City) => void;
  autoFocus?: boolean;
  suggestions?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<City[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api<{ results: City[] }>(`/api/cities?q=${encodeURIComponent(q)}`)
        .then((r) => {
          if (cancelled) return;
          setResults(r.results);
          setError(null);
          setActive(0);
        })
        .catch((e: ApiError) => !cancelled && (setError(e.message), setResults(null)))
        .finally(() => !cancelled && setLoading(false));
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  const choose = (c: City) => {
    setOpen(false);
    setQuery("");
    setResults(null);
    inputRef.current?.blur();
    onSelect(c);
  };

  /** Rounded to ~1 km on the server before it's sent anywhere; never stored. */
  const nearMe = () => {
    setLocError(null);
    if (!("geolocation" in navigator)) {
      setLocError("Location isn’t available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const r = await api<{ city: City }>(`/api/cities/nearest?lat=${coords.latitude.toFixed(3)}&lon=${coords.longitude.toFixed(3)}`);
          choose(r.city);
        } catch (e) {
          setLocError((e as ApiError).message);
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        setLocError(err.code === err.PERMISSION_DENIED ? "Location access is off. You can still search by name." : "We couldn’t get your location.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!results?.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  // Count duplicates so we can surface the extra detail (county) only when it helps.
  const nameCounts = new Map<string, number>();
  results?.forEach((c) => nameCounts.set(`${c.name}|${c.admin1}|${c.country}`, (nameCounts.get(`${c.name}|${c.admin1}|${c.country}`) ?? 0) + 1));
  const showDropdown = open && query.trim().length >= 2 && (results !== null || error !== null);

  return (
    <div className="search">
      <div className="search__field glass">
        <Search size={21} />
        <input
          ref={inputRef}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
          placeholder="Search for a city"
          aria-label="Search for a city"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
        {loading && <span className="search__spinner" aria-label="Searching" />}
        <button
          type="button"
          className="search__locate"
          onClick={nearMe}
          disabled={locating}
          aria-label="Use my location"
          title="Use my location"
        >
          {locating ? <span className="search__spinner" /> : <LocateFixed size={18} />}
          <span className="search__locate-label">Near me</span>
        </button>
      </div>
      {locError && (
        <p className="search__error" role="alert">
          {locError}
        </p>
      )}

      <AnimatePresence>
        {showDropdown && (
          <motion.div
            className="results material"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            id={listId}
            role="listbox"
          >
            {error && <div className="results__empty">{error}</div>}
            {results?.length === 0 && <div className="results__empty">No matches for “{query.trim()}”. Check the spelling, or try a nearby city.</div>}
            {results?.map((c, i) => {
              const dup = (nameCounts.get(`${c.name}|${c.admin1}|${c.country}`) ?? 0) > 1;
              const meta = [dup ? c.admin2 : null, c.admin1, c.country].filter(Boolean).join(" · ");
              return (
                <button
                  key={c.id}
                  className="results__item"
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(c)}
                >
                  <span className="results__flag" aria-hidden>
                    {flag(c.country_code)}
                  </span>
                  <span className="results__text">
                    <div className="results__name">{c.name}</div>
                    <div className="results__meta">{meta || "Region unknown"}</div>
                  </span>
                  <span className="results__aside">
                    {compactPopulation(c.population) && (
                      <>
                        {compactPopulation(c.population)}
                        <br />
                        people
                      </>
                    )}
                  </span>
                </button>
              );
            })}
            {results && results.length > 0 && (
              <div className="results__foot">
                <MapPin size={11} style={{ verticalAlign: -1 }} /> Places from GeoNames, via Open-Meteo
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {suggestions && (
        <Suggestions
          onPick={(q) => {
            setQuery(q);
            setOpen(true);
            inputRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function Suggestions({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="suggestions">
      <div className="suggestions__label">Try</div>
      {SUGGESTIONS.map((s) => (
        <button key={s} className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}
