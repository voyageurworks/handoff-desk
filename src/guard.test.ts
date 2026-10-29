import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORDS_FILE = ".guard-words";
const SKIP = new Set(["node_modules", "dist", ".git", ".superpowers", "pnpm-lock.yaml", WORDS_FILE]);
// Personal addresses must never ship; the public default mail host smtp.gmail.com is allowed.
const ALWAYS_BANNED = ["@gmail\\.com"];

// The owner's own words (names, places, vendors) live in an untracked file, one regex per line,
// so this public test never spells them out. Without the file only the generic ban runs.
function bannedPattern(): RegExp {
  const local = existsSync(path.join(ROOT, WORDS_FILE))
    ? readFileSync(path.join(ROOT, WORDS_FILE), "utf8").split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : [];
  return new RegExp([...ALWAYS_BANNED, ...local].join("|"), "i");
}

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

describe("extraction guard", () => {
  it("repo contains no personal data", () => {
    const banned = bannedPattern();
    const hits = [...files(ROOT)]
      .filter(file => banned.test(readFileSync(file, "utf8")) || banned.test(path.basename(file)))
      .map(file => path.relative(ROOT, file));
    expect(hits).toEqual([]);
  });
});
