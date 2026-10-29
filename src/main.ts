#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, syncEnv } from "./config.js";
import { initDesk } from "./init.js";
import { buildServer } from "./server.js";
import { runStandIn } from "./standin.js";
import { detectSync, ensureClone, git, type SyncHandle } from "./sync.js";

const USAGE = "Usage: handoff-desk [init [dir] | stand-in [--once] [--git]]\n  (no argument)  start the MCP server on stdio\n  init [dir]     create the desk folder and a handoff.md to edit (default: HANDOFF_DIR or ~/handoff)\n  stand-in       a stand-in agent that answers waiting items, for testing";

const [command, ...rest] = process.argv.slice(2);
const config = loadConfig();
// Dates in notes and emails read HANDOFF_TZ; when it came from the settings file, the process must see it too.
if (config.tz) process.env.HANDOFF_TZ ??= config.tz;

/**
 * The desk's git handle, or null for a plain folder. Runs on the first desk tool call, not at start-up, so the server
 * always starts; a failure (say the clone couldn't reach the network) is reported by that call and tried again on the next.
 */
async function resolveSync(): Promise<SyncHandle | null> {
  if (config.sync === "off") return null;
  if (config.remote) await ensureClone(config.dir, config.remote);
  return detectSync(config.dir, syncEnv(config));
}

if (command === undefined) {
  await buildServer(config, resolveSync).connect(new StdioServerTransport());
} else if (command === "init") {
  const dir = rest[0] ?? config.dir;
  const { created, kept } = await initDesk(dir, { inboxDir: config.inboxDir });
  const inRepo = await git(dir, ["rev-parse", "--is-inside-work-tree"]).then(() => true, () => false);
  console.log(`Desk folder: ${dir}\nCreated: ${created.join(", ") || "nothing"}\nKept as it was: ${kept.join(", ") || "nothing"}\nNext: edit ${dir}/handoff.md, then add the server to your MCP client.${inRepo ? "\nThis folder is in a git repository: keep that repository PRIVATE, because desk notes are pushed to its remote." : ""}`);
} else if (command === "stand-in") {
  const deskDir = config.desk.deskDir;
  let sync: SyncHandle | undefined;
  if (rest.includes("--git")) {
    // Acts like a cloud agent: reaches the desk only through its git remote. The identity is the desk's, or a neutral default.
    try {
      const found = await detectSync(config.dir, syncEnv(config, process.env, "git"));
      if (found) sync = { ...found, identity: found.identity ?? { name: "stand-in agent", email: "stand-in@example.com" } };
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  }
  if (rest.includes("--once")) {
    console.log(`Answered ${await runStandIn(deskDir, { sync })} waiting item(s) in ${deskDir}`);
  } else {
    console.log(`Stand-in agent watching ${deskDir}${sync ? " through git" : ""} (Ctrl+C to stop)`);
    for (;;) {
      const count = await runStandIn(deskDir, { sync }).catch(error => (console.error(error instanceof Error ? error.message : String(error)), 0));
      if (count) console.log(`Answered ${count} item(s)`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
} else {
  console.error(USAGE);
  process.exit(2);
}
