import type { AgentPluginManifest, AgentPluginHandle, AgentPluginService } from "@roo-code/plugin-api"
import type { AgentMcpServerConfig } from "@roo-code/plugin-api"

import type { CustomToolDefinition } from "./custom-tool.js"
import type { TokenUsage } from "./message.js"
import type { ToolUsage } from "./tool.js"

// Re-export agent-agnostic types so plugin authors can import them from @roo-code/types.
export type { AgentPluginManifest, AgentPluginHandle, AgentPluginService } from "@roo-code/plugin-api"
export type {
	AgentMessage,
	AgentSayKind,
	AgentAskKind,
	AgentTokenUsage,
	AgentMcpServerConfig,
	AgentTaskContext,
	AgentToolDefinition,
	AgentToolContext,
	JsonSchema,
	AgentProfile,
	AgentProfileManager,
} from "@roo-code/plugin-api"

/**
 * Configuration for an MCP server registered by a plugin.
 * This is an alias for the agent-agnostic AgentMcpServerConfig from @roo-code/plugin-api.
 */
export type PluginMcpServerConfig = AgentMcpServerConfig

/**
 * Minimal disposable interface (mirrors vscode.Disposable without the dependency).
 * @deprecated Use `() => void` cleanup functions instead for environment-agnostic code.
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
	onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
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
 * Extends `AgentPluginManifest` with Roo Code-specific fields.
 * Plugins may optionally provide this in their package.json under
 * `contributes["roo-code"]`, or supply it programmatically to `register()`.
 */
export interface RooPluginManifest extends AgentPluginManifest {
	/** Tool definitions contributed by this plugin. */
	tools?: CustomToolDefinition[]
}

/**
 * Roo Code-specific extension of `AgentPluginHandle`.
 *
 * Adds VS Code webview panel integration on top of the agent-agnostic base.
 * All core capabilities (task management, messaging, tool registration, etc.)
 * are inherited from `AgentPluginHandle`.
 *
 * The `manifest` property is narrowed to `RooPluginManifest` so callers can
 * access Roo-specific manifest fields (e.g. `tools`).
 */
export interface RooPluginHandle extends AgentPluginHandle {
	/** The manifest this handle was registered with (Roo-specific superset). */
	readonly manifest: RooPluginManifest

	// ── Webview panel message bus (VS Code–specific) ──────────────────────────

	/**
	 * Register a webview view (sidebar panel or editor panel) with this plugin's handle.
	 * Call this inside your `WebviewViewProvider.resolveWebviewView()` implementation.
	 * Once registered, `postMessageToPanel` and `onMessageFromPanel` become active.
	 *
	 * @param view - The `vscode.WebviewView` handed to you by VS Code.
	 * @returns A cleanup function that unregisters the view.
	 */
	registerPanelView(view: RooWebviewView): () => void

	/**
	 * Post a message to the plugin's registered webview panel.
	 * No-op if no panel view has been registered yet.
	 *
	 * @param message - Any JSON-serialisable value.
	 */
	postMessageToPanel(message: unknown): Promise<void>

	/**
	 * Subscribe to messages sent by the plugin's webview panel.
	 * Listeners registered before `registerPanelView` are attached automatically once the view arrives.
	 *
	 * @returns A cleanup function that removes the listener when called.
	 */
	onMessageFromPanel(listener: (message: unknown) => void): () => void
}

/**
 * Roo Code-specific extension of `AgentPluginService`.
 *
 * Narrows the `register()` return type to `RooPluginHandle` so callers
 * get access to VS Code panel methods without having to cast.
 */
export interface RooPluginService extends AgentPluginService {
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
