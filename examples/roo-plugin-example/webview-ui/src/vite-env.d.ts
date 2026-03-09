/// <reference types="vite/client" />

/**
 * VS Code WebView API injected at runtime by the extension host.
 * Available only inside a VS Code webview context.
 */
declare function acquireVsCodeApi(): {
	postMessage(message: unknown): void
	getState<T = unknown>(): T | undefined
	setState<T = unknown>(state: T): void
}
