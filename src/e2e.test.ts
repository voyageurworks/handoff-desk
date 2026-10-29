import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runStandIn } from "./standin.js";
import { ensureBuilt } from "./testBuild.js";

const text = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0].text);

describe("end to end over stdio", () => {
  it("hands a task over, the stand-in agent answers, and wait returns the reply", async () => {
    const entry = await ensureBuilt();
    const dir = path.join(await mkdtemp(path.join(tmpdir(), "handoff e2e-")), "desk");
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { HANDOFF_DIR: dir } });
    const client = new Client({ name: "e2e", version: "1.0.0" });
    await client.connect(transport);
    try {
      const sent = JSON.parse(text(await client.callTool({ name: "handoff_send", arguments: { type: "errand", title: "Book dentist", request: "Friday at 3" } })));
      expect(sent.id).toBe(1);
      expect(await runStandIn(path.join(dir, "Desk"))).toBe(1);
      const waited = JSON.parse(text(await client.callTool({ name: "handoff_wait", arguments: { id: 1, seconds: 30 } })));
      expect(waited.answered).toBe(true);
      expect(waited.item.reply).toContain("Book dentist");
      const listed = JSON.parse(text(await client.callTool({ name: "handoff_list", arguments: {} })));
      expect(listed.map((i: { status: string }) => i.status)).toEqual(["done"]);
    } finally {
      await client.close();
    }
  }, 180_000);
});
