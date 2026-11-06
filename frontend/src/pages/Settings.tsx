import { motion } from "framer-motion";
import { CheckCircle2, KeyRound, LogOut, Loader2, ShieldCheck, Trash2, XCircle, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { ErrorState, Segmented, Skeleton, spring } from "../components/ui";

interface SecretView {
  set: boolean;
  hint: string | null;
  source: "settings" | "env" | null;
}
interface SettingsView {
  secrets: Record<SecretKey, SecretView>;
  places_provider: Provider;
  overpass_urls: string[];
  contact_email: string;
  simulate_failure: string[];
}
type SecretKey = "geoapify_api_key" | "google_places_api_key" | "open_meteo_api_key";
type Provider = "auto" | "google" | "geoapify" | "osm";

const SECRETS: { key: SecretKey; label: string; hint: string; link: string; test?: string }[] = [
  {
    key: "geoapify_api_key",
    label: "Geoapify",
    hint: "Free for up to 3,000 requests a day. Faster, more reliable place search.",
    link: "https://myprojects.geoapify.com/",
    test: "geoapify",
  },
  {
    key: "google_places_api_key",
    label: "Google Places (New)",
    hint: "Adds ratings and a “good for children” signal. Billed by Google beyond its monthly free tier.",
    link: "https://console.cloud.google.com/apis/library/places.googleapis.com",
    test: "google",
  },
  {
    key: "open_meteo_api_key",
    label: "Open-Meteo (commercial)",
    hint: "Not needed for personal use. Add one only for commercial use.",
    link: "https://open-meteo.com/en/pricing",
  },
];

const FAILURES = [
  { key: "geocoding", label: "City search", hint: "City search" },
  { key: "weather", label: "Weather forecast", hint: "The forecast" },
  { key: "places", label: "Activities & restaurant", hint: "Every places source" },
];

const TESTS = [
  { key: "geocoding", label: "Geocoding" },
  { key: "weather", label: "Weather" },
  { key: "overpass", label: "Overpass" },
  { key: "nominatim", label: "Nominatim" },
  { key: "geoapify", label: "Geoapify" },
  { key: "google", label: "Google" },
];

type TestResult = { ok: boolean; message: string } | "running";

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

export function Settings() {
  const [view, setView] = useState<SettingsView | null>(null);
  const [user, setUser] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [draft, setDraft] = useState<Partial<Record<SecretKey, string>>>({});
  const [form, setForm] = useState<Omit<SettingsView, "secrets"> | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [tests, setTests] = useState<Record<string, TestResult>>({});

  const load = () => {
    setError(null);
    api<{ user: string; settings: SettingsView }>("/api/admin/settings")
      .then(({ user, settings }) => {
        setUser(user);
        setView(settings);
        const { secrets: _, ...rest } = settings;
        setForm(rest);
        setDraft({});
      })
      .catch((e: ApiError) => {
        if (e.status === 401 || e.status === 403) {
          window.location.href = `/authelia/?rd=${encodeURIComponent(window.location.href)}`;
          return;
        }
        setError(e);
      });
  };
  useEffect(load, []);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const r = await api<{ settings: SettingsView }>("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setView(r.settings);
      setDraft({});
      setToast("Saved. Fresh results from now on.");
      setTimeout(() => setToast(""), 3500);
    } catch (e) {
      setToast((e as ApiError).message);
    } finally {
      setSaving(false);
    }
  };

  const runTest = async (key: string) => {
    setTests((t) => ({ ...t, [key]: "running" }));
    try {
      const r = await api<{ ok: boolean; message: string }>(`/api/admin/test/${key}`, { method: "POST" });
      setTests((t) => ({ ...t, [key]: r }));
    } catch (e) {
      setTests((t) => ({ ...t, [key]: { ok: false, message: (e as ApiError).message } }));
    }
  };

  if (error) {
    return (
      <div className="shell settings">
        <div className="glass card" style={{ marginTop: 40 }}>
          <ErrorState title="Settings unavailable" message={error.message} onRetry={load} />
        </div>
      </div>
    );
  }

  if (!view || !form) {
    return (
      <div className="shell settings">
        <div className="settings__head">
          <Skeleton w={220} h={44} r={12} />
        </div>
        <Skeleton h={220} r={20} />
      </div>
    );
  }

  const dirty =
    Object.values(draft).some((v) => v !== undefined && v !== "") ||
    form.places_provider !== view.places_provider ||
    form.contact_email !== view.contact_email ||
    form.overpass_urls.join("\n") !== view.overpass_urls.join("\n");

  return (
    <motion.div className="shell settings" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
      <div className="settings__head">
        <span className="chip chip--green" style={{ marginBottom: 14 }}>
          <ShieldCheck size={14} /> Signed in as {user}
        </span>
        <h1>Settings</h1>
        <p>Your keys stay on the server. The browser only ever sees the last four characters.</p>
      </div>

      <section className="group">
        <h2 className="group__title">API keys</h2>
        <div className="group__body glass">
          {SECRETS.map((s) => {
            const v = view.secrets[s.key];
            const t = s.test ? tests[s.test] : undefined;
            return (
              <div className="row row--stack" key={s.key}>
                <div>
                  <div className="row__label">
                    <KeyRound size={15} style={{ verticalAlign: -2, marginRight: 6, color: "var(--text-3)" }} />
                    {s.label}
                  </div>
                  <div className="row__hint">
                    {s.hint}{" "}
                    <a href={s.link} target="_blank" rel="noreferrer">
                      Get a key ›
                    </a>
                  </div>
                </div>
                <div className="key-line">
                  <input
                    className="input"
                    type="password"
                    autoComplete="off"
                    placeholder={v.set ? `Saved ${v.hint}${v.source === "env" ? " (from environment)" : ""} — type to replace` : "Not set"}
                    value={draft[s.key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.value }))}
                  />
                  {v.source === "settings" && (
                    <button className="btn btn--ghost btn--small" onClick={() => save({ [s.key]: "" })} disabled={saving}>
                      <Trash2 size={14} /> Remove
                    </button>
                  )}
                  {s.test && v.set && (
                    <button className="btn btn--ghost btn--small" onClick={() => runTest(s.test!)} disabled={t === "running"}>
                      <Zap size={14} /> Check
                    </button>
                  )}
                </div>
                {t && t !== "running" && (
                  <span className={`status ${t.ok ? "status--ok" : "status--bad"}`}>
                    {t.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {t.message}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="group">
        <h2 className="group__title">Places data</h2>
        <div className="group__body glass">
          <div className="row row--stack">
            <div>
              <div className="row__label">Preferred provider</div>
              <div className="row__hint">Auto uses your keys first, then falls back to free OpenStreetMap services.</div>
            </div>
            <Segmented<Provider>
              label="Provider"
              value={form.places_provider}
              onChange={(p) => setForm({ ...form, places_provider: p })}
              options={[
                { value: "auto", label: "Auto" },
                { value: "geoapify", label: "Geoapify" },
                { value: "google", label: "Google" },
                { value: "osm", label: "OSM only" },
              ]}
            />
          </div>
          <div className="row row--stack">
            <div>
              <div className="row__label">Overpass servers</div>
              <div className="row__hint">One HTTPS address per line. We ask them all at once and use the fastest answer.</div>
            </div>
            <textarea
              className="input"
              value={form.overpass_urls.join("\n")}
              onChange={(e) => setForm({ ...form, overpass_urls: e.target.value.split("\n") })}
              spellCheck={false}
            />
          </div>
          <div className="row row--stack">
            <div>
              <div className="row__label">Contact email</div>
              <div className="row__hint">OpenStreetMap asks apps to identify themselves. This is how.</div>
            </div>
            <input
              className="input"
              type="email"
              value={form.contact_email}
              placeholder="ops@example.com"
              onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            />
          </div>
        </div>
      </section>

      <section className="group">
        <h2 className="group__title">Check connections</h2>
        <div className="group__body glass">
          {TESTS.map((t) => {
            const r = tests[t.key];
            return (
              <div className="row" key={t.key}>
                <div>
                  <div className="row__label">{t.label}</div>
                  <div className="row__hint">
                    {r === "running" ? (
                      <span className="status status--muted">
                        <Loader2 size={13} className="spin" style={{ animation: "spin 1s linear infinite" }} /> Testing…
                      </span>
                    ) : r ? (
                      <span className={`status ${r.ok ? "status--ok" : "status--bad"}`}>
                        {r.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {r.message}
                      </span>
                    ) : (
                      "Not checked yet"
                    )}
                  </div>
                </div>
                <button className="btn btn--ghost btn--small" onClick={() => runTest(t.key)} disabled={r === "running"}>
                  Run
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="group">
        <h2 className="group__title">Simulate an outage</h2>
        <div className="group__body glass">
          {FAILURES.map((f) => (
            <div className="row" key={f.key}>
              <div>
                <div className="row__label">{f.label}</div>
                <div className="row__hint">{f.hint} will appear unavailable to everyone. Great for demos.</div>
              </div>
              <Switch
                label={`Simulate ${f.label} outage`}
                checked={view.simulate_failure.includes(f.key)}
                onChange={(on) =>
                  save({
                    simulate_failure: on ? [...view.simulate_failure, f.key] : view.simulate_failure.filter((k) => k !== f.key),
                  })
                }
              />
            </div>
          ))}
        </div>
      </section>

      <div className="savebar material">
        <span className="toast" aria-live="polite">
          {toast || (dirty ? "Unsaved changes." : "All changes saved.")}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <a className="btn btn--ghost btn--small" href="/authelia/logout">
            <LogOut size={14} /> Sign Out
          </a>
          <button
            className="btn btn--small"
            disabled={!dirty || saving}
            onClick={() =>
              save({
                ...Object.fromEntries(Object.entries(draft).filter(([, v]) => v)),
                places_provider: form.places_provider,
                contact_email: form.contact_email,
                overpass_urls: form.overpass_urls.map((u) => u.trim()).filter(Boolean),
              })
            }
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
