# Roo Plugin Example

A minimal VS Code extension that demonstrates the three core features of the Roo Code plugin API:

| Feature                  | What it does                                                             |
| ------------------------ | ------------------------------------------------------------------------ |
| **Tool registration**    | Adds `word_count` and `get_datetime` tools the agent can call            |
| **Context subscription** | Shows a live status bar item reflecting the current mode and active task |
| **Agent messaging**      | Provides a command that sends a message directly to the active task      |

---

## Prerequisites

- [Node.js](https://nodejs.org) 20+
- [pnpm](https://pnpm.io) (used by the Roo Code monorepo)
- The **Roo Code** extension installed in VS Code (`RooVeterinaryInc.roo-cline`)

---

## Setup

From the `examples/roo-plugin-example` directory:

```bash
npm install
npm run compile
```

---

## Running in VS Code (Extension Development Host)

1. Open the **root** of the Roo Code repository in VS Code (not the example subfolder):

    ```bash
    code .
    ```

2. In the **Run and Debug** panel, select **"Run Roo Plugin Example"** from the dropdown and press **F5**.
   This opens an **Extension Development Host** window with both Roo Code and this example plugin loaded together.

    > **Why the root?** The EDH starts with a clean profile that has no installed extensions.
    > The launch config passes both `src/` (Roo Code) and `examples/roo-plugin-example` as
    > `--extensionDevelopmentPath` arguments, so both load side-by-side without needing
    > Roo Code to be installed in your normal VS Code profile.

3. In the Extension Development Host window, verify the plugin activated:
    - A notification appears: _"Roo Plugin Example activated — tools and status bar are live."_
    - A `$(robot) Roo [code] idle` item appears in the bottom-right status bar.

---

## Testing each feature

### 1. Status bar — context subscription

The status bar item updates automatically as the agent state changes.

- **Start a Roo task** (open the Roo sidebar and send any message).  
  → The status bar changes from `idle` to `task:<taskId prefix>`.
- **Switch mode** (e.g. to `architect`).  
  → The mode label in the status bar updates immediately.
- **End the task**.  
  → The status bar returns to `idle`.

### 2. Custom tools — `word_count` and `get_datetime`

With a task active, ask the agent to use the registered tools:

> _"Use the word_count tool on the text 'hello world foo bar'."_

> _"Use the get_datetime tool to tell me the current time."_

The agent will invoke the tool and return the result. Tool names are automatically
namespaced by the service, so the agent sees them as:

- `example.roo-plugin-example/word_count`
- `example.roo-plugin-example/get_datetime`

### 3. Agent messaging — command

1. Start a Roo task so there is an active task ID.
2. Open the **Command Palette** (`Ctrl+Shift+P` / `Cmd+Shift+P`).
3. Run **"Roo: Ask Agent for Current Date & Time"**.  
   → The extension calls `handle.sendMessageToAgent(...)`, and the agent responds
   as if you had typed the message yourself.

If no task is active, the command shows an info notification instead of sending.

---

## File overview

```
examples/roo-plugin-example/
├── package.json        # Extension manifest; contributes["roo-code"] enables auto-discovery
├── tsconfig.json       # TypeScript config (CommonJS output)
└── src/
    └── extension.ts    # activate() wires up all three plugin features
```

### Key points in `package.json`

```jsonc
"activationEvents": ["onCommand:roo-cline.activationCompleted"],
```

Ensures this plugin activates only after Roo Code has finished its own activation.

```jsonc
"extensionDependencies": ["roo-cline.roo-cline"],
```

Guarantees Roo Code is active before `activate()` runs, so `rooExt.exports` is always available.

```jsonc
"contributes": { "roo-code": { ... } }
```

Enables **declarative auto-discovery**: Roo Code scans this field at startup and
registers the plugin automatically, even before `activate()` is called.
