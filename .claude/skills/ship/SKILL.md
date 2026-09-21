---
name: ship
description: Ship a code change to the CQC Defect Map wafer viewer app (this repo) — implement, verify with headless Playwright, update docs, commit, push, and confirm the GitHub Pages deploy. Use this whenever a feature/fix/refactor in index.html, css/style.css, or js/app.js is ready to go out, or the user asks to "ship", "deploy", "push this live", "release this", or otherwise wants a change to reach https://sinliongtoo.github.io/Cqc-defect-map/. Don't wait for the user to spell out every step — this skill's sequence *is* the answer to "what do I do now that the code works."
---

# Shipping a change to CQC Defect Map

This is a vanilla HTML/CSS/JS app (no build step, no framework, no backend — everything
runs client-side) deployed to GitHub Pages at https://sinliongtoo.github.io/Cqc-defect-map/,
repo https://github.com/SinLiongToo/Cqc-defect-map. Because there's no build/CI pipeline to
catch mistakes, the burden of catching them falls on you before you push — that's why
verification and docs aren't optional extras tacked onto "the real work," they're part of
what shipping means here.

Run the steps below in order. Don't skip verification because a change "looks obviously
correct" — this project has a history of subtle regressions (SVG attribute precedence,
`[hidden]` being overridden by author CSS, drag-select math) that only surfaced under an
actual headless browser, not by reading the diff.

## 1. Implement

Make the change in `index.html`, `css/style.css`, and/or `js/app.js`. Keep it scoped to
what was asked — this app has accumulated a lot of surface area (wafer map, die defect map,
Pareto chart, Trend chart, a shared Full View modal every plot can open into, rotation, grid
lines, calibration) and it's easy to reach for an abstraction it doesn't need yet.

If the change adds a new plot/card, give it a Full View icon button too (see how the
existing four wire into the shared `openFullView(cardEl, elements, title)` helper in
`js/app.js`) — "every plot gets a full-view button" is an established expectation now, not
a one-off.

## 2. Verify with headless Playwright

Write a small test script under the scratchpad directory (not the project directory) and
run it with `node`. Load the app via `file://` on the project's `index.html`, feed it
`sample-data/sample_defects.csv` (or whatever fixture fits) via `page.setInputFiles`, and
drive the actual UI — click, drag, hover — rather than calling internal functions directly,
since the bugs that matter here live in the DOM/event wiring, not the data logic.

Take screenshots for anything visual (new UI, layout changes, style changes) and actually
look at them — don't just assert no exception was thrown.

Two known Playwright gotchas from past runs, so you don't rediscover them the hard way:
- `page.mouse.click(x, y, {modifiers: [...]})` — the `modifiers` option isn't supported.
  Use `page.keyboard.down('Control')` / `page.mouse.click(x, y)` / `page.keyboard.up('Control')`
  instead.
- `element.isVisible()` gives false negatives for thin/axis-aligned SVG `<line>` elements
  (e.g. grid lines, ruler ticks) because of how Playwright computes their bounding box. If a
  visibility assertion on an SVG line fails unexpectedly, check
  `getComputedStyle(el).display` instead before concluding it's a real bug — cross-check
  with a screenshot either way.

If the change touches an existing feature (selection, rotation, calibration, drag-select,
Full View reparenting), re-run the prior test scripts for those features too, not just new
ones for this change — the per-defect selection refactor and the Full View toolbar bug were
both things a full re-run caught that a narrow test would have missed.

## 3. Update docs

Two places need to reflect the change, both read by the end user, not just you:
- **README.md** — update the relevant feature bullet or usage step. Match the existing
  voice (concrete, describes behavior/interaction, not implementation).
- **In-app Help modal** (inside `index.html`) — update the corresponding guide `<li>` so the
  live app's own documentation doesn't go stale relative to what it actually does.

## 4. Sanity-check syntax

No build step means no compiler to catch typos. Before committing, run:

```bash
node --check js/app.js
```

and a quick brace-balance check on the CSS (a mismatched `{`/`}` silently breaks styling
with no error anywhere):

```bash
node -e "
const css = require('fs').readFileSync('css/style.css','utf8');
const o=(css.match(/\{/g)||[]).length, c=(css.match(/\}/g)||[]).length;
console.log('braces', o, c, o===c?'OK':'MISMATCH');
"
```

## 5. Bump the version

Update `APP_VERSION` and `APP_UPDATED` near the top of `js/app.js` (they drive the
version/updated-date line in the page footer). There's no build step to derive either
automatically, so this is a manual edit every time, not something to skip because the change
feels small. Get the real current date/time rather than guessing:

```bash
date "+%Y-%m-%d %H:%M (UTC%z)"
```

Bump the version by simple judgment, not strict semver ritual: patch-level for a fix, minor
for a new feature/plot, and don't overthink it beyond that.

## 6. Commit

```bash
git status   # confirm only the files you meant to touch changed
git diff --stat
git add -A
git status   # re-check staged files before committing — catch anything unexpected
```

Write a commit message that explains the *why*, not just the *what*: root cause if it's a
fix, the design decision if it's a feature choice the user made explicitly, and a short note
on what was verified (which test scripts, what they covered). Future-you (or the user,
months later) benefits far more from "why" than from a restatement of the diff.

End every commit message with:

```
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
```

## 7. Push

```bash
git push
```

## 8. Confirm the deploy

This repo's Pages source is set to "deploy from a branch," but GitHub actually serves it
through an auto-generated Actions workflow called `pages build and deployment` — **not** the
legacy Jekyll build pipeline. `gh api repos/SinLiongToo/Cqc-defect-map/pages/builds/latest`
queries that legacy pipeline and has been observed reporting `"errored"` for commits that
the real Actions deployment built and served just fine seconds later — don't use it, and
don't trust it if you see it fail. Check the real thing instead:

```bash
git rev-parse HEAD   # the exact SHA you just pushed
gh run list --workflow=pages-build-deployment --limit 1 --json headSha,status,conclusion
```

Wait for `status` to reach `"completed"` **for that exact SHA** (not just "the latest run" —
if you push twice in quick succession, an older SHA's run can show `"cancelled"` when a
newer push superseded it, which is normal, not a failure). Use a single-shot wait, not a
polling `Monitor` that echoes on every loop iteration regardless of whether anything changed
— that spams duplicate "still building" notifications. `Bash` with `run_in_background` and
an `until` loop gives exactly one notification, when the condition is actually met:

```bash
until run=$(gh run list --workflow=pages-build-deployment --limit 1 --json headSha,status,conclusion 2>&1) && \
  sha=$(echo "$run" | grep -o '"headSha":"[^"]*"' | head -1 | cut -d'"' -f4) && \
  status=$(echo "$run" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4) && \
  [ "$sha" = "<the SHA from git rev-parse HEAD>" ] && [ "$status" = "completed" ]; do
  sleep 5
done
echo "$run"
```

Then verify the live site actually served it, rather than trusting a green status alone —
`curl` for a distinctive string you just added:

```bash
curl -s "https://sinliongtoo.github.io/Cqc-defect-map/js/app.js" | grep -o '<something unique to this change>'
gh api repos/SinLiongToo/Cqc-defect-map/deployments --jq '.[0] | {sha, created_at}'
```

## 9. Report back

Tell the user, concisely: the live URL (https://sinliongtoo.github.io/Cqc-defect-map/),
what changed, and what was verified. If you found and fixed an incidental bug along the way
(this has happened — e.g. the Full View toolbar being stranded behind the modal overlay),
call it out explicitly rather than folding it silently into the main change, since it's
something the user didn't ask for and should know about.
