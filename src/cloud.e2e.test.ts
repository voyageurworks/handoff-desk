import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { renameSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ensureBuilt } from "./testBuild.js";
import { makeRemote, sh } from "./testRepos.js";

const text = (result: unknown) => ((result as { content: Array<{ text: string }> }).content[0].text);
const failed = (result: unknown) => Boolean((result as { isError?: boolean }).isError);

describe("cloud path end to end: a user's computer and a cloud agent share a git remote", () => {
  it("send pushes, the agent (a separate process on another clone) answers and pushes, wait returns the reply", async () => {
    const entry = await ensureBuilt();
    const { bare, cloneA, cloneB } = await makeRemote();
    const identity = { HANDOFF_GIT_NAME: "Desk User", HANDOFF_GIT_EMAIL: "user@example.com" };
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], env: { HANDOFF_DIR: cloneA, HANDOFF_SYNC: "git", ...identity } });
    const client = new Client({ name: "cloud-e2e", version: "1.0.0" });
    await client.connect(transport);
    try {
      const sent = JSON.parse(text(await client.callTool({ name: "handoff_send", arguments: { type: "errand", title: "Book dentist", request: "Friday at 3" } })));
      expect(sent.id).toBe(1);
      expect(sh(bare, ["log", "--format=%s", "main"])).toContain("Handoff: errand 1 - Book dentist");

      // The cloud agent: another process, another clone, reaching the desk only through the remote.
      const out = execFileSync(process.execPath, [entry, "stand-in", "--once", "--git"], { env: { ...process.env, HANDOFF_DIR: cloneB, HANDOFF_SYNC: "git" } }).toString();
      expect(out).toContain("Answered 1");

      const waited = JSON.parse(text(await client.callTool({ name: "handoff_wait", arguments: { id: 1, seconds: 30 } })));
      expect(waited.answered).toBe(true);
      expect(waited.item.reply).toContain("Book dentist");
      const listed = JSON.parse(text(await client.callTool({ name: "handoff_list", arguments: {} })));
      expect(listed.map((i: { status: string }) => i.status)).toEqual(["done"]);

      // The remote goes away: reads fall back to the local copy and say so; sends refuse and write nothing.
      renameSync(bare, `${bare}-away`);
      const stale = JSON.parse(text(await client.callTool({ name: "handoff_list", arguments: {} })));
      expect(stale.stale).toMatch(/^Couldn't update/);
      expect(stale.items).toHaveLength(1);
      expect(failed(await client.callTool({ name: "handoff_send", arguments: { type: "errand", title: "Offline", request: "r" } }))).toBe(true);
      renameSync(`${bare}-away`, bare);
      const back = JSON.parse(text(await client.callTool({ name: "handoff_list", arguments: {} })));
      expect(Array.isArray(back)).toBe(true);
      expect(back).toHaveLength(1);
    } finally {
      await client.close();
    }
  }, 420_000);
});
