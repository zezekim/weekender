import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const PARIS = 2988507;

/** The weekend rule, computed independently of the app: next Saturday on or after the city's local date. */
function expectedWeekend(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const today = new Date(`${parts}T00:00:00Z`);
  const sat = new Date(today);
  sat.setUTCDate(today.getUTCDate() + ((6 - today.getUTCDay() + 7) % 7));
  const sun = new Date(sat);
  sun.setUTCDate(sat.getUTCDate() + 1);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  return [fmt(sat), fmt(sun)];
}

async function axe(page: Page) {
  // Measure the settled page: mid-animation text is semi-transparent and would skew contrast.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude(".maplibregl-map").analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

async function waitForPlaces(page: Page) {
  // Places can take a while on a cold cache when the free OSM servers are slow.
  await expect(page.locator(".skeleton")).toHaveCount(0, { timeout: 150_000 });
}

/** Playwright counts opacity:0 as visible, so check every card actually finished fading in (parents included). */
async function expectFullyShown(page: Page, selector: string) {
  for (const y of [0.33, 0.66, 1]) {
    await page.evaluate((f) => window.scrollTo(0, document.body.scrollHeight * f), y);
    await page.waitForTimeout(400);
  }
  await expect
    .poll(
      () =>
        page.locator(selector).evaluateAll((els) =>
          Math.min(
            1,
            ...els.map((e) => {
              let o = 1;
              for (let n: Element | null = e; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
              return o;
            }),
          ),
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0.99);
}

test("home page renders and is accessible", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("The weekend.");
  await expect(page.getByRole("combobox", { name: "Search for a city" })).toBeVisible();
  await axe(page);
});

test("ambiguous names show region and country", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("combobox", { name: "Search for a city" }).fill("Springfield");
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  expect(await options.count()).toBeGreaterThanOrEqual(3);
  const metas = await page.locator(".results__meta").allInnerTexts();
  expect(new Set(metas).size).toBe(metas.length); // every result is distinguishable
  expect(metas.join(" ")).toContain("Missouri");
  expect(metas.join(" ")).toContain("Illinois");
});

test("city page shows the correct weekend with sources", async ({ page }) => {
  await page.goto(`/?city=${PARIS}`);
  await expect(page.getByRole("heading", { level: 2, name: "Paris" })).toBeVisible();
  const [sat, sun] = expectedWeekend("Europe/Paris");
  await expect(page.locator(".wx__date").nth(0)).toHaveText(sat);
  await expect(page.locator(".wx__date").nth(1)).toHaveText(sun);
  await expect(page.locator(".wx__hi").first()).toContainText("°");
  await expect(page.getByText("Source: Open-Meteo Forecast")).toBeVisible();

  await waitForPlaces(page);
  // Every recommendation either links to its source or says clearly that nothing was found.
  const cards = page.locator(".place");
  const empty = page.locator(".state");
  expect((await cards.count()) + (await empty.count())).toBeGreaterThan(0);
  await expectFullyShown(page, ".card");
  for (const link of await page.getByRole("link", { name: /View source/ }).all()) {
    await expect(link).toHaveAttribute("href", /^https:\/\//);
  }
  await axe(page);
});

test("dark mode is accessible too", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`/?city=${PARIS}`);
  await waitForPlaces(page);
  await axe(page);
});

test("weekend plan exports a calendar file", async ({ page }) => {
  await page.goto(`/?city=${PARIS}`);
  await waitForPlaces(page);
  const plan = page.locator("#plan");
  test.skip((await plan.count()) === 0, "No places available from the free sources right now");
  await plan.scrollIntoViewIfNeeded();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Add to Calendar" }).click();
  const file = await download;
  const body = await (await file.createReadStream()).toArray();
  const ics = Buffer.concat(body).toString("utf8");
  expect(ics).toContain("BEGIN:VCALENDAR");
  expect(ics).toContain("TZID=Europe/Paris");
});

test("source outages are explained, never papered over", async ({ page, request }) => {
  const set = (simulate_failure: string[]) => request.put("/api/admin/settings", { data: { simulate_failure } });
  expect((await set(["weather", "places"])).ok()).toBeTruthy();
  try {
    await page.goto(`/?city=${PARIS}`);
    await expect(page.getByRole("alert").filter({ hasText: "The forecast is unavailable." })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Activity ideas are unavailable." })).toBeVisible();
    await expect(page.getByRole("alert").filter({ hasText: "Restaurant ideas are unavailable." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try Again" }).first()).toBeVisible();
  } finally {
    await set([]);
  }
});

test("theme toggle switches and remembers @mobile", async ({ page }) => {
  await page.goto("/");
  const toggle = page.locator(".theme-toggle");
  const before = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await toggle.click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(before);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
});

test("mobile layout has no horizontal scroll @mobile", async ({ page }) => {
  await page.goto(`/?city=${PARIS}`);
  await expect(page.locator(".wx__hi").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
