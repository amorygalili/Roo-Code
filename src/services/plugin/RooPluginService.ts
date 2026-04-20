import * as vscode from "vscode"

import { customToolRegistry } from "@roo-code/core"
import type { AgentTaskContext, AgentTokenUsage, AgentMessage } from "@roo-code/plugin-api-v2"
import { PluginServer } from "@roo-code/plugin-api-v2"
import type { PluginServerEvents } from "@roo-code/plugin-api-v2"
import type {
	RooPluginService,
	RooTaskContext,
	CustomToolDefinition,
	RooCodeAPI,
	TokenUsage,
	ToolUsage,
	ToolName,
	ClineMessage,
} from "@roo-code/types"
import { RooCodeEventName } from "@roo-code/types"

import type { McpHub } from "../mcp/McpHub"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<RooTaskContext> = {}): RooTaskContext {
	return {
		taskId: undefined,
		mode: "code",
		workspaceFolders: vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [],
		openFiles: vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath).filter(Boolean),
		...overrides,
	}
}

/** Convert Roo's internal TokenUsage to the agent-agnostic AgentTokenUsage. */
function toAgentTokenUsage(tokenUsage: TokenUsage): AgentTokenUsage {
	return {
		tokensIn: tokenUsage.totalTokensIn,
		tokensOut: tokenUsage.totalTokensOut,
		cost: tokenUsage.totalCost,
		contextTokens: tokenUsage.contextTokens,
		cacheWrites: tokenUsage.totalCacheWrites,
		cacheReads: tokenUsage.totalCacheReads,
	}
}

/** Convert Roo's internal RooTaskContext to the agent-agnostic AgentTaskContext. */
function toAgentContext(ctx: RooTaskContext): AgentTaskContext {
	return {
		taskId: ctx.taskId,
		mode: ctx.mode,
		workspaceFolders: ctx.workspaceFolders,
		openFiles: ctx.openFiles,
		tokenUsage: ctx.tokenUsage ? toAgentTokenUsage(ctx.tokenUsage) : undefined,
	}
}

/** Convert Roo's internal ClineMessage to the agent-agnostic AgentMessage. */
function toAgentMessage(msg: ClineMessage): AgentMessage {
	return {
		id: msg.ts,
		timestamp: msg.ts,
		type: msg.type,
		say: msg.say,
		ask: msg.ask,
		text: msg.text,
		images: msg.images,
		partial: msg.partial,
	}
}

// ---------------------------------------------------------------------------
// RooPluginServiceImpl
// ---------------------------------------------------------------------------

/** Default port for the WebSocket plugin server. */
const DEFAULT_PLUGIN_SERVER_PORT = 6066

export class RooPluginServiceImpl implements RooPluginService {
	public readonly api: RooCodeAPI
	private readonly _getMcpHub: () => McpHub | undefined
	private _context: RooTaskContext = makeContext()
	private readonly _cleanups: Array<() => void> = []

	/** WebSocket server for remote plugin clients. */
	private readonly _pluginServer: PluginServer
	/** Namespaced tool names registered per connected WebSocket client. */
	private readonly _clientTools = new Map<string, string[]>()
	/** MCP server names registered per connected WebSocket client. */
	private readonly _clientMcpServers = new Map<string, string[]>()

	constructor(api: RooCodeAPI, getMcpHub: () => McpHub | undefined = () => undefined) {
		this.api = api
		this._getMcpHub = getMcpHub
		this._pluginServer = new PluginServer({ port: DEFAULT_PLUGIN_SERVER_PORT })
		this._wireEvents()
		this._wireServerEvents()
		this._pluginServer.listen()
	}

	get pluginServerPort(): number {
		return this._pluginServer.port
	}

	dispose(): void {
		for (const cleanup of this._cleanups) {
			try {
				cleanup()
			} catch {
				// Best-effort cleanup.
			}
		}

		this._pluginServer.close().catch((err: unknown) => {
			console.error("[RooPluginService] Error closing plugin server:", err)
		})
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private _broadcastContext(): void {
		this._pluginServer.broadcastContextChange(toAgentContext({ ...this._context }))
	}

	private _wireEvents(): void {
		// Task lifecycle — update taskId and reset per-task usage stats.
		const onTaskStarted = (taskId: string) => {
			this._context = { ...this._context, taskId, tokenUsage: undefined, toolUsage: undefined }
			this._broadcastContext()
		}

		const onTaskEnded = (_taskId: string) => {
			this._context = { ...this._context, taskId: undefined, tokenUsage: undefined, toolUsage: undefined }
			this._broadcastContext()
		}

		// TaskModeSwitched fires when the agent switches mode during a task.
		const onModeSwitch = (_taskId: string, mode: string) => {
			this._context = { ...this._context, mode }
			this._broadcastContext()
		}

		// ModeChanged fires when the user changes mode in the settings UI (outside a task).
		const onModeChanged = (mode: string) => {
			this._context = { ...this._context, mode }
			this._broadcastContext()
		}

		// TokenUsageUpdated fires after each LLM request with cumulative counts.
		const onTokenUsageUpdated = (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => {
			this._context = { ...this._context, tokenUsage, toolUsage }
			this._broadcastContext()
			this._pluginServer.broadcastTokenUsageUpdated(taskId, toAgentTokenUsage(tokenUsage))
		}

		// ToolFailed fires when a tool invocation fails inside the active task.
		const onToolFailed = (taskId: string, toolName: ToolName, errorMessage: string) => {
			this._pluginServer.broadcastToolCallFailed(taskId, toolName, errorMessage)
		}

		// Message fires for every agent message (say/ask) created or updated.
		const onAgentMessage = (payload: { taskId: string; action: "created" | "updated"; message: ClineMessage }) => {
			const { taskId, action, message } = payload
			this._pluginServer.broadcastAgentMessage(taskId, action, toAgentMessage(message))
		}

		// VS Code workspace change listeners.
		const workspaceDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
			this._context = makeContext({
				taskId: this._context.taskId,
				mode: this._context.mode,
				tokenUsage: this._context.tokenUsage,
				toolUsage: this._context.toolUsage,
			})
			this._broadcastContext()
		})

		const editorDisposable = vscode.window.onDidChangeVisibleTextEditors(() => {
			this._context = {
				...this._context,
				openFiles: vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath).filter(Boolean),
			}
			this._broadcastContext()
		})

		// Wire API events. Cast to access `.on` without fighting the narrow
		// EventEmitter overload signatures.
		const emitter = this.api as unknown as {
			on(event: string, listener: (...args: unknown[]) => void): void
			off(event: string, listener: (...args: unknown[]) => void): void
		}

		emitter.on(RooCodeEventName.TaskStarted, onTaskStarted as (...args: unknown[]) => void)
		emitter.on(RooCodeEventName.TaskCompleted, onTaskEnded as (...args: unknown[]) => void)
		emitter.on(RooCodeEventName.TaskAborted, onTaskEnded as (...args: unknown[]) => void)
		emitter.on(RooCodeEventName.TaskModeSwitched, onModeSwitch as (...args: unknown[]) => void)
		emitter.on(RooCodeEventName.ModeChanged, onModeChanged as (...args: unknown[]) => void)
		emitter.on(RooCodeEventName.TaskTokenUsageUpdated, onTokenUsageUpdated as (...args: unknown[]) => void)
		emitter.on(RooCodeEventName.TaskToolFailed, onToolFailed as (...args: unknown[]) => void)
		emitter.on(RooCodeEventName.Message, onAgentMessage as (...args: unknown[]) => void)

		this._cleanups.push(
			() => {
				emitter.off(RooCodeEventName.TaskStarted, onTaskStarted as (...args: unknown[]) => void)
				emitter.off(RooCodeEventName.TaskCompleted, onTaskEnded as (...args: unknown[]) => void)
				emitter.off(RooCodeEventName.TaskAborted, onTaskEnded as (...args: unknown[]) => void)
				emitter.off(RooCodeEventName.TaskModeSwitched, onModeSwitch as (...args: unknown[]) => void)
				emitter.off(RooCodeEventName.ModeChanged, onModeChanged as (...args: unknown[]) => void)
				emitter.off(RooCodeEventName.TaskTokenUsageUpdated, onTokenUsageUpdated as (...args: unknown[]) => void)
				emitter.off(RooCodeEventName.TaskToolFailed, onToolFailed as (...args: unknown[]) => void)
				emitter.off(RooCodeEventName.Message, onAgentMessage as (...args: unknown[]) => void)
			},
			() => workspaceDisposable.dispose(),
			() => editorDisposable.dispose(),
		)
	}

	/**
	 * Wire PluginServer events → RooCodeAPI method calls.
	 * Each event corresponds to a PluginClient method; the final `reply` arg
	 * sends the result (or error) back to the waiting client Promise.
	 */
	private _wireServerEvents(): void {
		const server = this._pluginServer

		/**
		 * Type-safe wrapper around EventEmitter.on that preserves PluginServerEvents
		 * tuple types as callback parameters — needed because TypeScript's bundler
		 * module-resolution sometimes loses the generic inference for external packages.
		 */
		const handle = <K extends keyof PluginServerEvents>(
			event: K,
			listener: (...args: PluginServerEvents[K]) => void | Promise<void>,
		): void => {
			server.on(event as never, listener as never)
		}

		// ── Connection lifecycle ──────────────────────────────────────────────

		handle("connect", (clientId) => {
			this._clientTools.set(clientId, [])
			this._clientMcpServers.set(clientId, [])
		})

		handle("disconnect", (clientId) => {
			// Unregister all tools the disconnected client had registered.
			for (const toolName of this._clientTools.get(clientId) ?? []) {
				customToolRegistry.unregister(toolName)
			}
			this._clientTools.delete(clientId)

			// Unregister all MCP servers the disconnected client had registered.
			const hub = this._getMcpHub()
			for (const serverName of this._clientMcpServers.get(clientId) ?? []) {
				hub?.unregisterPluginServer(serverName).catch((err: unknown) => {
					console.error(`[RooPluginService] Failed to unregister MCP server "${serverName}":`, err)
				})
			}
			this._clientMcpServers.delete(clientId)
		})

		// ── Context ───────────────────────────────────────────────────────────

		handle("getContext", (_clientId, reply) => {
			reply(toAgentContext({ ...this._context }))
		})

		// ── Profile management ────────────────────────────────────────────────

		handle("getProfiles", (_clientId, reply) => {
			reply(this.api.getProfiles())
		})

		handle("getProfile", (_clientId, name, reply) => {
			const entry = this.api.getProfileEntry(name)
			reply(entry ? { id: entry.id, name: entry.name, settings: entry as Record<string, unknown> } : undefined)
		})

		handle("getActiveProfile", (_clientId, reply) => {
			reply(this.api.getActiveProfile())
		})

		handle("getCurrentSettings", (_clientId, reply) => {
			reply(this.api.getConfiguration() as Record<string, unknown>)
		})

		handle("upsertProfile", async (_clientId, name, settings, activate, reply) => {
			try {
				const id = await this.api.upsertProfile(
					name,
					settings as Parameters<RooCodeAPI["upsertProfile"]>[1],
					activate ?? true,
				)
				reply(id)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})

		handle("createProfile", async (_clientId, name, settings, activate, reply) => {
			try {
				const id = await this.api.createProfile(
					name,
					(settings ?? {}) as Parameters<RooCodeAPI["createProfile"]>[1],
					activate ?? true,
				)
				reply(id)
			} catch (err: unknown) {
				reply("", err instanceof Error ? err.message : String(err))
			}
		})

		handle("updateProfile", async (_clientId, name, settings, activate, reply) => {
			try {
				const id = await this.api.updateProfile(
					name,
					settings as Parameters<RooCodeAPI["updateProfile"]>[1],
					activate ?? true,
				)
				reply(id)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})

		handle("deleteProfile", async (_clientId, name, reply) => {
			try {
				await this.api.deleteProfile(name)
				reply(undefined)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})

		handle("setActiveProfile", async (_clientId, name, reply) => {
			try {
				await this.api.setActiveProfile(name)
				reply(undefined)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})

		// ── Task management ───────────────────────────────────────────────────

		handle("startTask", async (_clientId, text, images, reply) => {
			try {
				const taskId = await this.api.startNewTask({ text, images })
				reply(taskId)
			} catch (err: unknown) {
				reply("", err instanceof Error ? err.message : String(err))
			}
		})

		handle("resumeTask", async (_clientId, taskId, reply) => {
			try {
				await this.api.resumeTask(taskId)
				reply(undefined)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})

		handle("setCurrentTask", async (_clientId, taskId, reply) => {
			try {
				await this.api.resumeTask(taskId)
				reply(undefined)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})

		handle("cancelCurrentTask", async (_clientId, reply) => {
			try {
				await this.api.cancelCurrentTask()
				reply(undefined)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})

		// ── Messaging ─────────────────────────────────────────────────────────

		handle("sendMessage", async (_clientId, text, images, reply) => {
			try {
				await this.api.sendMessage(text, images)
				reply(undefined)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})

		handle("interruptAgent", async (_clientId, reply) => {
			try {
				await this.api.pressSecondaryButton()
				reply(undefined)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})

		// ── Tool registration ─────────────────────────────────────────────────

		handle("registerTool", (clientId, definition, reply) => {
			const namespacedName = `ws-plugin:${clientId}/${definition.name}`
			const customDef: CustomToolDefinition = {
				name: namespacedName,
				description: definition.description,
				// Execute runs on the remote client via WebSocket round-trip.
				execute: async (args, ctx) =>
					server.invokeClientTool(clientId, definition.name, args, {
						taskId: ctx.task.taskId,
						mode: ctx.mode,
					}),
			}
			customToolRegistry.register(customDef, `ws-plugin:${clientId}`)
			const tools = this._clientTools.get(clientId) ?? []
			tools.push(namespacedName)
			this._clientTools.set(clientId, tools)
			reply(undefined)
		})

		handle("unregisterTool", (clientId, name, reply) => {
			const namespacedName = `ws-plugin:${clientId}/${name}`
			customToolRegistry.unregister(namespacedName)
			const tools = this._clientTools.get(clientId) ?? []
			const idx = tools.indexOf(namespacedName)
			if (idx !== -1) tools.splice(idx, 1)
			reply(undefined)
		})

		// ── MCP server registration ───────────────────────────────────────────

		handle("registerMcpServer", async (clientId, name, config, reply) => {
			const hub = this._getMcpHub()
			if (!hub) {
				reply(undefined, "McpHub is not available yet. Try again after activation.")
				return
			}
			try {
				await hub.registerPluginServer(name, `ws-plugin:${clientId}`, config)
				const servers = this._clientMcpServers.get(clientId) ?? []
				servers.push(name)
				this._clientMcpServers.set(clientId, servers)
				reply(undefined)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})

		handle("unregisterMcpServer", async (clientId, name, reply) => {
			try {
				await this._getMcpHub()?.unregisterPluginServer(name)
				const servers = this._clientMcpServers.get(clientId) ?? []
				const idx = servers.indexOf(name)
				if (idx !== -1) servers.splice(idx, 1)
				reply(undefined)
			} catch (err: unknown) {
				reply(undefined, err instanceof Error ? err.message : String(err))
			}
		})
	}
}
