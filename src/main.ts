#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import os from "node:os";
import { configCommand } from "./clientConfig.js";
import { expandHome, loadConfig, syncEnv } from "./config.js";
import { formatDoctor, runDoctor } from "./doctor.js";
import { initDesk } from "./init.js";
import { INSTALLABLE, installClient } from "./install.js";
import { buildServer } from "./server.js";
import { runStandIn } from "./standin.js";
import { detectSync, ensureClone, git, type SyncHandle } from "./sync.js";

const USAGE = "Usage: handoff-desk [init [dir] | stand-in [--once] [--git] | config --client <name> | config --list | install --client <name> | doctor]\n  (no argument)  start the MCP server on stdio\n  init [dir]     create the desk folder and a handoff.md to edit (default: HANDOFF_DIR or ~/handoff)\n  stand-in       a stand-in agent that answers waiting items, for testing\n  config         print the settings block for an MCP client (--list shows the clients)\n  install        add the server to a client's own settings file (dry run unless --write)\n  doctor         check the setup and say what to fix (--client <name> reads that client's settings; --ping sends a test message to Telegram and Slack)";

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
  const dir = rest[0] ? expandHome(rest[0]) : config.dir;
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
} else if (command === "config") {
  // Prints a ready-made settings block for an MCP client: the config on stdout (so it can be redirected), where it goes on stderr.
  const result = configCommand(rest);
  if (result.out) process.stdout.write(result.out);
  if (result.err) console.error(result.err);
  process.exitCode = result.code;
} else if (command === "install") {
  // Edits one client's settings file: a dry run unless --write, with a backup, and only for clients whose file is plain JSON.
  const value = (flag: string) => { const at = rest.indexOf(flag); return at >= 0 ? rest[at + 1] : undefined; };
  const id = value("--client");
  if (!id) {
    console.error(`Usage: handoff-desk install --client <name> [--dir <desk folder>] [--write] [--force]\n  Clients it can edit: ${INSTALLABLE.join(", ")}. Add --write to change the file; without it nothing is changed.`);
    process.exit(2);
  }
  const result = await installClient(id, { home: os.homedir(), dir: value("--dir") ?? "~/handoff", windows: rest.includes("--windows") || process.platform === "win32", write: rest.includes("--write"), force: rest.includes("--force") });
  (result.code === 0 ? console.log : console.error)(result.message);
  process.exitCode = result.code;
} else if (command === "doctor") {
  const at = rest.indexOf("--client");
  const result = await runDoctor({ env: process.env, client: at >= 0 ? rest[at + 1] : undefined, ping: rest.includes("--ping") });
  console.log(formatDoctor(result));
  process.exitCode = result.code;
} else {
  console.error(USAGE);
  process.exit(2);
}
