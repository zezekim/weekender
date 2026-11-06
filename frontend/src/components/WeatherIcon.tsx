import type { WeatherIconKey } from "../types";

const CLOUD = "M20 48h26a10 10 0 0 0 0-20a14 14 0 0 0-26.6 3.5A8.5 8.5 0 0 0 20 48z";

/** Flat, single-colour weather glyphs in the style of system symbols. */
export function WeatherIcon({ kind, className }: { kind: WeatherIconKey; className?: string }) {
  const wet = kind === "rain" || kind === "drizzle" || kind === "storm" || kind === "snow";
  const cloud = (dy = 0, fill = wet ? "var(--cloud-dark)" : "var(--cloud)") => <path d={CLOUD} transform={`translate(0 ${dy})`} fill={fill} />;

  const sun = (cx: number, cy: number, r: number) => (
    <g fill="none" stroke="var(--sun)" strokeWidth={3} strokeLinecap="round">
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <line key={i} x1={cx + Math.cos(a) * (r + 5)} y1={cy + Math.sin(a) * (r + 5)} x2={cx + Math.cos(a) * (r + 9)} y2={cy + Math.sin(a) * (r + 9)} />
        );
      })}
      <circle cx={cx} cy={cy} r={r} fill="var(--sun)" stroke="none" />
    </g>
  );

  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" style={{ overflow: "visible" }}>
      {kind === "clear" && sun(32, 32, 12)}
      {kind === "partly" && (
        <>
          {sun(24, 24, 9)}
          <g transform="translate(4 2)">{cloud(0, "var(--cloud)")}</g>
        </>
      )}
      {kind === "cloudy" && cloud(-4)}
      {kind === "fog" && (
        <>
          {cloud(-10)}
          {[44, 51, 58].map((y) => (
            <line key={y} x1={14} y1={y} x2={50} y2={y} stroke="var(--cloud)" strokeWidth={3.5} strokeLinecap="round" />
          ))}
        </>
      )}
      {(kind === "rain" || kind === "drizzle") && (
        <>
          {cloud(-10)}
          {[22, 32, 42].map((x, i) => (
            <line key={x} className="wi-drop" x1={x} y1={44} x2={x - 3} y2={kind === "rain" ? 53 : 49} stroke="var(--rain)" strokeWidth={3.5} strokeLinecap="round" style={{ animationDelay: `${i * 0.35}s` }} />
          ))}
        </>
      )}
      {kind === "snow" && (
        <>
          {cloud(-10)}
          {[22, 32, 42].map((x, i) => (
            <circle key={x} className="wi-flake" cx={x} cy={48} r={3} fill="var(--cloud-dark)" style={{ animationDelay: `${i * 0.8}s` }} />
          ))}
        </>
      )}
      {kind === "storm" && (
        <>
          {cloud(-10)}
          <path d="M34 40l-8 12h6l-3 10 10-14h-6l4-8z" fill="var(--sun)" />
        </>
      )}
    </svg>
  );
}
