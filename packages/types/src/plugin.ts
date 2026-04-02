import type { CustomToolDefinition } from "./custom-tool.js"
import type { ClineMessage, TokenUsage } from "./message.js"
import type { ToolName, ToolUsage } from "./tool.js"

/**
 * Configuration for an MCP server registered by a plugin.
 * Mirrors the subset of McpHub's ServerConfigSchema that plugins may supply.
 */
export type PluginMcpServerConfig =
	| {
			type: "stdio"
			command: string
			args?: string[]
			env?: Record<string, string>
			cwd?: string
			disabled?: boolean
			timeout?: number
			alwaysAllow?: string[]
			disabledTools?: string[]
	  }
	| {
			type: "sse"
			url: string
			headers?: Record<string, string>
			disabled?: boolean
			timeout?: number
			alwaysAllow?: string[]
			disabledTools?: string[]
	  }
	| {
			type: "streamable-http"
			url: string
			headers?: Record<string, string>
			disabled?: boolean
			timeout?: number
			alwaysAllow?: string[]
			disabledTools?: string[]
	  }

/**
 * Minimal disposable interface (mirrors vscode.Disposable without the dependency).
 */
export interface RooDisposable {
	dispose(): void
}

/**
 * Structural interface matching the shape of `vscode.Webview` for the subset of
 * members used by the plugin panel bus (avoids a hard dependency on the `vscode` module).
 */
export interface RooWebview {
	postMessage(message: unknown): Promise<boolean>
	onDidReceiveMessage(listener: (message: unknown) => void): RooDisposable
}

/**
 * Structural interface matching the shape of `vscode.WebviewView`.
 */
export interface RooWebviewView {
	readonly webview: RooWebview
}

/**
 * A snapshot of the agent's current runtime context, broadcast to plugins whenever
 * the agent state changes (task started/stopped, mode changed, etc.).
 */
export interface RooTaskContext {
	/** The active task ID, or undefined when no task is running. */
	taskId: string | undefined
	/** The current mode slug (e.g. "code", "architect"). */
	mode: string
	/** Workspace root paths currently open in VS Code. */
	workspaceFolders: string[]
	/** Paths of files currently open in the editor. */
	openFiles: string[]
	/**
	 * Cumulative token usage for the active task.
	 * Updated live as the task runs; undefined when no task is active.
	 */
	tokenUsage?: TokenUsage
	/**
	 * Cumulative tool usage for the active task.
	 * Updated live as the task runs; undefined when no task is active.
	 */
	toolUsage?: ToolUsage
}

/**
 * Declarative manifest contributed by a plugin.
 * Plugins may optionally provide this in their package.json under
 * `contributes["roo-code"]`, or supply it programmatically to `register()`.
 */
export interface RooPluginManifest {
	/** Unique plugin identifier — must be the VS Code extension ID (publisher.name). */
	id: string
	/** Human-readable plugin name shown in Roo's UI. */
	displayName: string
	/** Optional short description of the plugin's purpose. */
	description?: string
	/** Tool definitions contributed by this plugin. */
	tools?: CustomToolDefinition[]
}

/**
 * Handle returned to a plugin after successful registration.
 * All subscriptions and contributions scoped to this handle are automatically
 * cleaned up when `dispose()` is called.
 */
export interface RooPluginHandle extends RooDisposable {
	/** The manifest this handle was registered with. */
	readonly manifest: RooPluginManifest

	/**
	 * Returns a snapshot of the current agent context.
	 * Safe to call at any time; returns defaults when no task is active.
	 */
	getContext(): RooTaskContext

	/**
	 * Subscribe to context changes.
	 * The callback is invoked whenever the agent state changes
	 * (e.g. a new task starts, the mode changes, the workspace changes).
	 *
	 * @returns A disposable to unsubscribe.
	 */
	onContextChange(listener: (context: RooTaskContext) => void): RooDisposable

	/**
	 * Send a text message to the currently active task, as if the user had typed it.
	 * No-op when no task is active.
	 */
	sendMessageToAgent(message: string, images?: string[]): Promise<void>

	/**
	 * Register an additional tool at runtime.
	 * The tool name will be automatically namespaced as `<pluginId>/<toolName>`.
	 *
	 * @returns A disposable that unregisters the tool when disposed.
	 */
	registerTool(definition: CustomToolDefinition): RooDisposable

	/**
	 * Register an MCP server with Roo Code.
	 * The server will appear in Roo's MCP server list alongside global and project servers.
	 * It will be automatically unregistered when the returned disposable (or the handle itself) is disposed.
	 *
	 * @param name - Unique name for this MCP server.
	 * @param config - Server configuration (stdio, sse, or streamable-http).
	 * @returns A promise that resolves to a disposable that unregisters the server when disposed.
	 */
	registerMcpServer(name: string, config: PluginMcpServerConfig): Promise<RooDisposable>

	/**
	 * Subscribe to live token/tool usage updates for the active task.
	 * Called each time the agent reports new token counts (roughly after each LLM request).
	 *
	 * @returns A disposable to unsubscribe.
	 */
	onTokenUsageUpdated(listener: (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => void): RooDisposable

	/**
	 * Subscribe to tool-failure events.
	 * Called whenever a tool invocation fails inside the active task.
	 *
	 * @returns A disposable to unsubscribe.
	 */
	onToolFailed(listener: (taskId: string, toolName: ToolName, errorMessage: string) => void): RooDisposable

	// ── Phase 4: Plugin Panel Message Bus ────────────────────────────────────

	/**
	 * Register a webview view (sidebar panel or editor panel) with this plugin's handle.
	 * Call this inside your `WebviewViewProvider.resolveWebviewView()` implementation.
	 * Once registered, `postMessageToPanel` and `onMessageFromPanel` become active.
	 *
	 * @param view - The `vscode.WebviewView` handed to you by VS Code.
	 * @returns A disposable that unregisters the view.
	 */
	registerPanelView(view: RooWebviewView): RooDisposable

	/**
	 * Post a message to the plugin's registered webview panel.
	 * No-op if no panel view has been registered yet.
	 *
	 * @param message - Any JSON-serialisable value.
	 */
	postMessageToPanel(message: unknown): Promise<void>

	/**
	 * Subscribe to messages sent by the plugin's webview panel via `acquireVsCodeApi().postMessage()`.
	 * No-op (returns a no-op disposable) if no panel view has been registered yet;
	 * listeners registered before `registerPanelView` are attached automatically once the view arrives.
	 *
	 * @returns A disposable to unsubscribe.
	 */
	onMessageFromPanel(listener: (message: unknown) => void): RooDisposable

	// ── Phase 5: Agent Communication ─────────────────────────────────────────

	/**
	 * Subscribe to messages emitted by the agent during any active task.
	 * The listener receives the raw `ClineMessage` (which includes `type`, `say`, `ask`, `text`, etc.)
	 * together with the `taskId` and whether the message was `"created"` or `"updated"`.
	 *
	 * Useful for logging, external syncing, or driving custom UI that mirrors the conversation.
	 *
	 * @returns A disposable to unsubscribe.
	 */
	onAgentMessage(
		listener: (taskId: string, action: "created" | "updated", message: ClineMessage) => void,
	): RooDisposable
}

/**
 * The public plugin service exposed on `RooCodeAPI.plugins`.
 * Third-party extensions use this to register themselves with Roo Code.
 */
export interface RooPluginService {
	/**
	 * Register a plugin with Roo Code.
	 *
	 * @param manifest - Plugin manifest describing the plugin's identity and contributions.
	 * @returns A `RooPluginHandle` scoped to this registration.
	 * @throws If a plugin with the same `id` is already registered.
	 */
	register(manifest: RooPluginManifest): RooPluginHandle

	/**
	 * Returns metadata for all currently registered plugins.
	 */
	getRegisteredPlugins(): RooPluginManifest[]
}
