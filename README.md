# netrun-mcp

<!-- Файл собирается из web/src/features/mcp/catalog.ts командой `npm run sync:mcp`. Правки руками затрутся. -->

Publish websites and Telegram bots to Netrun — upload a folder from your editor, get a URL.

Connect Netrun to your AI editor and just ask: “publish this bot”. The agent uploads your code folder and sends back the link. MCP is the common way to connect external services to AI editors. With Netrun connected, you tell the agent in chat that you want the project online: it uploads the code folder, asks for a token if the code needs one, waits for the build and gives you the link. Works in Cursor, Claude Code, Codex, Claude Desktop, VS Code and Windsurf, and in ChatGPT and Claude right in the browser.

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
      "args": ["-y", "netrun-mcp@latest"],
      "env": {
        "NETRUN_API_KEY": "nru_…"
      }
    }
  }
}
```

- **Cursor** — click *Add to Cursor* on the MCP page, or put the JSON above into `~/.cursor/mcp.json`.
- **Claude Code** — `claude mcp add netrun -s user -e NETRUN_API_KEY=nru_… -- npx -y netrun-mcp@latest`
- **Codex** — `codex mcp add netrun --env NETRUN_API_KEY=nru_… -- npx -y netrun-mcp@latest`
- **Claude Desktop, VS Code, Windsurf** — the JSON above in the MCP servers config.

Node.js has to be installed — AI editors usually ship with it.

### ChatGPT, Claude in the browser — no install, no key

Netrun also runs as a remote MCP server: `https://api.netrun.io/v1/mcp` (Streamable HTTP, OAuth sign-in). In the chat settings open connections (Connectors or Apps), add a custom one with this address and press Connect. You sign in to Netrun by email — no key needed. ChatGPT allows custom connections on paid plans — turn on developer mode in the settings. Claude allows them on every plan, one on the free plan. The agent takes the code right from the conversation; a large multi-file project is easier to publish from an editor.

## What the agent can do

| Tool | What it does |
| --- | --- |
| `netrun_publish` | Uploads a project folder and puts it online — a new project or a new version of an existing one. Detects the stack (Python, Node, Go, Rust, PHP, static HTML, Docker, docker-compose), asks for missing secrets, waits for the build and returns the URL or the failure reason. |
| `netrun_status` | Is the project running, its URL, what blocks it, which secrets are already set and why the last publish failed. |
| `netrun_logs` | Last lines of the application output — the first place to look when a bot goes silent. |
| `netrun_set_secrets` | Saves tokens and API keys as environment variables (stored encrypted) and re-publishes so the app picks them up. |
| `netrun_link` | Decides whether the project gets a public HTTPS address — for example a webhook bot we took for a background program. Re-publishes the project; the link appears if the app answers requests from the internet. |
| `netrun_domains` | Points your own domain at the site and checks whether the registrar settings have taken effect. Until they have, it shows which records to add. |
| `netrun_control` | Start, stop or restart a project. |
| `netrun_list_projects` | All projects of the account with URLs and state. |
| `netrun_whoami` | The plan, how many projects are available and how much free running time bots have left. |

## What it deliberately cannot do

- The agent cannot pay, renew a plan or buy places — you do that in the dashboard.
- It cannot delete projects or files from persistent storage either — anything irreversible stays with you.
- If the code needs a token or a password, the agent asks you before publishing — it never makes values up.
- The access key lives only in your editor config, and a connected chat is listed in the dashboard — you can revoke either there at any time.

## How it works

This package is a thin courier: it zips the folder (honouring `.gitignore`), sends it to the Netrun API with your key, and asks for status and logs. Building, running, HTTPS and addresses all happen on Netrun.

Environment variables: `NETRUN_API_KEY` (required), `NETRUN_API_URL` (default `https://api.netrun.io/v1`), `NETRUN_APP_URL` (default `https://netrun.io`).

- Registry: `io.github.fadeynotchenko/netrun`
- Source: https://github.com/fadeynotchenko/netrun-mcp

MIT
