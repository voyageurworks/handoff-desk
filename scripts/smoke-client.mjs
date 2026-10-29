// Acts like an MCP client: starts the server, hands over a question, waits for the stand-in's answer,
// and checks that a password-looking request is refused. Used by scripts/quickstart-smoke.sh.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = process.argv[2];
if (!entry) throw new Error("usage: node smoke-client.mjs <path to dist/main.js>");

const text = result => result.content[0].text;
const transport = new StdioClientTransport({ command: "node", args: [entry], env: { ...process.env } });
const client = new Client({ name: "quickstart-smoke", version: "1.0.0" });
await client.connect(transport);
try {
  const sent = JSON.parse(text(await client.callTool({ name: "handoff_send", arguments: { type: "question", title: "Smoke", request: "reply with pong" } })));
  let answered = false;
  for (let attempt = 0; attempt < 4 && !answered; attempt++) {
    const waited = JSON.parse(text(await client.callTool({ name: "handoff_wait", arguments: { id: sent.id, seconds: 40 } })));
    answered = waited.answered === true;
  }
  if (!answered) throw new Error("the stand-in did not answer");

  const refused = await client.callTool({ name: "handoff_send", arguments: { type: "question", title: "Secret", request: "my password is hunter2hunter2" } });
  if (!/Refused/.test(text(refused))) throw new Error("a password-looking request was not refused");
  console.log("smoke ok: item", sent.id, "answered, password refused");
} finally {
  await client.close();
}
