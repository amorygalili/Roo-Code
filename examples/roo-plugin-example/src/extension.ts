/**
 * Roo Plugin Example — WebSocket edition
 *
 * Demonstrates the socket-based plugin API (@roo-code/plugin-api-v2):
 *   1. Tool registration        – adds `word_count` and `get_datetime` tools the agent can call
 *   2. Context subscription     – live mode / task info shown in the panel and status bar
 *   3. Token usage tracking     – cumulative token counts and cost displayed in the panel
 *   4. Tool failure alerts      – failed tool invocations logged in the panel
 *   5. Agent message stream     – live assistant transcript shown in the panel
 *   6. Panel message bus        – bidirectional ping/pong between the panel and extension host
 *   7. Agent messaging          – panel textarea sends messages directly to the active task
 *   8. Configuration profiles   – creates and activates a custom API configuration profile
 *   9. MCP server registration  – registers `mcp-server-time` via the plugin API
 *
 * Instead of the in-process `roo.plugins.register()` API, this example uses a
 * `PluginClient` from `@roo-code/plugin-api-v2` that connects over WebSocket to the
 * `PluginServer` started inside Roo Code. The port is exposed via `roo.plugins.pluginServerPort`.
 * The webview panel is driven entirely by extension-host→panel `postMessage` calls,
 * which replaces the old `handle.postMessageToPanel` approach.
 */

import * as vscode from "vscode"

import { PluginClient } from "@roo-code/plugin-api-v2"
import type { AgentTaskContext, AgentTokenUsage, RooCodeAPI } from "@roo-code/types"

// ── Panel provider ────────────────────────────────────────────────────────────

/** Random nonce for the Content-Security-Policy header. */
function getNonce(): string {
	let text = ""
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length))
	return text
}

/**
 * Sidebar panel provider that uses `webviewView.webview.postMessage` directly
 * (no longer needs `handle.registerPanelView` / `handle.postMessageToPanel`).
 * The extension host calls `panel.postMessage(msg)` to push data; the panel
 * calls back via `webviewView.webview.onDidReceiveMessage`.
 */
class RooPluginPanelProvider implements vscode.WebviewViewProvider {
	public static readonly VIEW_ID = "roo-plugin-example.panel"
	private _view?: vscode.WebviewView

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _client: PluginClient,
		private readonly _demoProfName: string,
		private readonly _demoProfSettings: Record<string, unknown>,
	) {}

	/** Send a message to the webview (no-op when the panel is not open). */
	postMessage(msg: unknown): void {
		this._view?.webview.postMessage(msg)
	}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_ctx: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "webview-ui", "dist")],
		}
		webviewView.webview.html = getWebviewContent(webviewView.webview, this._extensionUri)
		webviewView.onDidDispose(() => {
			this._view = undefined
		})

		// Push initial snapshots so the panel isn't blank on first open.
		webviewView.webview.postMessage({ type: "contextUpdate", context: this._client.getContext() })
		this._client
			.getActiveProfile()
			.then((activeProfile) => {
				return this._client.getProfiles().then((profiles) => {
					webviewView.webview.postMessage({ type: "profileUpdate", activeProfile, profiles })
				})
			})
			.catch(() => {
				/* best-effort */
			})

		// Handle messages sent from the webview to the extension host.
		webviewView.webview.onDidReceiveMessage(async (msg: { type: string; text?: string; ts?: number }) => {
			if (msg.type === "sendToAgent") {
				const ctx = this._client.getContext()
				if (!ctx.taskId) {
					webviewView.webview.postMessage({ type: "error", text: "No active Roo task — start one first." })
				} else {
					await this._client.sendMessage(msg.text ?? "")
				}
			} else if (msg.type === "pingExtension") {
				webviewView.webview.postMessage({
					type: "pongFromExtension",
					ts: msg.ts,
					roundTrip: Date.now() - (msg.ts ?? 0),
				})
			} else if (msg.type === "pong") {
				// Panel echoed our ping — nothing to do.
			} else if (msg.type === "upsertDemoProfile") {
				await this._client.upsertProfile(this._demoProfName, this._demoProfSettings, false)
				const [activeProfile, profiles] = await Promise.all([
					this._client.getActiveProfile(),
					this._client.getProfiles(),
				])
				webviewView.webview.postMessage({ type: "profileUpdate", activeProfile, profiles })
			} else if (msg.type === "activateDemoProfile") {
				await this._client.setActiveProfile(this._demoProfName)
				const [activeProfile, profiles] = await Promise.all([
					this._client.getActiveProfile(),
					this._client.getProfiles(),
				])
				webviewView.webview.postMessage({ type: "profileUpdate", activeProfile, profiles })
				vscode.window.showInformationMessage(`Roo: switched to profile "${this._demoProfName}"`)
			}
		})
	}
}

// ── Webview HTML ──────────────────────────────────────────────────────────────

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const scriptUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "webview-ui", "dist", "assets", "index.js"),
	)
	const styleUri = webview.asWebviewUri(
		vscode.Uri.joinPath(extensionUri, "webview-ui", "dist", "assets", "index.css"),
	)
	const nonce = getNonce()
	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource}; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
  <link rel="stylesheet" href="${styleUri}" />
  <title>Roo Plugin Demo</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map AgentTokenUsage → the shape the webview's App.tsx expects.
 * The webview was written against the old RooTaskContext-era field names.
 */
function toWebviewTokenUsage(usage: AgentTokenUsage) {
	return {
		totalTokensIn: usage.tokensIn,
		totalTokensOut: usage.tokensOut,
		totalCost: usage.cost,
		contextTokens: 0, // not exposed by AgentTokenUsage
	}
}

// ── Activate ──────────────────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext) {
	// ── 1. Obtain the Roo Code API ────────────────────────────────────────────
	const rooExt = vscode.extensions.getExtension<RooCodeAPI>("RooVeterinaryInc.roo-cline")

	if (!rooExt) {
		vscode.window.showWarningMessage("Roo Plugin Example: Roo Code extension not found.")
		return
	}

	// Roo Code is declared as a dependency, so it will already be active.
	const roo = rooExt.exports
	const port = roo.plugins.pluginServerPort

	// ── 2. Connect to the PluginServer via WebSocket ──────────────────────────
	const client = new PluginClient({ url: `ws://localhost:${port}` })
	context.subscriptions.push({ dispose: () => client.disconnect() })

	try {
		await client.connect()
	} catch (err: unknown) {
		vscode.window.showErrorMessage(`Roo Plugin Example: Could not connect to plugin server on port ${port}: ${err}`)
		return
	}

	// ── 3. Create / refresh the demo configuration profile ───────────────────
	const DEMO_PROFILE_NAME = "Roo Plugin Demo"
	const DEMO_PROFILE_SETTINGS = {
		apiProvider: "openai",
		openAiBaseUrl: "https://api.openai.com/v1",
		openAiModelId: "gpt-4o-mini",
	}
	client.upsertProfile(DEMO_PROFILE_NAME, DEMO_PROFILE_SETTINGS, false).catch((err: unknown) => {
		console.error("[roo-plugin-example] Failed to upsert demo profile:", err)
	})

	// ── 4. Register custom tools ──────────────────────────────────────────────

	// Tool A: count words in a string.
	const unregisterWordCount = client.registerTool({
		name: "word_count",
		description: "Count the number of words in a piece of text.",
		execute: async (args: unknown) => {
			const { text } = args as { text: string }
			if (typeof text !== "string") return "Error: `text` must be a string."
			const count = text.trim() === "" ? 0 : text.trim().split(/\s+/).length
			return `The text contains ${count} word${count === 1 ? "" : "s"}.`
		},
	})
	context.subscriptions.push({ dispose: unregisterWordCount })

	// Tool B: return the current date and time.
	const unregisterGetDatetime = client.registerTool({
		name: "get_datetime",
		description: "Return the current date and time in ISO 8601 format.",
		execute: async () => new Date().toISOString(),
	})
	context.subscriptions.push({ dispose: unregisterGetDatetime })

	// ── 5. Output channel (logs extension-host activity) ─────────────────────
	const outputChannel = vscode.window.createOutputChannel("Roo Plugin Example")
	context.subscriptions.push(outputChannel)

	// ── 6. Register the sidebar panel ─────────────────────────────────────────
	const panel = new RooPluginPanelProvider(context.extensionUri, client, DEMO_PROFILE_NAME, DEMO_PROFILE_SETTINGS)
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(RooPluginPanelProvider.VIEW_ID, panel, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	// ── 7. Register a plugin MCP server ──────────────────────────────────────
	// Requires `uvx` (part of the `uv` Python toolchain). Install with:
	//   curl -LsSf https://astral.sh/uv/install.sh | sh   (macOS / Linux)
	//   powershell -c "irm https://astral.sh/uv/install.ps1 | iex"  (Windows)
	client
		.registerMcpServer("plugin-time-server", {
			type: "stdio",
			command: "uvx",
			args: ["mcp-server-time"],
		})
		.then((cleanupMcpServer) => {
			context.subscriptions.push({ dispose: cleanupMcpServer })
			outputChannel.appendLine("[mcp] Registered 'plugin-time-server' (mcp-server-time via uvx)")
		})
		.catch((err: unknown) => {
			outputChannel.appendLine(`[mcp] Failed to register 'plugin-time-server': ${err}`)
			vscode.window.showWarningMessage(
				"Roo Plugin Example: Could not register MCP server — ensure 'uvx' is installed.",
			)
		})

	// ── 8. Status bar ─────────────────────────────────────────────────────────
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	statusBar.tooltip = "Roo Code agent context — open the Roo Plugin Demo panel for details"
	context.subscriptions.push(statusBar)

	function updateStatusBar(ctx: AgentTaskContext) {
		const task = ctx.taskId ? `task:${ctx.taskId.slice(0, 8)}` : "idle"
		statusBar.text = `$(robot) Roo [${ctx.mode}] ${task}`
		statusBar.show()
	}
	updateStatusBar(client.getContext())

	// ── 9. Context subscription → status bar + panel ──────────────────────────
	const unsubscribeContext = client.onContextChange((ctx) => {
		updateStatusBar(ctx)
		panel.postMessage({ type: "contextUpdate", context: ctx })
	})
	context.subscriptions.push({ dispose: unsubscribeContext })

	// ── 10. Token usage → output channel + panel ───────────────────────────────
	const unsubscribeTokens = client.onTokenUsageUpdated((taskId, usage) => {
		const { tokensIn, tokensOut, cost } = usage
		outputChannel.appendLine(
			`[tokens] task=${taskId.slice(0, 8)} in=${tokensIn} out=${tokensOut} cost=$${cost.toFixed(4)}`,
		)
		const ctx = client.getContext()
		const task = ctx.taskId ? `task:${ctx.taskId.slice(0, 8)}` : "idle"
		statusBar.text = `$(robot) Roo [${ctx.mode}] ${task} · $${cost.toFixed(4)}`
		panel.postMessage({ type: "tokenUsage", taskId, tokenUsage: toWebviewTokenUsage(usage) })
	})
	context.subscriptions.push({ dispose: unsubscribeTokens })

	// ── 11. Tool failures → notification + output channel + panel ─────────────
	const unsubscribeToolFailed = client.onToolCallFailed((taskId, toolName, errorMessage) => {
		outputChannel.appendLine(`[tool-failed] task=${taskId.slice(0, 8)} tool=${toolName}: ${errorMessage}`)
		vscode.window.showWarningMessage(`Roo: Tool "${toolName}" failed — ${errorMessage}`)
		panel.postMessage({ type: "toolFailed", taskId, toolName, errorMessage })
	})
	context.subscriptions.push({ dispose: unsubscribeToolFailed })

	// ── 12. Agent messages → output channel + panel ────────────────────────────
	const unsubscribeAgentMsg = client.onAgentMessage((taskId, action, message) => {
		if (message.type === "say" && message.say === "text" && !message.partial && message.text) {
			outputChannel.appendLine(`[agent] [${taskId.slice(0, 8)}] [${action}] ${message.text.slice(0, 120)}`)
		}
		panel.postMessage({ type: "agentMessage", taskId, action, message })
	})
	context.subscriptions.push({ dispose: unsubscribeAgentMsg })

	// ── 13. Commands ──────────────────────────────────────────────────────────

	// Ping the panel from the extension host (demonstrates ext → panel direction).
	context.subscriptions.push(
		vscode.commands.registerCommand("roo-plugin-example.pingPanel", async () => {
			panel.postMessage({ type: "pingFromExtension", ts: Date.now() })
			outputChannel.appendLine("[ext → panel] sent ping")
			outputChannel.show(true)
		}),
	)

	// Ask agent for date/time.
	context.subscriptions.push(
		vscode.commands.registerCommand("roo-plugin-example.askDateTime", async () => {
			const ctx = client.getContext()
			if (!ctx.taskId) {
				vscode.window.showInformationMessage("No active Roo task. Start a task first.")
				return
			}
			await client.sendMessage("What is the current date and time?")
		}),
	)

	// Activate the demo profile from the Command Palette.
	context.subscriptions.push(
		vscode.commands.registerCommand("roo-plugin-example.activateDemoProfile", async () => {
			await client.setActiveProfile(DEMO_PROFILE_NAME)
			const [activeProfile, profiles] = await Promise.all([client.getActiveProfile(), client.getProfiles()])
			panel.postMessage({ type: "profileUpdate", activeProfile, profiles })
			vscode.window.showInformationMessage(`Roo: switched to profile "${DEMO_PROFILE_NAME}"`)
		}),
	)

	outputChannel.appendLine(`[roo-plugin-example] Connected to Roo Code plugin server on port ${port}`)
	vscode.window.showInformationMessage(
		`Roo Plugin Example activated — open the 'Roo Plugin Demo' panel in the Roo sidebar.`,
	)
}

export function deactivate() {
	console.log("Roo Plugin Example deactivated")
}
