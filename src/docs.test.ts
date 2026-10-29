import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const markdownFiles = ["README.md", "CONTRIBUTING.md", "SECURITY.md", ...readdirSync(path.join(ROOT, "docs")).map(name => `docs/${name}`)];

const blocks = (text: string, lang: string) =>
  [...text.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)```", "g"))].map(match => match[1]!);

function anchors(text: string): Set<string> {
  return new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map(match =>
    match[1]!.toLowerCase().replace(/[^a-z0-9 _-]/g, "").trim().replace(/ /g, "-")));
}

describe("documentation", () => {
  it("client config examples are valid JSON with the shape each client expects", () => {
    const json = blocks(read("docs/clients.md"), "json").map(text => JSON.parse(text) as Record<string, any>);
    expect(json.length).toBeGreaterThanOrEqual(3);
    for (const config of json) {
      const servers = config.mcpServers ?? config.servers;
      expect(servers.handoff.command).toBe("node");
      expect(servers.handoff.args[0]).toMatch(/dist\/main\.js$/);
      expect(servers.handoff.env.HANDOFF_DIR).toBeTruthy();
    }
  });

  it("the Codex example sets the same command, arguments and environment", () => {
    const toml = blocks(read("docs/clients.md"), "toml").join("\n");
    expect(toml).toContain("[mcp_servers.handoff]");
    expect(toml).toContain('command = "node"');
    expect(toml).toMatch(/args = \["[^"]*dist\/main\.js"\]/);
    expect(toml).toContain("[mcp_servers.handoff.env]");
    expect(toml).toContain("HANDOFF_DIR");
  });

  it("every relative link points at a file that exists, and every anchor at a heading", () => {
    const problems: string[] = [];
    for (const file of markdownFiles) {
      const text = read(file);
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|\.\.\/\.\.\/)/.test(target!)) continue;
        const [rel, anchor] = target!.split("#") as [string, string | undefined];
        const resolved = rel ? path.resolve(path.dirname(path.join(ROOT, file)), rel) : path.join(ROOT, file);
        if (!existsSync(resolved)) { problems.push(`${file}: missing ${target}`); continue; }
        if (anchor && resolved.endsWith(".md") && !anchors(readFileSync(resolved, "utf8")).has(anchor)) problems.push(`${file}: no heading for ${target}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("every setting the README tells people to set exists in the code", () => {
    const source = readdirSync(path.join(ROOT, "src")).filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts")).map(name => read(`src/${name}`)).join("\n");
    const names = new Set([...read("README.md").matchAll(/`(HANDOFF_[A-Z_]+)`/g)].map(match => match[1]!));
    const missing = [...names].filter(name => !source.includes(name));
    expect(missing).toEqual([]);
  });
});
