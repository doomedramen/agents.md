# Reference packages

These packages are intentionally small, editable starting points. The global
example contains only stable cross-project behavior. The project example
contains repository facts, commands, and boundaries that belong closer to a
codebase.

They are original compositions informed by public references. The repository
does not redistribute the linked projects' `AGENTS.md` text.

## Install the examples

From any Git repository, run one of these commands:

```sh
# Project-scoped instructions
npx @doomedramen/agents.md add @doomedramen/agents.md#examples/project-typescript

# User-global instructions for Codex and Claude Code
npx @doomedramen/agents.md add @doomedramen/agents.md#examples/global-baseline
```

The scope and target agent are declared by `agent.yaml`. A global package can
change files outside the current project, so inspect it before installing.

## What good references have in common

- Global files describe stable working agreements, safety boundaries, evidence
  standards, and collaboration defaults. They do not pretend to know a
  repository's commands or architecture.
- Project files give an agent a compact map of the repository, the commands
  that are actually expected to pass, important generated-file boundaries,
  and project-specific risks.
- Rules are concrete and verifiable. “Run the relevant checks” is weaker than
  naming the repository's check command and saying what to report.
- Shared guidance lives in one canonical `AGENTS.md`. Native adapters such as
  Claude's `CLAUDE.md` should point to it instead of duplicating it.
- The highest-value instructions are non-obvious. File names, package scripts,
  and directory layout already provide facts an agent can discover quickly.

## Research references

Reviewed 2026-09-10. These are reading references, not endorsements of every
repository-specific rule in each file.

| Reference | Scope signal | Useful pattern |
| --- | --- | --- |
| [Codex AGENTS.md documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md) | Official global + project behavior | Layered discovery, closer project rules, and explicit global guidance. |
| [Claude Code memory documentation](https://code.claude.com/docs/en/memory) | Official user + project behavior | Concise instructions, scope-aware placement, and `@AGENTS.md` imports. |
| [OpenAI Agents Python](https://github.com/openai/openai-agents-python/blob/main/AGENTS.md) | Project | Repository map, operating guide, review policy, and test guidance. |
| [OpenAI Codex](https://github.com/openai/codex/blob/main/AGENTS.md) | Project/subsystem | File-local conventions, generated-file reminders, and focused test rules. |
| [Vercel AI SDK](https://github.com/vercel/ai/blob/main/AGENTS.md) | Project/monorepo | Commands, package boundaries, example layout, tests, architecture, and ADR routing. |
| [WordPress Contributor Toolkit](https://github.com/WordPress/contributor-toolkit/blob/trunk/AGENTS.md) | Project | One canonical tool-neutral file with thin native wrappers to prevent drift. |
| [Fullsend](https://github.com/fullsend-ai/agents/blob/main/AGENTS.md) | Project | Think-first, simplicity-first, surgical changes, and goal-driven verification. |
| [Codex global template](https://github.com/yuanguang-ai-lab/codex-global-agents-template/blob/main/AGENTS.md) | Global | Explicitly keeps commands and architecture out of global guidance. |
| [Skills documentation](https://www.skills.sh/docs) | Repository/package UX | GitHub owner/repo install syntax and a simple README-first discovery surface. |

The examples intentionally combine these patterns without copying their
prose, project assumptions, or licenses.
