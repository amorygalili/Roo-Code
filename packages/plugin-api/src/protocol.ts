/**
 * @roo-code/plugin-api — WebSocket protocol types
 *
 * These types define the JSON messages that flow over the WebSocket connection
 * between a PluginClient and a PluginServer.
 *
 * Every client→server message carries a `requestId` so the server can send a
 * matching `response` or `error` message back.  Server→client push messages
 * (e.g. `agentMessage`, `toolCall`) carry a `type` but no `requestId`.
 */

import type { AgentMcpServerConfig } from "./mcp.js"
import type { AgentProfile } from "./profile.js"
import type { AgentTaskContext } from "./task.js"
import type { AgentTokenUsage } from "./token-usage.js"
import type { JsonSchema } from "./tool.js"
import type { AgentMessage } from "./message.js"

// ---------------------------------------------------------------------------
// Wire-safe tool definition (no execute function — that lives on the client)
// ---------------------------------------------------------------------------

export interface WireToolDefinition {
	name: string
	description: string
	parameters?: JsonSchema
}

// ---------------------------------------------------------------------------
// Client → Server messages
// ---------------------------------------------------------------------------

export type C2SMessage =
	// Profile management
	| { requestId: string; type: "upsertProfile"; name: string; settings: Record<string, unknown>; activate?: boolean }
	| { requestId: string; type: "createProfile"; name: string; settings?: Record<string, unknown>; activate?: boolean }
	| { requestId: string; type: "updateProfile"; name: string; settings: Record<string, unknown>; activate?: boolean }
	| { requestId: string; type: "deleteProfile"; name: string }
	| { requestId: string; type: "setActiveProfile"; name: string }
	| { requestId: string; type: "getProfiles" }
	| { requestId: string; type: "getProfile"; name: string }
	| { requestId: string; type: "getActiveProfile" }
	| { requestId: string; type: "getCurrentSettings" }
	// Tool registration
	| { requestId: string; type: "registerTool"; definition: WireToolDefinition }
	| { requestId: string; type: "unregisterTool"; name: string }
	// MCP server registration
	| { requestId: string; type: "registerMcpServer"; name: string; config: AgentMcpServerConfig }
	| { requestId: string; type: "unregisterMcpServer"; name: string }
	// Task management
	| { requestId: string; type: "startTask"; text?: string; images?: string[] }
	| { requestId: string; type: "resumeTask"; taskId: string }
	| { requestId: string; type: "setCurrentTask"; taskId: string }
	| { requestId: string; type: "cancelCurrentTask" }
	// Messaging
	| { requestId: string; type: "sendMessage"; text: string; images?: string[] }
	| { requestId: string; type: "interruptAgent" }
	// Context snapshot
	| { requestId: string; type: "getContext" }
	// Tool execution result — client replies to a server toolCall
	| { requestId: string; type: "toolResult"; callId: string; result?: string; error?: string }

// ---------------------------------------------------------------------------
// Server → Client messages
// ---------------------------------------------------------------------------

/** Inline AgentToolContext to avoid a circular dependency via AgentToolDefinition */
export interface WireToolContext {
	taskId: string
	mode: string
}

export type S2CMessage =
	// Response / error to a matching C2S requestId
	| { type: "response"; requestId: string; result: unknown }
	| { type: "error"; requestId: string; error: string }
	// Agent lifecycle events (pushed to all connected clients)
	| { type: "agentMessage"; taskId: string; action: "created" | "updated"; message: AgentMessage }
	| { type: "contextChange"; context: AgentTaskContext }
	| { type: "tokenUsageUpdated"; taskId: string; usage: AgentTokenUsage }
	| { type: "toolCallFailed"; taskId: string; toolName: string; errorMessage: string }
	| { type: "llmError"; taskId: string; errorMessage: string }
	// Tool invocation — server asks the client to run one of its registered tools
	| { type: "toolCall"; callId: string; toolName: string; args: unknown; context: WireToolContext }

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isC2SMessage(raw: unknown): raw is C2SMessage {
	return (
		typeof raw === "object" &&
		raw !== null &&
		"requestId" in raw &&
		typeof (raw as Record<string, unknown>)["requestId"] === "string" &&
		"type" in raw &&
		typeof (raw as Record<string, unknown>)["type"] === "string"
	)
}

export function isS2CMessage(raw: unknown): raw is S2CMessage {
	return (
		typeof raw === "object" &&
		raw !== null &&
		"type" in raw &&
		typeof (raw as Record<string, unknown>)["type"] === "string"
	)
}

/**
 * Distributive Omit — applies Omit to each member of a union individually.
 * This is needed because the built-in `Omit<A | B, K>` collapses to the
 * intersection of properties, losing the discriminated-union structure.
 */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/**
 * A C2S message body — the client provides all fields except `requestId`,
 * which is generated internally by `PluginClient._request`.
 */
export type C2SMessageBody = DistributiveOmit<C2SMessage, "requestId">

// Re-export types that callers may need without additional imports
export type { AgentMessage, AgentProfile, AgentTaskContext, AgentTokenUsage, AgentMcpServerConfig }
