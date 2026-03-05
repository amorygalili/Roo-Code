import * as vscode from "vscode"

import { customToolRegistry } from "@roo-code/core"
import type {
	RooPluginService,
	RooPluginHandle,
	RooPluginManifest,
	RooTaskContext,
	RooDisposable,
	CustomToolDefinition,
	RooCodeAPI,
	RooCodeEvents,
} from "@roo-code/types"
import { RooCodeEventName } from "@roo-code/types"

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
		return this._service.subscribeToContext(listener)
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
	private readonly _handles = new Map<string, RooPluginHandleImpl>()
	private readonly _contextListeners = new Set<(ctx: RooTaskContext) => void>()
	private _context: RooTaskContext = makeContext()
	private readonly _disposables: RooDisposable[] = []

	constructor(api: RooCodeAPI) {
		this.api = api
		this._wireEvents()
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
		// Task lifecycle — update taskId.
		const onTaskStarted = (taskId: string) => {
			this._context = { ...this._context, taskId }
			this._notifyListeners()
		}

		const onTaskEnded = (_taskId: string) => {
			this._context = { ...this._context, taskId: undefined }
			this._notifyListeners()
		}

		const onModeSwitch = (_taskId: string, mode: string) => {
			this._context = { ...this._context, mode }
			this._notifyListeners()
		}

		// VS Code workspace change listener.
		const workspaceDisposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
			this._context = makeContext({ taskId: this._context.taskId, mode: this._context.mode })
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

		this._disposables.push(
			{
				dispose: () => {
					emitter.off(RooCodeEventName.TaskStarted, onTaskStarted as (...args: unknown[]) => void)
					emitter.off(RooCodeEventName.TaskCompleted, onTaskEnded as (...args: unknown[]) => void)
					emitter.off(RooCodeEventName.TaskAborted, onTaskEnded as (...args: unknown[]) => void)
					emitter.off(RooCodeEventName.TaskModeSwitched, onModeSwitch as (...args: unknown[]) => void)
				},
			},
			{ dispose: () => workspaceDisposable.dispose() },
			{ dispose: () => editorDisposable.dispose() },
		)
	}
}
