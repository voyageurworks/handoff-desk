# Let your AI assistant set it up

If you use an assistant that can run commands (Claude Code, OpenClaw, Codex, Cursor's agent), paste the block below into it. It asks you three plain questions, runs the guided `setup` command, does the safe steps, runs the check, and tells you in plain words what is left.

The assistant never needs a password, token or code: if a step does, it tells you what to do and waits. Nothing outside the desk folder is changed unless you approve the step.

```
Please set up handoff-desk (an MCP server that lets me hand tasks to my personal agent through a folder of notes) on this computer.
1. Run: npx -y @voyageurworks/handoff-desk setup --help
2. Ask me which assistant sends the notes, who answers them (an agent on this computer, OpenClaw, or a cloud agent) and where the desk folder should be (default ~/handoff).
3. Run the setup command with those answers, for example: npx -y @voyageurworks/handoff-desk setup --client claude-code --agent local --dir <folder>
4. Run each step it prints that is safe to run, one at a time. Do not change my other settings, and do not ask me for passwords, tokens or codes: if a step needs one, tell me exactly what to do and wait.
5. Run the check it prints (doctor) and tell me in plain words what passed, what needs my attention, and what I should say to try it.
```

Prefer to do it yourself? Run `npx -y @voyageurworks/handoff-desk setup` in a terminal: it asks the same questions and prints every step.
