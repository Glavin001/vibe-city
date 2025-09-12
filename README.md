# Vibe City
> A city filled with great vibes made by vibe coding

TODO: Clean up this README.

---


This is a [Next.js](https://nextjs.org) app that integrates a Fluid HTN planner compiled to WebAssembly and tested with [Vitest](https://vitest.dev/). It runs planner calls on Node worker threads to keep the main thread responsive.

## Prerequisites

- Node.js 20.11+ (or 22.x). NPM 10+ recommended.
- Docker (required to build the Fluid HTN WASM AppBundle).

## Install

```bash
npm install
```

## Development

Start the dev server:

```bash
npm run dev
```

- Open http://localhost:3000
- Edit `app/page.tsx` (hot reload enabled).

## Fluid HTN (C# → WASM)

Build the WASM AppBundle and copy it to `public/fluidhtn/_framework`:

```bash
npm run build:fluidhtn
```

- This calls `scripts/build_fluidhtn_docker.sh` (Docker required) and syncs the generated bundle into `examples/app/public/fluidhtn/`.
- Rebuild whenever you change files under `scripts/fluidhtn/` (e.g. `PlannerBridge.cs`).

## Testing (Vitest + worker threads)

All tests use Vitest and invoke the planner on Node worker threads to avoid blocking and timeouts.

Run the full suite:

```bash
npm test
```

Watch mode (interactive):

```bash
npx vitest
```

Included tests (TypeScript + legacy JavaScript):

- `src/tests/fluidhtn.spec.ts`
- `src/tests/fluidhtn.test.js`
- `src/tests/fluidhtn-goals.test.js`
- `src/tests/fluidhtn-demo.test.js`

Key details:

- The WASM bundle must exist at `public/fluidhtn/_framework/` (run `npm run build:fluidhtn` first).
- Tests compute the .NET boot script URL using:
  - `new URL('../../public/fluidhtn/_framework/dotnet.js', import.meta.url).href` (TS/ESM), or
  - `pathToFileURL(path.join(process.cwd(), 'public', 'fluidhtn', '_framework', 'dotnet.js')).href` (legacy JS).
- Worker helpers are provided in `src/lib/fluidhtn.ts`:
  - `runDemoOnWorker(dotnetUrl)`
  - `planGoalOnWorker(dotnetUrl, goalKey)`
  - `planJsonOnWorker(dotnetUrl, payload)`
- Global timeouts are set in `vitest.config.ts` (`testTimeout: 30s`, `hookTimeout: 60s`).
- Legacy `.js` tests and `.ts` tests are both included via `include: ['src/**/*.{test,spec}.{ts,js}']`.

Enable verbose planner logs from C# during tests:

```bash
FLUIDHTN_DEBUG=1 npm test
```

## TypeScript notes

- App is TypeScript-first. See `tsconfig.json` (ESNext, bundler resolution, strict on, JSX preserved).
- When importing internal modules in tests, prefer the explicit `.ts` extension if a `.js` CommonJS twin exists (e.g. `import '../lib/fluidhtn.ts'`) to avoid resolving the CJS helper by accident.

## Troubleshooting

- Tests freeze or time out:
  - Ensure you are calling `planGoalOnWorker` / `planJsonOnWorker` (worker-based), not the main-thread variants.
  - Confirm the WASM bundle exists under `public/fluidhtn/_framework/`.
  - Increase timeouts in `vitest.config.ts` if needed.
- MONO_WASM "Error loading symbol file dotnet.native.js.symbols": harmless for tests; symbol files may be absent.
- Engine warnings:
  - The project pins `vite@^6` for wide Node 20+/22+ compatibility.

## Useful scripts

- `npm run dev` — Next.js dev server
- `npm run build` — Next.js production build
- `npm start` — Next.js production server
- `npm test` — Vitest (run once). Use `npx vitest` for watch/UI.
- `npm run build:fluidhtn` — Build and copy the Fluid HTN WASM AppBundle via Docker

## Learn More

- Next.js: https://nextjs.org/docs
- Vitest: https://vitest.dev/

