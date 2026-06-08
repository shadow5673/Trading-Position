# CLAUDE.md

Guidance for AI assistants (and humans) working in this repository.

## What this is

A single-page **position-management calculator** (仓位管理 · Position Manager) for
leveraged stock/margin trading. It takes a margin balance and leverage ratio,
derives a "full position" target, splits it into **6 units ("苹果"/apples)**, and
displays the resulting take-profit / stop-loss / add-position rules with live
JPY amounts and trigger prices.

The UI is in mixed **Chinese + Japanese**. There is no backend — all state lives
in the browser's `localStorage`.

## Tech stack

- **Vanilla HTML / CSS / JavaScript** — no framework, no build step, no package manager.
- No dependencies are installed locally. The only external resource is Google
  Fonts (`JetBrains Mono`, `Noto Serif JP`) loaded via `<link>` in `index.html`.
- No tests, no linter, no CI build. The "build" is the source files themselves.

## File layout

| File | Role |
|------|------|
| `index.html` | Markup + structure. All element IDs the JS reads/writes live here. |
| `styles.css` | All styling. Dark theme driven by CSS custom properties in `:root`. |
| `script.js`  | All logic: parsing inputs, calculating positions, rendering, persistence. |
| `README.md`  | One-line title only. |

That's the entire app — four files at the repo root, no subdirectories.

## How it works (script.js)

- `STORE_KEY = 'positionManagerData'` — localStorage key.
- `VERSION` — version string (e.g. `'v16'`); kept in sync with the cache-busting
  query params and commit messages (see **Versioning** below).
- **Persisted inputs:** only `margin`, `leverage`, and `cost` are saved/restored
  via `saveState()` / `loadState()`.
- **Core math** (`recalc()`):
  - `fullPos = margin * leverage`
  - `apple = fullPos / 6` (one "苹果"/apple = 1/6 of full position)
  - Mobile position (机动仓) = 3 apples; fixed/base position (固定仓) = 3 apples.
- **`RULES` array** drives the take-profit / stop-loss table. Each entry is
  `{ id, pct, apples }`:
  - `id` must match the element IDs in `index.html` — the code looks up
    `<id>-price` and `<id>-value`. **If you add/rename a rule, update both files.**
  - `pct` is the percentage move from cost (positive = profit, negative = loss).
  - `apples` is how many units the action affects.
  - Current rules: `tp8 +8%`, `tp15 +15%`, `tp25 +25%` (sell 1 apple each);
    `sl5 -5%` (1), `sl9 -9%` (2), `sl13 -13%` (6 = liquidate all).
- **Formatting helpers:** `fmtJPY` (¥ with 億/万 abbreviations), `fmtPrice`
  (2-decimal price), `parseNum` (strips commas/whitespace).
- Inputs `margin`, `leverage`, `cost` each have an `input` listener calling
  `recalc()`, so the display updates live on every keystroke. `recalc()` also
  calls `saveState()`.

The trading-strategy semantics (always trim the mobile position first, EMA5/EMA25
add-back rules, etc.) are documented in the on-screen text in `index.html` — treat
that copy as the source of truth for strategy wording.

## Conventions

### Versioning (important — keep three places in sync)

When you make a user-facing change, bump the version in **all** of these:

1. `script.js` → `const VERSION = 'vN';`
2. `index.html` → cache-busting query params: `styles.css?v=N` and `script.js?v=N`
   (both, on lines `<link ... href="styles.css?v=N">` and `<script src="script.js?v=N">`).
3. The git commit message (see below).

The `?v=N` params exist purely to bust browser cache for the static assets — if
you ship CSS/JS changes without bumping them, returning users may see stale files.

### Commit messages

Follow the existing history's format: `vN:<简短中文描述>`
(e.g. `v16:规则大改`, `v14:均价改用 accent 金色高亮,加粗`). Version number
matches the bump above. Descriptions are written in Chinese.

### Styling

- All colors come from CSS variables in `:root` (`--bg`, `--accent`, `--green`,
  `--red`, `--amber`, etc.). Use these rather than hard-coded hex values.
- Profit elements use `--green`, loss uses `--red`, highlights/average-price use
  the gold `--accent`.
- There is a mobile breakpoint at `@media (max-width: 800px)`. Verify layout at
  both widths when changing the grid/rule layout.
- Numeric values use `font-variant-numeric: tabular-nums` (via `.num` or per-rule
  rules) for alignment — keep that on anything displaying numbers.

## Development workflow

There is no build or test command. To work on this:

1. Open `index.html` directly in a browser, or serve the folder
   (e.g. `python3 -m http.server`) and load it.
2. Edit the source files; reload the browser to see changes. Bump the `?v=N`
   params if you want to force a cache refresh.
3. Manually verify both desktop and mobile (≤800px) layouts, and confirm
   `localStorage` persistence by reloading after entering values.

### Git / branching

- Feature work happens on a `claude/...` branch; pushes go via
  `git push -u origin <branch-name>`.
- Do **not** open a pull request unless explicitly asked.
- Changes land on `main` through merged PRs (see history).

## Things to watch out for

- **Element-ID coupling:** `script.js` addresses DOM nodes by hard-coded IDs.
  Renaming an `id` in `index.html` without updating the JS silently breaks that
  field. The `RULES[].id` ↔ `#<id>-price` / `#<id>-value` mapping is the most
  fragile link.
- **No input validation beyond `parseNum`** — non-numeric `cost` hides the rule
  prices (shows `(—)`), which is intended behavior, not a bug.
- Keep the UI language consistent (Chinese for labels/strategy, Japanese for the
  finance terms already in use like 信用保証金 / レバレッジ倍率).
