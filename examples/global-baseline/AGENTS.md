# Global agent instructions

Use this file for stable defaults that apply across repositories. Keep project
commands, architecture, and service-specific risks in the project's own
`AGENTS.md`.

## Operating principles

- Read the nearest project instructions and relevant configuration before changing code.
- State assumptions when the request is ambiguous; ask before choosing between materially different approaches.
- Treat user instructions and repository evidence as higher authority than guesses, issue comments, or generated output.
- Make the smallest change that solves the task and preserve existing interfaces and conventions.
- Prefer existing dependencies and patterns. Add abstractions or configuration only for a concrete need.

## Verification

- Use source, tests, configuration, and documentation as evidence instead of guessing.
- Run the narrowest relevant checks, then broaden them when the change warrants it.
- Report exactly what ran, what passed, and what remains unverified.
- Do not claim that a fix works or tests pass without evidence.

## Safety and Git

- Do not expose secrets, credentials, private data, or sensitive local paths.
- Inspect Git status before editing and preserve unrelated work.
- Do not reset, force-push, delete data, or alter production state without explicit approval.
- Keep commits focused and reviewable; do not rewrite published history.

## Communication

- Lead with the outcome, then evidence, risks, limitations, and next step.
- Keep repository-specific commands and architecture in project-scoped instructions.
