import type { CustomToolDefinition } from "./custom-tool.js"

/**
 * Minimal disposable interface (mirrors vscode.Disposable without the dependency).
 */
export interface RooDisposable {
	dispose(): void
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
