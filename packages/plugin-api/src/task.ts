import type { AgentTokenUsage } from "./token-usage.js"

/**
 * AgentTaskContext
 *
 * A snapshot of the agent's current runtime state, including active task
 * information, environment context, and cumulative token usage.
 *
 * Delivered to plugins via `AgentPluginHandle.onContextChange()` whenever
 * the agent's state changes (new task started, mode changed, files opened, etc.).
 * Plugins can also request an immediate snapshot via `AgentPluginHandle.getContext()`.
 */
export interface AgentTaskContext {
	/**
	 * The ID of the currently running task, or `undefined` when the agent is idle
	 * (no task is active).
	 */
	taskId: string | undefined

	/**
	 * The active mode or persona the agent is operating in.
	 * The available values depend on the agent implementation (e.g. `"code"`,
	 * `"architect"`, `"ask"`).
	 */
	mode: string

	/**
	 * Absolute paths of the workspace root folders currently open in the editor.
	 * Empty when no workspace is open.
	 */
	workspaceFolders: string[]

	/**
	 * Absolute paths of files currently open in the editor.
	 * This list changes as the user opens and closes documents.
	 */
	openFiles: string[]

	/**
	 * Cumulative token usage for the active task, updated after each LLM request.
	 * `undefined` when no task is active.
	 */
	tokenUsage?: AgentTokenUsage
}
