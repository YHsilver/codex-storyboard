# Repository Guidelines

## Project Structure & Module Organization

This repository is a local Codex Storyboard web app and bundled Codex plugin. The Node.js server entry point is `server.mjs`; it serves the native frontend in `public/` and exposes JSON/media APIs. Frontend code lives in `public/app.js`, styling in `public/styles.css`, and markup in `public/index.html`. Runtime project state is stored under `data/`, including `data/projects/<project-id>/project.json`, optional `DESIGN.md`, and uploaded media; treat this as local generated state unless a change explicitly requires fixtures. Product and design notes live in `README.md`, `PRODUCT.md`, `DESIGN.md`, and `docs/`. Plugin code is under `plugins/codex-storyboard/`, with MCP tools in `mcp/server.mjs`, scripts in `scripts/`, and skill instructions in `skills/`.

## Build, Test, and Development Commands

- `npm start`: starts the local server on `http://127.0.0.1:43218` by default. Set `PORT=43219 npm start` to use another port.
- `npm run check`: syntax-checks `server.mjs` and `public/app.js` with Node.
- `codex plugin marketplace add .` and `codex plugin add codex-storyboard@codex-storyboard`: register and install the local plugin while developing plugin changes.

The app has no runtime npm dependencies; use Node.js 18 or newer.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, and double quotes for JavaScript. Prefer small helper functions near related behavior, as in `server.mjs`. Keep API responses JSON-shaped and use existing naming patterns such as `projectId`, `shotId`, `generationStatus`, and `visualPrompt`. CSS uses custom properties in `:root`; extend those tokens before adding one-off colors.

## Testing Guidelines

There is no formal test suite yet. For code changes, run `npm run check` at minimum. For behavior changes, also run `npm start` and manually verify the affected flow in the browser, such as project creation, shot editing, media upload, task generation, or plugin queue processing. Name future tests after the behavior under test, for example `generation-tasks.test.mjs`.

## Commit & Pull Request Guidelines

Git history is currently minimal, so use concise imperative commit messages such as `Add generation task validation` or `Update storyboard table styles`. Pull requests should describe the user-facing change, list verification steps, mention data migration or compatibility risks, and include screenshots or short recordings for UI changes.

## Security & Configuration Tips

Do not trust uploaded file names or project IDs; preserve the existing validation and path-safety checks. Keep generated media and local project data out of commits unless intentionally adding sample assets or fixtures.

## Dreamina CLI Confirmation Rule

Before running any `dreamina` command that submits generation, polls or downloads generation results, changes account/session state, or may spend credits, show the exact command to the user and wait for explicit manual confirmation. Capability checks such as `dreamina -h`, `dreamina version`, and `dreamina user_credit` may run without confirmation.
