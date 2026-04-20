/**
 * PluginServer
 *
 * Creates a WebSocket server that agents (e.g. Roo Code) instantiate to receive
 * commands from remote plugins.  For each method a PluginClient calls, the server
 * emits a matching event whose listener arguments mirror the method's parameters,
 * plus a final `reply` callback that the handler must call to resolve the client's
 * awaiting Promise.
 *
 * @example
 * ```ts
 * const server = new PluginServer({ port: 7777 })
 * server.listen()
 *
 * server.on('upsertProfile', (clientId, name, settings, activate, reply) => {
 *   const id = profileManager.upsert(name, settings, activate)
 *   reply(id)
 * })
 * ```
 */

import EventEmitter from "node:events"
import * as crypto from "node:crypto"

import { WebSocketServer, WebSocket } from "ws"

import type {
	AgentMessage,
	AgentMcpServerConfig,
	AgentProfile,
	AgentTaskContext,
	AgentTokenUsage,
	WireToolDefinition,
	WireToolContext,
} from "./protocol.js"
import { isC2SMessage, type S2CMessage } from "./protocol.js"

// ---------------------------------------------------------------------------
// Reply-function helper type
// ---------------------------------------------------------------------------

/** Called by the server-side event handler to send a result (or error) back to the waiting client. */
export type ReplyFn<T> = (result: T, error?: string) => void

// ---------------------------------------------------------------------------
// Typed event map for PluginServer
// ---------------------------------------------------------------------------

export interface PluginServerEvents {
	// Lifecycle
	connect: [clientId: string]
	disconnect: [clientId: string]
	// Profile management
	upsertProfile: [
		clientId: string,
		name: string,
		settings: Record<string, unknown>,
		activate: boolean | undefined,
		reply: ReplyFn<string | undefined>,
	]
	createProfile: [
		clientId: string,
		name: string,
		settings: Record<string, unknown> | undefined,
		activate: boolean | undefined,
		reply: ReplyFn<string>,
	]
	updateProfile: [
		clientId: string,
		name: string,
		settings: Record<string, unknown>,
		activate: boolean | undefined,
		reply: ReplyFn<string | undefined>,
	]
	deleteProfile: [clientId: string, name: string, reply: ReplyFn<void>]
	setActiveProfile: [clientId: string, name: string, reply: ReplyFn<void>]
	getProfiles: [clientId: string, reply: ReplyFn<string[]>]
	getProfile: [clientId: string, name: string, reply: ReplyFn<AgentProfile | undefined>]
	getActiveProfile: [clientId: string, reply: ReplyFn<string | undefined>]
	getCurrentSettings: [clientId: string, reply: ReplyFn<Record<string, unknown>>]
	// Tool registration
	registerTool: [clientId: string, definition: WireToolDefinition, reply: ReplyFn<void>]
	unregisterTool: [clientId: string, name: string, reply: ReplyFn<void>]
	// MCP server registration
	registerMcpServer: [clientId: string, name: string, config: AgentMcpServerConfig, reply: ReplyFn<void>]
	unregisterMcpServer: [clientId: string, name: string, reply: ReplyFn<void>]
	// Task management
	startTask: [clientId: string, text: string | undefined, images: string[] | undefined, reply: ReplyFn<string>]
	resumeTask: [clientId: string, taskId: string, reply: ReplyFn<void>]
	setCurrentTask: [clientId: string, taskId: string, reply: ReplyFn<void>]
	cancelCurrentTask: [clientId: string, reply: ReplyFn<void>]
	// Messaging
	sendMessage: [clientId: string, text: string, images: string[] | undefined, reply: ReplyFn<void>]
	interruptAgent: [clientId: string, reply: ReplyFn<void>]
	// Context
	getContext: [clientId: string, reply: ReplyFn<AgentTaskContext>]
}

// ---------------------------------------------------------------------------
// PluginServer
// ---------------------------------------------------------------------------

export interface PluginServerOptions {
	/** TCP port the WebSocket server will bind to. */
	port: number
	/** Optional host/interface to bind to (default: all interfaces). */
	host?: string
	/** Optional logger function (default: console.log). */
	log?: (...args: unknown[]) => void
}

export class PluginServer extends EventEmitter<PluginServerEvents> {
	private readonly _options: PluginServerOptions
	private readonly _log: (...args: unknown[]) => void
	private readonly _clients: Map<string, WebSocket> = new Map()
	/** Pending tool-call resolvers keyed by callId (for invokeClientTool). */
	private readonly _pendingToolCalls: Map<string, { resolve: (r: string) => void; reject: (e: Error) => void }> =
		new Map()
	private _wss: WebSocketServer | null = null

	constructor(options: PluginServerOptions) {
		super()
		this._options = options
		this._log = options.log ?? console.log
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	/** Start listening for incoming plugin client connections. */
	public listen(): void {
		this._wss = new WebSocketServer({ port: this._options.port, host: this._options.host })
		this._wss.on("connection", (ws) => this._onConnection(ws))
		this._wss.on("error", (err) => this._log("[PluginServer] wss error:", err))
		this._log(`[PluginServer] Listening on port ${this._options.port}`)
	}

	/** Close the server and disconnect all clients. */
	public close(): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this._wss) {
				resolve()
				return
			}
			for (const ws of this._clients.values()) {
				ws.terminate()
			}
			this._clients.clear()
			this._wss.close((err) => (err ? reject(err) : resolve()))
			this._wss = null
		})
	}

	// ── Server-push helpers ───────────────────────────────────────────────────

	/** Broadcast an agent message to all connected plugin clients. */
	public broadcastAgentMessage(taskId: string, action: "created" | "updated", message: AgentMessage): void {
		this._broadcast({ type: "agentMessage", taskId, action, message })
	}

	/** Broadcast a context-change snapshot to all connected plugin clients. */
	public broadcastContextChange(context: AgentTaskContext): void {
		this._broadcast({ type: "contextChange", context })
	}

	/** Broadcast updated token-usage stats to all connected plugin clients. */
	public broadcastTokenUsageUpdated(taskId: string, usage: AgentTokenUsage): void {
		this._broadcast({ type: "tokenUsageUpdated", taskId, usage })
	}

	/** Broadcast a tool-call failure to all connected plugin clients. */
	public broadcastToolCallFailed(taskId: string, toolName: string, errorMessage: string): void {
		this._broadcast({ type: "toolCallFailed", taskId, toolName, errorMessage })
	}

	/** Broadcast an LLM error to all connected plugin clients. */
	public broadcastLlmError(taskId: string, errorMessage: string): void {
		this._broadcast({ type: "llmError", taskId, errorMessage })
	}

	/**
	 * Ask a specific connected client to execute one of its registered tools.
	 * Resolves with the tool's string result or rejects on error / timeout.
	 */
	public invokeClientTool(
		clientId: string,
		toolName: string,
		args: unknown,
		context: WireToolContext,
		timeoutMs = 30_000,
	): Promise<string> {
		return new Promise((resolve, reject) => {
			const ws = this._clients.get(clientId)
			if (!ws) {
				reject(new Error(`[PluginServer] Client "${clientId}" is not connected`))
				return
			}
			const callId = crypto.randomUUID()
			const timer = setTimeout(() => {
				this._pendingToolCalls.delete(callId)
				reject(new Error(`[PluginServer] Tool call "${toolName}" timed out after ${timeoutMs}ms`))
			}, timeoutMs)

			this._pendingToolCalls.set(callId, {
				resolve: (r) => {
					clearTimeout(timer)
					resolve(r)
				},
				reject: (e) => {
					clearTimeout(timer)
					reject(e)
				},
			})

			const msg: S2CMessage = { type: "toolCall", callId, toolName, args, context }
			this._send(ws, msg)
		})
	}

	// ── Internals ─────────────────────────────────────────────────────────────

	private _onConnection(ws: WebSocket): void {
		const clientId = crypto.randomUUID()
		this._clients.set(clientId, ws)
		this._log(`[PluginServer] Client connected: ${clientId} (total: ${this._clients.size})`)
		this.emit("connect", clientId)

		ws.on("message", (data) => this._onMessage(clientId, ws, data.toString()))
		ws.on("close", () => this._onClose(clientId))
		ws.on("error", (err) => this._log(`[PluginServer] Client ${clientId} error:`, err))
	}

	private _onClose(clientId: string): void {
		this._clients.delete(clientId)
		this._log(`[PluginServer] Client disconnected: ${clientId} (total: ${this._clients.size})`)
		this.emit("disconnect", clientId)
	}

	private _onMessage(clientId: string, ws: WebSocket, raw: string): void {
		let data: unknown
		try {
			data = JSON.parse(raw)
		} catch {
			this._log(`[PluginServer] Unparseable message from ${clientId}:`, raw)
			return
		}

		if (!isC2SMessage(data)) {
			this._log(`[PluginServer] Invalid C2S message from ${clientId}:`, data)
			return
		}

		const msg = data
		const { requestId } = msg

		// toolResult is handled internally (for invokeClientTool)
		if (msg.type === "toolResult") {
			const pending = this._pendingToolCalls.get(msg.callId)
			if (pending) {
				this._pendingToolCalls.delete(msg.callId)
				if (msg.error) {
					pending.reject(new Error(msg.error))
				} else {
					pending.resolve(msg.result ?? "")
				}
			}
			return
		}

		const reply = <T>(result: T, error?: string): void => {
			if (error) {
				this._send(ws, { type: "error", requestId, error })
			} else {
				this._send(ws, { type: "response", requestId, result })
			}
		}

		switch (msg.type) {
			case "upsertProfile":
				this.emit("upsertProfile", clientId, msg.name, msg.settings, msg.activate, reply)
				break
			case "createProfile":
				this.emit("createProfile", clientId, msg.name, msg.settings, msg.activate, reply)
				break
			case "updateProfile":
				this.emit("updateProfile", clientId, msg.name, msg.settings, msg.activate, reply)
				break
			case "deleteProfile":
				this.emit("deleteProfile", clientId, msg.name, reply)
				break
			case "setActiveProfile":
				this.emit("setActiveProfile", clientId, msg.name, reply)
				break
			case "getProfiles":
				this.emit("getProfiles", clientId, reply)
				break
			case "getProfile":
				this.emit("getProfile", clientId, msg.name, reply)
				break
			case "getActiveProfile":
				this.emit("getActiveProfile", clientId, reply)
				break
			case "getCurrentSettings":
				this.emit("getCurrentSettings", clientId, reply)
				break
			case "registerTool":
				this.emit("registerTool", clientId, msg.definition, reply)
				break
			case "unregisterTool":
				this.emit("unregisterTool", clientId, msg.name, reply)
				break
			case "registerMcpServer":
				this.emit("registerMcpServer", clientId, msg.name, msg.config, reply)
				break
			case "unregisterMcpServer":
				this.emit("unregisterMcpServer", clientId, msg.name, reply)
				break
			case "startTask":
				this.emit("startTask", clientId, msg.text, msg.images, reply)
				break
			case "resumeTask":
				this.emit("resumeTask", clientId, msg.taskId, reply)
				break
			case "setCurrentTask":
				this.emit("setCurrentTask", clientId, msg.taskId, reply)
				break
			case "cancelCurrentTask":
				this.emit("cancelCurrentTask", clientId, reply)
				break
			case "sendMessage":
				this.emit("sendMessage", clientId, msg.text, msg.images, reply)
				break
			case "interruptAgent":
				this.emit("interruptAgent", clientId, reply)
				break
			case "getContext":
				this.emit("getContext", clientId, reply)
				break
			default:
				this._log(`[PluginServer] Unhandled message type from ${clientId}:`, (msg as { type: string }).type)
				break
		}
	}

	private _send(ws: WebSocket, msg: S2CMessage): void {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(msg))
		}
	}

	private _broadcast(msg: S2CMessage): void {
		const payload = JSON.stringify(msg)
		for (const ws of this._clients.values()) {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(payload)
			}
		}
	}

	// ── Accessors ─────────────────────────────────────────────────────────────

	/** Number of currently connected plugin clients. */
	public get clientCount(): number {
		return this._clients.size
	}

	/** IDs of all currently connected plugin clients. */
	public get clientIds(): string[] {
		return [...this._clients.keys()]
	}

	public get port(): number {
		return this._options.port
	}
}
