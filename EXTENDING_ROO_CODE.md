# Extending Roo Code — Plugin System Design

## Goals

- Allow third-party VS Code extensions to extend Roo Code **without modifying the Roo Code extension itself**.
- Support both **declarative** contribution points (declared in a plugin's `package.json`) and **programmatic** registration (via a typed TypeScript API returned from `activate()`).
- Let plugins add **custom UI panels** to Roo's sidebar that have access to the current agent context (task, open files, mode, etc.) and can send/receive messages to/from the agent.
- Keep the plugin surface **stable and versioned** so plugins don't break when Roo Code's internal implementation changes.

---

## What Already Exists (Useful Head Start)

Before designing anything new it is worth noting what Roo Code already ships:

| Mechanism                               | Where it lives                                      | What it provides                                                                                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `RooCodeAPI`                            | `src/extension/api.ts`, `packages/types/src/api.ts` | Typed API returned from `activate()`. Already usable by other extensions via `vscode.extensions.getExtension(...).exports`. Supports task control, profile management, and event subscription.                                                   |
| `customToolRegistry`                    | `packages/core/src/custom-tools/`                   | Singleton registry. Tools can be registered programmatically (`registry.register(def)`) or loaded from `.roo/tools/*.ts` files on disk.                                                                                                          |
| MCP server support                      | `src/services/mcp/`                                 | Roo can connect to any MCP server. Plugins that stand up an MCP server can already add themselves to Roo's config.                                                                                                                               |
| Custom modes                            | `CustomModesManager`, marketplace                   | Modes can be contributed via `.roo/modes.yaml` or the marketplace. No in-process API yet.                                                                                                                                                        |
| `roo-cline-ActivityBar` view container  | `src/package.json` → `contributes.viewsContainers`  | VS Code's native mechanism. **Any extension can already add a view to Roo's sidebar** by declaring `contributes.views["roo-cline-ActivityBar"]` in its own `package.json`. The only missing piece is a way to pass Roo's context into that view. |
| `roo-cline.activationCompleted` command | `src/extension.ts`                                  | Fired after Roo finishes activating. Plugin extensions can use `onCommand:roo-cline.activationCompleted` as their `activationEvent` to guarantee Roo is ready before they call its API.                                                          |

---

## Recommended Architecture

A hybrid of two complementary layers:

1. **Declarative contribution points** — static metadata in a plugin's `package.json` for things Roo can discover at startup without activating the plugin (modes, MCP server configs, menu items).
2. **Programmatic Plugin Registration API** — a strongly-typed API surface that plugins call from their own `activate()` to register tools, context providers, and UI panels, and to subscribe to agent events.

These two layers are designed to work independently; a plugin can use one or both.

---

## Layer 1 — Declarative Contribution Points

Plugins declare a `contributes["roo-code"]` key in their own `package.json`. Roo Code scans all installed extensions for this key at activation time (no user action needed).

```jsonc
// my-roo-plugin/package.json  (the plugin extension, not Roo Code)
{
	"name": "my-roo-plugin",
	"engines": { "vscode": "^1.84.0" },
	"extensionDependencies": ["RooVeterinaryInc.roo-cline"],
	"activationEvents": ["onCommand:roo-cline.activationCompleted"],

	"contributes": {
		// ── 1a. Custom Modes ──────────────────────────────────────────────
		"roo-code": {
			"modes": [
				{
					"slug": "reviewer",
					"name": "Code Reviewer",
					"roleDefinition": "You are an expert code reviewer...",
					"groups": ["read", "browser"],
				},
			],

			// ── 1b. MCP Servers (auto-registered into Roo's MCP config) ────
			"mcpServers": [
				{
					"name": "my-plugin-mcp",
					"command": "node",
					"args": ["${extensionPath}/out/mcp-server.js"],
					"env": {},
				},
			],

			// ── 1c. Context-menu items (added to Roo's editor right-click) ─
			"contextMenuItems": [
				{
					"id": "my-plugin.reviewSelection",
					"label": "Review with My Plugin",
					"command": "my-plugin.reviewSelection",
					"when": "editorHasSelection",
				},
			],
		},

		// ── 1d. Custom sidebar panel (native VS Code mechanism) ──────────
		"views": {
			"roo-cline-ActivityBar": [
				{
					"type": "webview",
					"id": "my-plugin.panel",
					"name": "My Plugin",
				},
			],
		},
	},
}
```

**How Roo discovers these at startup:**

```typescript
// src/activate/discoverPlugins.ts  (new file)
export async function discoverPlugins(context: vscode.ExtensionContext): Promise<void> {
	for (const ext of vscode.extensions.all) {
		const contrib = ext.packageJSON?.contributes?.["roo-code"]
		if (!contrib) continue

		// Register declared modes
		for (const mode of contrib.modes ?? []) {
			await customModesManager.addMode(mode)
		}

		// Queue declared MCP servers for registration
		for (const server of contrib.mcpServers ?? []) {
			await mcpHub.addServerConfig(resolveServerPaths(server, ext.extensionPath))
		}
	}
}
```

---

## Layer 2 — Programmatic Plugin Registration API

Roo Code extends its exported API with a `plugins` namespace. A plugin calls `roo.plugins.register(...)` from its own `activate()` to get a `RooPluginHandle` — a scoped object that lets the plugin contribute tools, subscribe to context events, and communicate with the agent.

### New Types (added to `packages/types/src/api.ts`)

```typescript
// packages/types/src/plugin.ts  (new file)

import type { CustomToolDefinition } from "./custom-tool.js"
import type { ModeConfig } from "./mode.js"

/** Manifest the plugin declares when registering. */
export interface RooPluginManifest {
	/** Unique reverse-domain identifier, e.g. "com.example.my-plugin" */
	id: string
	displayName: string
	/** Tools the plugin contributes to the custom tool registry. */
	tools?: CustomToolDefinition[]
	/** Custom modes to add/override. */
	modes?: ModeConfig[]
	/** Called when Roo is about to unregister this plugin (e.g. on deactivation). */
	onDispose?: () => void | Promise<void>
}

/** Snapshot of the current Roo agent context. */
export interface RooTaskContext {
	taskId: string | null
	mode: string
	isRunning: boolean
	openFiles: string[] // absolute paths currently open in VS Code
	workspaceFolders: string[] // absolute paths of workspace roots
}

/** Object returned to the plugin after registration. */
export interface RooPluginHandle {
	/** Unregister all contributions and tear down listeners. */
	dispose(): void

	// ── Context subscription ──────────────────────────────────────────
	/** Get a snapshot of the current agent context. */
	getContext(): RooTaskContext
	/** Subscribe to context changes (task started/stopped, file opened, mode changed, etc.) */
	onContextChange(handler: (ctx: RooTaskContext) => void): vscode.Disposable

	// ── Agent communication ───────────────────────────────────────────
	/** Send a text message to the current task (same as the user typing in chat). */
	sendMessageToAgent(text: string, images?: string[]): Promise<void>
	/** Subscribe to messages the agent emits (assistant replies, tool calls, etc.) */
	onAgentMessage(handler: (message: RooAgentMessage) => void): vscode.Disposable

	// ── Plugin-panel message bus ──────────────────────────────────────
	/**
	 * Send a message from the extension host to the plugin's own webview panel.
	 * The panel receives this via the standard VS Code `acquireVsCodeApi().onmessage` mechanism.
	 */
	postMessageToPanel(message: unknown): void
	/**
	 * Subscribe to messages the plugin's webview panel posts back to the extension host.
	 * The panel posts messages via `vscode.postMessage(...)`.
	 */
	onMessageFromPanel(handler: (message: unknown) => void): vscode.Disposable
}

export interface RooAgentMessage {
	taskId: string
	role: "assistant" | "tool"
	content: string
	partial: boolean
}

/** Subset of RooCodeAPI exposed to plugins. */
export interface RooPluginService {
	register(manifest: RooPluginManifest): RooPluginHandle
	/** List all currently registered plugin IDs. */
	getRegisteredPlugins(): string[]
}
```

### Extending `RooCodeAPI`

```typescript
// packages/types/src/api.ts  (addition)
export interface RooCodeAPI extends EventEmitter<RooCodeAPIEvents> {
	// ... existing methods ...

	/** Plugin registration service. Available after Roo has fully activated. */
	readonly plugins: RooPluginService
}
```

### Plugin-side usage (example)

```typescript
// my-roo-plugin/src/extension.ts
import * as vscode from "vscode"
import type { RooCodeAPI } from "roo-cline" // type-only import from published @roo-code/types

export async function activate(context: vscode.ExtensionContext) {
	const rooExtension = vscode.extensions.getExtension<RooCodeAPI>("RooVeterinaryInc.roo-cline")
	if (!rooExtension) return

	const roo = await rooExtension.activate()

	const handle = roo.plugins.register({
		id: "com.example.my-plugin",
		displayName: "My Roo Plugin",

		tools: [
			{
				name: "fetch_jira_ticket",
				description: "Fetches a Jira ticket by ID and returns its description.",
				parameters: z.object({ ticketId: z.string() }),
				async execute({ ticketId }) {
					const data = await myJiraClient.getTicket(ticketId)
					return JSON.stringify(data)
				},
			},
		],
	})

	// Keep the panel in sync with whatever task Roo is running.
	handle.onContextChange((ctx) => {
		handle.postMessageToPanel({ type: "contextUpdate", context: ctx })
	})

	// Forward agent messages to the panel so it can show a live transcript.
	handle.onAgentMessage((msg) => {
		if (!msg.partial) handle.postMessageToPanel({ type: "agentMessage", message: msg })
	})

	context.subscriptions.push({ dispose: () => handle.dispose() })
}
```

---

## Custom UI Panels — Design Details

Plugin UI panels are **not** injected into Roo's own React webview. Instead they are first-class VS Code `WebviewView` panels declared with `contributes.views` (Layer 1). This has several advantages:

- Each plugin owns its entire HTML/React bundle — no dependency on Roo's UI internals.
- VS Code handles panel lifecycle (show/hide, retention, etc.) automatically.
- Communication with the agent uses the `RooPluginHandle` message bus (above) — clean and typed.

```
┌────────────────────────── Activity Bar ─────────────────────────────┐
│  ┌─ roo-cline-ActivityBar ──────────────────────────────────────┐   │
│  │  [ Roo Code ]           ← Roo's own webview                  │   │
│  │  ─────────────────────────────────────────────────────────   │   │
│  │  [ My Plugin ]          ← Plugin's WebviewView               │   │
│  │     (plugin owns HTML; receives context via plugin API)       │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

                Extension Host process
  ┌────────────────┐  plugins.register()  ┌──────────────────────┐
  │  Roo Code      │ ◄─────────────────── │  Plugin Extension    │
  │  (API server)  │                      │  (API client)        │
  │                │  onContextChange()   │                      │
  │                │ ─────────────────── ►│  postMessageToPanel()│
  │                │                      │       │              │
  └────────────────┘                      └───────┼──────────────┘
                                                  │ VS Code webview message bus
                                          ┌───────▼──────────────┐
                                          │  Plugin Webview UI   │
                                          │  (HTML / React)      │
                                          └──────────────────────┘
```

The plugin's webview panel registers a `WebviewViewProvider` in its own extension and uses `acquireVsCodeApi()` to communicate with its extension host. The extension host then relays context updates from Roo's `RooPluginHandle`.

---

## Implementation Plan

### Phase 0 — Preparation (no new features)

- [ ] Publish `@roo-code/types` to npm (or document how plugins import types). This is the stable contract between Roo and plugins.
- [ ] Add `extensionDependencies` and `activationEvents` documentation for plugin authors.
- [ ] Audit what `RooCodeAPI` already exports and decide what needs to be hidden vs. surfaced.

### Phase 1 — Plugin Registration Service

**Effort: Medium | Risk: Low**

New files:

- `src/services/plugin/RooPluginService.ts` — implements `RooPluginService`, wraps `customToolRegistry` and the custom modes manager.
- `src/services/plugin/RooPluginHandle.ts` — scoped handle returned to each plugin.

Changes to existing files:

- `src/extension/api.ts` — add `readonly plugins: RooPluginService` property.
- `packages/types/src/plugin.ts` — add the new types above.
- `packages/types/src/api.ts` — add the `plugins` property to `RooCodeAPI`.

The `register()` method:

1. Validates the manifest (unique ID, valid tool definitions, etc.).
2. Registers each tool with `customToolRegistry.register(tool, pluginId)`.
3. Adds any declared modes to `CustomModesManager`.
4. Returns a `RooPluginHandle` that holds a cleanup callback list.

### Phase 2 — Declarative Contribution Points & Auto-Discovery

**Effort: Low | Risk: Low**

New file: `src/activate/discoverPlugins.ts`

- Called from `activate()` in `src/extension.ts` after `ClineProvider` and `McpHub` are initialized.
- Iterates `vscode.extensions.all`, reads `contributes["roo-code"]`, and registers modes and MCP servers.
- Re-runs when `vscode.extensions.onDidChange` fires (plugins installed/removed at runtime).

### Phase 3 — Context Subscription

**Effort: Medium | Risk: Low**

- Add a `RooContextBroadcaster` that listens to existing `RooCodeEventName` events (`TaskStarted`, `TaskCompleted`, `ModeChanged`, etc.) and computes a `RooTaskContext` snapshot.
- `RooPluginHandle.onContextChange()` subscribes to this broadcaster.
- `RooPluginHandle.getContext()` returns the latest cached snapshot.

No changes to the core task loop — this is purely additive event wiring on top of existing events.

### Phase 4 — Plugin Panel Message Bus

**Effort: Medium | Risk: Low**

- `RooPluginService` keeps a `Map<pluginId, vscode.WebviewView>`.
- When a plugin's webview view becomes visible, it calls back to the plugin's registered `WebviewViewProvider`; the plugin then calls `handle.postMessageToPanel(msg)`.
- `postMessageToPanel` calls `webviewView.webview.postMessage(msg)`.
- `onMessageFromPanel` attaches a listener to `webviewView.webview.onDidReceiveMessage`.
- The plugin must call `roo.plugins.registerPanelView(viewId, webviewView)` when VS Code hands its `WebviewViewProvider.resolveWebviewView()` the view object.

### Phase 5 — Agent Communication

**Effort: Low | Risk: Low**

- `handle.sendMessageToAgent()` — delegates to the existing `API.sendMessage()`.
- `handle.onAgentMessage()` — subscribes to `RooCodeEventName.Message` events filtered to `role === 'assistant'`.

Both are thin wrappers over infrastructure that already exists.

### Phase 6 — MCP Server Auto-Registration from Plugins

**Effort: Medium | Risk: Medium**

- After `McpHub` is initialized, for each discovered plugin MCP server config, call `McpHub.addServerConfig()` with paths resolved relative to the plugin extension's `extensionPath`.
- Watch `vscode.extensions.onDidChange` to add/remove MCP configs as plugins are installed/uninstalled.
- Expose `handle.createMcpServer(options)` as an optional helper that spins up a lightweight in-process MCP server (using the `@modelcontextprotocol/sdk`) and auto-registers it — eliminating the need for plugins to manage a separate process.

---

## Security & Trust Considerations

- Plugins that register custom tools can run arbitrary code when the agent invokes those tools. Roo should display a one-time user consent prompt the first time an unrecognized plugin registers tools, similar to how VS Code asks about workspace trust.
- The `contributes["roo-code"]` key should be validated against a JSON schema in Roo's `package.json` `contributes` definition so VS Code's extension validator catches errors early.
- MCP server auto-registration should be opt-in at the user level (a setting `roo-code.autoRegisterPluginMcpServers`).
- Plugin tool names should be namespaced by plugin ID to prevent conflicts (e.g., `com.example.my-plugin/fetch_jira_ticket`).

---

## Open Questions

1. **Versioning**: Should `@roo-code/types` be semver-stable and published to npm, or should plugins just import types via a path alias? Publishing to npm (`@roo-code/types`) is already set up (`packages/types/npm/`) — this just needs to be flagged as the stable plugin API surface.
2. **Multi-instance**: Roo can open in multiple tabs (`openClineInNewTab`). Should `RooPluginHandle` expose a per-tab or global context? Recommendation: global context pointing to the "focused" task, matching how the existing `RooCodeAPI` works.
3. **In-process MCP vs. subprocess MCP**: Phase 6 proposes an optional in-process MCP helper. This is convenient but means plugin bugs can crash the extension host. A subprocess MCP (which already works today) is safer. Both should be documented.
4. **UI panel slots**: If deeper integration into Roo's own React UI is needed (e.g., a widget inside the chat panel), a slot-based system using `postMessage` into Roo's webview and dynamic `<iframe>` rendering would be required. This is significantly more complex and should be deferred until there is clear demand.
