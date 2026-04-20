/**
 * AgentSayKind
 *
 * Common kinds of "say" messages that an agent can emit to describe its
 * current activity or surface information to the user.
 *
 * The list is intentionally non-exhaustive: agent implementations may emit
 * additional string values not listed here. Consumers should handle unknown
 * kinds gracefully (e.g. treat them as plain text).
 */
export type AgentSayKind =
	/** Plain text response or continuation from the agent. */
	| "text"
	/** An unrecoverable or reported error encountered by the agent. */
	| "error"
	/** An API/LLM request has been initiated. */
	| "api_req_started"
	/** An API/LLM request completed successfully. */
	| "api_req_finished"
	/** An API/LLM request failed (may include retry information). */
	| "api_req_failed"
	/** Output produced by a shell command invoked by the agent. */
	| "command_output"
	/** The agent's reasoning or chain-of-thought (may be hidden in some UIs). */
	| "reasoning"
	/** The agent has finished the task and is presenting a final result. */
	| "completion_result"
	/** Any other implementation-specific kind. */
	| (string & {})

/**
 * AgentAskKind
 *
 * Common kinds of "ask" messages that represent points where the agent
 * requires a response or approval from the user before it can continue.
 *
 * The list is intentionally non-exhaustive: implementations may use
 * additional string values beyond those listed here.
 */
export type AgentAskKind =
	/** Agent is asking a clarifying question. */
	| "followup"
	/** Agent is requesting permission to invoke a tool. */
	| "tool_approval"
	/** Agent is requesting permission to run a shell command. */
	| "command_approval"
	/** Agent is asking for explicit user confirmation before proceeding. */
	| "confirmation"
	/** Agent has finished and is awaiting acknowledgment or a new task. */
	| "completion_result"
	/** Agent's API request failed and it is asking whether to retry. */
	| "api_req_failed"
	/** Any other implementation-specific kind. */
	| (string & {})

/**
 * AgentMessage
 *
 * A single message in the agent's conversation stream.
 *
 * Messages are either:
 * - `"say"` — the agent is emitting information (text, status, errors, etc.).
 * - `"ask"` — the agent needs a response from the user before it can continue.
 *
 * The `say` and `ask` fields narrow which kind applies; only one will be set
 * for a given message.
 */
export interface AgentMessage {
	/**
	 * Implementation-defined unique identifier for this message within a task.
	 * Use this to correlate `"created"` and `"updated"` events for the same message.
	 */
	id?: string | number

	/** Unix timestamp (milliseconds) when this message was created or last updated. */
	timestamp: number

	/** Whether this is an outgoing agent message ("say") or a request for input ("ask"). */
	type: "say" | "ask"

	/** Populated when `type === "say"`. Describes the nature of the message. */
	say?: AgentSayKind

	/** Populated when `type === "ask"`. Describes what the agent is asking for. */
	ask?: AgentAskKind

	/** The human-readable text content of the message. */
	text?: string

	/** Optional array of base64-encoded data URIs for inline images. */
	images?: string[]

	/**
	 * When `true`, the message is still being streamed and its `text` content
	 * is not yet complete. A subsequent `"updated"` event with `partial: false`
	 * (or absent) signals completion.
	 */
	partial?: boolean
}
