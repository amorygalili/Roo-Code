import * as vscode from "vscode"

import { customToolRegistry } from "@roo-code/core"
import type {
	RooPluginService,
	RooPluginHandle,
	RooPluginManifest,
	RooTaskContext,
	RooDisposable,
	RooWebviewView,
	CustomToolDefinition,
	PluginMcpServerConfig,
	RooCodeAPI,
	RooCodeEvents,
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

// ---------------------------------------------------------------------------
// RooPluginHandleImpl
// ---------------------------------------------------------------------------

class RooPluginHandleImpl implements RooPluginHandle {
	public readonly manifest: RooPluginManifest
	private readonly _service: RooPluginServiceImpl
	private readonly _disposables: RooDisposable[] = []
	private _disposed = false

	// Phase 4: panel view state
	private _panelView: RooWebviewView | undefined = undefined
	private readonly _panelListeners = new Set<(message: unknown) => void>()
	private _panelViewDisposable: RooDisposable | undefined = undefined

	constructor(manifest: RooPluginManifest, service: RooPluginServiceImpl) {
		this.manifest = manifest
		this._service = service

		// Register declarative tools from the manifest.
		if (manifest.tools) {
			for (const tool of manifest.tools) {
				this._disposables.push(this.registerTool(tool))
			}
		}
	}

	getContext(): RooTaskContext {
		return this._service.getContext()
	}

	onContextChange(listener: (context: RooTaskContext) => void): RooDisposable {
		const disposable = this._service.subscribeToContext(listener)
		this._disposables.push(disposable)
		return disposable
	}

	async sendMessageToAgent(message: string, images?: string[]): Promise<void> {
		await this._service.api.sendMessage(message, images)
	}

	registerTool(definition: CustomToolDefinition): RooDisposable {
		// Namespace the tool name to avoid collisions between plugins.
		const namespacedName = `${this.manifest.id}/${definition.name}`
		const namespacedDef: CustomToolDefinition = { ...definition, name: namespacedName }

		customToolRegistry.register(namespacedDef, `plugin:${this.manifest.id}`)

		const disposable: RooDisposable = {
			dispose: () => {
				customToolRegistry.unregister(namespacedName)
			},
		}

		this._disposables.push(disposable)
		return disposable
	}

	async registerMcpServer(name: string, config: PluginMcpServerConfig): Promise<RooDisposable> {
		const disposable = await this._service.registerPluginMcpServer(this.manifest.id, name, config)
		this._disposables.push(disposable)
		return disposable
	}

	onTokenUsageUpdated(
		listener: (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => void,
	): RooDisposable {
		const disposable = this._service.subscribeToTokenUsageUpdated(listener)
		this._disposables.push(disposable)
		return disposable
	}

	onToolFailed(listener: (taskId: string, toolName: ToolName, errorMessage: string) => void): RooDisposable {
		const disposable = this._service.subscribeToToolFailed(listener)
		this._disposables.push(disposable)
		return disposable
	}

	// ── Phase 4: Plugin Panel Message Bus ──────────────────────────────────

	registerPanelView(view: RooWebviewView): RooDisposable {
		// Detach any previously registered view.
		this._panelViewDisposable?.dispose()

		this._panelView = view

		// Wire incoming messages from the webview to all panel listeners.
		const msgDisposable = view.webview.onDidReceiveMessage((message) => {
			for (const listener of this._panelListeners) {
				try {
					listener(message)
				} catch {
					// Isolate plugin errors.
				}
			}
		})

		const disposable: RooDisposable = {
			dispose: () => {
				msgDisposable.dispose()
				if (this._panelView === view) {
					this._panelView = undefined
				}
				this._panelViewDisposable = undefined
			},
		}

		this._panelViewDisposable = disposable
		this._disposables.push(disposable)
		return disposable
	}

	async postMessageToPanel(message: unknown): Promise<void> {
		await this._panelView?.webview.postMessage(message)
	}

	onMessageFromPanel(listener: (message: unknown) => void): RooDisposable {
		this._panelListeners.add(listener)
		const disposable: RooDisposable = {
			dispose: () => {
				this._panelListeners.delete(listener)
			},
		}
		this._disposables.push(disposable)
		return disposable
	}

	// ── Phase 5: Agent Communication ────────────────────────────────────────

	onAgentMessage(
		listener: (taskId: string, action: "created" | "updated", message: ClineMessage) => void,
	): RooDisposable {
		const disposable = this._service.subscribeToAgentMessages(listener)
		this._disposables.push(disposable)
		return disposable
	}

	dispose(): void {
		if (this._disposed) {
			return
		}

		this._disposed = true

		for (const d of this._disposables) {
			try {
				d.dispose()
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
	private readonly _agentMessageListeners = new Set<
		(taskId: string, action: "created" | "updated", message: ClineMessage) => void
	>()
	private _context: RooTaskContext = makeContext()
	private readonly _disposables: RooDisposable[] = []

	constructor(api: RooCodeAPI, getMcpHub: () => McpHub | undefined = () => undefined) {
		this.api = api
		this._getMcpHub = getMcpHub
		this._wireEvents()
	}

	/**
	 * Registers a plugin-contributed MCP server.
	 * Called from RooPluginHandleImpl.registerMcpServer.
	 */
	async registerPluginMcpServer(
		pluginId: string,
		name: string,
		config: PluginMcpServerConfig,
	): Promise<RooDisposable> {
		const hub = this._getMcpHub()
		if (!hub) {
			throw new Error(
				"McpHub is not available yet. Try calling registerMcpServer after the extension has fully activated.",
			)
		}

		await hub.registerPluginServer(name, pluginId, config)

		return {
			dispose: () => {
				hub.unregisterPluginServer(name).catch((error) => {
					console.error(`[RooPluginService] Failed to unregister plugin MCP server "${name}":`, error)
				})
			},
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

	subscribeToContext(listener: (ctx: RooTaskContext) => void): RooDisposable {
		this._contextListeners.add(listener)
		return {
			dispose: () => {
				this._contextListeners.delete(listener)
			},
		}
	}

	subscribeToTokenUsageUpdated(
		listener: (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => void,
	): RooDisposable {
		this._tokenUsageListeners.add(listener)
		return {
			dispose: () => {
				this._tokenUsageListeners.delete(listener)
			},
		}
	}

	subscribeToToolFailed(listener: (taskId: string, toolName: ToolName, errorMessage: string) => void): RooDisposable {
		this._toolFailedListeners.add(listener)
		return {
			dispose: () => {
				this._toolFailedListeners.delete(listener)
			},
		}
	}

	subscribeToAgentMessages(
		listener: (taskId: string, action: "created" | "updated", message: ClineMessage) => void,
	): RooDisposable {
		this._agentMessageListeners.add(listener)
		return {
			dispose: () => {
				this._agentMessageListeners.delete(listener)
			},
		}
	}

	unregister(pluginId: string): void {
		this._handles.delete(pluginId)
	}

	dispose(): void {
		for (const d of this._disposables) {
			try {
				d.dispose()
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

		this._disposables.push(
			{
				dispose: () => {
					emitter.off(RooCodeEventName.TaskStarted, onTaskStarted as (...args: unknown[]) => void)
					emitter.off(RooCodeEventName.TaskCompleted, onTaskEnded as (...args: unknown[]) => void)
					emitter.off(RooCodeEventName.TaskAborted, onTaskEnded as (...args: unknown[]) => void)
					emitter.off(RooCodeEventName.TaskModeSwitched, onModeSwitch as (...args: unknown[]) => void)
					emitter.off(RooCodeEventName.ModeChanged, onModeChanged as (...args: unknown[]) => void)
					emitter.off(
						RooCodeEventName.TaskTokenUsageUpdated,
						onTokenUsageUpdated as (...args: unknown[]) => void,
					)
					emitter.off(RooCodeEventName.TaskToolFailed, onToolFailed as (...args: unknown[]) => void)
					emitter.off(RooCodeEventName.Message, onAgentMessage as (...args: unknown[]) => void)
				},
			},
			{ dispose: () => workspaceDisposable.dispose() },
			{ dispose: () => editorDisposable.dispose() },
		)
	}
}
