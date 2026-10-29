import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDesk } from "./desk.js";
import { runStandIn } from "./standin.js";
import { detectSync } from "./sync.js";
import { makeRemote, sh } from "./testRepos.js";

const remoteLog = (bare: string) => sh(bare, ["log", "--format=%s", "main"]).split("\n");

describe("stand-in agent over git", () => {
  it("pulls a waiting note, answers it, and pushes the reply", async () => {
    const { bare, cloneA, cloneB } = await makeRemote();
    const syncA = await detectSync(cloneA, { HANDOFF_GIT_NAME: "Desk User", HANDOFF_GIT_EMAIL: "user@example.com" });
    const syncB = await detectSync(cloneB, { HANDOFF_GIT_NAME: "Stand-in", HANDOFF_GIT_EMAIL: "stand-in@example.com" });
    const deskA = createDesk({ deskDir: path.join(cloneA, "Desk"), rootDir: cloneA, sync: syncA ?? undefined });
    const { id } = await deskA.send({ type: "errand", title: "Book dentist", request: "Friday" });

    expect(await runStandIn(path.join(cloneB, "Desk"), { sync: syncB ?? undefined })).toBe(1);
    expect(remoteLog(bare)).toContain("Handoff: stand-in answered 1");
    expect(sh(bare, ["log", "-1", "--format=%an", "main"])).toBe("Stand-in");

    const item = await deskA.read(id);
    expect(item.status).toBe("done");
    expect(item.reply).toBe("Stand-in agent received: Book dentist");
  });

  it("makes no commit when nothing is waiting", async () => {
    const { bare, cloneB } = await makeRemote();
    const syncB = await detectSync(cloneB, {});
    const before = remoteLog(bare).length;
    expect(await runStandIn(path.join(cloneB, "Desk"), { sync: syncB ?? undefined })).toBe(0);
    expect(remoteLog(bare).length).toBe(before);
  });
});
