import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Cost guard: every runner label in .github/workflows must be a standard GitHub-hosted runner, which is free for a public
// repository. A larger runner (-large, -xlarge, GPU), a self-hosted runner or an unknown label could be billed or never start,
// so adding one must be a deliberate change: edit this list in the same pull request.
const FREE = new Set(["ubuntu-latest", "ubuntu-24.04", "windows-latest", "macos-15", "macos-15-intel", "macos-26"]);
const dir = new URL("../.github/workflows/", import.meta.url);

/** Runner labels named on `runs-on:` lines and on matrix `os:` lines, ignoring comments. */
export function labels(text: string): string[] {
  const found: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, "");
    const on = /\bruns-on:\s*(.+)$/.exec(line);
    if (on && !on[1]!.includes("${{")) found.push(on[1]!.trim().replace(/^["']|["']$/g, ""));
    for (const m of line.matchAll(/\bos:\s*(\[[^\]]*\]|[^\s,}]+)/g)) {
      for (const t of m[1]!.replace(/[[\]]/g, "").split(",")) if (t.trim() && !t.includes("${{")) found.push(t.trim().replace(/^["']|["']$/g, ""));
    }
  }
  return found;
}

describe("workflows use only free standard runners", () => {
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  it("finds the workflows", () => expect(files.length).toBeGreaterThan(0));
  for (const f of files) {
    it(f, () => {
      const used = labels(readFileSync(new URL(f, dir), "utf8"));
      for (const l of used) expect(FREE.has(l), `${f}: runner label "${l}" is not on the free list`).toBe(true);
    });
  }
  it("the detector flags paid and self-hosted labels", () => {
    expect(labels("    runs-on: macos-15-xlarge\n").filter((l) => !FREE.has(l))).toEqual(["macos-15-xlarge"]);
    expect(labels("    runs-on: self-hosted\n").filter((l) => !FREE.has(l))).toEqual(["self-hosted"]);
    expect(labels("        include:\n          - { os: macos-15-large, arch: x64 }\n").filter((l) => !FREE.has(l))).toEqual(["macos-15-large"]);
    expect(labels("      os: [ubuntu-latest, windows-latest]\n")).toEqual(["ubuntu-latest", "windows-latest"]);
    expect(labels("    runs-on: ubuntu-8-cores # comment\n    # runs-on: macos-15-large\n")).toEqual(["ubuntu-8-cores"]);
  });
});
