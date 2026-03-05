/**
 * Roo Plugin Example
 *
 * Demonstrates the three main plugin API features:
 *   1. Tool registration   – adds a `word_count` and `get_datetime` tool
 *   2. Context subscription – reflects the live agent state in a status bar item
 *   3. Agent messaging      – sends a message to the active task via a VS Code command
 */

import * as vscode from "vscode"

// The Roo Code extension's public export shape.
// In a real plugin you would import from "@roo-code/types" once it is published.
interface RooTaskContext {
	taskId: string | undefined
	mode: string
	workspaceFolders: string[]
	openFiles: string[]
}

interface RooPluginHandle {
	getContext(): RooTaskContext
	onContextChange(listener: (ctx: RooTaskContext) => void): { dispose(): void }
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
		description: "Demonstrates tool registration, context subscription, and agent messaging.",
	})

	// Dispose the handle when this extension deactivates.
	context.subscriptions.push({ dispose: () => handle.dispose() })

	// ── 3. Register custom tools ──────────────────────────────────────────────

	// Tool A: count words in a string.
	const wordCountTool = handle.registerTool({
		name: "word_count",
		description: "Count the number of words in a piece of text.",
		execute: async (args: unknown) => {
			const { text } = args as { text: string }
			if (typeof text !== "string") {
				return "Error: `text` must be a string."
			}
			const count = text.trim() === "" ? 0 : text.trim().split(/\s+/).length
			return `The text contains ${count} word${count === 1 ? "" : "s"}.`
		},
	})
	context.subscriptions.push(wordCountTool)

	// Tool B: return the current date and time.
	const datetimeTool = handle.registerTool({
		name: "get_datetime",
		description: "Return the current date and time in ISO 8601 format.",
		execute: async () => new Date().toISOString(),
	})
	context.subscriptions.push(datetimeTool)

	// ── 4. Context subscription → status bar item ─────────────────────────────
	const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100)
	statusBar.tooltip = "Roo Code agent context (provided by roo-plugin-example)"
	context.subscriptions.push(statusBar)

	function updateStatusBar(ctx: RooTaskContext) {
		const task = ctx.taskId ? `task:${ctx.taskId.slice(0, 8)}` : "idle"
		statusBar.text = `$(robot) Roo [${ctx.mode}] ${task}`
		statusBar.show()
	}

	// Show the current state immediately…
	updateStatusBar(handle.getContext())

	// …and update whenever the agent state changes.
	const contextSub = handle.onContextChange(updateStatusBar)
	context.subscriptions.push(contextSub)

	// ── 5. Command: send a message to the active task ─────────────────────────
	const cmd = vscode.commands.registerCommand("roo-plugin-example.askDateTime", async () => {
		const ctx = handle.getContext()

		if (!ctx.taskId) {
			vscode.window.showInformationMessage("No active Roo task. Start a task first.")
			return
		}

		await handle.sendMessageToAgent("What is the current date and time?")
	})
	context.subscriptions.push(cmd)

	vscode.window.showInformationMessage("Roo Plugin Example activated — tools and status bar are live.")
}

export function deactivate() {
	// VS Code disposes context.subscriptions automatically;
	// the handle.dispose() call above cleans up tools and listeners.
}
