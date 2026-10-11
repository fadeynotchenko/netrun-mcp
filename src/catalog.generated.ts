// ⚠️ СГЕНЕРИРОВАНО. Не правьте руками: источник — web/src/features/mcp/catalog.ts,
// обновление — `npm run sync:mcp` из папки web.

/** Описания действий, которые читает ИИ-агент. */
export const TOOLS = [
  {
    "id": "netrun_publish",
    "title": "Publish",
    "description": "Uploads a project folder and puts it online — a new project or a new version of an existing one. Detects the stack (Python, Node, Go, Rust, PHP, static HTML, Docker, docker-compose), asks for missing secrets, waits for the build and returns the URL or the failure reason. A new project takes a name; an existing one is updated by project_id. When the code needs secrets that are not set yet, the result is needs_secrets with their names, and values go in “secrets”. A build takes 1-5 minutes."
  },
  {
    "id": "netrun_status",
    "title": "Status",
    "description": "Is the project running, its URL, what blocks it, which secrets are already set and why the last publish failed. It also lists the names of the secrets already saved; their values are never returned."
  },
  {
    "id": "netrun_logs",
    "title": "Logs",
    "description": "Last lines of the application output — the first place to look when a bot goes silent. Most failures name their cause in the last lines."
  },
  {
    "id": "netrun_set_secrets",
    "title": "Secrets",
    "description": "Saves tokens and API keys as environment variables (stored encrypted) and re-publishes so the app picks them up. Values are write-only and are never returned."
  },
  {
    "id": "netrun_link",
    "title": "Public link",
    "description": "Decides whether the project gets a public HTTPS address — for example a webhook bot we took for a background program. Re-publishes the project; the link appears if the app answers requests from the internet. Netrun guesses from the code whether a project needs an address, and a webhook bot or an API can look like a background program. needed=true gives the project a URL, needed=false removes it; the choice survives later code updates. The project is re-published (a short restart). The link appears only if the app listens on 0.0.0.0 on the port from the PORT environment variable; otherwise the project keeps running in the background without a link. The URL is not registered with the bot platform automatically (for Telegram that is setWebhook)."
  },
  {
    "id": "netrun_domains",
    "title": "Custom domain",
    "description": "Points your own domain at the site and checks whether the registrar settings have taken effect. Until they have, it shows which records to add. The result lists the DNS records to add at the registrar; action \"check\" verifies them. Records take minutes to hours to spread. Custom domains need a paid plan and a website (bots have no address). Removing a domain is only available in the dashboard."
  },
  {
    "id": "netrun_control",
    "title": "Start and stop",
    "description": "Start, stop or restart a project. On the Free plan a bot’s free running time is counted only while it runs."
  },
  {
    "id": "netrun_list_projects",
    "title": "List projects",
    "description": "All projects of the account with URLs and state."
  },
  {
    "id": "netrun_whoami",
    "title": "Account",
    "description": "The plan, how many projects are available and how much free running time bots have left."
  }
] as const

/** Чего агент делать не может — уходит в инструкцию сервера. */
export const LIMITS = [
  "The agent cannot pay, renew a plan or buy places — you do that in the dashboard",
  "It cannot delete projects or files from persistent storage either — anything irreversible stays with you",
  "If the code needs a token or a password, the agent asks you before publishing — it never makes values up",
  "The access key lives only in your editor config, and a connected chat is listed in the dashboard — you can revoke either there at any time"
] as const

/** Примеры фраз человека — ими сервер объясняет агенту сценарий. */
export const PHRASES = [
  "Publish this bot to Netrun",
  "I fixed the greeting — update the project",
  "Why is the bot silent? Check the logs",
  "Change the bot token and restart"
] as const

export const TAGLINE = "Publish websites and Telegram bots to Netrun — upload a folder from your editor, get a URL"
export const ANSWER = "Connect Netrun to your AI editor and just ask: “publish this bot”. The agent uploads your code folder and sends back the link. MCP is the common way to connect external services to AI editors. With Netrun connected, you tell the agent in chat that you want the project online: it uploads the code folder, asks for a token if the code needs one, waits for the build and gives you the link. Works in Cursor, Claude Code, Codex, Claude Desktop, VS Code and Windsurf, and in ChatGPT and Claude right in the browser."
export const KEY_ENV = "NETRUN_API_KEY"
export const PACKAGE = "netrun-mcp"
export const SERVER_NAME = "netrun"
