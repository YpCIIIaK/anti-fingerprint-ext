# ext-suite — privacy-focused Chrome extensions

A monorepo (npm workspaces) for a suite of privacy-focused Chrome MV3
extensions. Each extension lives under `apps/` and builds independently into its
own `dist/` folder.

## Extensions

| Extension | Folder | Status | What it does |
|-----------|--------|--------|--------------|
| **Privacy Guard** | [apps/privacy-guard](apps/privacy-guard) | active | Anti-fingerprinting (Canvas/WebGL/Audio/navigator/screen/fonts), tracker blocking, per-site Privacy Score |
| _(next)_ | `apps/…` | planned | — |

## Layout

```
ext-suite/
├─ package.json          # workspace root (npm workspaces: apps/*)
└─ apps/
   └─ privacy-guard/     # one extension = one workspace
      ├─ package.json
      ├─ build.mjs       # Vite multi-IIFE build → dist/
      ├─ src/
      └─ static/
```

## Build

```bash
npm install                 # installs all workspaces (deps hoist to root)
npm run build               # build every extension
npm run build:privacy-guard # build just one
```

Load any built extension via `chrome://extensions` → Developer mode → Load
unpacked → select that extension's `apps/<name>/dist` folder.

## Adding a new extension

1. `mkdir apps/<name>` and add a `package.json` named `@ext-suite/<name>`.
2. Reuse the Privacy Guard build setup (`build.mjs` + `static/manifest.json`).
3. `npm install` from the root picks it up automatically (workspace glob).
