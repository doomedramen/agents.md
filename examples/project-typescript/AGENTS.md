# TypeScript project agent instructions

This example assumes a Node.js and TypeScript repository. Replace its commands
and paths with facts from the target codebase before adopting it.

## Repository map

- `src/` contains production TypeScript.
- `test/` contains executable tests and fixtures.
- `docs/` contains user and developer documentation.
- `dist/` is generated build output; never edit it by hand.

## Working agreement

- Read `README.md`, `package.json`, `tsconfig.json`, and nearby code before changing behavior.
- Keep production code in `src/` and follow the existing ESM, naming, and error-handling conventions.
- Preserve public APIs and package entry points unless the change explicitly requires a break.
- Add or update a focused regression test for each behavior change.
- Update documentation when commands, public behavior, or repository structure changes.

## Validation

- Run `npm run check` before handoff; it is the required lint, type, and test gate for this example.
- Run `npm run build` when changing build configuration or distribution behavior.
- During iteration, run the narrowest relevant test before the full check.
- Report the exact commands and results; call out checks that could not run.

## Boundaries

- Do not edit generated `dist/` files directly; change source and rebuild.
- Do not commit `.env` files, credentials, tokens, or generated local state.
- Preserve unrelated working-tree changes.
- Keep changes focused; do not add dependencies or broad refactors without a concrete need.

## Handoff

Summarize changed behavior, tests run, documentation updates, and any known
follow-up. Leave the repository in a state another contributor can inspect and
verify.
