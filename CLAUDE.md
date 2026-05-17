# CLAUDE.md

## Project

**Paper Timeline Workbench** — a local Electron desktop app for managing paper submission projects. Tracks projects through stages (idea → submission), manages research assets with versioning, logs timeline events, captures daily summaries, and visualizes project plans on a timeline.

## Tech Stack

- **Runtime**: Electron 35 (main process in CommonJS via `electron/main.cjs`)
- **Frontend**: Vue 3 (Composition API, `<script setup>`) + Vite 8 + TypeScript 6
- **State management**: Pinia (single store in `src/stores/workbench.ts`)
- **Routing**: Vue Router 5 with hash history (`/` → HomeView, `/projects/:id` → ProjectView)
- **Database**: sql.js (SQLite compiled to WASM, runs in both Electron and browser)
- **Path alias**: `@/` maps to `src/`

## Dual-runtime architecture

The app runs in two modes, detected at runtime via `window.paperTimeline?.invoke`:

1. **Electron (desktop)**: Main process handles IPC commands (`electron/main.cjs`), exposes API via preload (`electron/preload.cjs`). Uses real filesystem + SQLite. Frontend calls go through `src/services/desktop.ts` → IPC.
2. **Browser (demo)**: The Pinia store detects missing `window.paperTimeline` and falls back to `localStorage` + in-memory SQLite. Used for `npm run dev` without Electron.

Every operation in the Pinia store branches on `isDesktopRuntime()` at the point of I/O — the store methods themselves contain both code paths.

## Commands

```sh
npm run dev            # Vite dev server (browser mode, no Electron)
npm run electron:dev   # Vite + Electron dev (desktop mode)
npm run build          # Type-check + production build
npm run package:win    # Build + package for Windows (dir output)
npm run dist:win       # Build + NSIS installer for Windows
npm run type-check     # vue-tsc --build (no emit)
```

## Key files

| File | Purpose |
|------|---------|
| `electron/main.cjs` | Electron main process — IPC handlers, SQLite init, file operations (~50KB) |
| `electron/preload.cjs` | Context bridge — exposes `window.paperTimeline.invoke()` |
| `electron/dev.cjs` | Dev launcher — starts Vite then spawns Electron |
| `src/main.ts` | Vue app entry — createApp, install Pinia + Router, mount |
| `src/App.vue` | Shell layout — sidebar (workspace, new project form, project list) + `<RouterView>` |
| `src/types.ts` | All TypeScript interfaces — Project, Asset, Idea, PlanRange, TimelineEvent, etc. |
| `src/stores/workbench.ts` | Single Pinia store — all state, all operations, both runtime paths (~39KB) |
| `src/services/desktop.ts` | Typed IPC wrapper — `desktopApi` object with one method per IPC command |
| `src/router/index.ts` | Two routes: `/` (HomeView) and `/projects/:id` (ProjectView) |
| `src/views/HomeView.vue` | Dashboard — timeline overview, project cards |
| `src/views/ProjectView.vue` | Project detail — assets, ideas, plan ranges, timeline events, daily summaries (~43KB) |
| `src/styles.css` | All styles (~37KB, no scoped styles) |
| `vite.config.ts` | Vite config — Vue plugin, `@/` alias, `base: './'` for Electron file:// |

## Code conventions

- Vue components use `<script setup lang="ts">` with Composition API
- All types live in `src/types.ts` (no types directory, no co-located types)
- The Pinia store is monolithic — all project/asset/idea/plan/timeline state in one `useWorkbenchStore`
- IPC commands use `snake_case` naming
- Styles are global (no CSS modules, no `<style scoped>`)
- Electron main process is CommonJS (`.cjs`), frontend is ESM (`"type": "module"`)
- Project stage lifecycle: `idea` → `survey` → `method_design` → `experiment` → `writing` → `revision` → `submitted` → `archived`
- Assets have a versioning system: each Asset has a `currentVersionId`, versions stored as `AssetVersion[]`

## Database

- sql.js runs SQLite in-memory, persisted to a `.db` file on disk in Electron mode
- Schema includes tables: projects, assets, asset_versions, ideas, plan_ranges, timeline_events, daily_summaries
- Database file is stored inside the workspace directory the user selects
