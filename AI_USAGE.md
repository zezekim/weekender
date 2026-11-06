# AI usage

**Tool:** Claude Code (Claude Opus), running in the terminal.

It helped with:
- planning;
- the backend, frontend, Docker, Caddy and Authelia configuration;
- the GitHub Actions pipeline and the server setup over SSH;
- running the tests and taking browser screenshots with Playwright.

I directed the work, reviewed the output and made the product and security calls listed below.

## How the output was checked
- **Before writing any code:** each public API was called with `curl` to confirm response shapes and availability. That is how we found that the public Overpass servers were failing.
- **Unit tests** (pytest, 14) cover:
  - the weekend date rule, including the year boundary;
  - activity and restaurant scoring and the alternates;
  - the best outdoor window and UV notes;
  - the cache serving saved results when a source is down;
  - Google museum-name matching.
- **Browser tests** (Playwright + axe, 10) run in CI against the exact image that gets deployed. They check:
  - the weekend dates, computed independently in the test;
  - Springfield disambiguation;
  - that every card is fully visible;
  - the calendar export;
  - simulated outages;
  - the theme toggle;
  - mobile overflow;
  - WCAG 2.1 AA in light and dark mode.
- **Every deploy** is smoke-tested over HTTPS and HTTP, confirms Settings is still behind the login, compares the live security policy with the repo, and runs a Lighthouse audit.
- **Screenshots:** I reviewed them at desktop and mobile sizes, in light and dark mode, after each design change.

## Decisions and corrections made by the human
- **No AI-written recommendations.** Explanations come from source data or are general guidance about the type of place, so nothing about hours, prices or availability can be invented.
- **Italian means verified cuisine.** A pizzeria is labelled as such and never presented as a full Italian restaurant.
- **The design was redone.** The first version used gradients and glass effects everywhere. I rejected it as looking AI-generated and asked for a restrained, Apple-style system: neutral surfaces, one accent colour, flat icons, glass only on the nav and pop-ups. Later I asked for a grey (not black) dark mode, a theme toggle, and Apple-style motion and copy.
- **Plain HTTP access is limited.** The app is reachable at `http://<server-ip>`, but sign-in and Settings always redirect to HTTPS, so passwords and session cookies are never sent unencrypted.
- **Least-privilege deploys.** GitHub Actions uses a deploy key that can only run `scripts/deploy.sh` (a forced command). It deploys the exact commit and image that CI tested, and it rolls back automatically if the app isn't healthy.

## Problems found during review and fixed
- **Overpass was down during the build.** Fixed with parallel mirrors, a Nominatim fallback, a circuit breaker, a saved-results fallback, and a "How we found this" panel showing every attempt to the user.
- **Authelia wouldn't start with a read-only filesystem.** Found by testing `docker run` flags one at a time.
- **Accessibility:** axe found low-contrast grey and blue text and links that relied on colour alone. Fixed the colour values, underlined links within text, and made the hourly strip reachable by keyboard.
- **Invisible activity cards:** they were stuck at opacity 0 after an animation change. Playwright counts that as "visible", so the browser tests now check each card's actual opacity.
- **Collapsed map:** React updates removed a class MapLibre adds to its container. The map now has its own inner container.
- **Photos missing:** Wikimedia now serves thumbnails from `thumb.wikimedia.org`, which the allow-list didn't include.
- **Wrong museum picks:** with a Google key set, a search for "children's museum" returned ordinary museums. Google museum results now need a children's or science name to qualify.
- **Config not reloading on deploy:** Caddy didn't restart when its config changed. The deploy script now restarts it, and CI checks that the live security policy matches the repo.

## Representative prompts (credentials removed)
1. *Planning:* "Build the Ashlex Family Weekend Planner [full brief pasted]. Make it local-first with Docker; we'll upload it via root later. Use free APIs where possible. Add a settings page for the individual API keys, protected with Authelia. The design should look like it was Designed by Apple in Cupertino… Recommend the language (I usually use Python/FastAPI). Frontend in React."
2. *Design:* "I like the layout but the gradients make it look like AI slop. Lose the AI slop. Make it look designed by a team of highly skilled UI experts from California." Then: "Make the background grey-ish instead of black", "Add light/dark mode switching to the top bar", "Make the site stand out with Apple-style animation, and rewrite the copy to sound like an Apple product."
3. *Deployment:* "ssh root@<server>, set up GitHub Actions so CI/CD is automated and the server picks up code changes automatically." Then: "Ensure it can be accessed over plain HTTP at the IP as well."
4. *Improvements:* "What other improvements can you make to make this app really stand out?" Then: "Do all except TOTP."
5. *Troubleshooting:* "Authelia exits with 'Errors occurred performing startup checks' and no detail. Test the docker run flags one at a time."
6. *Verification:* "Screenshot desktop, mobile and dark mode for Tokyo; test the Springfield ambiguity, the Authelia login and the simulated outages."

The full session transcript is available on request. Omitted: the admin password, the Authelia secrets and the deploy key.
