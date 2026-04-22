import type { AgentTokenUsage } from "./token-usage.js"

/**
 * AgentTaskContext
 *
 * A snapshot of the agent's current runtime state, including active task
 * information, environment context, and cumulative token usage.
 */
export interface AgentTaskContext {
	/**
	 * The ID of the currently running task, or `undefined` when the agent is idle.
	 */
	taskId: string | undefined

	/**
	 * The active mode or persona the agent is operating in.
	 */
	mode: string

	/**
	 * Absolute paths of the workspace root folders currently open in the editor.
	 */
	workspaceFolders: string[]

	/**
	 * Absolute paths of files currently open in the editor.
	 */
	openFiles: string[]

	/**
	 * Cumulative token usage for the active task, updated after each LLM request.
	 * `undefined` when no task is active.
	 */
	tokenUsage?: AgentTokenUsage
}
