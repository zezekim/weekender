import { AnimatePresence, motion } from "framer-motion";
import {
  Blocks,
  Bone,
  Clock,
  CloudSun,
  ExternalLink,
  FerrisWheel,
  Fish,
  Flag,
  FlaskConical,
  Globe,
  Info,
  Landmark,
  MapPin,
  Navigation,
  PartyPopper,
  PawPrint,
  Pizza,
  RefreshCw,
  Smile,
  Sparkles,
  Star,
  Telescope,
  Trees,
  Waves,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Async } from "../api";
import { appleMapsUrl, distance, hostname } from "../format";
import type { Activities, Activity, Dining, Photo, Place, Restaurant, Unit } from "../types";
import { Card, EmptyState, ErrorState, Skeleton, SourceLine, easeOutExpo } from "./ui";

const ICONS: Record<string, typeof Fish> = {
  museum: Landmark,
  science: FlaskConical,
  fish: Fish,
  paw: PawPrint,
  dino: Bone,
  star: Telescope,
  blocks: Blocks,
  bounce: PartyPopper,
  ferris: FerrisWheel,
  wave: Waves,
  flag: Flag,
  swing: Smile,
  pizza: Pizza,
  tree: Trees,
};

function Tile({ icon, large }: { icon: string; large?: boolean }) {
  const Icon = ICONS[icon] ?? Sparkles;
  return (
    <div className={`tile ${large ? "tile--lg" : ""}`} aria-hidden>
      <Icon size={large ? 26 : 22} strokeWidth={1.75} />
    </div>
  );
}

function PlaceFacts({ place, unit }: { place: Place; unit: Unit }) {
  return (
    <ul className="facts">
      <li>
        <MapPin size={16} />
        <span>
          {place.address ?? "Street address not listed"}
          {place.distance_km != null && <small>{distance(place.distance_km, unit)} from the centre</small>}
        </span>
      </li>
      {place.rating != null && (
        <li>
          <Star size={16} />
          <span>
            {place.rating.toFixed(1)} out of 5 · {place.rating_count?.toLocaleString()} Google reviews
          </span>
        </li>
      )}
      {place.opening_hours && (
        <li>
          <Clock size={16} />
          <span>
            <code style={{ fontFamily: "inherit" }}>{place.opening_hours}</code>
            <small>Hours from {place.source.name.split(" (")[0]}. Community-maintained, so check before you go.</small>
          </span>
        </li>
      )}
      {place.website && (
        <li>
          <Globe size={16} />
          <a href={place.website} target="_blank" rel="noreferrer">
            {hostname(place.website)}
          </a>
        </li>
      )}
    </ul>
  );
}

/** Freely licensed photo of this exact place, credited. Disappears quietly if it fails to load. */
function PlacePhoto({ photo, alt }: { photo: Photo; alt: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  if (state === "error") return null;
  return (
    <figure className={`place__photo ${state === "ok" ? "is-loaded" : ""}`}>
      <img src={photo.url} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" onLoad={() => setState("ok")} onError={() => setState("error")} />
      <figcaption>
        {photo.page ? (
          <a href={photo.page} target="_blank" rel="noreferrer">
            Photo: {photo.credit}
            {photo.license ? `, ${photo.license}` : ""}
          </a>
        ) : (
          <>Photo: {photo.credit}</>
        )}
      </figcaption>
    </figure>
  );
}

function PlaceActions({ place, onSwap }: { place: Place; onSwap?: () => void }) {
  return (
    <div className="place__actions">
      <a className="btn btn--small" href={appleMapsUrl(place.name, place.latitude, place.longitude)} target="_blank" rel="noreferrer">
        <Navigation size={13} /> Directions
      </a>
      {place.source.url && (
        <a className="btn btn--link btn--small" href={place.source.url} target="_blank" rel="noreferrer">
          View source <ExternalLink size={13} />
        </a>
      )}
      {onSwap && (
        <button className="btn btn--link btn--small place__swap" onClick={onSwap}>
          <RefreshCw size={13} /> Show me another
        </button>
      )}
    </div>
  );
}

const swapMotion = {
  initial: { opacity: 0, y: 16, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -12, scale: 0.98 },
  transition: { duration: 0.45, ease: easeOutExpo },
};

function ActivityCard({ a, unit, onSwap }: { a: Activity; unit: Unit; onSwap?: () => void }) {
  return (
    <Card lift className={a.photo ? "card--photo" : ""}>
      {a.photo && <PlacePhoto photo={a.photo} alt={a.name} />}
      <div className="place">
        <div className="place__head">
          <Tile icon={a.icon} />
          <div>
            <div className="place__eyebrow">
              {a.category_label} · {a.indoor ? "Indoor" : "Outdoor"}
            </div>
            <h4 className="place__title">{a.name}</h4>
          </div>
        </div>
        <p className="place__why">{a.why}</p>
        {a.weather_note && (
          <div className="place__note">
            <CloudSun size={16} />
            <span>{a.weather_note}</span>
          </div>
        )}
        <PlaceFacts place={a} unit={unit} />
        <PlaceActions place={a} onSwap={onSwap} />
      </div>
    </Card>
  );
}

function PlaceSkeleton() {
  return (
    <div className="glass card" aria-hidden>
      <div className="place">
        <div className="place__head">
          <Skeleton w={56} h={56} r={16} />
          <div style={{ flex: 1, display: "grid", gap: 10 }}>
            <Skeleton w={140} h={22} r={11} />
            <Skeleton w="70%" h={20} />
          </div>
        </div>
        <Skeleton h={14} />
        <Skeleton w="85%" h={14} />
        <Skeleton h={44} r={14} />
        <Skeleton w="60%" h={14} />
      </div>
    </div>
  );
}

function LoadingNote({ children }: { children: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="loading-note" role="status">
      <span className="search__spinner" />
      {slow ? "Still looking. The free map servers are busy right now — thanks for hanging in there." : children}
    </div>
  );
}

export function ActivitiesSection({
  state,
  unit,
  city,
  shown,
  onSwap,
}: {
  state: Async<Activities>;
  unit: Unit;
  city: string;
  shown: Activity[];
  onSwap?: (slot: number) => void;
}) {
  const d = state.data;
  return (
    <section className="section" aria-labelledby="act-title">
      <div className="section__head">
        <div>
          <div className="section__eyebrow">
            For ages 4 to 8
          </div>
          <h3 id="act-title">Fun, rain or shine.</h3>
          {d?.weather_summary && <p className="section__sub">{d.weather_summary}</p>}
        </div>
      </div>

      {state.loading && (
        <>
          <div className="grid-2">
            <PlaceSkeleton />
            <PlaceSkeleton />
          </div>
          <LoadingNote>Finding the good stuff…</LoadingNote>
        </>
      )}

      {state.error && (
        <div className="glass card">
          <ErrorState title="Activity ideas are unavailable." message={`${state.error.message} We’d rather show nothing than make something up.`} onRetry={state.reload} />
        </div>
      )}

      {d && d.items.length === 0 && (
        <div className="glass card">
          <EmptyState
            title="Nothing we can vouch for nearby."
            message={`Our sources don’t list a zoo, aquarium, children’s museum or similar near ${city}. Try a larger city close by.`}
          />
        </div>
      )}

      {d && d.items.length > 0 && (
        // Each slot animates itself (entrance and swaps), so the grid passes no variants down.
        <div className="grid-2">
          {shown.map((a, slot) => (
            <AnimatePresence mode="wait" key={slot}>
              <motion.div key={a.id} {...swapMotion} style={{ display: "grid" }}>
                <ActivityCard a={a} unit={unit} onSwap={onSwap && (() => onSwap(slot))} />
              </motion.div>
            </AnimatePresence>
          ))}
        </div>
      )}

      {d && (
        <SourceLine
          name={d.items[0]?.source.name}
          url={d.items[0]?.source.url ? "https://www.openstreetmap.org/copyright" : null}
          retrievedAt={d.retrieved_at}
          cached={d.cached}
          attempts={d.attempts}
          stale={d.stale}
          extra={d.items.length === 1 ? <span>We could only find one good match.</span> : undefined}
        />
      )}
    </section>
  );
}

export function DiningSection({
  state,
  unit,
  city,
  shown,
  onSwap,
}: {
  state: Async<Dining>;
  unit: Unit;
  city: string;
  shown: Restaurant | null;
  onSwap?: () => void;
}) {
  const d = state.data;
  const r = shown;
  return (
    <section className="section" aria-labelledby="dine-title">
      <div className="section__head">
        <div>
          <div className="section__eyebrow">
            Dinner
          </div>
          <h3 id="dine-title">Pasta night, sorted.</h3>
        </div>
      </div>

      {state.loading && (
        <>
          <PlaceSkeleton />
          <LoadingNote>Finding a table…</LoadingNote>
        </>
      )}

      {state.error && (
        <div className="glass card">
          <ErrorState title="Restaurant ideas are unavailable." message={state.error.message} onRetry={state.reload} />
        </div>
      )}

      {d && !r && (
        <div className="glass card">
          <EmptyState
            icon={<Pizza size={24} />}
            title="No verified Italian spot nearby."
            message={`We couldn’t confirm an Italian restaurant near the centre of ${city}. So we won’t pretend we did.`}
          />
        </div>
      )}

      {r && (
        <AnimatePresence mode="wait">
        <motion.div key={r.id} {...swapMotion}>
          <Card className={r.photo ? "card--photo" : ""}>
            {r.photo && <PlacePhoto photo={r.photo} alt={r.name} />}
            <div className="dining">
              <div className="place">
                <div className="place__head">
                  <Tile icon="pizza" large />
                  <div>
                    <div className="place__eyebrow">
                      {r.cuisine_kind === "italian" ? "Italian restaurant" : "Pizzeria"}
                      {r.cuisine && r.cuisine.toLowerCase() !== r.cuisine_kind && ` · ${r.cuisine.replace(/;/g, ", ").replace(/_/g, " ")}`}
                    </div>
                    <h4 className="place__title" style={{ fontSize: 24 }}>
                      {r.name}
                    </h4>
                  </div>
                </div>
                <p className="place__why">{r.why}</p>
                <PlaceActions place={r} onSwap={onSwap} />
              </div>
              <div className="dining__panel">
                <PlaceFacts place={r} unit={unit} />
                <div className="caveat">
                  <Info size={16} />
                  <span>Prices, availability and today’s hours aren’t verified. Check with the restaurant before you go.</span>
                </div>
              </div>
            </div>
          </Card>
        </motion.div>
        </AnimatePresence>
      )}

      {d && (
        <SourceLine name={r?.source.name} url={r?.source.url} retrievedAt={d.retrieved_at} cached={d.cached} stale={d.stale} attempts={d.attempts} />
      )}
    </section>
  );
}
