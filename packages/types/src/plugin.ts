import type { TokenUsage } from "./message.js"
import type { ToolUsage } from "./tool.js"

// Re-export agent-agnostic types so plugin authors can import them from @roo-code/types.
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
 * A snapshot of the agent's current runtime context, broadcast to WebSocket plugin
 * clients whenever the agent state changes (task started/stopped, mode changed, etc.).
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
 * The plugin service exposed on the Roo Code API.
 * Plugins connect via WebSocket using `PluginClient` from `@roo-code/plugin-api`.
 */
export interface RooPluginService {
	/**
	 * The TCP port on which the WebSocket plugin server is listening.
	 * Connect with `new PluginClient({ url: "ws://localhost:<pluginServerPort>" })`.
	 */
	readonly pluginServerPort: number
}
