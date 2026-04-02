# Roo Plugin Example

A VS Code extension that demonstrates all major Roo Code plugin API features inside a **sidebar panel UI** (plus a status bar item as a secondary display).

The panel UI is built with **Vite + React + TypeScript** and lives in `webview-ui/`. The extension host (`src/extension.ts`) loads the compiled assets at runtime via `webview.asWebviewUri`.

| Feature                     | Where it shows up                                                              |
| --------------------------- | ------------------------------------------------------------------------------ |
| **Tool registration**       | `word_count` and `get_datetime` tools available to the agent                   |
| **Context subscription**    | Live mode / task ID / workspace / open-files display in the panel + status bar |
| **Token usage tracking**    | Cumulative token counts and cost, updated in real time in the panel            |
| **Tool failure alerts**     | Failed tool invocations logged in the panel and shown as VS Code notifications |
| **Agent message stream**    | Live assistant transcript rendered in the panel                                |
| **Panel message bus**       | Bidirectional ping/pong between the panel webview and extension host           |
| **Agent messaging**         | Panel textarea and "Ask Date & Time" button send messages to the active task   |
| **MCP server registration** | `plugin-time-server` (`mcp-server-time`) registered via the plugin API         |

---

## Prerequisites

- [Node.js](https://nodejs.org) 20+
- [pnpm](https://pnpm.io) 10+ (the Roo Code monorepo uses pnpm as its package manager)
- The **Roo Code** extension installed in VS Code (`RooVeterinaryInc.roo-cline`)

---

## Setup

Dependencies are managed by the monorepo. From the **repository root**, run:

```bash
pnpm install
```

This installs both the extension host dependencies and the `webview-ui` dependencies in one step (both packages are declared in `pnpm-workspace.yaml`).

---

## Running in VS Code (Extension Development Host)

1. Build the webview UI (required before first launch, and after any changes to `webview-ui/src/`):

    ```bash
    # From the repository root:
    pnpm --filter roo-plugin-example-webview-ui run build

    # Or from the examples/roo-plugin-example directory:
    pnpm run build:webview-ui
    ```

2. Open the **root** of the Roo Code repository in VS Code (not the example subfolder):

    ```bash
    code .
    ```

3. In the **Run and Debug** panel, select **"Run Roo Plugin Example"** from the dropdown and press **F5**.
   This opens an **Extension Development Host** window with both Roo Code and this example plugin loaded together.

    > **Why the root?** The EDH starts with a clean profile that has no installed extensions.
    > The launch config passes both `src/` (Roo Code) and `examples/roo-plugin-example` as
    > `--extensionDevelopmentPath` arguments, so both load side-by-side without needing
    > Roo Code to be installed in your normal VS Code profile.

4. In the Extension Development Host window, verify the plugin activated:
    - A notification appears: _"Roo Plugin Example activated — open the 'Roo Plugin Demo' panel in the Roo sidebar."_
    - A `$(robot) Roo [code] idle` item appears in the bottom-right status bar.
    - A **"Roo Plugin Demo"** section appears inside the Roo sidebar (click the Roo icon in the Activity Bar).

---

## Testing each feature in the panel

Open the **Roo Plugin Demo** panel by clicking the Roo icon in the Activity Bar and expanding the "Roo Plugin Demo" section.

### 1. Context subscription

The **Context** section of the panel (and the status bar item) update automatically:

- **Start a Roo task** → Task ID appears and mode is shown.
- **Switch mode** → Mode pill updates immediately.
- **Open or close files** → Open Files list refreshes.
- **End the task** → Task reverts to `idle`.

### 2. MCP server — `plugin-time-server`

The plugin registers the [`mcp-server-time`](https://github.com/modelcontextprotocol/servers/tree/main/src/time) server with Roo Code via `handle.registerMcpServer()`.
This requires [`uvx`](https://docs.astral.sh/uv/) (part of the `uv` Python toolchain):

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Once registered, the server appears in Roo's **MCP** settings tab alongside global and project servers (labelled with its plugin source). With a task active, you can ask the agent:

> _"What time is it in Tokyo right now?"_ > _"Convert 3 PM UTC to New York time."_

The server is automatically unregistered when the example extension deactivates.

### 3. Custom tools — `word_count` and `get_datetime`

With a task active, ask the agent to use the registered tools via the Roo chat:

> _"Use the word_count tool on the text 'hello world foo bar'."_ > _"Use the get_datetime tool to tell me the current time."_

The agent will invoke the tool and return the result. Tool names are namespaced:

- `example.roo-plugin-example/word_count`
- `example.roo-plugin-example/get_datetime`

### 4. Token usage

Every time the agent makes an LLM request the **Token Usage** section updates live with token counts and accumulated cost. The status bar also shows the running cost (`· $0.0123`).

### 5. Tool failure alerts

If a tool invocation fails, the failure is shown in the **Tool Failures** section of the panel and as a VS Code warning notification.

### 6. Agent message stream

The **Agent Messages** section shows a live, scrollable transcript of the assistant's replies. Only final (non-partial) `say/text` messages are rendered. Click **Clear** to reset the log.

### 7. Send to Agent — panel textarea

1. Start a Roo task.
2. Type any message in the **Send to Agent** textarea.
3. Press **Send** (or `Ctrl+Enter` / `Cmd+Enter`).
   → The extension calls `handle.sendMessageToAgent(...)` and the agent responds as if you had typed in the Roo chat directly.

Click **Ask Date & Time** to fire a pre-canned message without typing.

The same action is also available via the Command Palette: **"Roo: Ask Agent for Current Date & Time"**.

### 8. Panel message bus — ping/pong

**Panel → Extension Host:**

1. Click **Ping Extension Host** in the **Panel Message Bus** section.
2. The extension host receives the ping, logs it to the _Roo Plugin Example_ output channel, and sends a pong back.
3. The panel shows the round-trip time: `🏓 Pong from extension host — round-trip N ms`.

**Extension Host → Panel:**

1. Open the Command Palette and run **"Roo Plugin: Ping Panel from Extension Host"**.
2. The panel receives the ping, displays the latency, and posts a pong back to the host.
3. The round-trip is logged in the output channel.

---

## Development workflow

Two processes run in parallel during active development:

| Process        | Command (run from `examples/roo-plugin-example/`) | What it does                                            |
| -------------- | ------------------------------------------------- | ------------------------------------------------------- |
| Extension host | `pnpm run watch`                                  | Recompiles `src/extension.ts` on save via `tsc --watch` |
| Webview UI     | `pnpm --dir webview-ui run build`                 | One-shot Vite production build; re-run after UI changes |

> **Tip:** The webview UI does not use Vite's HMR inside the Extension Development Host. After editing files under `webview-ui/src/`, rebuild with `pnpm run build:webview-ui` and reload the EDH window (`Ctrl+R` / `Cmd+R`).

---

## Packaging

To produce a `.vsix` file:

```bash
# From examples/roo-plugin-example/:
pnpm run package
```

This runs `build:webview-ui` → `compile` → `vsce package` in sequence. The resulting file is written to `bin/roo-plugin-example-0.0.1.vsix`. The `.vscodeignore` file ensures that only the compiled outputs (`out/` and `webview-ui/dist/`) are bundled — source files and `node_modules` are excluded.

---

## File overview

```
examples/roo-plugin-example/
├── .vscodeignore           # Excludes source & node_modules from the VSIX
├── package.json            # Extension manifest: view contribution, commands, scripts
├── tsconfig.json           # TypeScript config for the extension host (CommonJS output)
├── src/
│   └── extension.ts        # activate() — tools, panel provider, event forwarding
└── webview-ui/             # Vite + React + TypeScript panel UI
    ├── package.json        # UI dependencies (react, vite, @vitejs/plugin-react)
    ├── tsconfig.json       # TypeScript config for the webview (bundler module resolution)
    ├── vite.config.ts      # Builds to dist/ with predictable asset filenames
    ├── index.html          # Vite entry point
    └── src/
        ├── vite-env.d.ts   # Vite client types + acquireVsCodeApi() declaration
        ├── main.tsx        # React entry — mounts <App /> into #root
        ├── App.tsx         # Panel UI component: context, tokens, messages, send, ping
        └── App.css         # VS Code CSS variable-based styles
```

### Key points in `package.json`

```jsonc
"activationEvents": ["onCommand:roo-cline.activationCompleted"],
```

Ensures this plugin activates only after Roo Code has finished its own activation.

```jsonc
"extensionDependencies": ["RooVeterinaryInc.roo-cline"],
```

Guarantees Roo Code is active before `activate()` runs, so `rooExt.exports` is always available.

```jsonc
"contributes": {
  "views": {
    "roo-cline-ActivityBar": [
      { "type": "webview", "id": "roo-plugin-example.panel", "name": "Roo Plugin Demo" }
    ]
  }
}
```

Adds the **"Roo Plugin Demo"** webview panel to Roo's own sidebar using VS Code's native
`contributes.views` mechanism — no changes to Roo Code's source required.

```jsonc
"contributes": { "roo-code": { ... } }
```

Enables **declarative auto-discovery**: Roo Code scans this field at startup and
registers the plugin automatically, even before `activate()` is called.
