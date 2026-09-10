# Team walkthrough

Publish packages or a pack from an ordinary Git repository. The public
reference pack is already available for a working walkthrough:
[`doomedramen/agent-packages`](https://github.com/doomedramen/agent-packages).
Developers use the same commands as solo users:

```sh
agents.md init
agents.md add github:doomedramen/agent-packages#packs/typescript-project --ref main
agents.md edit
agents.md check
```

Commit reviewed configuration, generated instructions, local project context,
and lockfile. If CI requires a company convention, select it in project
configuration; global installation cannot provide that repository guarantee.
The committed pack fixture is
[`examples/typescript-monorepo`](https://github.com/doomedramen/agent-packages/tree/main/examples/typescript-monorepo).
