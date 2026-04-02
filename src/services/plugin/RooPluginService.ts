import * as vscode from "vscode"

import { customToolRegistry } from "@roo-code/core"
import type {
	AgentProfileManager,
	AgentTaskContext,
	AgentTokenUsage,
	AgentMessage,
	AgentToolDefinition,
} from "@roo-code/plugin-api"
import type {
	RooPluginService,
	RooPluginHandle,
	RooPluginManifest,
	RooTaskContext,
	RooWebviewView,
	CustomToolDefinition,
	PluginMcpServerConfig,
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
// RooProfileManagerAdapter — wraps RooCodeAPI profile methods into AgentProfileManager
// ---------------------------------------------------------------------------

class RooProfileManagerAdapter implements AgentProfileManager {
	constructor(private readonly _api: RooCodeAPI) {}

	getProfiles(): string[] {
		return this._api.getProfiles()
	}

	getProfile(name: string) {
		const entry = this._api.getProfileEntry(name)
		if (!entry) return undefined
		return { id: entry.id, name: entry.name, settings: entry as Record<string, unknown> }
	}

	getActiveProfile(): string | undefined {
		return this._api.getActiveProfile()
	}

	getCurrentSettings(): Record<string, unknown> {
		return this._api.getConfiguration() as Record<string, unknown>
	}

	async createProfile(name: string, settings: Record<string, unknown> = {}, activate = true): Promise<string> {
		return await this._api.createProfile(name, settings as Parameters<RooCodeAPI["createProfile"]>[1], activate)
	}

	async updateProfile(name: string, settings: Record<string, unknown>, activate = true): Promise<string | undefined> {
		return await this._api.updateProfile(name, settings as Parameters<RooCodeAPI["updateProfile"]>[1], activate)
	}

	async upsertProfile(name: string, settings: Record<string, unknown>, activate = true): Promise<string | undefined> {
		return await this._api.upsertProfile(name, settings as Parameters<RooCodeAPI["upsertProfile"]>[1], activate)
	}

	async deleteProfile(name: string): Promise<void> {
		await this._api.deleteProfile(name)
	}

	async setActiveProfile(name: string): Promise<void> {
		await this._api.setActiveProfile(name)
	}
}

// ---------------------------------------------------------------------------
// RooPluginHandleImpl
// ---------------------------------------------------------------------------

class RooPluginHandleImpl implements RooPluginHandle {
	public readonly manifest: RooPluginManifest
	public readonly profiles: AgentProfileManager
	private readonly _service: RooPluginServiceImpl
	private readonly _cleanups: Array<() => void> = []
	private _disposed = false

	// Panel view state
	private _panelView: RooWebviewView | undefined = undefined
	private readonly _panelListeners = new Set<(message: unknown) => void>()
	private _panelViewCleanup: (() => void) | undefined = undefined

	constructor(manifest: RooPluginManifest, service: RooPluginServiceImpl) {
		this.manifest = manifest
		this._service = service
		this.profiles = new RooProfileManagerAdapter(service.api)

		// Register declarative tools from the manifest.
		// These are Roo-native CustomToolDefinition objects, so register them
		// directly with the registry (bypassing the AgentToolDefinition adapter).
		if (manifest.tools) {
			for (const tool of manifest.tools) {
				this._cleanups.push(this._registerNativeTool(tool))
			}
		}
	}

	getContext(): AgentTaskContext {
		return toAgentContext(this._service.getContext())
	}

	onContextChange(listener: (context: AgentTaskContext) => void): () => void {
		const wrapper = (ctx: RooTaskContext) => listener(toAgentContext(ctx))
		const cleanup = this._service.subscribeToContext(wrapper)
		this._cleanups.push(cleanup)
		return cleanup
	}

	// ── Task management ─────────────────────────────────────────────────────

	async startTask(text?: string, images?: string[]): Promise<string> {
		return await this._service.api.startNewTask({ text, images })
	}

	async resumeTask(taskId: string): Promise<void> {
		await this._service.api.resumeTask(taskId)
	}

	async setCurrentTask(taskId: string): Promise<void> {
		await this._service.api.resumeTask(taskId)
	}

	async cancelCurrentTask(): Promise<void> {
		await this._service.api.cancelCurrentTask()
	}

	// ── Messaging ────────────────────────────────────────────────────────────

	async sendMessage(text: string, images?: string[]): Promise<void> {
		await this._service.api.sendMessage(text, images)
	}

	/** @deprecated Use `sendMessage()` instead. */
	async sendMessageToAgent(message: string, images?: string[]): Promise<void> {
		return this.sendMessage(message, images)
	}

	async interruptAgent(): Promise<void> {
		await this._service.api.pressSecondaryButton()
	}

	onAgentMessage(
		listener: (taskId: string, action: "created" | "updated", message: AgentMessage) => void,
	): () => void {
		const wrapper = (taskId: string, action: "created" | "updated", msg: ClineMessage) =>
			listener(taskId, action, toAgentMessage(msg))
		const cleanup = this._service.subscribeToAgentMessages(wrapper)
		this._cleanups.push(cleanup)
		return cleanup
	}

	// ── Token & error events ─────────────────────────────────────────────────

	onTokenUsageUpdated(listener: (taskId: string, usage: AgentTokenUsage) => void): () => void {
		const wrapper = (taskId: string, tokenUsage: TokenUsage, _toolUsage: ToolUsage) =>
			listener(taskId, toAgentTokenUsage(tokenUsage))
		const cleanup = this._service.subscribeToTokenUsageUpdated(wrapper)
		this._cleanups.push(cleanup)
		return cleanup
	}

	onToolCallFailed(listener: (taskId: string, toolName: string, errorMessage: string) => void): () => void {
		const cleanup = this._service.subscribeToToolFailed(listener)
		this._cleanups.push(cleanup)
		return cleanup
	}

	onLlmError(listener: (taskId: string, errorMessage: string) => void): () => void {
		const cleanup = this._service.subscribeToLlmError(listener)
		this._cleanups.push(cleanup)
		return cleanup
	}

	// ── Tool registration ────────────────────────────────────────────────────

	registerTool(definition: AgentToolDefinition): () => void {
		const namespacedName = `${this.manifest.id}/${definition.name}`
		// Adapt AgentToolDefinition → CustomToolDefinition:
		// - parameters is omitted (AgentToolDefinition uses plain JSON Schema while
		//   CustomToolDefinition expects a Zod schema; args are passed through as-is)
		// - execute context is bridged from CustomToolContext to AgentToolContext
		const customDef: CustomToolDefinition = {
			name: namespacedName,
			description: definition.description,
			execute: async (args: unknown, ctx) =>
				definition.execute(args, { taskId: ctx.task.taskId, mode: ctx.mode }),
		}
		customToolRegistry.register(customDef, `plugin:${this.manifest.id}`)
		const cleanup = () => {
			customToolRegistry.unregister(namespacedName)
		}
		this._cleanups.push(cleanup)
		return cleanup
	}

	// ── Private helpers ──────────────────────────────────────────────────────

	/** Register a Roo-native CustomToolDefinition directly (used for manifest.tools). */
	private _registerNativeTool(definition: CustomToolDefinition): () => void {
		const namespacedName = `${this.manifest.id}/${definition.name}`
		const namespacedDef: CustomToolDefinition = { ...definition, name: namespacedName }
		customToolRegistry.register(namespacedDef, `plugin:${this.manifest.id}`)
		return () => {
			customToolRegistry.unregister(namespacedName)
		}
	}

	// ── MCP server registration ──────────────────────────────────────────────

	async registerMcpServer(name: string, config: PluginMcpServerConfig): Promise<() => void> {
		const cleanup = await this._service.registerPluginMcpServer(this.manifest.id, name, config)
		this._cleanups.push(cleanup)
		return cleanup
	}

	// ── Webview panel message bus ────────────────────────────────────────────

	registerPanelView(view: RooWebviewView): () => void {
		// Detach any previously registered view.
		this._panelViewCleanup?.()

		this._panelView = view

		const msgDisposable = view.webview.onDidReceiveMessage((message) => {
			for (const listener of this._panelListeners) {
				try {
					listener(message)
				} catch {
					// Isolate plugin errors.
				}
			}
		})

		const cleanup = () => {
			msgDisposable.dispose()
			if (this._panelView === view) {
				this._panelView = undefined
			}
			this._panelViewCleanup = undefined
		}

		this._panelViewCleanup = cleanup
		this._cleanups.push(cleanup)
		return cleanup
	}

	async postMessageToPanel(message: unknown): Promise<void> {
		await this._panelView?.webview.postMessage(message)
	}

	onMessageFromPanel(listener: (message: unknown) => void): () => void {
		this._panelListeners.add(listener)
		const cleanup = () => {
			this._panelListeners.delete(listener)
		}
		this._cleanups.push(cleanup)
		return cleanup
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────

	dispose(): void {
		if (this._disposed) {
			return
		}

		this._disposed = true

		for (const cleanup of this._cleanups) {
			try {
				cleanup()
			} catch {
				// Best-effort cleanup.
			}
		}

		this._service.unregister(this.manifest.id)
	}
}

// ---------------------------------------------------------------------------
// RooPluginServiceImpl
// ---------------------------------------------------------------------------

export class RooPluginServiceImpl implements RooPluginService {
	public readonly api: RooCodeAPI
	private readonly _getMcpHub: () => McpHub | undefined
	private readonly _handles = new Map<string, RooPluginHandleImpl>()
	private readonly _contextListeners = new Set<(ctx: RooTaskContext) => void>()
	private readonly _tokenUsageListeners = new Set<
		(taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => void
	>()
	private readonly _toolFailedListeners = new Set<
		(taskId: string, toolName: ToolName, errorMessage: string) => void
	>()
	private readonly _llmErrorListeners = new Set<(taskId: string, errorMessage: string) => void>()
	private readonly _agentMessageListeners = new Set<
		(taskId: string, action: "created" | "updated", message: ClineMessage) => void
	>()
	private _context: RooTaskContext = makeContext()
	private readonly _cleanups: Array<() => void> = []

	constructor(api: RooCodeAPI, getMcpHub: () => McpHub | undefined = () => undefined) {
		this.api = api
		this._getMcpHub = getMcpHub
		this._wireEvents()
	}

	/**
	 * Registers a plugin-contributed MCP server.
	 * Called from RooPluginHandleImpl.registerMcpServer.
	 */
	async registerPluginMcpServer(pluginId: string, name: string, config: PluginMcpServerConfig): Promise<() => void> {
		const hub = this._getMcpHub()
		if (!hub) {
			throw new Error(
				"McpHub is not available yet. Try calling registerMcpServer after the extension has fully activated.",
			)
		}

		await hub.registerPluginServer(name, pluginId, config)

		return () => {
			hub.unregisterPluginServer(name).catch((error) => {
				console.error(`[RooPluginService] Failed to unregister plugin MCP server "${name}":`, error)
			})
		}
	}

	// -------------------------------------------------------------------------
	// RooPluginService interface
	// -------------------------------------------------------------------------

	register(manifest: RooPluginManifest): RooPluginHandle {
		// Idempotent: if the plugin was already registered (e.g. via declarative
		// auto-discovery in discoverPlugins), return the existing handle so that
		// extensions which call register() in their activate() don't get an error.
		const existing = this._handles.get(manifest.id)
		if (existing) {
			return existing
		}

		const handle = new RooPluginHandleImpl(manifest, this)
		this._handles.set(manifest.id, handle)
		return handle
	}

	getRegisteredPlugins(): RooPluginManifest[] {
		return Array.from(this._handles.values()).map((h) => h.manifest)
	}

	// -------------------------------------------------------------------------
	// Internal helpers used by handles
	// -------------------------------------------------------------------------

	getContext(): RooTaskContext {
		return { ...this._context }
	}

	subscribeToContext(listener: (ctx: RooTaskContext) => void): () => void {
		this._contextListeners.add(listener)
		return () => {
			this._contextListeners.delete(listener)
		}
	}

	subscribeToTokenUsageUpdated(
		listener: (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => void,
	): () => void {
		this._tokenUsageListeners.add(listener)
		return () => {
			this._tokenUsageListeners.delete(listener)
		}
	}

	subscribeToToolFailed(listener: (taskId: string, toolName: ToolName, errorMessage: string) => void): () => void {
		this._toolFailedListeners.add(listener)
		return () => {
			this._toolFailedListeners.delete(listener)
		}
	}

	subscribeToLlmError(listener: (taskId: string, errorMessage: string) => void): () => void {
		this._llmErrorListeners.add(listener)
		return () => {
			this._llmErrorListeners.delete(listener)
		}
	}

	subscribeToAgentMessages(
		listener: (taskId: string, action: "created" | "updated", message: ClineMessage) => void,
	): () => void {
		this._agentMessageListeners.add(listener)
		return () => {
			this._agentMessageListeners.delete(listener)
		}
	}

	unregister(pluginId: string): void {
		this._handles.delete(pluginId)
	}

	dispose(): void {
		for (const cleanup of this._cleanups) {
			try {
				cleanup()
			} catch {
				// Best-effort cleanup.
			}
		}

		for (const handle of this._handles.values()) {
			handle.dispose()
		}
	}

	// -------------------------------------------------------------------------
	// Private
	// -------------------------------------------------------------------------

	private _notifyListeners(): void {
		const snapshot = { ...this._context }
		for (const listener of this._contextListeners) {
			try {
				listener(snapshot)
			} catch {
				// Isolate plugin errors.
			}
		}
	}

	private _wireEvents(): void {
		// Task lifecycle — update taskId and reset per-task usage stats.
		const onTaskStarted = (taskId: string) => {
			this._context = { ...this._context, taskId, tokenUsage: undefined, toolUsage: undefined }
			this._notifyListeners()
		}

		const onTaskEnded = (_taskId: string) => {
			this._context = { ...this._context, taskId: undefined, tokenUsage: undefined, toolUsage: undefined }
			this._notifyListeners()
		}

		// TaskModeSwitched fires when the agent switches mode during a task.
		const onModeSwitch = (_taskId: string, mode: string) => {
			this._context = { ...this._context, mode }
			this._notifyListeners()
		}

		// ModeChanged fires when the user changes mode in the settings UI (outside a task).
		const onModeChanged = (mode: string) => {
			this._context = { ...this._context, mode }
			this._notifyListeners()
		}

		// TokenUsageUpdated fires after each LLM request with cumulative counts.
		const onTokenUsageUpdated = (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => {
			this._context = { ...this._context, tokenUsage, toolUsage }
			this._notifyListeners()
			for (const listener of this._tokenUsageListeners) {
				try {
					listener(taskId, tokenUsage, toolUsage)
				} catch {
					// Isolate plugin errors.
				}
			}
		}

		// ToolFailed fires when a tool invocation fails inside the active task.
		const onToolFailed = (taskId: string, toolName: ToolName, errorMessage: string) => {
			for (const listener of this._toolFailedListeners) {
				try {
					listener(taskId, toolName, errorMessage)
				} catch {
					// Isolate plugin errors.
				}
			}
		}

		// Message fires for every agent message (say/ask) created or updated.
		const onAgentMessage = (payload: { taskId: string; action: "created" | "updated"; message: ClineMessage }) => {
			const { taskId, action, message } = payload
			for (const listener of this._agentMessageListeners) {
				try {
					listener(taskId, action, message)
				} catch {
					// Isolate plugin errors.
				}
			}
		}

		// VS Code workspace change listeners.
		const workspaceDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
			this._context = makeContext({
				taskId: this._context.taskId,
				mode: this._context.mode,
				tokenUsage: this._context.tokenUsage,
				toolUsage: this._context.toolUsage,
			})
			this._notifyListeners()
		})

		const editorDisposable = vscode.window.onDidChangeVisibleTextEditors(() => {
			this._context = {
				...this._context,
				openFiles: vscode.window.visibleTextEditors.map((e) => e.document.uri.fsPath).filter(Boolean),
			}
			this._notifyListeners()
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
}
