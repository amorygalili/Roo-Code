import * as vscode from "vscode"

import type { RooPluginManifest, RooPluginService } from "@roo-code/types"

/**
 * Shape of the `contributes["roo-code"]` field in a plugin's package.json.
 * We deliberately keep the type loose so that forward-compatible fields don't
 * cause validation failures.
 */
interface RooContributes {
	id?: string
	displayName?: string
	description?: string
}

/**
 * Scan all installed VS Code extensions for a `contributes["roo-code"]` field
 * and register them with the Roo Code plugin service.
 *
 * This is intentionally fire-and-forget: individual plugin failures are logged
 * but never bubble up to abort the activation sequence.
 *
 * @param pluginService - The `RooPluginService` instance from the active API.
 * @param outputChannel - For diagnostic messages.
 */
export function discoverPlugins(
	pluginService: RooPluginService,
	outputChannel: vscode.OutputChannel,
): vscode.Disposable {
	const tag = "[PluginDiscovery]"

	function tryRegisterExtension(extension: vscode.Extension<unknown>): void {
		const rooContrib: RooContributes | undefined = extension.packageJSON?.contributes?.["roo-code"]

		if (!rooContrib) {
			return
		}

		// The plugin ID defaults to the VS Code extension identifier.
		const id = rooContrib.id ?? extension.id

		// Skip if already registered (e.g. hot-reload scenarios).
		const alreadyRegistered = pluginService.getRegisteredPlugins().some((p) => p.id === id)
		if (alreadyRegistered) {
			return
		}

		const manifest: RooPluginManifest = {
			id,
			displayName: rooContrib.displayName ?? extension.packageJSON?.displayName ?? id,
			description: rooContrib.description ?? extension.packageJSON?.description,
		}

		try {
			pluginService.register(manifest)
			outputChannel.appendLine(`${tag} registered plugin: ${id} ("${manifest.displayName}")`)
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			outputChannel.appendLine(`${tag} failed to register plugin ${id}: ${message}`)
		}
	}

	// Scan extensions that are already active at this point.
	for (const ext of vscode.extensions.all) {
		tryRegisterExtension(ext)
	}

	// Watch for extensions that activate later (e.g. lazy-activated plugins).
	const watcher = vscode.extensions.onDidChange(() => {
		for (const ext of vscode.extensions.all) {
			tryRegisterExtension(ext)
		}
	})

	return watcher
}
