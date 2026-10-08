# Repository Guidelines

## Project Structure & Module Organization

This workspace currently has no application code, dependency manifests, tests, assets, or Git metadata. Establish the layout when adding the first implementation. Suggested directories are `src/` for application modules, `tests/` for automated tests, and `assets/` for static resources. Document the actual structure in `README.md`; keep generated output separate from source.

## Build, Test, and Development Commands

No build, test, or development commands are configured yet. When selecting a toolchain, define reproducible commands in its manifest or task runner and document installation, local startup, testing, and production builds in `README.md`. Run commands from the repository root. Do not assume that `npm test` or another framework-specific command is available until configured.

## Coding Style & Naming Conventions

No language, formatter, or linter has been established. Configure the language's standard formatter and linter with the initial implementation. Until then, use two spaces for JavaScript, TypeScript, JSON, and YAML; use four spaces for Python. Use descriptive names, keep modules focused, and follow the chosen language's naming conventions consistently. Avoid mixing unrelated formatting changes with functional edits.

## Testing Guidelines

No testing framework or coverage threshold exists. Select a framework alongside the initial application and document its test command. Name tests after the behavior or module they exercise, following the framework's discovery rules. Cover new behavior and add regression tests for bug fixes. Keep fixtures deterministic and independent of live credentials.

## Commit & Pull Request Guidelines

Git history is unavailable, so no existing commit convention can be inferred. Use short, imperative subjects such as `Add application entry point`. Keep commits focused. Pull requests should explain the change, link relevant issues, and report verification commands and results. Include screenshots for visible UI changes and note configuration changes.

## Security & Configuration

Keep credentials and local configuration out of version control. Provide sanitized examples such as `.env.example` when configuration is introduced.

## Agent-Specific Instructions

Prefer codebase-memory-mcp graph tools for code discovery. Use CodeGraph when a `.codegraph/` index exists; otherwise skip it. Fall back to text searches for configuration, literals, or insufficient graph results. Implementation and review subagents must use `gpt-6-luna` with `xhigh` reasoning; stop and report if unavailable.
