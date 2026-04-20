/**
 * AgentMcpServerConfig
 *
 * Configuration for an MCP (Model Context Protocol) server to be registered
 * with the agent. Supports three transport types that together cover the full
 * range of MCP connection mechanisms:
 *
 * - `"stdio"` — spawns a local process and communicates over stdin/stdout.
 * - `"sse"` — connects to a remote server using Server-Sent Events.
 * - `"streamable-http"` — connects to a remote server using streaming HTTP.
 */
export type AgentMcpServerConfig =
	| {
			/** Local process transport. */
			type: "stdio"
			/** The executable to run (e.g. `"uvx"`, `"node"`, `"python"`). */
			command: string
			/** Arguments to pass to the executable. */
			args?: string[]
			/** Additional environment variables to inject into the process. */
			env?: Record<string, string>
			/** Working directory for the spawned process. */
			cwd?: string
			/** When `true`, this server is registered but not actively connected. */
			disabled?: boolean
			/** Connection timeout in milliseconds. */
			timeout?: number
			/** Tool names that are always approved without prompting the user. */
			alwaysAllow?: string[]
			/** Tool names that are disabled and hidden from the agent. */
			disabledTools?: string[]
	  }
	| {
			/** Server-Sent Events transport. */
			type: "sse"
			/** Full URL of the SSE endpoint (e.g. `"https://example.com/mcp/sse"`). */
			url: string
			/** HTTP headers to include in the connection request. */
			headers?: Record<string, string>
			/** When `true`, this server is registered but not actively connected. */
			disabled?: boolean
			/** Connection timeout in milliseconds. */
			timeout?: number
			/** Tool names that are always approved without prompting the user. */
			alwaysAllow?: string[]
			/** Tool names that are disabled and hidden from the agent. */
			disabledTools?: string[]
	  }
	| {
			/** Streaming HTTP transport. */
			type: "streamable-http"
			/** Full URL of the streaming HTTP endpoint. */
			url: string
			/** HTTP headers to include in the connection request. */
			headers?: Record<string, string>
			/** When `true`, this server is registered but not actively connected. */
			disabled?: boolean
			/** Connection timeout in milliseconds. */
			timeout?: number
			/** Tool names that are always approved without prompting the user. */
			alwaysAllow?: string[]
			/** Tool names that are disabled and hidden from the agent. */
			disabledTools?: string[]
	  }
