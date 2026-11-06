import { MotionConfig } from "framer-motion";
import { Settings as SettingsIcon } from "lucide-react";
import { Link, Route, Routes } from "react-router-dom";
import { Planner } from "./pages/Planner";
import { Settings } from "./pages/Settings";
import { ThemeToggle } from "./theme";

/** App icon. Inverts in dark mode so the tile never disappears into the bar. */
function BrandMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="var(--brand-tile)" />
      <circle cx="26" cy="27" r="9" fill="var(--sun)" />
      <path d="M23 45h20a8 8 0 0 0 0-16 10.5 10.5 0 0 0-19.8 3.6A6.2 6.2 0 0 0 23 45z" fill="var(--brand-cloud)" />
    </svg>
  );
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <nav className="nav">
        <div className="shell">
          <div className="nav__bar">
            <Link to="/" className="brand" aria-label="Weekender home">
              <BrandMark />
              <span>Weekender</span>
            </Link>
            <div className="nav__actions">
              <ThemeToggle />
              {/* Full page load on purpose: the proxy asks Authelia before serving /settings. */}
              <a className="btn btn--link btn--small" href="/settings">
                <SettingsIcon size={15} /> <span>Settings</span>
              </a>
            </div>
          </div>
        </div>
      </nav>

      <main>
        <Routes>
          <Route path="/" element={<Planner />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Planner />} />
        </Routes>
      </main>

      <footer className="footer shell">
        Recommendations are drawn from public data and may change. Confirm opening hours and bookings directly with each venue.
        <br />
        Weather by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a> (CC BY 4.0). Cities by{" "}
        <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a>. Places ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>.
      </footer>
    </MotionConfig>
  );
}
