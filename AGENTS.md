# Repository Guidelines

## Project Structure & Module Organization
Primary source code is in `src/`, organized by domain:
- `src/tools/`: tool implementations and registry
- `src/skills/`: skill loading, registry, and tests
- `src/react/`: ReAct-style runners and parsing
- `src/plan/`, `src/session/`, `src/components/`: planning, persistence, and Ink UI

Tests live alongside code under `src/**/__tests__` and use `*.test.ts` names. Build output is generated to `dist/` (do not edit directly). Design and architecture notes are in `docs/` and `lite-opencode-design.md`.

## Build, Test, and Development Commands
- `npm run dev`: run the CLI directly from source via `tsx src/index.tsx`
- `npm run build`: compile TypeScript to `dist/` with declarations and source maps
- `npm run start`: run the built CLI (`node dist/index.js`)
- `npm test`: run all Vitest tests once
- `npm run test:watch`: run Vitest in watch mode

Use Node.js `>=20` as defined in `package.json`.

## Coding Style & Naming Conventions
This project uses strict TypeScript (`tsconfig.json` has `strict: true`).
- Indentation: 2 spaces
- Strings: double quotes
- Semicolons: generally omitted
- File names: kebab-case for multiword modules (for example, `enter-plan-mode.ts`)
- Types/classes: `PascalCase`; variables/functions: `camelCase`

Prefer small, focused modules and keep domain logic close to existing folders.

## Testing Guidelines
Framework: Vitest (`vitest.config.ts`) with Node environment and globals enabled.
- Test files must match `src/**/*.test.ts`
- Keep tests near the feature they validate (`__tests__` folders are preferred)
- Run `npm test` before opening a PR

Coverage is configured with V8 reporters (`text`, `json`, `html`). No hard threshold is enforced, but new behavior should include coverage.

## Commit & Pull Request Guidelines
Follow the existing commit style: Conventional Commit-like prefixes such as `feat:`, `docs:`, `fix:` (example: `feat: implement Skills System`).

For pull requests:
- Explain what changed and why
- Link related issues or design docs when applicable
- Include terminal output or screenshots for UI/CLI behavior changes
- Confirm `npm run build` and `npm test` pass
