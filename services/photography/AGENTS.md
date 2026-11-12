# Repository Guidelines

## Project Structure & Module Organization

This repository is a Node.js 22 photography portfolio with a local admin backend. `src/` contains the static renderer and seed content (`content.json`, `render.mjs`, `build.mjs`). `server/` contains the HTTP server, auth, SQLite model, media processing, backup logic, NAS preview helpers, and SQL migrations in `server/migrations/`. `dist/` holds generated pages, browser JavaScript, CSS, admin UI files, and static assets served locally. `tests/` contains Node test-runner suites plus fixtures in `tests/fixtures/`. Documentation and source attribution live in the root Markdown files and `*-IMAGE-SOURCES.json`.

## Build, Test, and Development Commands

- `npm ci`: install exact dependencies from `package-lock.json`.
- `cp .env.example .env`: create local configuration before running the backend.
- `npm start` or `npm run dev`: start the local server with `.env` if present.
- `npm run build`: regenerate static HTML, `dist/photos.js`, and `src/routes.json` from `src/content.json`.
- `npm test`: run all `.test.cjs` and `.test.mjs` files with Node’s built-in test runner.
- `npm run backup` / `npm run restore`: manage local portfolio data backups using `server/backup.mjs`.

## Coding Style & Naming Conventions

Use ESM (`.mjs`) for server and build code unless an existing CommonJS test pattern requires `.cjs`. Follow the compact existing JavaScript style: two-space indentation in blocks, no semicolons, named exports for shared helpers, and lower camelCase for functions and variables. Keep route slugs and content IDs stable, lowercase, and URL-safe. Do not commit `.env`, SQLite databases, imported photo data, backups, or `node_modules/`.

## Testing Guidelines

Tests use `node:test` and `node:assert/strict`. Add focused tests under `tests/` with names like `feature.test.mjs` or `feature.test.cjs`. Backend tests create isolated temporary data; use `TEST_WORK_DIR=/path/to/tmp npm test` only when you need a custom scratch directory. Cover route behavior, data persistence, media handling, and regression cases for any user-facing workflow changes.

## Commit & Pull Request Guidelines

Current history uses concise imperative commit messages, for example `Initialize JIANSHAN photography portfolio and NAS photo studio`. Keep commits scoped and describe the observable change. Pull requests should include a short summary, test results (`npm test`, build if relevant), linked issue or task context, and screenshots or screen recordings for visible portfolio/admin UI changes.

## Security & Configuration Tips

Keep private photos and admin state in `PORTFOLIO_DATA_DIR`, outside the repository. Preserve NAS source files as read-only inputs; imports should write managed copies to the data directory. Never replace real EXIF or dates with invented metadata.
