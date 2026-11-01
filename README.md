# Kien's website

A static personal website built with Astro and TypeScript. The token heatmap reads a small, locally generated daily aggregate snapshot; it does not request usage records from visitors or a public API.

The photo’s Kien popup contains the name and links to LinkedIn, GitHub, and X (`@kiendlee`), with leading platform icons and no university subtitle. Social icons are from [Bootstrap Icons](https://github.com/twbs/icons), under the MIT license retained in `public/logos/bootstrap-icons-LICENSE.txt`.

The Kien heading is plain, non-interactive text with no popup. The greeting and name stay above the full-width segmented photo with a small 12px gap between the name and image. Profile details are available only through Kien’s silhouette in the photo.

The supplied outdoor photo keeps its full composition and original content-column width immediately below the introduction, with token usage below the combined section. Responsive WebP files in `public/photos/` omit embedded photo metadata; explicit dimensions reserve the image’s space while it loads.

Hover, keyboard-focus, or tap Kien or Blue Jay in that photo to open their details. Only the active subject’s silhouette is highlighted: purple for Kien, warm orange for Blue Jay. The rest of the photo stays unchanged. Kien’s card contains the profile links; Blue Jay’s card contains only its name and description. Each non-modal native popover is centered 10px above its subject’s head and scrolls with the photo. It never flips downward or pins itself to a viewport edge, so it may scroll partly off-screen. Popovers close on Escape, an outside click/tap, or when the mouse leaves both the subject and its card. Enter or Space opens a focused subject’s card; Tab continues through the card without trapping focus.

These two photo interactions use liquid morphology: the colored highlight briefly ripples as its popup pulls out through a neck, separates, and settles. Closing reverses the contour motion; rapid reopening continues from the current shape. The popup text and photo never scale or warp, and the exact segmentation paths remain the hit targets. Reduced-motion preferences disable both the highlight distortion and popup animation. This effect is confined to the photo; it does not change the heading, year selector, or other site controls.

The contours are extracted offline from the supplied, precomputed segmentation image by `scripts/extract-photo-segments.py`, which writes `src/data/photo-segments.json` in the full photo’s 1408 × 792 coordinate space. See `public/photos/segments-SOURCES.txt` for the source and local reproduction command. The page scales those static SVG contours with the original responsive photo; no segmentation model runs in the browser, and no photo is uploaded.

The “I’m playing around with...” section displays technology icons as links without surrounding card backgrounds or borders. PNG icons are scaled to compensate for their transparent padding, matching the SVG icon’s visible size. Each link keeps an accessible name, tooltip, and keyboard focus outline.

The “My heroes” cards use sourced portraits stored locally in `public/people/`; source credits are recorded in `public/people/SOURCES.txt`.

App links and hero cards stay in place on hover and keyboard focus, without blur halos or shadows. The liquid cursor carries the hero cards’ northeast link arrow instead of repeating it in each card’s top-right corner. Keyboard focus outlines remain visible.

On initial page load, a CSS-only, page-wide blur wipe clears from top to bottom over one second. Its moving boundary shares the existing bottom edge’s eight blur layers and mask curves, stretched across a softer 320px depth on desktop and 240px at widths of 680px or less. The visible feather uses the first 84% and 80% of those curves, respectively, preserving the transition into the fully blurred region. It does not intercept input or replay on scroll, leaves the existing fixed edge blur unchanged, and is disabled for reduced-motion preferences.

Mouse and trackpad users get a small charcoal dot cursor and an outlined ring over ordinary links and controls, with white edging for contrast over photos. Those native cursors use inline SVG images without extra asset requests. Over app links and hero cards only, `LiquidLinkCursor.astro` morphs into a magnifying glass for apps, or a thin northeast arrow for heroes. The magnifier’s circular lens folds into the arrowhead and its diagonal handle becomes the shaft, rather than crossfading separate icons. The shape yields with pointer motion, compresses on press, and springs back without moving the card or artwork. SVG `d` attribute updates work in both Chromium and WebKit; the animation loop stops once the shape settles. Leaving the links restores the native cursor. Keyboard input, scrolling, blur, reduced motion, coarse pointers, and forced-colors mode dismiss or bypass the overlay. Selectable paragraphs and headings keep the text cursor.

Selected text uses a static burgundy (`#800020`) background with white text, rendered by native CSS `::selection` without JavaScript or overlays. Forced-colors mode retains the system highlight colors.

## Run locally

Use Node.js 22.18+ (Node 24 recommended), npm, and the installed `ccusage` CLI. The usage scripts and calendar tests use Node built-ins only.

```sh
npm install
npm run dev
```

```sh
npm run build
npm run preview
```

The production build is written to `dist/`. These commands do not deploy a hosted website.

Verify changes with `npm run check`, `npm test`, and `npm run build`.

## Collect local token usage

Run from this checkout:

```sh
node scripts/collect-usage.mjs
```

The default grouping timezone is the Mac's current IANA timezone. Choose a fixed timezone explicitly if wanted:

```sh
node scripts/collect-usage.mjs --timezone UTC
```

`USAGE_TIME_ZONE` is also supported; `--timezone` takes precedence. `CCUSAGE_BIN` can point to an installed executable when `ccusage` is not on `PATH`.

The collector invokes the installed CLI with these arguments, passing the selected timezone as a separate subprocess argument:

```text
ccusage daily --json --no-cost --offline --timezone <IANA timezone>
```

There is no `--since`, `--until`, agent filter, or history-length limit. All supported agents detected by this version of `ccusage` are included by default. The collector uses unified `daily` rows (`agent: "all"`, `period: "YYYY-MM-DD"`); it does not combine an aggregate with per-agent breakdowns.

### What is saved

`src/data/usage.json` contains only:

- `updatedAt`: UTC ISO timestamp of the last changed aggregate snapshot. It stays unchanged when the aggregate data and timezone are unchanged, rather than creating timestamp-only changes on every run. `null` means no collection has been saved yet.
- `timeZone`: the IANA timezone used to group dates.
- `days`: every recorded day returned by `ccusage`, sorted oldest first. Dates without records are not invented as zero-usage days.
  - `date`: `YYYY-MM-DD`, from the CLI's daily `period`.
  - `inputTokens`: the CLI's non-cache input counter.
  - `outputTokens`: its output counter.
  - `cacheCreationTokens`: its cache-write counter.
  - `cacheReadTokens`: its cache-read counter.
  - `totalTokens`: the sum of those four counters, once each.

The collector checks that the CLI's reported total matches that sum; it never adds cache counters to an already-inclusive `totalTokens`. These are token counts as reported by `ccusage`, not monetary costs, unique prompt tokens, or a claim of complete lifetime usage.

Coverage is **all history currently available in local records that the installed `ccusage` can discover**. It is not an account-wide service export. Unsupported tools, usage on other computers, deleted records, and records outside configured local data locations cannot appear. Moving or removing local logs can change historical coverage. Calendar display layout does not truncate the saved snapshot.

The selected year's heatmap runs from January 1 through today (or December 31 for past years), without reserving blank columns for future weeks. Activity uses a saturated green scale shared with the legend. Narrow screens scroll horizontally to the latest day with room for its focus outline; short early-year calendars keep their cells compact.

Day details use a compact, non-interactive label outside the calendar grid. Mouse hover opens it immediately. The same popover stays open across cell gaps while scrubbing, with a soft blur on changing dates that sharpens after 100 ms of rest. Entering and leaving use a 140 ms blur dissolve instead of abrupt show/hide flashes. Keyboard focus and touch taps show the exact count and a short date immediately; Escape dismisses the label. Reduced-motion preferences disable the transitions and scrub blur.

The selected-year token total is bold green and uses [NumberFlow](https://number-flow.barvian.me/vanilla) to roll digits upward from below once when it enters the viewport, then on subsequent year changes. Horizontal movement is disabled. Reduced-motion preferences disable the animation. The exact total is server-rendered for no-JavaScript viewing and exposed separately to screen readers so rolling digits are not announced. NumberFlow is Copyright (c) 2024 Maxwell Barvian; its MIT notice is preserved in `public/licenses/number-flow-LICENSE.txt` and included in the static build.

The repository snapshot contains real aggregates collected from local records, not fabricated activity. Before the first successful collection, the empty state is `updatedAt: null` and `days: []`. A failed command, invalid report, inconsistent counters, or completely empty report exits with an error and leaves the previous snapshot intact. Successful changes are written to a private temporary file and atomically renamed into place.

### Refresh and publish token usage

Collecting alone changes the source JSON, not an existing production build. To collect, rebuild the static webpage locally, and publish the sanitized snapshot to the production branch:

```sh
node scripts/refresh-usage.mjs
```

Or fix the grouping timezone for this run:

```sh
USAGE_TIME_ZONE=UTC node scripts/refresh-usage.mjs
```

This runs the collector followed by `npm run build` in this checkout, then publishes only sanitized `src/data/usage.json` to the latest `origin/main`. It rebuilds even if the aggregate snapshot is unchanged. If collection fails, no build or publication is started. If the build fails, the newly collected source snapshot is retained and nothing is published, but `dist/` should not be considered successfully refreshed. `NPM_BIN` can point to an installed npm executable.

The collector requests offline/cached pricing behavior with `--offline` and omits costs with `--no-cost`. Refreshing uses preinstalled tools and dependencies; it does not install packages. When the Mac is offline or GitHub authentication is unavailable, collection and the local build can still succeed, but publication fails with a nonzero exit status and retains the local snapshot. Run the refresh again after connectivity or credentials are restored.

For a local-only collection and build, without any GitHub publication:

```sh
node scripts/collect-usage.mjs
npm run build
```

## Daily macOS refresh: explicit opt-in

The existing `local.kien-portfolio.usage` job runs daily at **09:00 in the Mac's local wall-clock timezone**, with **America/New_York** usage date grouping. It already invokes `refresh-usage.mjs` without arguments, so its next run collects, builds, and publishes automatically without reinstalling or rescheduling.

Scheduling is not enabled by cloning the project or installing dependencies. For a new installation, first confirm a manual refresh works, keep this checkout at a stable location, and then explicitly install the user LaunchAgent:

```sh
node scripts/install-usage-launchd.mjs --install
```

New installations also default to **09:00 in the Mac's local wall-clock timezone**. Their date-grouping timezone is captured from the current system timezone at installation. To choose a different time and a fixed grouping timezone:

```sh
node scripts/install-usage-launchd.mjs --install --hour 9 --minute 30 --timezone UTC
```

Choose one installation command, not both. An existing installation is never silently replaced; uninstall before changing it.

The installer creates:

- `~/Library/LaunchAgents/local.kien-portfolio.usage.plist`
- Private logs at `~/Library/Logs/PortfolioUsage/stdout.log` and `stderr.log`

The plist uses `StartCalendarInterval`, absolute resolved Node/npm/ccusage executable paths, the checkout as `WorkingDirectory`, and an explicit `PATH`. New installations also resolve Git and include its directory in `PATH`. Resolving executables avoids depending on an ephemeral fnm multishell symlink. `RunAtLoad` is off, so installation does not immediately collect, build, or publish; run `refresh-usage.mjs` manually when an immediate refresh is wanted. This is a logged-in user job, not a system daemon: it cannot refresh while the Mac is shut down or the user is logged out. Missed intervals during sleep are handled by launchd on wake.

The job captures `HOME`, `PATH`, `CCUSAGE_BIN`, `NPM_BIN`, and `USAGE_TIME_ZONE`, not your shell profile or arbitrary environment variables/secrets. Publication uses noninteractive Git (`GIT_TERMINAL_PROMPT=0`) and the user's existing Git credential helper/configuration through `HOME`; those credentials must be available in the logged-in Mac session. No GitHub tokens are written into the plist or repository. Scheduled and manual refresh builds disable Astro CLI telemetry with `ASTRO_TELEMETRY_DISABLED=1`. If your agent logs use custom locations, make sure the installed CLI's local configuration can discover them in this environment before scheduling. Reinstall after moving the checkout or removing/upgrading the resolved Node or CLI installations. Local collection and building need no GitHub credentials.

Inspect the installed job:

```sh
launchctl print "gui/$(id -u)/local.kien-portfolio.usage"
```

Uninstall it explicitly:

```sh
node scripts/install-usage-launchd.mjs --uninstall
```

Uninstalling unloads the job and removes its plist. Existing private logs are retained for inspection. The installer does not alter any other LaunchAgent.

## Privacy and deployment

Raw CLI reports stay in process memory and are not written or uploaded by the collector. No prompts, project names, filesystem paths, session identifiers, model lists, model breakdowns, per-agent breakdowns, costs, or CLI metadata are copied into the snapshot. Only the allowlisted date/count fields and snapshot metadata above are saved, and the publisher independently projects that allowlist before committing. The published aggregate still reveals daily activity patterns. Build and error logs remain local, outside the repository when scheduled.

Vercel hosts the site as `kiens-projects-656209eb/kien-portfolio`, connected to the private GitHub repository `kiendle/Portfolio`. Pushes to `main` create production deployments; pushes to other branches and pull requests create preview deployments. Vercel uses Node.js 24, `npm ci`, `npm run build`, and the static `dist/` output. No server adapter or separate GitHub Actions deployment workflow is required.

Vercel's default deployment protection stays enabled for `.vercel.app` URLs; the custom production domains are public.

The production domain is `https://www.kienle.work`; `https://kienle.work` redirects to it with HTTP 307, preserving the previous site's routing. Astro's `site` setting supplies the canonical URL. Vercel project metadata and local environment files are ignored and must not be committed.

After a successful local refresh build, publication creates a commit based on the latest remote `origin/main`, changing only canonical, sanitized `src/data/usage.json`. Vercel's native Git integration then rebuilds and deploys production; no direct Vercel upload is used. If the remote snapshot already has identical bytes, no commit or push is made and no new deployment is triggered.

Publication uses a private temporary Git ref and index. It does not change the active branch or its HEAD, touch the real Git index, stage/checkout/stash working files, or push the active branch's commits. Unrelated staged and unstaged work stays untouched, and other changes already on remote `main` are preserved. A concurrent update to `main` causes the normal non-force push to fail; there are no automatic retries or force pushes, and the collected local snapshot remains available. The developer branch is not advanced by these usage commits: sync it with the latest `main` before future production pushes.
