# FuddiG AI

A sleek, privacy-first multi-model chat interface that runs entirely in your browser. Connects to dozens of AI models through a lightweight local proxy — your API keys never leave your machine.

---

## Features

- **Multi-model support** — Switch between  models available through the OpenRouter-compatible API, all from one interface.
- **Thinking / extended reasoning** — Toggle  "Thinking Mode" that lets supported models (Claude, Gemini) reason through problems before answering.
- **Web search toggle** — Enable grounded web search for supported models with a single click.
- **Streaming responses** — Replies stream in token-by-token so you see output immediately.
- **Full Markdown rendering** — Tables, code blocks with syntax highlighting, blockquotes, lists all rendered cleanly.
- **LaTeX / math support** — Inline and block math rendered via KaTeX.
- **File attachments** — Attach images or other files and include them in your prompt.
- **Multiple named API keys** — Save several keys locally, label them, and switch between them from the sidebar. Keys are stored only in your browser's `localStorage`.
- **Per-key daily spend tracking** — The app estimates your token costs per key and shows today's spend in the sidebar.
- **Conversation history** — All chats are stored locally in the browser. Search, rename, or delete conversations at any time.
- **Auto-generated titles** — After the first message, a cheap fast model names the conversation automatically.
- **Command palette** — Hit `Ctrl+K` to search conversations, switch models, or trigger actions without touching the mouse.
- **Export options** — Download any conversation as Markdown, JSON, PDF, or a standalone HTML file.
- **Import / export all data** — Back up all conversations to JSON and restore them on another device.
- **Customisable interface** — Font size, compact mode, code theme (dark / light / GitHub Dark), Enter-to-send preference.
- **System prompt & persona** — Set a default system message and an assistant persona that get prepended to every conversation.
- **Instruction templates & few-shot examples** — Wrap user prompts with a custom template and include example exchanges to guide model behaviour.
- **Context limit warning** — A banner appears when a conversation is approaching the model's context window.
- **Details panel** — Live view of the active model, its context length, capabilities, pricing, and per-conversation token/cost estimates.
- **Keyboard shortcuts** — Full set of shortcuts for power users (see Settings → Shortcuts).

---

## How It Works

The browser cannot call most AI APIs directly because of CORS restrictions. `server.js` is a tiny Node.js HTTP server that:

1. Serves the static frontend files (`index.html`, `style.css`, `script.js`).
2. Exposes a proxy at `/api/v1` that forwards requests to `https://ai.hackclub.com/proxy/v1`.

Your API key is sent from the browser to the local proxy in the `Authorization` header — it never hits any third-party server other than the AI provider.

---

## Local Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later (no npm packages required — the server uses only built-in Node modules).

### Steps

```bash
# 1. Clone or download the project
git clone https://github.com/your-username/fuddig-ai.git
cd fuddig-ai

# 2. Start the local proxy + dev server
node server.js
```

Open your browser at **http://localhost:8787**.

The server defaults to port `8787`. If that port is busy it will automatically try the next one (up to 10 attempts). You can also set a custom port:

```bash
PORT=3000 node server.js
```

### First-Time Configuration

1. Click the **⚙ Settings** button (bottom of the sidebar) or press `Ctrl+,`.
2. Go to the **API** tab.
3. Enter a key name (e.g. "Personal") and your OpenRouter-compatible API key (starts with `sk-or-...`).
4. Click **Add New Key**, then **Save Settings**.
5. The status dot in the sidebar turns green when the key is valid.

The default model is **Claude Sonnet 4.5**. Change it any time from the model selector in the header or from **Settings → Models**.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+N` | New conversation |
| `Ctrl+K` | Command palette / search |
| `Ctrl+,` | Open settings |
| `Enter` | Send message |
| `Shift+Enter` | New line in input |
| `Ctrl+Enter` | Send (always, ignoring Enter-to-send setting) |
| `Ctrl+Shift+T` | Toggle thinking mode |
| `Ctrl+L` | Clear current chat |
| `Ctrl+Shift+E` | Export current chat |
| `Escape` | Stop generation / close modal |
| `↑` (empty input) | Edit last user message |
| `?` or `Ctrl+/` | Show shortcut list |

---

## Project Structure

```
├── index.html      # App shell and all UI markup
├── style.css       # All styling (dark theme, layout, components)
├── script.js       # All client-side logic (state, API calls, rendering)
├── server.js       # Local dev proxy + static file server
└── settings.json   # Default settings (reference — runtime settings live in localStorage)
```

## Use in vercel

Go to : 

## Privacy

- API keys are stored exclusively in your browser's `localStorage`.
- Conversation history is stored exclusively in your browser's `localStorage`.
- The proxy (`server.js` locally, or the Vercel function) only forwards requests and never logs or stores message content.

---

## License

MIT — do whatever you like with it.
