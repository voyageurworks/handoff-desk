import { readFile } from "node:fs/promises";
import path from "node:path";

/** `unedited`: some bullet or the About text is still a `<placeholder>` from the template, so these lists aren't the user's own yet. */
export type Capabilities = { about: string; alone: string[]; askFirst: string[]; never: string[]; unreadable: string[]; unedited: boolean };

const SECTIONS = ["About me", "You may do alone", "Ask me first", "Never"] as const;

/** The body lines under `## <heading>` up to the next `## ` heading, or null when the heading is missing. */
function sectionLines(lines: string[], heading: string): string[] | null {
  const start = lines.findIndex(line => line.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

const bullets = (lines: string[]) => lines.map(line => line.match(/^\s*[-*]\s+(.*\S)\s*$/)?.[1]).filter((text): text is string => Boolean(text));

/**
 * What the user's handoff.md says the agent may do alone, must ask first, and must never do.
 * A section that is missing or empty is listed in `unreadable`, never guessed.
 */
export async function capabilitiesIn(dir: string): Promise<Capabilities> {
  const text = await readFile(path.join(dir, "handoff.md"), "utf8").catch(() => "");
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const found = Object.fromEntries(SECTIONS.map(name => [name, sectionLines(lines, name)]));
  const about = (found["About me"] ?? []).join(" ").replace(/\s+/g, " ").trim();
  const result = {
    about,
    alone: bullets(found["You may do alone"] ?? []),
    askFirst: bullets(found["Ask me first"] ?? []),
    never: bullets(found["Never"] ?? []),
  };
  const filled: Record<(typeof SECTIONS)[number], boolean> = { "About me": about.length > 0, "You may do alone": result.alone.length > 0, "Ask me first": result.askFirst.length > 0, Never: result.never.length > 0 };
  const placeholder = (line: string) => /^<.*>$/.test(line.trim());
  const unedited = [about, ...result.alone, ...result.askFirst, ...result.never].some(placeholder);
  return { ...result, unreadable: SECTIONS.filter(name => !filled[name]), unedited };
}
