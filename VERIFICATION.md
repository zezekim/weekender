# Verification notes

All checks ran against the full Docker stack (Caddy, Authelia and the app) at `https://weekender.localhost` on macOS, on 6 November 2026 (a Friday in Europe and America, already Saturday in Tokyo).

| # | Check | How | Result |
|---|---|---|---|
| 1 | Weekend date rule (weekday, Saturday, Sunday, year boundary) | Automated: `pytest backend/tests` | ✅ 7/7 tests pass |
| 2 | Scoring: rain favours indoor picks; mixed weather gives one indoor and one outdoor; missing weather still produces picks with a caveat; a restaurant without a verified cuisine is rejected | Automated: `pytest` | ✅ |
| 3 | **Normal search:** Paris and Tokyo | Automated (Playwright) plus screenshot review | ✅ Forecast for Sat 7 and Sun 8 Nov with units and rain chance; 2 activities (Tokyo: Ueno Zoological Gardens, Sunshine Aquarium); Italian restaurant with address and OSM link. Tokyo correctly shows "Saturday 12:54 AM local", so the weekend starts today. |
| 4 | **Ambiguous name:** "Springfield" | Automated (Playwright) | ✅ The list shows Missouri, Illinois, Massachusetts, Ohio, Tennessee, Kentucky, … each with its region, country, flag and population. County is added when region and country are the same. |
| 5 | **Failed source (real):** Overpass returned 502/504 or timed out | Observed, then checked against the API response | ✅ "How we found this" shows *Overpass: all servers failed or timed out → Nominatim: used for these results*. A request made right after showed *Overpass skipped (failed Xs ago)*, which confirms the circuit breaker. |
| 6 | **Failed source (simulated):** weather and places outage switches in Settings | Automated (Playwright) | ✅ Each section shows "The forecast is unavailable." / "Activity ideas are unavailable." / "Restaurant ideas are unavailable." with the reason and a Try Again button. No invented content. |
| 7 | Settings protected by Authelia | Automated (curl + Playwright) | ✅ `/settings` returns 302 to the Authelia portal; `/api/admin/settings` returns 401; a spoofed `Remote-User` header is rejected; a wrong password returns 401; a correct login lands on Settings as "Signed in as admin". |
| 8 | Security headers and HTTP redirect | Automated (curl) | ✅ CSP, HSTS, `X-Frame-Options: DENY` and `nosniff` are present; `http://127.0.0.1/` returns 301 to the HTTPS host. |
| 9 | **Desktop layout** at 1440×900, light and dark | Screenshots, reviewed manually | ✅ |
| 10 | **Mobile layout** at 390×844 (iPhone size) | Screenshots, reviewed manually | ✅ Single column, no horizontal scroll, the hourly strip scrolls sideways |
| 11 | Console errors and broken assets | Automated (Playwright `console` and `requestfailed` listeners) | ✅ None in the app. The strict CSP correctly blocks `eval`, so the browser test context runs with CSP bypassed only for its own polling. |
| 12 | Theme toggle | Automated (Playwright) | ✅ Starts from the system theme; a click switches to dark, the choice survives a reload, and a second click switches back to light |

## Issues found and fixed during verification
- Overpass timeouts made a page take about 60 s. Fixed by querying mirrors in parallel, a 10 s budget and the circuit breaker; the worst case is now about 25 s and the next request takes about 5 s.
- Authelia would not start with a read-only root filesystem. Its startup checks fail; I found this by bisecting with `docker run`. That container now runs with a writable filesystem but still non-root, with no capabilities.
- Place names came back in Japanese for Tokyo. Fixed by requesting English names from Nominatim (`accept-language=en`, `namedetails`, `name:en`).
- The restaurant text always said "km" while the facts panel followed the °F/imperial setting. Removed the number from the text.
