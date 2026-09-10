# Solo developer walkthrough

Use the public v2 packages in
[`doomedramen/agent-packages`](https://github.com/doomedramen/agent-packages).
No private index, account, or organization setup is required.

From a consumer repository:

```sh
agents.md init
agents.md add github:doomedramen/agent-packages#packages/project-typescript --ref main
agents.md edit
agents.md check
```

Review `agents.yaml`, generated `AGENTS.md`, local additions, and
`agents.lock` in Git. The committed fixture is available at
[`examples/direct-project`](https://github.com/doomedramen/agent-packages/tree/main/examples/direct-project).
Replace `main` with a reviewed tag or commit for a real project.
