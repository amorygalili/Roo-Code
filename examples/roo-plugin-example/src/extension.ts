/**
 * Roo Plugin Example
 *
 * Demonstrates all plugin API features in a sidebar panel UI:
 *   1. Tool registration        – adds `word_count` and `get_datetime` tools the agent can call
 *   2. Context subscription     – live mode / task / file info shown in the panel and status bar
 *   3. Token usage tracking     – cumulative token counts and cost displayed in the panel
 *   4. Tool failure alerts      – failed tool invocations logged in the panel
 *   5. Agent message stream     – live assistant transcript shown in the panel
 *   6. Panel message bus        – bidirectional ping/pong between the panel and extension host
 *   7. Agent messaging          – panel textarea sends messages directly to the active task
 *   8. Configuration profiles   – creates and activates a custom API configuration profile
 */

import * as vscode from "vscode"
import type { RooCodeAPI, RooPluginHandle, RooTaskContext, RooWebviewView, ProviderSettings } from "@roo-code/types"

// ── Panel UI ─────────────────────────────────────────────────────────────────

/**
 * Generates a random nonce string for use in Content-Security-Policy headers.
 */
function getNonce(): string {
	let text = ""
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length))
	}
	return text
}

/**
 * Registers the "Roo Plugin Demo" sidebar panel and wires it into the Roo
 * plugin message bus so every event (context, tokens, failures, agent messages)
 * is forwarded from the extension host to the webview automatically.
 */
class RooPluginPanelProvider implements vscode.WebviewViewProvider {
	public static readonly VIEW_ID = "roo-plugin-example.panel"
	private _view?: vscode.WebviewView

	constructor(
		private readonly _extensionUri: vscode.Uri,
		private readonly _handle: RooPluginHandle,
		private readonly _roo: RooCodeAPI,
	) {}

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

		// Hook this view into the Roo plugin panel message bus so that
		// handle.postMessageToPanel() / handle.onMessageFromPanel() work.
		// Cast required: vscode.WebviewView.postMessage returns Thenable<boolean>
		// while RooWebviewView expects Promise<boolean>; the runtime shape is compatible.
		const viewReg = this._handle.registerPanelView(webviewView as unknown as RooWebviewView)
		webviewView.onDidDispose(() => {
			viewReg.dispose()
			this._view = undefined
		})

		// Push initial snapshots so the panel isn't blank on open.
		this._handle.postMessageToPanel({ type: "contextUpdate", context: this._handle.getContext() })
		this._handle.postMessageToPanel({
			type: "profileUpdate",
			activeProfile: this._roo.getActiveProfile(),
			profiles: this._roo.getProfiles(),
		})
	}
}

// ── Webview HTML ──────────────────────────────────────────────────────────────

/**
 * Returns the HTML shell that loads the Vite-built React app from
 * `webview-ui/dist/`. The extension host converts the asset paths to
 * webview-safe URIs via `webview.asWebviewUri`.
 */
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

export function activate(context: vscode.ExtensionContext) {
	// ── 1. Obtain the Roo Code API ────────────────────────────────────────────
	const rooExt = vscode.extensions.getExtension<RooCodeAPI>("RooVeterinaryInc.roo-cline")

	if (!rooExt) {
		vscode.window.showWarningMessage("Roo Plugin Example: Roo Code extension not found.")
		return
	}

	// Roo Code is declared as a dependency, so it will already be active.
	const roo = rooExt.exports

	// ── 2. Register this plugin ───────────────────────────────────────────────
	const handle = roo.plugins.register({
		id: "example.roo-plugin-example",
		displayName: "Roo Plugin Example",
		description: "Demonstrates all plugin API features in a sidebar panel.",
	})
	context.subscriptions.push({ dispose: () => handle.dispose() })

	// ── 3. Create / refresh the demo configuration profile ───────────────────
	// upsertProfile creates the profile if it doesn't exist, or updates it if
	// it does — without switching away from whatever the user has active.
	const DEMO_PROFILE_NAME = "Roo Plugin Demo"
	const DEMO_PROFILE_SETTINGS: ProviderSettings = {
		apiProvider: "openai",
		openAiBaseUrl: "https://api.openai.com/v1",
		openAiModelId: "gpt-4o-mini",
	}
	roo.upsertProfile(DEMO_PROFILE_NAME, DEMO_PROFILE_SETTINGS, false).catch((err: unknown) => {
		console.error("[roo-plugin-example] Failed to upsert demo profile:", err)
	})

	// ── 4. Register custom tools ──────────────────────────────────────────────

	// Tool A: count words in a string.
	handle.registerTool({
		name: "word_count",
		description: "Count the number of words in a piece of text.",
		execute: async (args: unknown) => {
			const { text } = args as { text: string }
			if (typeof text !== "string") return "Error: `text` must be a string."
			const count = text.trim() === "" ? 0 : text.trim().split(/\s+/).length
			return `The text contains ${count} word${count === 1 ? "" : "s"}.`
		},
	})

	// Tool B: return the current date and time.
	handle.registerTool({
		name: "get_datetime",
		description: "Return the current date and time in ISO 8601 format.",
		execute: async () => new Date().toISOString(),
	})

	// ── 5. Output channel (logs extension-host activity) ─────────────────────
	const outputChannel = vscode.window.createOutputChannel("Roo Plugin Example")
	context.subscriptions.push(outputChannel)

	// ── 6. Status bar (secondary display; panel is the primary UI) ───────────
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	statusBar.tooltip = "Roo Code agent context — open the Roo Plugin Demo panel for details"
	context.subscriptions.push(statusBar)

	function updateStatusBar(ctx: RooTaskContext) {
		const task = ctx.taskId ? `task:${ctx.taskId.slice(0, 8)}` : "idle"
		statusBar.text = `$(robot) Roo [${ctx.mode}] ${task}`
		statusBar.show()
	}
	updateStatusBar(handle.getContext())

	// ── 7. Register the sidebar panel ────────────────────────────────────────
	const panelProvider = new RooPluginPanelProvider(context.extensionUri, handle, roo)
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(RooPluginPanelProvider.VIEW_ID, panelProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	// ── 8. Context subscription → status bar + panel ─────────────────────────
	handle.onContextChange((ctx) => {
		updateStatusBar(ctx)
		handle.postMessageToPanel({ type: "contextUpdate", context: ctx })
	})

	// ── 9. Token usage → panel ───────────────────────────────────────────────
	// onTokenUsageUpdated fires after each LLM request with live cumulative counts.
	handle.onTokenUsageUpdated((taskId, tokenUsage, toolUsage) => {
		const { totalTokensIn, totalTokensOut, totalCost } = tokenUsage
		outputChannel.appendLine(
			`[tokens] task=${taskId.slice(0, 8)} in=${totalTokensIn} out=${totalTokensOut} cost=$${totalCost.toFixed(4)}`,
		)
		// Update status bar cost and forward to panel.
		const ctx = handle.getContext()
		const task = ctx.taskId ? `task:${ctx.taskId.slice(0, 8)}` : "idle"
		statusBar.text = `$(robot) Roo [${ctx.mode}] ${task} · $${totalCost.toFixed(4)}`
		handle.postMessageToPanel({ type: "tokenUsage", taskId, tokenUsage, toolUsage })
	})

	// ── 10. Tool failures → notification + panel ─────────────────────────────
	// onToolFailed fires whenever a tool invocation fails inside the active task.
	handle.onToolFailed((taskId, toolName, errorMessage) => {
		outputChannel.appendLine(`[tool-failed] task=${taskId.slice(0, 8)} tool=${toolName}: ${errorMessage}`)
		vscode.window.showWarningMessage(`Roo: Tool "${toolName}" failed — ${errorMessage}`)
		handle.postMessageToPanel({ type: "toolFailed", taskId, toolName, errorMessage })
	})

	// ── 11. Agent messages → output channel + panel ──────────────────────────
	// onAgentMessage fires for every message the agent creates or updates.
	handle.onAgentMessage((taskId, action, message) => {
		if (message.type === "say" && message.say === "text" && !message.partial && message.text) {
			outputChannel.appendLine(`[agent] [${taskId.slice(0, 8)}] [${action}] ${message.text.slice(0, 120)}`)
		}
		handle.postMessageToPanel({ type: "agentMessage", taskId, action, message })
	})

	// ── 12. Panel → extension message handling ────────────────────────────────
	handle.onMessageFromPanel(async (rawMessage) => {
		outputChannel.appendLine(`[panel → ext] ${JSON.stringify(rawMessage)}`)
		const msg = rawMessage as { type: string; text?: string; ts?: number }

		if (msg.type === "sendToAgent") {
			const ctx = handle.getContext()
			if (!ctx.taskId) {
				handle.postMessageToPanel({ type: "error", text: "No active Roo task — start one first." })
			} else {
				await handle.sendMessageToAgent(msg.text ?? "")
			}
		} else if (msg.type === "pingExtension") {
			// Panel pinged the extension host — echo a pong back.
			outputChannel.appendLine("[panel → ext] ping — sending pong")
			handle.postMessageToPanel({
				type: "pongFromExtension",
				ts: msg.ts,
				roundTrip: Date.now() - (msg.ts ?? 0),
			})
		} else if (msg.type === "pong") {
			// Panel responded to our ping command.
			outputChannel.appendLine(`[panel → ext] pong — round-trip ${Date.now() - (msg.ts ?? 0)} ms`)
		} else if (msg.type === "upsertDemoProfile") {
			// Panel asked us to (re-)create the demo profile without activating it.
			outputChannel.appendLine(`[profile] upserting "${DEMO_PROFILE_NAME}"`)
			await roo.upsertProfile(DEMO_PROFILE_NAME, DEMO_PROFILE_SETTINGS, false)
			handle.postMessageToPanel({
				type: "profileUpdate",
				activeProfile: roo.getActiveProfile(),
				profiles: roo.getProfiles(),
			})
		} else if (msg.type === "activateDemoProfile") {
			// Panel asked us to switch Roo Code to the demo profile.
			outputChannel.appendLine(`[profile] activating "${DEMO_PROFILE_NAME}"`)
			await roo.setActiveProfile(DEMO_PROFILE_NAME)
			handle.postMessageToPanel({
				type: "profileUpdate",
				activeProfile: roo.getActiveProfile(),
				profiles: roo.getProfiles(),
			})
			vscode.window.showInformationMessage(`Roo: switched to profile "${DEMO_PROFILE_NAME}"`)
		}
	})

	// ── 13. Commands ──────────────────────────────────────────────────────────

	// Ping the panel from the extension host (demonstrates ext → panel direction).
	context.subscriptions.push(
		vscode.commands.registerCommand("roo-plugin-example.pingPanel", async () => {
			await handle.postMessageToPanel({ type: "pingFromExtension", ts: Date.now() })
			outputChannel.appendLine("[ext → panel] sent ping")
			outputChannel.show(true)
		}),
	)

	// Ask agent for date/time (also available as a quick button inside the panel).
	context.subscriptions.push(
		vscode.commands.registerCommand("roo-plugin-example.askDateTime", async () => {
			const ctx = handle.getContext()
			if (!ctx.taskId) {
				vscode.window.showInformationMessage("No active Roo task. Start a task first.")
				return
			}
			await handle.sendMessageToAgent("What is the current date and time?")
		}),
	)

	// Activate the demo profile from the Command Palette.
	context.subscriptions.push(
		vscode.commands.registerCommand("roo-plugin-example.activateDemoProfile", async () => {
			await roo.setActiveProfile(DEMO_PROFILE_NAME)
			handle.postMessageToPanel({
				type: "profileUpdate",
				activeProfile: roo.getActiveProfile(),
				profiles: roo.getProfiles(),
			})
			vscode.window.showInformationMessage(`Roo: switched to profile "${DEMO_PROFILE_NAME}"`)
		}),
	)

	vscode.window.showInformationMessage(
		"Roo Plugin Example activated — open the 'Roo Plugin Demo' panel in the Roo sidebar.",
	)
}

export function deactivate() {
	console.log("Roo Plugin Example deactivated")
}
