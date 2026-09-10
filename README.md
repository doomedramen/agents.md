# agents.md

Git-native package manager for AI coding-agent instruction files.

The CLI is distributed through npm as `@doomedramen/agents.md`. Its installed
executable remains `agents.md`.

```sh
npx @doomedramen/agents.md add @doomedramen/agents-nextjs
```

`@owner/repo` is parsed as a GitHub source reference. The package's
`agent.yaml` declares whether each target is project-local or global, so the
CLI does not take a scope flag. `add` replaces the package-declared targets
and records the source commit in the relevant state and lock files.

## Reference packages

This repository includes two original starter packages based on patterns found
in strong public `AGENTS.md` files:

- [Global baseline](examples/global-baseline/): stable cross-project defaults
  for safety, evidence, Git, and collaboration. Review it before installing;
  global instructions affect every project on the machine.
- [TypeScript project](examples/project-typescript/): project-scoped commands,
  repository structure, testing, generated files, and handoff rules.

Try them directly from this Git repository:

```sh
# Project scope: writes AGENTS.md and a Claude import adapter in the current repo
npx @doomedramen/agents.md add @doomedramen/agents.md#examples/project-typescript

# Global scope: writes reusable Codex and Claude defaults for your user account
npx @doomedramen/agents.md add @doomedramen/agents.md#examples/global-baseline
```

The package scope is declared in each example's `agent.yaml`; there is no
`--global` or `--project` flag.

### Public references

The local examples are original compositions, not copies of the linked files.
They draw on these public references:

- [Codex guidance on global and project scope](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Claude Code memory and `@` imports](https://code.claude.com/docs/en/memory)
- [OpenAI Agents Python `AGENTS.md`](https://github.com/openai/openai-agents-python/blob/main/AGENTS.md)
- [OpenAI Codex `AGENTS.md`](https://github.com/openai/codex/blob/main/AGENTS.md)
- [Vercel AI SDK `AGENTS.md`](https://github.com/vercel/ai/blob/main/AGENTS.md)
- [WordPress Contributor Toolkit `AGENTS.md`](https://github.com/WordPress/contributor-toolkit/blob/trunk/AGENTS.md)
- [Fullsend `AGENTS.md`](https://github.com/fullsend-ai/agents/blob/main/AGENTS.md)
- [Codex global template](https://github.com/yuanguang-ai-lab/codex-global-agents-template/blob/main/AGENTS.md)
- [Skills documentation](https://www.skills.sh/docs) for GitHub-native package naming and install examples.

See [examples/README.md](examples/README.md) for the research notes and the
reason each reference was selected.

## Development

```sh
npm install
npm run check
npm run build
```
