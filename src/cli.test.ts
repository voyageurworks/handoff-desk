import { spawnSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nextSteps } from "./init.js";
import { ensureBuilt } from "./testBuild.js";

const version = (await import("../package.json", { with: { type: "json" } })).default.version;

describe("the command line a first-time user types", () => {
  it("--version prints the package version and exits 0", async () => {
    const entry = await ensureBuilt();
    for (const flag of ["--version", "-v", "version"]) {
      const result = spawnSync(process.execPath, [entry, flag], { encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe(version);
    }
  }, 180_000);
  it("--help prints the usage on stdout and exits 0 (an unknown word still exits 2)", async () => {
    const entry = await ensureBuilt();
    for (const flag of ["--help", "-h", "help"]) {
      const result = spawnSync(process.execPath, [entry, flag], { encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("Usage: handoff-desk");
      expect(result.stdout).toContain("init");
    }
    expect(spawnSync(process.execPath, [entry, "nonsense"], { encoding: "utf8" }).status).toBe(2);
  }, 180_000);
  it("init ends with the exact commands for the folder it made", async () => {
    const entry = await ensureBuilt();
    const dir = path.join(await mkdtemp(path.join(tmpdir(), "handoff cli-")), "my desk");
    const result = spawnSync(process.execPath, [entry, "init", dir], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Next steps:");
    expect(result.stdout).toContain("claude mcp add handoff");
    expect(result.stdout).toContain("doctor");
  }, 180_000);
});

describe("nextSteps", () => {
  it("POSIX: a plain double dash, and doctor told which folder to read", () => {
    const text = nextSteps("/home/me/handoff", false);
    expect(text).toContain('claude mcp add handoff -e HANDOFF_DIR="/home/me/handoff" -- npx -y @voyageurworks/handoff-desk');
    expect(text).toContain('HANDOFF_DIR="/home/me/handoff" npx -y @voyageurworks/handoff-desk doctor');
  });
  it("Windows: the quoted double dash and cmd /c that PowerShell 5.1 needs, and forward slashes", () => {
    const text = nextSteps(String.raw`C:\Users\me\handoff`, true);
    if (path.sep === "\\") expect(text).toContain('HANDOFF_DIR="C:/Users/me/handoff"');
    expect(text).toContain(`'--' cmd /c npx -y '@voyageurworks/handoff-desk'`);
    expect(text).toContain("$env:HANDOFF_DIR =");
  });
});
