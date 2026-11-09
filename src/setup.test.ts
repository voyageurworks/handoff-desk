import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENTS } from "./clientConfig.js";
import { AGENTS, SETUP_PROMPT, STANDING_ORDERS, setupCommand, setupSteps } from "./setup.js";

const root = path.resolve(import.meta.dirname, "..");
const fresh = () => mkdtemp(path.join(tmpdir(), "handoff setup-"));
const dedent = (text: string) => text.split("\n").map(line => line.replace(/^ {1,3}/, "")).join("\n");

describe("setup steps", () => {
  it("renders for every client, agent and system without throwing, with the real folder in it", () => {
    for (const client of CLIENTS) for (const agent of AGENTS) for (const windows of [false, true]) {
      const text = setupSteps({ client: client.id, agent: agent.id, dir: windows ? "C:\\Users\\dad\\my desk" : "/home/dad/my desk", windows });
      expect(text).toContain(windows ? "C:/Users/dad/my desk" : "/home/dad/my desk");
      expect(text).toMatch(/npx -y @voyageurworks\/handoff-desk --version/);
      expect(text).toMatch(/doctor/);
      expect(text).toMatch(/reply with pong/);
    }
  });
  it("uses the PowerShell form of the check on Windows and the shell form elsewhere", () => {
    expect(setupSteps({ client: "claude-code", agent: "local", dir: "C:/d", windows: true })).toContain('$env:HANDOFF_DIR = "C:/d"; npx');
    expect(setupSteps({ client: "claude-code", agent: "local", dir: "/d", windows: false })).toContain('HANDOFF_DIR="/d" npx');
  });
  it("gives OpenClaw its command once, the standing orders and both ways to wake it", () => {
    const text = setupSteps({ client: "claude-code", agent: "openclaw", dir: "/d", windows: false });
    expect(text.match(/openclaw mcp add handoff/g)).toHaveLength(1);
    expect(text).toContain("## Handoff desk");
    expect(text).toMatch(/scheduled check/);
    expect(text).toMatch(/wake call/);
    expect(setupSteps({ client: "openclaw", agent: "openclaw", dir: "/d", windows: false }).match(/openclaw mcp add handoff/g)).toHaveLength(1);
  });
  it("tells a cloud setup to use a private repository", () => {
    expect(setupSteps({ client: "cursor", agent: "cloud", dir: "/d", windows: false })).toMatch(/PRIVATE git repository/);
  });
});

describe("the setup command", () => {
  it("creates the desk from flags, and a second run keeps everything", async () => {
    const dir = path.join(await fresh(), "my desk");
    const first = await setupCommand(["--client", "codex", "--agent", "local", "--dir", dir], { defaultDir: dir, platform: "linux" });
    expect(first.code).toBe(0);
    expect(first.out).toContain("Created: Desk, Inbox, mail, handoff.md");
    expect((await stat(path.join(dir, "handoff.md"))).isFile()).toBe(true);
    const second = await setupCommand(["--client", "codex", "--dir", dir], { defaultDir: dir, platform: "linux" });
    expect(second.out).toContain("Created: nothing");
  });
  it("asks when it is interactive and flags are missing, and accepts a number or an id", async () => {
    const dir = await fresh();
    const answers = ["3", "2", dir];
    const asked: string[] = [];
    const result = await setupCommand([], { interactive: true, ask: async question => (asked.push(question), answers.shift() ?? ""), defaultDir: "/unused", platform: "linux" });
    expect(result.code).toBe(0);
    expect(asked).toHaveLength(3);
    expect(result.out).toContain("Setup for Cursor, answered by OpenClaw");
    const list = ["gemini-cli", "cloud", dir];
    const byId = await setupCommand([], { interactive: true, ask: async () => list.shift() ?? "", defaultDir: dir, platform: "linux" });
    expect(byId.out).toContain("Setup for Gemini CLI");
  });
  it("uses defaults without asking when it is not interactive", async () => {
    const dir = await fresh();
    const result = await setupCommand([], { defaultDir: dir, platform: "linux" });
    expect(result.out).toContain("Setup for Claude Code, answered by An agent on this computer");
  });
  it("says what is wrong for an unknown client or agent, and creates nothing", async () => {
    const dir = path.join(await fresh(), "never");
    const client = await setupCommand(["--client", "nope", "--dir", dir], { defaultDir: dir });
    expect(client).toMatchObject({ code: 2 });
    expect(client.out).toMatch(/Unknown client "nope"/);
    const agent = await setupCommand(["--agent", "robot", "--dir", dir], { defaultDir: dir });
    expect(agent.out).toMatch(/Unknown agent "robot"/);
    await expect(stat(dir)).rejects.toThrow();
  });
  it("prints usage for --help and the paste-in prompt for --prompt, without touching disk", async () => {
    expect((await setupCommand(["--help"], { defaultDir: "/x" })).out).toMatch(/Usage: handoff-desk setup/);
    expect((await setupCommand(["--prompt"], { defaultDir: "/x" })).out).toBe(SETUP_PROMPT);
  });
});

describe("the documents carry the same text the command prints", () => {
  it("docs/openclaw.md has the standing orders, word for word", async () => {
    expect(dedent(await readFile(path.join(root, "docs", "openclaw.md"), "utf8"))).toContain(STANDING_ORDERS);
  });
  it("docs/setup-prompt.md has the paste-in prompt, word for word", async () => {
    expect(await readFile(path.join(root, "docs", "setup-prompt.md"), "utf8")).toContain(SETUP_PROMPT);
  });
});
