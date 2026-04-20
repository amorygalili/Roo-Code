/**
 * PluginClient
 *
 * Creates a WebSocket client that remote plugins instantiate to communicate with
 * a PluginServer running inside the agent (e.g. Roo Code).
 *
 * The interface mirrors AgentPluginHandle from @roo-code/plugin-api so that
 * plugin authors can switch from the in-process API to the socket-based API
 * with minimal code changes.
 *
 * @example
 * ```ts
 * const client = new PluginClient({ url: "ws://localhost:7777" })
 * await client.connect()
 *
 * await client.upsertProfile("my-profile", { apiProvider: "anthropic" }, true)
 *
 * client.registerTool({
 *   name: "hello",
 *   description: "Say hello",
 *   execute: async () => "Hello from my plugin!",
 * })
 *
 * client.onAgentMessage((taskId, action, message) => {
 *   console.log(`[${taskId}] ${action}:`, message.text)
 * })
 * ```
 */

import EventEmitter from "node:events"
import * as crypto from "node:crypto"

import { WebSocket } from "ws"

import type { AgentMessage, AgentMcpServerConfig, AgentProfile, AgentTaskContext, AgentTokenUsage } from "./protocol.js"
import {
	isS2CMessage,
	type C2SMessage,
	type C2SMessageBody,
	type S2CMessage,
	type WireToolContext,
} from "./protocol.js"
import type { AgentToolDefinition } from "./tool.js"

// ---------------------------------------------------------------------------
// Internal events emitted to listeners registered via the on* methods
// ---------------------------------------------------------------------------

interface PluginClientInternalEvents {
	agentMessage: [taskId: string, action: "created" | "updated", message: AgentMessage]
	contextChange: [context: AgentTaskContext]
	tokenUsageUpdated: [taskId: string, usage: AgentTokenUsage]
	toolCallFailed: [taskId: string, toolName: string, errorMessage: string]
	llmError: [taskId: string, errorMessage: string]
}

// ---------------------------------------------------------------------------
// PluginClient options
// ---------------------------------------------------------------------------

export interface PluginClientOptions {
	/** WebSocket URL of the PluginServer (e.g. "ws://localhost:7777"). */
	url: string
	/** Optional logger function (default: console.log). */
	log?: (...args: unknown[]) => void
	/** Request timeout in milliseconds (default: 30 000). */
	timeoutMs?: number
}

// ---------------------------------------------------------------------------
// Pending request state
// ---------------------------------------------------------------------------

interface PendingRequest {
	resolve: (value: unknown) => void
	reject: (reason: Error) => void
	timer: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// PluginClient
// ---------------------------------------------------------------------------

export class PluginClient extends EventEmitter<PluginClientInternalEvents> {
	private readonly _options: PluginClientOptions
	private readonly _log: (...args: unknown[]) => void
	private readonly _timeoutMs: number
	private readonly _pending = new Map<string, PendingRequest>()
	/** name → execute function for registered tools */
	private readonly _tools = new Map<string, AgentToolDefinition["execute"]>()

	private _ws: WebSocket | null = null
	private _isConnected = false
	/** Cached context snapshot updated from server push events */
	private _context: AgentTaskContext = { taskId: undefined, mode: "code", workspaceFolders: [], openFiles: [] }

	constructor(options: PluginClientOptions) {
		super()
		this._options = options
		this._log = options.log ?? console.log
		this._timeoutMs = options.timeoutMs ?? 30_000
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	/** Open the WebSocket connection. Resolves once connected. */
	public connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (this._isConnected) {
				resolve()
				return
			}
			const ws = new WebSocket(this._options.url)
			this._ws = ws

			ws.once("open", () => {
				this._isConnected = true
				this._log("[PluginClient] Connected to", this._options.url)
				resolve()
			})
			ws.once("error", (err) => {
				if (!this._isConnected) reject(err)
				else this._log("[PluginClient] WebSocket error:", err)
			})
			ws.on("message", (data) => this._onMessage(data.toString()))
			ws.on("close", () => this._onClose())
		})
	}

	/** Close the WebSocket connection. */
	public disconnect(): void {
		this._ws?.close()
	}

	// ── Context ──────────────────────────────────────────────────────────────

	/** Returns the latest cached context snapshot received from the server. */
	public getContext(): AgentTaskContext {
		return this._context
	}

	/**
	 * Subscribe to context-change events pushed by the server.
	 * @returns A cleanup function that removes the listener.
	 */
	public onContextChange(listener: (context: AgentTaskContext) => void): () => void {
		this.on("contextChange", listener)
		return () => this.off("contextChange", listener)
	}

	// ── Task management ───────────────────────────────────────────────────────

	public startTask(text?: string, images?: string[]): Promise<string> {
		return this._request<string>({ type: "startTask", text, images })
	}

	public resumeTask(taskId: string): Promise<void> {
		return this._request<void>({ type: "resumeTask", taskId })
	}

	public setCurrentTask(taskId: string): Promise<void> {
		return this._request<void>({ type: "setCurrentTask", taskId })
	}

	public cancelCurrentTask(): Promise<void> {
		return this._request<void>({ type: "cancelCurrentTask" })
	}

	// ── Messaging ─────────────────────────────────────────────────────────────

	public sendMessage(text: string, images?: string[]): Promise<void> {
		return this._request<void>({ type: "sendMessage", text, images })
	}

	public interruptAgent(): Promise<void> {
		return this._request<void>({ type: "interruptAgent" })
	}

	/**
	 * Subscribe to agent messages pushed by the server.
	 * @returns A cleanup function that removes the listener.
	 */
	public onAgentMessage(
		listener: (taskId: string, action: "created" | "updated", message: AgentMessage) => void,
	): () => void {
		this.on("agentMessage", listener)
		return () => this.off("agentMessage", listener)
	}

	// ── Token usage ───────────────────────────────────────────────────────────

	/**
	 * Subscribe to token-usage updates pushed by the server.
	 * @returns A cleanup function that removes the listener.
	 */
	public onTokenUsageUpdated(listener: (taskId: string, usage: AgentTokenUsage) => void): () => void {
		this.on("tokenUsageUpdated", listener)
		return () => this.off("tokenUsageUpdated", listener)
	}

	// ── Error events ──────────────────────────────────────────────────────────

	/**
	 * Subscribe to tool-call failure events pushed by the server.
	 * @returns A cleanup function that removes the listener.
	 */
	public onToolCallFailed(listener: (taskId: string, toolName: string, errorMessage: string) => void): () => void {
		this.on("toolCallFailed", listener)
		return () => this.off("toolCallFailed", listener)
	}

	/**
	 * Subscribe to LLM error events pushed by the server.
	 * @returns A cleanup function that removes the listener.
	 */
	public onLlmError(listener: (taskId: string, errorMessage: string) => void): () => void {
		this.on("llmError", listener)
		return () => this.off("llmError", listener)
	}

	// ── Tool registration ─────────────────────────────────────────────────────

	/**
	 * Register a custom tool with the agent.
	 * The `execute` function runs locally on the client; the agent invokes it by
	 * sending a `toolCall` message and waiting for the `toolResult` reply.
	 *
	 * @returns A cleanup function that unregisters the tool.
	 */
	public registerTool(definition: AgentToolDefinition): () => void {
		const { name, description, parameters, execute } = definition
		this._tools.set(name, execute)
		// Fire-and-forget registration message (we don't await the reply here to
		// keep the API synchronous, matching the existing plugin-api signature).
		this._request<void>({ type: "registerTool", definition: { name, description, parameters } }).catch((err) => {
			this._log("[PluginClient] registerTool failed:", err)
		})
		return () => {
			this._tools.delete(name)
			this._request<void>({ type: "unregisterTool", name }).catch((err) => {
				this._log("[PluginClient] unregisterTool failed:", err)
			})
		}
	}

	// ── MCP server registration ───────────────────────────────────────────────

	/**
	 * Register an MCP server with the agent.
	 * @returns A cleanup function that unregisters the server.
	 */
	public async registerMcpServer(name: string, config: AgentMcpServerConfig): Promise<() => void> {
		await this._request<void>({ type: "registerMcpServer", name, config })
		return async () => {
			await this._request<void>({ type: "unregisterMcpServer", name })
		}
	}

	// ── Profile management ────────────────────────────────────────────────────

	public upsertProfile(
		name: string,
		settings: Record<string, unknown>,
		activate?: boolean,
	): Promise<string | undefined> {
		return this._request<string | undefined>({ type: "upsertProfile", name, settings, activate })
	}

	public createProfile(name: string, settings?: Record<string, unknown>, activate?: boolean): Promise<string> {
		return this._request<string>({ type: "createProfile", name, settings, activate })
	}

	public updateProfile(
		name: string,
		settings: Record<string, unknown>,
		activate?: boolean,
	): Promise<string | undefined> {
		return this._request<string | undefined>({ type: "updateProfile", name, settings, activate })
	}

	public deleteProfile(name: string): Promise<void> {
		return this._request<void>({ type: "deleteProfile", name })
	}

	public setActiveProfile(name: string): Promise<void> {
		return this._request<void>({ type: "setActiveProfile", name })
	}

	public getProfiles(): Promise<string[]> {
		return this._request<string[]>({ type: "getProfiles" })
	}

	public getProfile(name: string): Promise<AgentProfile | undefined> {
		return this._request<AgentProfile | undefined>({ type: "getProfile", name })
	}

	public getActiveProfile(): Promise<string | undefined> {
		return this._request<string | undefined>({ type: "getActiveProfile" })
	}

	public getCurrentSettings(): Promise<Record<string, unknown>> {
		return this._request<Record<string, unknown>>({ type: "getCurrentSettings" })
	}

	// ── Internals ─────────────────────────────────────────────────────────────

	/** Send a C2S message and return a Promise that resolves with the server's reply. */
	private _request<T>(msg: C2SMessageBody): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			if (!this._isConnected || !this._ws) {
				reject(new Error("[PluginClient] Not connected"))
				return
			}

			const requestId = crypto.randomUUID()
			const timer = setTimeout(() => {
				this._pending.delete(requestId)
				reject(new Error(`[PluginClient] Request timed out: ${(msg as { type: string }).type}`))
			}, this._timeoutMs)

			this._pending.set(requestId, {
				resolve: resolve as (v: unknown) => void,
				reject,
				timer,
			})

			const payload: C2SMessage = { requestId, ...msg } as C2SMessage
			this._ws!.send(JSON.stringify(payload))
		})
	}

	private _onMessage(raw: string): void {
		let data: unknown
		try {
			data = JSON.parse(raw)
		} catch {
			this._log("[PluginClient] Unparseable message:", raw)
			return
		}

		if (!isS2CMessage(data)) {
			this._log("[PluginClient] Invalid S2C message:", data)
			return
		}

		const msg: S2CMessage = data

		// Handle request-response messages
		if (msg.type === "response") {
			const pending = this._pending.get(msg.requestId)
			if (pending) {
				clearTimeout(pending.timer)
				this._pending.delete(msg.requestId)
				pending.resolve(msg.result)
			}
			return
		}

		if (msg.type === "error") {
			const pending = this._pending.get(msg.requestId)
			if (pending) {
				clearTimeout(pending.timer)
				this._pending.delete(msg.requestId)
				pending.reject(new Error(msg.error))
			}
			return
		}

		// Handle server-push events
		switch (msg.type) {
			case "agentMessage":
				this.emit("agentMessage", msg.taskId, msg.action, msg.message)
				break
			case "contextChange":
				this._context = msg.context
				this.emit("contextChange", msg.context)
				break
			case "tokenUsageUpdated":
				this.emit("tokenUsageUpdated", msg.taskId, msg.usage)
				break
			case "toolCallFailed":
				this.emit("toolCallFailed", msg.taskId, msg.toolName, msg.errorMessage)
				break
			case "llmError":
				this.emit("llmError", msg.taskId, msg.errorMessage)
				break
			case "toolCall":
				void this._handleToolCall(msg.callId, msg.toolName, msg.args, msg.context)
				break
			default:
				this._log("[PluginClient] Unhandled S2C message type:", (msg as { type: string }).type)
				break
		}
	}

	private async _handleToolCall(
		callId: string,
		toolName: string,
		args: unknown,
		context: WireToolContext,
	): Promise<void> {
		const execute = this._tools.get(toolName)
		if (!execute) {
			this._sendToolResult(callId, undefined, `Tool "${toolName}" is not registered on this client`)
			return
		}
		try {
			const result = await execute(args, context)
			this._sendToolResult(callId, result)
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			this._sendToolResult(callId, undefined, msg)
		}
	}

	private _sendToolResult(callId: string, result?: string, error?: string): void {
		if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return
		const payload: C2SMessage = {
			requestId: crypto.randomUUID(),
			type: "toolResult",
			callId,
			result,
			error,
		}
		this._ws.send(JSON.stringify(payload))
	}

	private _onClose(): void {
		this._isConnected = false
		this._log("[PluginClient] Disconnected from", this._options.url)
		// Reject all pending requests
		for (const [id, pending] of this._pending.entries()) {
			clearTimeout(pending.timer)
			pending.reject(new Error("[PluginClient] Connection closed"))
			this._pending.delete(id)
		}
	}

	// ── Accessors ─────────────────────────────────────────────────────────────

	public get isConnected(): boolean {
		return this._isConnected
	}

	public get url(): string {
		return this._options.url
	}
}
