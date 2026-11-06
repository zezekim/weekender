import { animate, motion, useMotionValue, useTransform, type HTMLMotionProps } from "framer-motion";
import { AlertTriangle, ChevronDown, RotateCw, SearchX } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { fmtRetrieved } from "../format";
import type { Attempt, Unit } from "../types";

export const spring = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 } as const;
/** The long, soft deceleration Apple uses on its product pages. */
export const easeOutExpo = [0.16, 1, 0.3, 1] as const;

export const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.9, ease: easeOutExpo } },
};

export const stagger = (gap = 0.08) => ({ hidden: {}, show: { transition: { staggerChildren: gap } } });

export function Card({
  className = "",
  children,
  lift,
  ...rest
}: HTMLMotionProps<"div"> & { children: ReactNode; lift?: boolean }) {
  return (
    <motion.div
      variants={fadeUp}
      className={`glass card ${className}`}
      whileHover={lift ? { y: -4, boxShadow: "var(--shadow-lg)", transition: { duration: 0.4, ease: easeOutExpo } } : undefined}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

/** Fades content up as it scrolls into view — once, like apple.com. */
export function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 1, ease: easeOutExpo, delay }}
    >
      {children}
    </motion.div>
  );
}

/** Animates a number to its new value (and between °C/°F). */
export function CountUp({ value }: { value: number }) {
  const mv = useMotionValue(value * 0.6);
  const text = useTransform(mv, (v) => Math.round(v).toString());
  useEffect(() => {
    const controls = animate(mv, value, { duration: 1.2, ease: easeOutExpo });
    return controls.stop;
  }, [mv, value]);
  return <motion.span>{text}</motion.span>;
}

export function Skeleton({ w = "100%", h = 14, r }: { w?: number | string; h?: number; r?: number }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r }} />;
}

export function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <motion.div className="state" role="alert" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6, ease: easeOutExpo }}>
      <div className="state__icon">
        <AlertTriangle size={24} />
      </div>
      <h4>{title}</h4>
      <p>{message}</p>
      {onRetry && (
        <button className="btn btn--ghost btn--small" onClick={onRetry}>
          <RotateCw size={14} /> Try Again
        </button>
      )}
    </motion.div>
  );
}

export function EmptyState({ title, message, icon }: { title: string; message: ReactNode; icon?: ReactNode }) {
  return (
    <div className="state">
      <div className="state__icon state__icon--warn">{icon ?? <SearchX size={24} />}</div>
      <h4>{title}</h4>
      <p>{message}</p>
    </div>
  );
}

/** "Source · Retrieved 4:36 PM · How we found this" */
export function SourceLine({
  name,
  url,
  retrievedAt,
  cached,
  stale,
  attempts,
  extra,
}: {
  name?: string;
  url?: string | null;
  retrievedAt?: string;
  cached?: boolean;
  stale?: boolean;
  attempts?: Attempt[];
  extra?: ReactNode;
}) {
  return (
    <div className="source-wrap">
      <div className="source">
        {name && (
          <span>
            Source:{" "}
            {url ? (
              <a href={url} target="_blank" rel="noreferrer">
                {name}
              </a>
            ) : (
              name
            )}
          </span>
        )}
        {retrievedAt && (
          <span title={new Date(retrievedAt).toString()}>
            Retrieved {fmtRetrieved(retrievedAt)}
            {cached && !stale ? " (cached)" : ""}
          </span>
        )}
        {stale && <span className="source__stale">Live source unavailable. Showing the last saved results.</span>}
        {extra}
        {attempts && attempts.length > 0 && (
          <details>
            <summary>
              How we found this <ChevronDown size={13} />
            </summary>
            <div className="trail glass glass--thin">
              {attempts.map((a, i) => (
                <div className="trail__row" key={i}>
                  <span className={`trail__dot ${a.ok ? "" : "trail__dot--bad"}`} />
                  <span>
                    <b>{a.provider}</b> — {a.detail}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${label}`} className="segmented__thumb" transition={spring} />}
          <span style={{ position: "relative" }}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function UnitToggle({ unit, onChange }: { unit: Unit; onChange: (u: Unit) => void }) {
  return (
    <Segmented
      label="Units"
      value={unit}
      onChange={onChange}
      options={[
        { value: "metric", label: "°C" },
        { value: "imperial", label: "°F" },
      ]}
    />
  );
}
