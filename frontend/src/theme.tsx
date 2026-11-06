import { AnimatePresence, motion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "theme";
const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function saved(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

function apply(theme: Theme | null) {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  const effective = theme ?? (media().matches ? "dark" : "light");
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    m.setAttribute("content", effective === "dark" ? "#1c1c1e" : "#f5f5f7");
    m.removeAttribute("media");
  });
}

/** Call before the first render so the saved theme never flashes. */
export function initTheme() {
  apply(saved());
}

/** Sun/moon button. Follows the system until the user picks, then remembers. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => saved() ?? (media().matches ? "dark" : "light"));

  // While the user hasn't chosen, track OS changes live.
  useEffect(() => {
    const mq = media();
    const onChange = () => !saved() && setTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* storage blocked: still switch for this visit */
    }
    apply(next);
  };

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button className="btn btn--link btn--small theme-toggle" onClick={toggle} aria-label={label} title={label}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={theme}
          style={{ display: "inline-flex" }}
          initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        >
          {theme === "dark" ? <Moon size={16} /> : <Sun size={16} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
