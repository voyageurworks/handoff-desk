import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { capabilitiesIn } from "./capabilities.js";
import { initDesk } from "./init.js";

describe("capabilitiesIn", () => {
  it("reads the fresh template", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-cap-"));
    await initDesk(dir);
    const caps = await capabilitiesIn(dir);
    expect(caps.alone).toHaveLength(3);
    expect(caps.askFirst).toHaveLength(3);
    expect(caps.never).toHaveLength(3);
    expect(caps.about.length).toBeGreaterThan(0);
    expect(caps.unreadable).toEqual([]);
  });
  it("lists a missing section as unreadable instead of guessing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-cap-"));
    await initDesk(dir);
    const file = path.join(dir, "handoff.md");
    await writeFile(file, (await readFile(file, "utf8")).replace(/## Never[\s\S]*$/, ""));
    expect((await capabilitiesIn(dir)).unreadable).toEqual(["Never"]);
  });
  it("reports every section unreadable when there is no handoff.md", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "handoff-cap-"));
    expect((await capabilitiesIn(dir)).unreadable).toEqual(["About me", "You may do alone", "Ask me first", "Never"]);
  });
});
