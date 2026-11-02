import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureBuilt } from "./testBuild.js";

const root = path.resolve(import.meta.dirname, "..");
const readJson = async (file: string) => JSON.parse(await readFile(path.join(root, file), "utf8")) as Record<string, unknown>;

describe("the version clients see", () => {
  it("the server reports the version in package.json to MCP clients", async () => {
    const entry = await ensureBuilt();
    const dir = path.join(await mkdtemp(path.join(tmpdir(), "handoff version-")), "desk");
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { HANDOFF_DIR: dir } });
    const client = new Client({ name: "version-check", version: "1.0.0" });
    await client.connect(transport);
    try {
      const pkg = await readJson("package.json");
      expect(client.getServerVersion()?.version).toBe(pkg.version);
    } finally {
      await client.close();
    }
  }, 180_000);
});

describe("MCP Registry metadata", () => {
  it("server.json and package.json agree on name, version and package", async () => {
    const pkg = await readJson("package.json");
    const server = (await readJson("server.json")) as {
      name: string;
      description: string;
      version: string;
      packages: Array<{ registryType: string; identifier: string; version: string }>;
    };
    expect(pkg.mcpName).toBe("io.github.voyageurworks/handoff-desk");
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.description.length).toBeLessThanOrEqual(100);
    expect(server.packages).toHaveLength(1);
    expect(server.packages[0]).toMatchObject({ registryType: "npm", identifier: pkg.name, version: pkg.version });
  });

  it("glama.json lists only the organization owner login", async () => {
    const glama = (await readJson("glama.json")) as { maintainers: string[] };
    expect(glama.maintainers).toEqual(["voyageur-works-dev"]);
  });
});
