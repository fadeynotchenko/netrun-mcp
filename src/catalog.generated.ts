// ⚠️ СГЕНЕРИРОВАНО. Не правьте руками: источник — web/src/features/mcp/catalog.ts,
// обновление — `npm run sync:mcp` из папки web.

/** Описания действий, которые читает ИИ-агент. */
export const TOOLS = [
  {
    "id": "netrun_publish",
    "title": "Publish",
    "description": "Uploads a project folder and puts it online — a new project or a new version of an existing one. Detects the stack (Python, Node, Go, Rust, PHP, static HTML, Docker, docker-compose), asks for missing secrets, waits for the build and returns the URL or the failure reason. For a brand-new project pass a name; to update an existing one pass project_id. If the result says needs_secrets, ask the user for the values (a Telegram bot token comes from @BotFather) and call again with them in “secrets” — never invent them. Do not call in a loop: one publish per code change, builds take 1-5 minutes."
  },
  {
    "id": "netrun_status",
    "title": "Status",
    "description": "Is the project running, its URL, what blocks it and why the last publish failed. Call it instead of publishing again when the user asks whether something works."
  },
  {
    "id": "netrun_logs",
    "title": "Logs",
    "description": "Last lines of the application output — the first place to look when a bot goes silent. Read this before guessing why an app fails; most failures name their cause in the last lines."
  },
  {
    "id": "netrun_set_secrets",
    "title": "Secrets",
    "description": "Saves tokens and API keys as environment variables (stored encrypted) and re-publishes so the app picks them up. Values are never returned back. Ask the user for them."
  },
  {
    "id": "netrun_control",
    "title": "Start and stop",
    "description": "Start, stop or restart a project. Stopping a Free-plan bot does not pause its free running time."
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
  "The access key lives only in your editor config; you can revoke it in the dashboard at any time"
] as const

/** Примеры фраз человека — ими сервер объясняет агенту сценарий. */
export const PHRASES = [
  "Publish this bot to Netrun",
  "I fixed the greeting — update the project",
  "Why is the bot silent? Check the logs",
  "Change the bot token and restart"
] as const

export const TAGLINE = "Publish websites and Telegram bots to Netrun — upload a folder from your editor, get a URL"
export const ANSWER = "Connect Netrun to your AI editor and just ask: “publish this bot”. The agent uploads your code folder and sends back the link. MCP is the common way to connect external services to AI editors. With Netrun connected, you tell the agent in chat that you want the project online: it uploads the code folder, asks for a token if the code needs one, waits for the build and gives you the link. Works in Cursor, Claude Code, Codex, Claude Desktop, VS Code and Windsurf.. MCP is the common way to connect external services to AI editors. With Netrun connected, you tell the agent in chat that you want the project online: it uploads the code folder, asks for a token if the code needs one, waits for the build and gives you the link. Works in Cursor, Claude Code, Codex, Claude Desktop, VS Code and Windsurf."
export const KEY_ENV = "NETRUN_API_KEY"
export const PACKAGE = "netrun-mcp"
export const SERVER_NAME = "netrun"
