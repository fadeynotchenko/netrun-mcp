# netrun-mcp

<!-- Файл собирается из web/src/features/mcp/catalog.ts командой `npm run sync:mcp`. Правки руками затрутся. -->

Publish websites and Telegram bots to Netrun — upload a folder from your editor, get a URL.

MCP is the common way to connect external services to AI editors. Once Netrun is connected, you tell the agent “publish this bot to Netrun”: it uploads the code folder, asks for a token if the code needs one, waits for the build and gives you the link. Works in Cursor, Claude Code, Codex, Claude Desktop, VS Code and Windsurf. Setup takes a minute and one command.

> Publish this bot to Netrun
>
> I fixed the greeting — update the project
>
> Why is the bot silent? Check the logs
>
> Change the bot token and restart

## Setup (one minute)

1. Sign in at [netrun.io](https://netrun.io) → **MCP** (https://netrun.io/mcp) → create an access key.
2. Connect your editor. The MCP page gives you a ready button or command with the key already inside; the generic form is:

```json
{
  "mcpServers": {
    "netrun": {
      "command": "npx",
      "args": ["-y", "netrun-mcp"],
      "env": {
        "NETRUN_API_KEY": "nru_…"
      }
    }
  }
}
```

- **Cursor** — click *Add to Cursor* on the MCP page, or put the JSON above into `~/.cursor/mcp.json`.
- **Claude Code** — `claude mcp add netrun -s user -e NETRUN_API_KEY=nru_… -- npx -y netrun-mcp`
- **Codex** — `codex mcp add netrun --env NETRUN_API_KEY=nru_… -- npx -y netrun-mcp`
- **Claude Desktop, VS Code, Windsurf** — the JSON above in the MCP servers config.

Node.js has to be installed — AI editors usually ship with it.

## What the agent can do

| Tool | What it does |
| --- | --- |
| `netrun_publish` | Uploads a project folder and puts it online — a new project or a new version of an existing one. Detects the stack (Python, Node, Go, Rust, PHP, static HTML, Docker, docker-compose), asks for missing secrets, waits for the build and returns the URL or the failure reason. |
| `netrun_status` | Is the project running, its URL, what blocks it and why the last publish failed. |
| `netrun_logs` | Last lines of the application output — the first place to look when a bot goes silent. |
| `netrun_set_secrets` | Saves tokens and API keys as environment variables (stored encrypted) and re-publishes so the app picks them up. |
| `netrun_control` | Start, stop or restart a project. |
| `netrun_list_projects` | All projects of the account with URLs and state. |
| `netrun_whoami` | The plan, how many projects are available and how much free running time bots have left. |

## What it deliberately cannot do

- The agent cannot pay, renew a plan or buy places — you do that in the dashboard.
- It cannot delete projects or files from persistent storage either — anything irreversible stays with you.
- If the code needs a token or a password, the agent asks you before publishing — it never makes values up.
- The access key lives only in your editor config; you can revoke it in the dashboard at any time.

## How it works

This package is a thin courier: it zips the folder (honouring `.gitignore`), sends it to the Netrun API with your key, and asks for status and logs. Building, running, HTTPS and addresses all happen on Netrun.

Environment variables: `NETRUN_API_KEY` (required), `NETRUN_API_URL` (default `https://api.netrun.io/v1`), `NETRUN_APP_URL` (default `https://netrun.io`).

- Registry: `io.github.fadeynotchenko/netrun`
- Source: https://github.com/fadeynotchenko/netrun-mcp

MIT
