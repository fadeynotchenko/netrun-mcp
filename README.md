# netrun-mcp

Publish websites and Telegram bots to [Netrun](https://netrun.io) straight from Cursor, Claude Code, Codex, Claude Desktop, VS Code, Windsurf — any editor or assistant that speaks MCP.

Say **“publish this bot to Netrun”** in the chat. The agent uploads the folder, asks you for the bot token if the code needs one, waits for the build and hands you the link. Say **“I fixed the greeting — update it”** and it ships the new version. No servers, Docker or configs on your side.

## Setup (one minute)

1. Sign in at [netrun.io](https://netrun.io) → **MCP** → create an access key.
2. Connect your editor. The MCP page gives you a ready button or command with the key already inside; the generic form is:

```json
{
  "mcpServers": {
    "netrun": {
      "command": "npx",
      "args": ["-y", "netrun-mcp"],
      "env": { "NETRUN_API_KEY": "nru_…" }
    }
  }
}
```

- **Cursor** — click *Add to Cursor* on the MCP page, or put the JSON above into `~/.cursor/mcp.json`.
- **Claude Code** — `claude mcp add netrun -s user -e NETRUN_API_KEY=nru_… -- npx -y netrun-mcp`
- **Codex** — `codex mcp add netrun --env NETRUN_API_KEY=nru_… -- npx -y netrun-mcp`
- **Claude Desktop / VS Code / Windsurf** — the JSON above in the MCP servers config.

Requires Node.js 18+.

## What the agent can do

| Tool | What it does |
| --- | --- |
| `netrun_publish` | Upload a project folder and put it online — new project or a new version of an existing one. Detects the stack (Python, Node, Go, Rust, PHP, static HTML, Docker, docker-compose…), asks for missing secrets, waits for the build, returns the URL or the failure reason. |
| `netrun_status` | Is it running? URL, what blocks it, why the last publish failed. |
| `netrun_logs` | Last lines of the app output. |
| `netrun_set_secrets` | Save tokens / API keys as environment variables (stored encrypted) and re-publish. |
| `netrun_control` | Start, stop, restart. |
| `netrun_list_projects` / `netrun_whoami` | Projects of the account, plan and limits. |

What it deliberately **cannot** do: pay, renew or delete projects. Those stay with you in the dashboard — the agent gets a link and passes it on.

## How it works

This package is a thin courier: it zips the folder (honouring `.gitignore`), sends it to the Netrun API with your key, and asks for status and logs. Building, running, HTTPS and addresses all happen on Netrun. Nothing here needs to be kept secret — the key lives only in your editor's config.

Environment variables: `NETRUN_API_KEY` (required), `NETRUN_API_URL` (default `https://api.netrun.io/v1`), `NETRUN_APP_URL` (default `https://netrun.io`).

## Development

```
npm install
npm test
npm run build
node dist/index.js   # stdio MCP server
```

MIT
