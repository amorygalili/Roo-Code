import type { AgentMessage } from "./message.js"
import type { AgentMcpServerConfig } from "./mcp.js"
import type { AgentProfileManager } from "./profile.js"
import type { AgentTaskContext } from "./task.js"
import type { AgentTokenUsage } from "./token-usage.js"
import type { AgentToolDefinition } from "./tool.js"

/**
 * AgentPluginManifest
 *
 * Declarative metadata that a plugin supplies when registering with the agent.
 * Used to identify the plugin in logs, UIs, and error messages.
 */
export interface AgentPluginManifest {
	/**
	 * Globally unique identifier for this plugin.
	 * When used inside VS Code, this should match the extension's publisher.name.
	 */
	id: string

	/** Human-readable name shown in the agent's UI and logs. */
	displayName: string

	/** Optional short description of the plugin's purpose. */
	description?: string
}

/**
 * AgentPluginHandle
 *
 * The capability handle returned to a plugin after successful registration.
 * Provides the full set of operations a plugin can perform:
 *
 * - **Context** – observe the agent's current task, mode, and workspace state.
 * - **Task management** – start, resume, and cancel tasks/chats.
 * - **Messaging** – send messages to the agent; receive the agent's response stream.
 * - **Tool registration** – contribute custom tools the LLM can invoke.
 * - **MCP servers** – register Model Context Protocol servers with the agent.
 * - **Profiles** – manage named AI configuration profiles.
 * - **Token usage** – subscribe to live cost and token statistics.
 * - **Error events** – react to tool failures and LLM communication errors.
 *
 * All subscriptions and contributions are automatically cleaned up when
 * `dispose()` is called on the handle.
 */
export interface AgentPluginHandle {
	/** The manifest this handle was created with. */
	readonly manifest: AgentPluginManifest

	/**
	 * Release all resources held by this handle.
	 *
	 * Unregisters all tools and MCP servers contributed by this plugin and
	 * removes all event listeners. Safe to call multiple times.
	 *
	 * In VS Code extensions this can be pushed to `context.subscriptions` by
	 * wrapping it: `{ dispose: () => handle.dispose() }`.
	 */
	dispose(): void

	// ── Context ───────────────────────────────────────────────────────────────

	/**
	 * Returns an immediate snapshot of the agent's current runtime context.
	 * Safe to call at any time; fields reflect defaults when no task is active.
	 */
	getContext(): AgentTaskContext

	/**
	 * Subscribe to agent context changes.
	 *
	 * The listener is called whenever the agent's state changes — a new task
	 * starts or ends, the mode changes, open files change, etc.
	 *
	 * @returns A cleanup function that removes the listener when called.
	 */
	onContextChange(listener: (context: AgentTaskContext) => void): () => void

	// ── Task management ───────────────────────────────────────────────────────

	/**
	 * Start a new task (chat) with an optional opening message.
	 *
	 * @param text - Optional initial text message sent to the agent.
	 * @param images - Optional base64-encoded data-URI images attached to the message.
	 * @returns The stable ID of the newly created task.
	 */
	startTask(text?: string, images?: string[]): Promise<string>

	/**
	 * Resume a previously started task by its ID.
	 *
	 * @param taskId - The ID of the task to resume.
	 * @throws If the task is not found in the agent's history.
	 */
	resumeTask(taskId: string): Promise<void>

	/**
	 * Make the given task the currently focused task.
	 * Useful when multiple tasks exist and the plugin needs to direct the user's
	 * attention (or subsequent `sendMessage` calls) to a specific one.
	 *
	 * @param taskId - The ID of the task to focus.
	 */
	setCurrentTask(taskId: string): Promise<void>

	/**
	 * Cancel (abort) the currently running task.
	 * No-op when no task is active.
	 */
	cancelCurrentTask(): Promise<void>

	// ── Messaging ─────────────────────────────────────────────────────────────

	/**
	 * Send a text message to the currently active task, as if the user typed it.
	 * No-op when no task is active.
	 *
	 * @param text - The message text.
	 * @param images - Optional base64-encoded data-URI images.
	 */
	sendMessage(text: string, images?: string[]): Promise<void>

	/**
	 * Interrupt the agent mid-response, stopping it from producing further output
	 * without fully cancelling the task.
	 * No-op when the agent is not actively generating a response.
	 */
	interruptAgent(): Promise<void>

	/**
	 * Subscribe to all messages emitted by the agent during any active task.
	 *
	 * The listener receives:
	 * - `taskId` — the task that produced the message.
	 * - `action` — `"created"` for new messages; `"updated"` for in-place edits
	 *   (e.g. streaming completions updating a partial message).
	 * - `message` — the full `AgentMessage` snapshot at the time of the event.
	 *
	 * @returns A cleanup function that removes the listener when called.
	 */
	onAgentMessage(listener: (taskId: string, action: "created" | "updated", message: AgentMessage) => void): () => void

	// ── Token usage ───────────────────────────────────────────────────────────

	/**
	 * Subscribe to live token-usage updates for the active task.
	 *
	 * Called after each LLM request completes with the latest cumulative totals.
	 * Use this to display running cost/token information in a sidebar panel.
	 *
	 * @returns A cleanup function that removes the listener when called.
	 */
	onTokenUsageUpdated(listener: (taskId: string, usage: AgentTokenUsage) => void): () => void

	// ── Error events ──────────────────────────────────────────────────────────

	/**
	 * Subscribe to tool-call failure events.
	 *
	 * Called whenever a tool invocation fails during an active task, whether the
	 * failing tool is a built-in, a custom plugin tool, or an MCP tool.
	 *
	 * @returns A cleanup function that removes the listener when called.
	 */
	onToolCallFailed(listener: (taskId: string, toolName: string, errorMessage: string) => void): () => void

	/**
	 * Subscribe to LLM communication error events.
	 *
	 * Called when the agent fails to send a request to the language model
	 * (e.g. network error, authentication failure, rate limit exceeded).
	 *
	 * @returns A cleanup function that removes the listener when called.
	 */
	onLlmError(listener: (taskId: string, errorMessage: string) => void): () => void

	// ── Tool registration ─────────────────────────────────────────────────────

	/**
	 * Register a custom tool that the LLM can invoke during any task.
	 *
	 * The agent automatically namespaces the tool's name using the plugin ID to
	 * avoid conflicts with other plugins' tools.
	 *
	 * @param definition - The tool's name, description, parameters, and execute function.
	 * @returns A cleanup function that unregisters the tool when called.
	 */
	registerTool(definition: AgentToolDefinition): () => void

	// ── MCP server registration ───────────────────────────────────────────────

	/**
	 * Register a Model Context Protocol (MCP) server with the agent.
	 *
	 * The server will appear alongside globally and project-configured MCP
	 * servers and will be automatically unregistered when the returned cleanup
	 * function (or `dispose()` on the handle) is called.
	 *
	 * @param name - A unique name for this MCP server within the plugin's scope.
	 * @param config - Transport configuration (stdio, SSE, or streaming HTTP).
	 * @returns A promise that resolves to a cleanup function that unregisters the server.
	 */
	registerMcpServer(name: string, config: AgentMcpServerConfig): Promise<() => void>

	// ── Profile management ────────────────────────────────────────────────────

	/**
	 * Access the agent's profile manager for creating, reading, updating, and
	 * switching named AI configuration profiles.
	 */
	readonly profiles: AgentProfileManager
}

/**
 * AgentPluginService
 *
 * The public-facing plugin registry exposed by the agent.
 *
 * Third-party extensions obtain a reference to this service through the
 * agent's public API (e.g. `api.plugins`) and call `register()` to receive
 * an `AgentPluginHandle` scoped to their plugin identity.
 */
export interface AgentPluginService {
	/**
	 * Register a plugin with the agent.
	 *
	 * @param manifest - Plugin identity and metadata.
	 * @returns An `AgentPluginHandle` with all available plugin capabilities.
	 * @throws If a plugin with the same `id` is already registered.
	 */
	register(manifest: AgentPluginManifest): AgentPluginHandle

	/**
	 * Returns the manifests of all currently registered plugins.
	 */
	getRegisteredPlugins(): AgentPluginManifest[]
}
