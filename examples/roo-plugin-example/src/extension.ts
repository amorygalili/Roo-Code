/**
 * Roo Plugin Example
 *
 * Demonstrates all plugin API features in a sidebar panel UI:
 *   1. Tool registration    – adds `word_count` and `get_datetime` tools the agent can call
 *   2. Context subscription – live mode / task / file info shown in the panel and status bar
 *   3. Token usage tracking – cumulative token counts and cost displayed in the panel
 *   4. Tool failure alerts  – failed tool invocations logged in the panel
 *   5. Agent message stream – live assistant transcript shown in the panel
 *   6. Panel message bus    – bidirectional ping/pong between the panel and extension host
 *   7. Agent messaging      – panel textarea sends messages directly to the active task
 */

import * as vscode from "vscode"

// The Roo Code extension's public export shape.
// In a real plugin you would import from "@roo-code/types" once it is published.
interface TokenUsage {
	totalTokensIn: number
	totalTokensOut: number
	totalCacheWrites?: number
	totalCacheReads?: number
	totalCost: number
	contextTokens: number
}

type ToolUsage = Record<string, { attempts: number; failures: number }>

interface RooTaskContext {
	taskId: string | undefined
	mode: string
	workspaceFolders: string[]
	openFiles: string[]
	tokenUsage?: TokenUsage
	toolUsage?: ToolUsage
}

interface ClineMessage {
	ts: number
	type: "ask" | "say"
	say?: string
	ask?: string
	text?: string
	partial?: boolean
}

interface RooWebview {
	postMessage(message: unknown): Thenable<boolean>
	onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): void }
}

interface RooWebviewView {
	readonly webview: RooWebview
}

interface RooPluginHandle {
	getContext(): RooTaskContext
	onContextChange(listener: (ctx: RooTaskContext) => void): { dispose(): void }
	onTokenUsageUpdated(listener: (taskId: string, tokenUsage: TokenUsage, toolUsage: ToolUsage) => void): {
		dispose(): void
	}
	onToolFailed(listener: (taskId: string, toolName: string, errorMessage: string) => void): { dispose(): void }
	onAgentMessage(listener: (taskId: string, action: "created" | "updated", message: ClineMessage) => void): {
		dispose(): void
	}
	registerPanelView(view: RooWebviewView): { dispose(): void }
	postMessageToPanel(message: unknown): Promise<void>
	onMessageFromPanel(listener: (message: unknown) => void): { dispose(): void }
	sendMessageToAgent(message: string): Promise<void>
	registerTool(def: {
		name: string
		description: string
		parameters?: unknown
		execute(args: unknown): Promise<string>
	}): { dispose(): void }
	dispose(): void
}

interface RooCodeAPI {
	plugins: {
		register(manifest: { id: string; displayName: string; description?: string }): RooPluginHandle
	}
}

// ── Panel UI ─────────────────────────────────────────────────────────────────

/**
 * Registers the "Roo Plugin Demo" sidebar panel and wires it into the Roo
 * plugin message bus so every event (context, tokens, failures, agent messages)
 * is forwarded from the extension host to the webview automatically.
 */
class RooPluginPanelProvider implements vscode.WebviewViewProvider {
	public static readonly VIEW_ID = "roo-plugin-example.panel"
	private _view?: vscode.WebviewView

	constructor(
		private readonly _handle: RooPluginHandle,
		private readonly _outputChannel: vscode.OutputChannel,
	) {}

	resolveWebviewView(
		webviewView: vscode.WebviewView,
		_ctx: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	) {
		this._view = webviewView
		webviewView.webview.options = { enableScripts: true }
		webviewView.webview.html = getWebviewContent()

		// Hook this view into the Roo plugin panel message bus so that
		// handle.postMessageToPanel() / handle.onMessageFromPanel() work.
		const viewReg = this._handle.registerPanelView(webviewView)
		webviewView.onDidDispose(() => {
			viewReg.dispose()
			this._view = undefined
		})

		// Push a context snapshot immediately so the panel isn't blank on open.
		this._handle.postMessageToPanel({ type: "contextUpdate", context: this._handle.getContext() })
	}
}

// ── Webview HTML ──────────────────────────────────────────────────────────────

function getWebviewContent(): string {
	return /* html */ `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Roo Plugin Demo</title><style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-sideBar-background,var(--vscode-editor-background));padding:0 8px 16px;margin:0}
section{margin-bottom:12px}
h3{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--vscode-sideBarSectionHeader-foreground,var(--vscode-foreground));border-bottom:1px solid var(--vscode-panel-border,#333);padding-bottom:4px;margin:12px 0 6px}
.kv{display:flex;gap:8px;margin-bottom:3px;font-size:12px}
.key{color:var(--vscode-descriptionForeground);min-width:70px;flex-shrink:0}
.pill{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;background:var(--vscode-statusBarItem-remoteBackground,#007acc);color:var(--vscode-statusBarItem-remoteForeground,#fff)}
#messageLog,#failureLog{max-height:120px;overflow-y:auto;background:var(--vscode-input-background);border:1px solid var(--vscode-input-border,#333);border-radius:3px;padding:4px 6px;font-size:11px;font-family:var(--vscode-editor-font-family,monospace);margin-bottom:4px}
.msg-line{margin-bottom:2px;line-height:1.4;color:var(--vscode-charts-blue,#4fc3f7);word-break:break-word}
.failure-line{color:var(--vscode-errorForeground,#f44);margin-bottom:2px;word-break:break-word}
.dim{color:var(--vscode-descriptionForeground);font-style:italic}
textarea{width:100%;height:52px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,#555);border-radius:3px;padding:4px;font-family:inherit;font-size:inherit;resize:vertical;box-sizing:border-box}
textarea:focus{outline:1px solid var(--vscode-focusBorder);border-color:var(--vscode-focusBorder)}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;padding:4px 10px;font-size:12px;cursor:pointer;margin-right:6px;margin-top:4px}
button:hover{background:var(--vscode-button-hoverBackground)}
button.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
button.sec:hover{background:var(--vscode-button-secondaryHoverBackground)}
#pingStatus,#sendStatus{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px}
</style></head>
<body>
<section>
  <h3>Context</h3>
  <div class="kv"><span class="key">Mode</span><span><span id="modeVal" class="pill">–</span></span></div>
  <div class="kv"><span class="key">Task</span><span id="taskVal">idle</span></div>
  <div class="kv"><span class="key">Workspace</span><span id="wsVal" class="dim">–</span></div>
  <div class="kv"><span class="key">Open Files</span><span id="filesVal" class="dim">–</span></div>
</section>
<section>
  <h3>Token Usage</h3>
  <div class="kv"><span class="key">Tokens In</span><span id="tokensIn">0</span></div>
  <div class="kv"><span class="key">Tokens Out</span><span id="tokensOut">0</span></div>
  <div class="kv"><span class="key">Cost</span>$<span id="cost">0.0000</span></div>
  <div class="kv"><span class="key">Context</span><span id="ctxTokens">0</span> tokens</div>
</section>
<section>
  <h3>Tool Failures</h3>
  <div id="failureLog"><span class="dim">None yet.</span></div>
</section>
<section>
  <h3>Agent Messages</h3>
  <div id="messageLog"><span class="dim">Waiting for messages…</span></div>
  <button class="sec" id="clearBtn">Clear</button>
</section>
<section>
  <h3>Send to Agent</h3>
  <textarea id="msgInput" placeholder="Type a message… (Ctrl+Enter to send)"></textarea>
  <div>
    <button id="sendBtn">Send</button>
    <button class="sec" id="dateTimeBtn">Ask Date &amp; Time</button>
  </div>
  <div id="sendStatus"></div>
</section>
<section>
  <h3>Panel Message Bus</h3>
  <button id="pingBtn">Ping Extension Host</button>
  <div id="pingStatus" class="dim">–</div>
</section>
<script>
const vscode = acquireVsCodeApi();
const $ = id => document.getElementById(id);

window.addEventListener('message', e => {
  const m = e.data;
  if (m.type === 'contextUpdate') {
    $('modeVal').textContent = m.context.mode || '–';
    $('taskVal').textContent = m.context.taskId ? m.context.taskId.slice(0, 12) + '…' : 'idle';
    $('wsVal').textContent = (m.context.workspaceFolders ?? []).map(p => p.split(/[\\/]/).pop()).join(', ') || '–';
    $('filesVal').textContent = (m.context.openFiles ?? []).map(p => p.split(/[\\/]/).pop()).join(', ') || 'none';
  } else if (m.type === 'tokenUsage' && m.tokenUsage) {
    $('tokensIn').textContent = m.tokenUsage.totalTokensIn.toLocaleString();
    $('tokensOut').textContent = m.tokenUsage.totalTokensOut.toLocaleString();
    $('cost').textContent = m.tokenUsage.totalCost.toFixed(4);
    $('ctxTokens').textContent = m.tokenUsage.contextTokens.toLocaleString();
  } else if (m.type === 'toolFailed') {
    $('failureLog').querySelector('.dim')?.remove();
    const el = document.createElement('div'); el.className = 'failure-line';
    el.textContent = '✗ ' + m.toolName + ': ' + m.errorMessage; $('failureLog').appendChild(el);
  } else if (m.type === 'agentMessage' && m.message.type === 'say' && m.message.say === 'text' && !m.message.partial && m.message.text) {
    $('messageLog').querySelector('.dim')?.remove();
    const el = document.createElement('div'); el.className = 'msg-line';
    el.textContent = '[' + m.action + '] ' + m.message.text.slice(0, 200);
    const log = $('messageLog'); log.appendChild(el); log.scrollTop = log.scrollHeight;
  } else if (m.type === 'pingFromExtension') {
    $('pingStatus').textContent = '📨 Ping from extension host (' + (Date.now() - m.ts) + ' ms) — sending pong…';
    vscode.postMessage({ type: 'pong', ts: m.ts });
  } else if (m.type === 'pongFromExtension') {
    $('pingStatus').textContent = '🏓 Pong from extension host — round-trip ' + m.roundTrip + ' ms';
  } else if (m.type === 'error') {
    $('sendStatus').textContent = '⚠ ' + m.text;
    setTimeout(() => { $('sendStatus').textContent = ''; }, 4000);
  }
});

$('sendBtn').addEventListener('click', () => {
  const text = $('msgInput').value.trim(); if (!text) return;
  vscode.postMessage({ type: 'sendToAgent', text }); $('msgInput').value = '';
  $('sendStatus').textContent = '✓ Sent'; setTimeout(() => { $('sendStatus').textContent = ''; }, 2000);
});
$('msgInput').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('sendBtn').click(); });
$('dateTimeBtn').addEventListener('click', () => {
  vscode.postMessage({ type: 'sendToAgent', text: 'What is the current date and time?' });
  $('sendStatus').textContent = '✓ Sent'; setTimeout(() => { $('sendStatus').textContent = ''; }, 2000);
});
$('clearBtn').addEventListener('click', () => { $('messageLog').innerHTML = ''; });
$('pingBtn').addEventListener('click', () => {
  vscode.postMessage({ type: 'pingExtension', ts: Date.now() });
  $('pingStatus').textContent = '⏳ Waiting for pong…';
});
</script>
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

	// ── 3. Register custom tools ──────────────────────────────────────────────

	// Tool A: count words in a string.
	context.subscriptions.push(
		handle.registerTool({
			name: "word_count",
			description: "Count the number of words in a piece of text.",
			execute: async (args: unknown) => {
				const { text } = args as { text: string }
				if (typeof text !== "string") return "Error: `text` must be a string."
				const count = text.trim() === "" ? 0 : text.trim().split(/\s+/).length
				return `The text contains ${count} word${count === 1 ? "" : "s"}.`
			},
		}),
	)

	// Tool B: return the current date and time.
	context.subscriptions.push(
		handle.registerTool({
			name: "get_datetime",
			description: "Return the current date and time in ISO 8601 format.",
			execute: async () => new Date().toISOString(),
		}),
	)

	// ── 4. Output channel (logs extension-host activity) ─────────────────────
	const outputChannel = vscode.window.createOutputChannel("Roo Plugin Example")
	context.subscriptions.push(outputChannel)

	// ── 5. Status bar (secondary display; panel is the primary UI) ───────────
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	statusBar.tooltip = "Roo Code agent context — open the Roo Plugin Demo panel for details"
	context.subscriptions.push(statusBar)

	function updateStatusBar(ctx: RooTaskContext) {
		const task = ctx.taskId ? `task:${ctx.taskId.slice(0, 8)}` : "idle"
		statusBar.text = `$(robot) Roo [${ctx.mode}] ${task}`
		statusBar.show()
	}
	updateStatusBar(handle.getContext())

	// ── 6. Register the sidebar panel ────────────────────────────────────────
	const panelProvider = new RooPluginPanelProvider(handle, outputChannel)
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(RooPluginPanelProvider.VIEW_ID, panelProvider, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	)

	// ── 7. Context subscription → status bar + panel ─────────────────────────
	context.subscriptions.push(
		handle.onContextChange((ctx) => {
			updateStatusBar(ctx)
			handle.postMessageToPanel({ type: "contextUpdate", context: ctx })
		}),
	)

	// ── 8. Token usage → panel ───────────────────────────────────────────────
	// onTokenUsageUpdated fires after each LLM request with live cumulative counts.
	context.subscriptions.push(
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
		}),
	)

	// ── 9. Tool failures → notification + panel ──────────────────────────────
	// onToolFailed fires whenever a tool invocation fails inside the active task.
	context.subscriptions.push(
		handle.onToolFailed((taskId, toolName, errorMessage) => {
			outputChannel.appendLine(`[tool-failed] task=${taskId.slice(0, 8)} tool=${toolName}: ${errorMessage}`)
			vscode.window.showWarningMessage(`Roo: Tool "${toolName}" failed — ${errorMessage}`)
			handle.postMessageToPanel({ type: "toolFailed", taskId, toolName, errorMessage })
		}),
	)

	// ── 10. Agent messages → output channel + panel ──────────────────────────
	// onAgentMessage fires for every message the agent creates or updates.
	context.subscriptions.push(
		handle.onAgentMessage((taskId, action, message) => {
			if (message.type === "say" && message.say === "text" && !message.partial && message.text) {
				outputChannel.appendLine(`[agent] [${taskId.slice(0, 8)}] [${action}] ${message.text.slice(0, 120)}`)
			}
			handle.postMessageToPanel({ type: "agentMessage", taskId, action, message })
		}),
	)

	// ── 11. Panel → extension message handling ────────────────────────────────
	context.subscriptions.push(
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
			}
		}),
	)

	// ── 12. Commands ──────────────────────────────────────────────────────────

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

	vscode.window.showInformationMessage(
		"Roo Plugin Example activated — open the 'Roo Plugin Demo' panel in the Roo sidebar.",
	)
}

export function deactivate() {
	// VS Code disposes context.subscriptions automatically;
	// handle.dispose() above cleans up all tools and listeners.
}
