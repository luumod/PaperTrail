# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project Overview

PaperManager is a local Electron desktop app for managing paper submission projects, research assets, ideas, version snapshots, daily summaries, and timeline exports.

The app also runs in a browser demo mode through Vite. Runtime behavior is selected at runtime by checking `window.paperTimeline?.invoke`.

## Tech Stack

- Electron 35 main process in CommonJS under `electron/`
- Vue 3 with Composition API and `<script setup lang="ts">`
- Vite 8 and TypeScript 6
- Pinia for state management
- Vue Router with hash history
- `sql.js` for SQLite-backed project data in Electron mode
- Global CSS in `src/styles.css`
- `@/` path alias maps to `src/`

## Important Files

- `electron/main.cjs`: Electron main process, IPC handlers, SQLite persistence, filesystem operations.
- `electron/preload.cjs`: Context bridge exposing `window.paperTimeline.invoke()`.
- `electron/dev.cjs`: Development launcher for Vite plus Electron.
- `src/main.ts`: Vue app bootstrap.
- `src/App.vue`: Main shell, sidebar, workspace selector, project creation, project navigation.
- `src/router/index.ts`: App routes.
- `src/stores/workbench.ts`: Single Pinia store containing state, derived data, mutations, and both Electron/browser persistence paths.
- `src/services/desktop.ts`: Typed frontend wrapper around Electron IPC commands.
- `src/types.ts`: Shared TypeScript domain types.
- `src/views/HomeView.vue`: Dashboard and project overview.
- `src/views/ProjectView.vue`: Project detail workspace.
- `src/styles.css`: Global application styling.
- `vite.config.ts`: Vite configuration, Vue plugin, devtools plugin, `@/` alias, and `base: './'` for packaged Electron loading.

## Commands

Use these scripts from the repository root:

```sh
npm run dev
npm run electron:dev
npm run type-check
npm run build
npm run package:win
npm run dist:win
```

Command purposes:

- `npm run dev`: Start Vite in browser demo mode.
- `npm run electron:dev`: Start Vite and Electron desktop mode.
- `npm run type-check`: Run `vue-tsc --build`.
- `npm run build`: Type-check and build production assets.
- `npm run package:win`: Build and create unpacked Windows output.
- `npm run dist:win`: Build and create a Windows NSIS installer.

Prefer `npm run type-check` for focused validation after TypeScript or Vue changes. Run `npm run build` before packaging or after changes that may affect bundling.

## Architecture Rules

This app has two runtime paths:

1. Electron desktop mode
   - Available when `window.paperTimeline?.invoke` exists.
   - Frontend calls `desktopApi` in `src/services/desktop.ts`.
   - `desktopApi` sends snake_case IPC commands to `electron/main.cjs`.
   - Data is persisted with SQLite and real filesystem operations.

2. Browser demo mode
   - Used when Electron IPC is unavailable.
   - The Pinia store falls back to `localStorage` and browser-only file metadata.
   - File opening/revealing should not be implemented as real filesystem behavior in browser mode.

When adding or changing a feature, update both runtime paths when the behavior touches persistence, assets, projects, plans, ideas, timeline events, or exports.

## Code Conventions

- Keep Vue components on the Composition API with `<script setup lang="ts">`.
- Keep shared domain interfaces in `src/types.ts`.
- Keep IPC frontend wrappers in `src/services/desktop.ts`.
- Use snake_case IPC command names.
- Use camelCase for TypeScript variables, properties, and functions.
- Preserve the current monolithic Pinia store structure unless a user explicitly asks for a refactor.
- Keep styles in `src/styles.css`; this project does not use scoped styles or CSS modules.
- Keep Electron main/preload files as `.cjs` CommonJS files.
- Frontend code is ESM because `package.json` uses `"type": "module"`.
- Avoid adding new dependencies unless they clearly reduce implementation risk or match an existing project need.

## Data Model Notes

Core domain entities live in `src/types.ts`:

- `Project`
- `Asset`
- `AssetVersion`
- `Idea`
- `ProjectPlanRange`
- `TimelineEvent`
- `DailySummary`
- `ProjectBundle`
- `WorkspaceSnapshot`

Project stages are:

```txt
idea -> survey -> method_design -> experiment -> writing -> revision -> submitted -> archived
```

Assets use a versioning model:

- Each `Asset` has `currentVersionId`.
- Historical versions are stored as `AssetVersion[]`.
- Version-changing operations should create timeline events where appropriate.

## Persistence and Filesystem Guidelines

- Electron mode should perform real persistence and filesystem operations only through IPC handlers in `electron/main.cjs`.
- Renderer code must not import Node filesystem APIs directly.
- Browser mode should remain a safe demo path using `localStorage` and metadata-only asset handling.
- Workspace selection and project database behavior must remain user-controlled.
- Do not write generated project data into the repository unless the task explicitly asks for fixtures or tests.

## UI Guidelines

- Follow the existing dense workbench layout instead of adding marketing-style pages.
- Reuse existing button, panel, timeline, form, and list styles in `src/styles.css`.
- Keep labels concise and task-oriented.
- Keep text responsive; do not introduce fixed-width text layouts that can overflow.
- When adding controls, make disabled/loading/error states explicit if the action touches persistence or IPC.

## Change Checklist

Before finishing a code change:

1. Check whether the change affects both Electron and browser demo mode.
2. Update `src/types.ts` first if the domain shape changes.
3. Update `src/services/desktop.ts` and `electron/main.cjs` together for IPC changes.
4. Keep timeline events and `updatedAt` behavior consistent with nearby store methods.
5. Run `npm run type-check` when TypeScript, Vue, or types changed.
6. Run `npm run build` when build configuration, packaging, Electron loading, or asset paths changed.

## Repository Hygiene

- Do not commit build output, packaged app output, `node_modules`, logs, or generated workspace databases.
- Avoid broad refactors in `src/stores/workbench.ts` unless requested; make surgical changes around the relevant operation.
- Preserve user changes in the working tree. Do not revert unrelated edits.
- If Git reports dubious ownership, do not change global Git configuration unless the user approves it.

