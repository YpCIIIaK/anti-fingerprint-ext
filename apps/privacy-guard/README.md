# Privacy Guard — Anti-Fingerprint & Privacy Score (Chrome MV3)

A Chrome MV3 extension that (1) neutralises browser fingerprinting
(Canvas / WebGL / Audio / navigator / screen / fonts), and (2) shows a per-site
**Privacy Score 0–100** with a letter grade and breakdown.

## The core engineering idea

Naïve anti-fingerprinting randomises every API call — but that *noise itself
becomes a fingerprint*. Privacy Guard instead makes the spoof **deterministic
within a session + origin, yet different across origins**:

```
seed = hash(origin + session_salt)
```

The `session_salt` is generated once per browser session by the service worker
(`crypto.getRandomValues`); the per-origin `seed` drives a fast `mulberry32`
PRNG. Same site + same session → identical noise (a re-run produces the same
canvas bytes, so hash-based detection is defeated *and* there is nothing to
correlate). Different site → different noise (no cross-site correlation).

Injection happens in the **MAIN world at `document_start`**, before any page
script runs — see [src/content/inject.ts](src/content/inject.ts).

## Architecture (MV3)

| File | World | Role |
|------|-------|------|
| [background/sw.ts](src/background/sw.ts) | service worker | session salt, settings, per-tab signals, score, badge |
| [content/bridge.ts](src/content/bridge.ts) | ISOLATED | broker between page and SW; relays config + signals |
| [content/inject.ts](src/content/inject.ts) | MAIN @ document_start | installs the fingerprint-API patches |
| [core/seed.ts](src/core/seed.ts) · [core/prng.ts](src/core/prng.ts) | — | deterministic per-origin seed + PRNG |
| [core/spoof/*.ts](src/core/spoof/) | — | canvas, webgl, audio, navigator, screen, fonts |
| [core/score.ts](src/core/score.ts) | — | weighted Privacy Score engine |
| [ui/popup](src/ui/popup/) · [ui/options](src/ui/options/) | — | score breakdown, strictness, allowlist |

### The `document_start` timing trick

The salt lives in the SW (async `chrome.storage`) and can't be read
synchronously in the MAIN world. So `inject.ts` **installs all hooks
synchronously** but they read a *mutable* config that the bridge fills a tick
later via `window.postMessage`. Real fingerprinting calls fire after load, by
which point the seed is in place; until then the hooks no-op, so we never break
the page or noise it with the wrong seed.

## What gets patched

- **Canvas** — `getImageData` / `toDataURL` / `toBlob`: sparse ±1 sub-pixel noise.
- **WebGL** — `getParameter`: spoofed `UNMASKED_RENDERER` / `UNMASKED_VENDOR`.
- **Audio** — `getChannelData` / `getFloatFrequencyData`: ~1e-7 noise floor.
- **navigator** — `hardwareConcurrency`, `deviceMemory`, `languages`.
- **screen** — dimensions rounded to 100px buckets; `availLeft/Top` zeroed.
- **fonts** — `measureText` / `getClientRects` sub-pixel jitter (<0.1px).

Every intercept increments a per-surface counter that feeds the Privacy Score.

## Privacy Score

Start at 100, subtract weighted penalties (weights centralised in
[core/score.ts](src/core/score.ts)): fingerprinting attempts dominate (capped so
one abusive script can't zero everything out), no-HTTPS is a flat hit, blocked
trackers are surfaced as a positive signal. Maps to a letter grade A–F shown on
the toolbar badge.

## Tech stack

TypeScript · Vite (one IIFE build per content entry — Rollup forbids multiple
IIFE inputs in a single build) · Chrome MV3 · `world: "MAIN"` content scripts ·
Web Crypto (session salt) · `chrome.storage.session`/`local` · **no backend, 100%
local**.

## Build & load

```bash
npm install
npm run build        # → dist/
npm run watch        # rebuild on change
```

Then `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select the `dist/` folder. Open the [fingerprint test page](test/fingerprint.html)
(or any site) and click the toolbar icon to see the score.

## Status / milestones

- [x] **M1** MV3 scaffold + Vite build, loads in Chrome, badge works
- [x] **M2** MAIN-world injection + canvas/webgl/audio/nav/screen/fonts spoof + counters
- [x] **M3** declarativeNetRequest tracker blocking (78 domains) + per-site counter
- [x] **M4** Score engine + popup breakdown + blocked-tracker list
- [x] **M5** Options: levels, allowlist, per-site history; per-site tracker exceptions
- [ ] **M6** Screenshots + publish

## Blocked-tracker control

The popup lists every third-party tracker blocked on the current page with a
per-domain toggle. Turning one off allows that tracker **only on the current
site** (a dynamic dNR `allow` rule, priority 2, scoped by `initiatorDomains`),
so you can unblock something that breaks a page without weakening protection
elsewhere. Exceptions persist in settings and are re-synced on SW startup.
