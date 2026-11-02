import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENTS, PACKAGE } from "./clientConfig.js";
import { INSTALLABLE, installClient } from "./install.js";
import { ensureBuilt } from "./testBuild.js";

const home = async () => mkdtemp(path.join(tmpdir(), "handoff install home-"));
const base = { dir: "~/handoff", windows: false, write: false, force: false };
const entry = { command: "npx", args: ["-y", PACKAGE], env: { HANDOFF_DIR: "~/handoff" } };
const read = async (file: string) => readFile(file, "utf8");
const files = async (dir: string) => (await readdir(dir)).sort();
// Fake secret assembled at run time so no scanner sees one in the source.
const secret = `${"6".repeat(9)}:${"p".repeat(35)}`;

describe("which clients it can edit", () => {
  it("only those with a documented strict-JSON user file; every other client is config-only", () => {
    expect([...INSTALLABLE].sort()).toEqual(["amp", "cursor", "gemini-cli", "kiro", "lm-studio"]);
    for (const id of INSTALLABLE) expect(CLIENTS.some(client => client.id === id)).toBe(true);
  });
});

describe("dry run (the default)", () => {
  it("shows the file and the entry, and changes nothing", async () => {
    const h = await home();
    const result = await installClient("cursor", { ...base, home: h });
    expect(result.code).toBe(0);
    expect(result.message).toContain(path.join(h, ".cursor", "mcp.json"));
    expect(result.message).toContain('"handoff"');
    expect(result.message).toMatch(/--write/);
    expect(await files(h)).toEqual([]);
  });
  it("shows only the handoff entry, never the rest of the file or other servers' settings", async () => {
    const h = await home();
    const target = path.join(h, ".cursor", "mcp.json");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify({ mcpServers: { other: { command: "x", env: { API_KEY: secret } } } }), "utf8");
    const result = await installClient("cursor", { ...base, home: h });
    expect(result.message).not.toContain(secret);
    expect(result.message).not.toContain("other");
  });
});

describe("--write", () => {
  it.each([
    ["cursor", [".cursor", "mcp.json"], "mcpServers"],
    ["gemini-cli", [".gemini", "settings.json"], "mcpServers"],
    ["lm-studio", [".lmstudio", "mcp.json"], "mcpServers"],
    ["kiro", [".kiro", "settings", "mcp.json"], "mcpServers"],
    ["amp", [".config", "amp", "settings.json"], "amp.mcpServers"],
  ])("%s: creates the file where the client reads it", async (id, parts, key) => {
    const h = await home();
    const result = await installClient(id, { ...base, home: h, write: true });
    expect(result.code).toBe(0);
    const written = JSON.parse(await read(path.join(h, ...parts)));
    expect(written[key].handoff).toEqual(entry);
  });

  it("merges into an existing file: other servers and keys, the indent and the line endings stay, and a backup is made", async () => {
    const h = await home();
    const target = path.join(h, ".cursor", "mcp.json");
    await mkdir(path.dirname(target), { recursive: true });
    const original = `{\r\n    "theme": "dark",\r\n    "mcpServers": {\r\n        "other": { "command": "x" }\r\n    }\r\n}\r\n`;
    await writeFile(target, original, "utf8");
    const result = await installClient("cursor", { ...base, home: h, write: true });
    expect(result.code).toBe(0);
    const text = await read(target);
    const parsed = JSON.parse(text);
    expect(parsed.theme).toBe("dark");
    expect(parsed.mcpServers.other).toEqual({ command: "x" });
    expect(parsed.mcpServers.handoff).toEqual(entry);
    expect(text).toContain("\r\n");
    expect(text).toContain('\r\n    "theme"');
    const backups = (await files(path.dirname(target))).filter(name => name.includes("backup"));
    expect(backups).toHaveLength(1);
    expect(await read(path.join(path.dirname(target), backups[0]))).toBe(original);
    expect(result.message).toContain(backups[0]);
  });

  it("a second run changes nothing and makes no new backup", async () => {
    const h = await home();
    await installClient("cursor", { ...base, home: h, write: true });
    const target = path.join(h, ".cursor", "mcp.json");
    const before = await read(target);
    const second = await installClient("cursor", { ...base, home: h, write: true });
    expect(second.code).toBe(0);
    expect(second.message).toMatch(/already/i);
    expect(await read(target)).toBe(before);
    expect((await files(path.dirname(target))).filter(name => name.includes("backup"))).toEqual([]);
  });

  it("treats an empty file as an empty object", async () => {
    const h = await home();
    const target = path.join(h, ".cursor", "mcp.json");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "  \n", "utf8");
    expect((await installClient("cursor", { ...base, home: h, write: true })).code).toBe(0);
    expect(JSON.parse(await read(target)).mcpServers.handoff).toEqual(entry);
  });
});

describe("an existing handoff entry that is different", () => {
  const prepare = async () => {
    const h = await home();
    const target = path.join(h, ".cursor", "mcp.json");
    await mkdir(path.dirname(target), { recursive: true });
    const custom = { command: "node", args: ["old.js"], env: { HANDOFF_DIR: "/old", HANDOFF_TELEGRAM_BOT_TOKEN: secret }, autoApprove: ["handoff_list"] };
    await writeFile(target, JSON.stringify({ mcpServers: { handoff: custom } }, null, 2), "utf8");
    return { h, target, custom };
  };

  it("is refused without --force, untouched, and never printed with its values", async () => {
    const { h, target } = await prepare();
    const before = await read(target);
    const result = await installClient("cursor", { ...base, home: h, write: true });
    expect(result.code).toBe(1);
    expect(result.message).toMatch(/--force/);
    expect(result.message).not.toContain(secret);
    expect(await read(target)).toBe(before);
  });

  it("with --force updates the command and arguments but keeps every other setting, including secrets already there", async () => {
    const { h, target } = await prepare();
    const result = await installClient("cursor", { ...base, home: h, write: true, force: true });
    expect(result.code).toBe(0);
    expect(result.message).not.toContain(secret);
    const handoff = JSON.parse(await read(target)).mcpServers.handoff;
    expect(handoff.command).toBe("npx");
    expect(handoff.args).toEqual(["-y", PACKAGE]);
    expect(handoff.autoApprove).toEqual(["handoff_list"]);
    expect(handoff.env).toEqual({ HANDOFF_DIR: "~/handoff", HANDOFF_TELEGRAM_BOT_TOKEN: secret });
  });

  it("a dry run with --force reports what would change and writes nothing", async () => {
    const { h, target } = await prepare();
    const before = await read(target);
    const result = await installClient("cursor", { ...base, home: h, force: true });
    expect(result.code).toBe(0);
    expect(result.message).toMatch(/dry run/i);
    expect(await read(target)).toBe(before);
  });
});

describe("files it will not touch", () => {
  const withFile = async (content: string) => {
    const h = await home();
    const target = path.join(h, ".cursor", "mcp.json");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
    return { h, target };
  };
  it.each([
    ["not JSON", "{not json"],
    ["JSON with comments", '{\n  // my servers\n  "mcpServers": {}\n}'],
    ["a trailing comma", '{"mcpServers": {},}'],
    ["an array at the top", "[]"],
    ["null at the top", "null"],
    ["mcpServers that is not an object", '{"mcpServers": []}'],
    ["a handoff entry that is not an object", '{"mcpServers": {"handoff": "x"}}'],
  ])("refuses %s and leaves the file byte for byte as it was", async (_name, content) => {
    const { h, target } = await withFile(content);
    const result = await installClient("cursor", { ...base, home: h, write: true, force: true });
    expect(result.code).toBe(1);
    expect(await read(target)).toBe(content);
    expect((await files(path.dirname(target))).filter(name => name.includes("backup") || name.endsWith(".tmp"))).toEqual([]);
  });
  it("refuses a folder where the file should be", async () => {
    const h = await home();
    await mkdir(path.join(h, ".cursor", "mcp.json"), { recursive: true });
    const result = await installClient("cursor", { ...base, home: h, write: true });
    expect(result.code).toBe(1);
    expect(result.message).toMatch(/not a file|folder/i);
  });
  it("refuses a symbolic link (it could point anywhere)", async () => {
    const h = await home();
    const real = path.join(h, "real.json");
    await writeFile(real, "{}", "utf8");
    await mkdir(path.join(h, ".cursor"), { recursive: true });
    try { await symlink(real, path.join(h, ".cursor", "mcp.json")); } catch { return; /* creating links needs a privilege on some Windows setups */ }
    const result = await installClient("cursor", { ...base, home: h, write: true });
    expect(result.code).toBe(1);
    expect(await read(real)).toBe("{}");
  });
  it("aborts if the file changes between reading and writing", async () => {
    const { h, target } = await withFile('{"mcpServers": {}}');
    const result = await installClient("cursor", { ...base, home: h, write: true, beforeWrite: async () => { await writeFile(target, '{"mcpServers": {"mine": {}}, "changed": true}', "utf8"); } });
    expect(result.code).toBe(1);
    expect(result.message).toMatch(/changed/i);
    expect(JSON.parse(await read(target)).changed).toBe(true);
    expect(JSON.parse(await read(target)).mcpServers.handoff).toBeUndefined();
  });
  it("never overwrites an earlier backup", async () => {
    const { h, target } = await withFile('{"mcpServers": {"handoff": {"command": "old"}}}');
    const fixed = () => new Date("2026-11-03T10:00:00Z");
    const first = await installClient("cursor", { ...base, home: h, write: true, force: true, now: fixed });
    expect(first.code).toBe(0);
    await writeFile(target, '{"mcpServers": {"handoff": {"command": "newer"}}}', "utf8");
    const second = await installClient("cursor", { ...base, home: h, write: true, force: true, now: fixed });
    expect(second.code).toBe(0);
    const backups = (await files(path.dirname(target))).filter(name => name.includes("backup"));
    expect(backups).toHaveLength(2);
    const contents = await Promise.all(backups.map(name => read(path.join(path.dirname(target), name))));
    expect(contents.some(text => text.includes('"old"'))).toBe(true);
    expect(contents.some(text => text.includes('"newer"'))).toBe(true);
  });
});

describe("clients it does not edit", () => {
  it.each(["claude-desktop", "windsurf", "vscode", "codex", "continue", "goose", "opencode", "kilo-code", "zed", "warp", "jetbrains", "cline", "roo-code", "amazon-q", "claude-code"])("%s: says what to do instead and creates nothing", async id => {
    const h = await home();
    const result = await installClient(id, { ...base, home: h, write: true });
    expect(result.code).toBe(1);
    expect(result.message).toContain(`handoff-desk config --client ${id}`);
    expect(await files(h)).toEqual([]);
  });
  it("names the clients it can edit for an unknown one", async () => {
    const result = await installClient("nope", { ...base, home: await home() });
    expect(result.code).toBe(1);
    expect(result.message).toContain("cursor");
  });
});

describe("the install command in the built program", () => {
  it("dry run prints, --write creates the file in the home folder it is given, and neither touches anything else", async () => {
    const entryFile = await ensureBuilt();
    const h = await home();
    const env = { ...process.env, HOME: h, USERPROFILE: h };
    const dry = spawnSync(process.execPath, [entryFile, "install", "--client", "cursor"], { encoding: "utf8", env });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain(path.join(h, ".cursor", "mcp.json"));
    expect(existsSync(path.join(h, ".cursor"))).toBe(false);
    execFileSync(process.execPath, [entryFile, "install", "--client", "cursor", "--write"], { encoding: "utf8", env });
    expect(JSON.parse(await read(path.join(h, ".cursor", "mcp.json"))).mcpServers.handoff.command).toBe(process.platform === "win32" ? "cmd" : "npx");
    const missing = spawnSync(process.execPath, [entryFile, "install"], { encoding: "utf8", env });
    expect(missing.status).toBe(2);
  }, 180_000);
});
