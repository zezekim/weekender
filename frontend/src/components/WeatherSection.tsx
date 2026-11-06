import { motion } from "framer-motion";
import { CheckCircle2, Droplets, Sun, Sunrise, Timer, Umbrella, Wind } from "lucide-react";
import type { Async } from "../api";
import { fmtDayMonth, fmtHour, fmtLocalClock, fmtWeekday, precip, temp, tempUnit, wind } from "../format";
import { windowHours } from "../plan";
import type { Unit, Weather, WeatherDay } from "../types";
import { Card, CountUp, ErrorState, Skeleton, SourceLine, fadeUp, stagger } from "./ui";
import { WeatherIcon } from "./WeatherIcon";

function verdict(d: WeatherDay): { good: boolean; text: string } {
  const a = d.assessment;
  if (a.outdoor_friendly) return { good: true, text: "A great day to be outside." };
  if (a.wet) return { good: false, text: "Rain likely. Have a plan B." };
  if (a.cold) return { good: false, text: "Chilly. Bundle up, or stay in." };
  return { good: false, text: "Hot. Plan for shade and water breaks." };
}

function DayCard({ day, unit }: { day: WeatherDay; unit: Unit }) {
  const v = verdict(day);
  return (
    <Card>
      <div className="wx">
        <div className="wx__top">
          <div>
            <div className="wx__day">{fmtWeekday(day.date)}</div>
            <div className="wx__date">{fmtDayMonth(day.date)}</div>
          </div>
          <WeatherIcon kind={day.icon} className="wx__icon" />
        </div>

        <div>
          <div className="wx__temps" aria-label={`High ${temp(day.temp_max, unit)}${tempUnit(unit)}, low ${temp(day.temp_min, unit)}${tempUnit(unit)}`}>
            <span className="wx__hi">
              <CountUp value={temp(day.temp_max, unit)} />
              {tempUnit(unit)}
            </span>
            <span className="wx__lo">
              <CountUp value={temp(day.temp_min, unit)} />
              {tempUnit(unit)}
            </span>
          </div>
          <div className="wx__cond">{day.condition}</div>
        </div>

        <div className="wx__stats">
          <div className="stat">
            <div className="stat__label">
              <Umbrella size={12} /> Chance
            </div>
            <div className="stat__value">{day.precip_probability ?? "—"}%</div>
          </div>
          <div className="stat">
            <div className="stat__label">
              <Droplets size={12} /> Rainfall
            </div>
            <div className="stat__value">{day.precip_sum != null ? precip(day.precip_sum, unit) : "—"}</div>
          </div>
          <div className="stat">
            <div className="stat__label">
              <Wind size={12} /> Wind
            </div>
            <div className="stat__value">{day.wind_max != null ? wind(day.wind_max, unit) : "—"}</div>
          </div>
          <div className="stat">
            <div className="stat__label">
              <Sunrise size={12} /> Daylight
            </div>
            <div className="stat__value">
              <small>
                {fmtLocalClock(day.sunrise)}
                <br />
                {fmtLocalClock(day.sunset)}
              </small>
            </div>
          </div>
        </div>

        {day.hourly.length > 0 && (
          <motion.div
            className="hours"
            role="region"
            tabIndex={0}
            aria-label={`Daytime forecast for ${fmtWeekday(day.date)}, every two hours`}
            variants={stagger(0.05)}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
          >
            {day.hourly.map((h) => (
              <motion.div className="hour" key={h.time} variants={fadeUp}>
                <span className="hour__t">{fmtHour(h.time)}</span>
                <WeatherIcon kind={h.icon} className="hour__i" />
                <span className="hour__v">{temp(h.temp, unit)}°</span>
                <span className="hour__p">{h.precip_probability ? `${h.precip_probability}%` : ""}</span>
              </motion.div>
            ))}
          </motion.div>
        )}

        <div className="verdicts">
          <div className="verdict">
            {v.good ? <CheckCircle2 size={17} color="var(--green)" /> : <Umbrella size={17} color="var(--orange)" />}
            <span>{v.text}</span>
          </div>
          {day.best_window && (
            <div className="verdict">
              <Timer size={17} color="var(--accent)" />
              <span>
                {windowHours(day.best_window) >= 10
                  ? "Dry from morning to evening."
                  : `Best time outside: ${fmtLocalClock(day.best_window.start)} – ${fmtLocalClock(day.best_window.end)}`}
              </span>
            </div>
          )}
          {day.uv_note && (
            <div className="verdict">
              <Sun size={17} color="var(--sun)" />
              <span>{day.uv_note}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function DaySkeleton() {
  return (
    <div className="glass card" aria-hidden>
      <div className="wx">
        <div className="wx__top">
          <div style={{ display: "grid", gap: 8 }}>
            <Skeleton w={110} h={20} />
            <Skeleton w={80} h={14} />
          </div>
          <Skeleton w={64} h={64} r={32} />
        </div>
        <Skeleton w={160} h={56} r={14} />
        <div className="wx__stats">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} h={52} r={14} />
          ))}
        </div>
        <Skeleton h={88} r={14} />
      </div>
    </div>
  );
}

export function WeatherSection({ state, unit }: { state: Async<Weather>; unit: Unit }) {
  return (
    <section className="section" aria-labelledby="wx-title">
      <div className="section__head">
        <div>
          <div className="section__eyebrow">
            Forecast
          </div>
          <h3 id="wx-title">The weekend, at a glance.</h3>
        </div>
      </div>

      {state.loading && (
        <div className="grid-2" role="status" aria-label="Loading forecast">
          <DaySkeleton />
          <DaySkeleton />
        </div>
      )}

      {state.error && (
        <div className="glass card">
          <ErrorState
            title="The forecast is unavailable."
            message={`${state.error.message} We won’t guess the weather, so the ideas below don’t factor it in.`}
            onRetry={state.reload}
          />
        </div>
      )}

      {state.data && (
        <>
          <motion.div className="grid-2" initial="hidden" animate="show" variants={stagger(0.12)}>
            {state.data.days.map((d) => (
              <DayCard key={d.date} day={d} unit={unit} />
            ))}
          </motion.div>
          <SourceLine
            name={state.data.source.name}
            url={state.data.source.url}
            retrievedAt={state.data.source.retrieved_at}
            cached={state.data.source.cached}
            stale={state.data.source.stale}
            extra={<span>All times are local.</span>}
          />
        </>
      )}
    </section>
  );
}
