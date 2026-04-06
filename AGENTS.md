# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Vibe City is a Next.js 15 web app with 3D interactive demos using Three.js/React Three Fiber, Rapier physics, and various AI features. It is a purely client-side application — no database, no backend API routes, no external services required to run.

### Key commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Dev server | `npm run dev` (port 3000) |
| Lint | `npm run lint` (biome check) |
| Format | `npm run format` |
| Tests | `npm test` (vitest run) |
| Storybook | `npm run storybook` (port 6006) |

### Non-obvious caveats

- **Node version**: `.nvmrc` specifies v22.12.0. Any Node 22.x works.
- **Playwright browsers required for tests**: Storybook browser tests (vitest Storybook project) need Playwright Chromium installed (`npx playwright install chromium`). Without it, `npm test` will fail on the storybook test project.
- **FluidHTN WASM tests fail without Docker build**: 14 tests in `bunker_planner.spec.ts` and `fluidhtn-demo.test.ts` expect the WASM bundle at `public/planner/_framework/dotnet.js`. This requires `npm run build:planner` (Docker needed). These failures are expected in environments without Docker.
- **Biome lint has pre-existing formatting warnings**: `npm run lint` reports formatting issues already in the codebase (not introduced by agent changes).
- **3D demos are heavy**: Pages using physics + 3D rendering (e.g., `/destructible-stress`) may take several seconds to initialize. Wait for the scene to load before interacting.
- **Google Gemini API key**: AI chat features require a user-supplied API key stored in browser localStorage. No server-side env vars needed.
- **Click-to-fire projectiles**: On the `/destructible-stress` page, clicking on the 3D canvas in "projectile" mode fires a projectile at that location. The control panel allows switching structures and interaction modes.
