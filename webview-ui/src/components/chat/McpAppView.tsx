import { useCallback, useEffect, useMemo, useRef, memo } from "react"
import { useEvent } from "react-use"
import type { ExtensionMessage } from "@roo-code/types"

import { vscode } from "@src/utils/vscode"

/** Props carrying the MCP App data sent by the extension via `mcpAppHtml`. */
export interface McpAppViewProps {
	executionId: string
	serverName: string
	toolName: string
	html: string
	toolArguments: Record<string, unknown>
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	toolResult: any
}

/** Pending JSON-RPC request awaiting a proxied response from the extension. */
type PendingResolver = (payload: { result?: unknown; error?: string }) => void

/**
 * Renders a sandboxed iframe that hosts an MCP App (SEP-1865 interactive UI).
 *
 * Architecture
 * ────────────
 * 1. The iframe receives the server's HTML via `srcdoc` (sandbox="allow-scripts").
 * 2. The iframe communicates with this component via `window.postMessage`.
 * 3. Requests that need MCP server access (tools/call, resources/read) are
 *    forwarded to the VS Code extension via `vscode.postMessage`, then the
 *    extension posts `mcpAppProxyResult` back to the webview.
 * 4. We route proxy results to the waiting iframe by matching `requestId`.
 */
const McpAppViewInternal = ({
	executionId,
	serverName,
	toolName,
	html,
	toolArguments,
	toolResult,
}: McpAppViewProps) => {
	const iframeRef = useRef<HTMLIFrameElement>(null)
	// Map of requestId → resolver for pending proxied MCP calls
	const pendingRef = useRef<Map<string, PendingResolver>>(new Map())
	const initializedRef = useRef(false)

	// Inject the parent webview's CSP nonce into every <script> element so that
	// VS Code's strict 'strict-dynamic' policy allows them to execute.  The
	// srcdoc iframe inherits the parent page's Content-Security-Policy, which
	// blocks inline scripts unless they carry the correct nonce.  The nonce is
	// exposed as window.WEBVIEW_NONCE by the extension host at startup.
	//
	// We use DOMParser rather than a regex so that only real <script> elements
	// receive the nonce.  A regex would also match occurrences of "<script>"
	// inside JavaScript string literals (e.g. in bundled app code), which can
	// inject the nonce inside a JS string and produce a SyntaxError at runtime.
	const processedHtml = useMemo(() => {
		const nonce = (window as Window & { WEBVIEW_NONCE?: string }).WEBVIEW_NONCE
		if (!nonce) return html
		const parser = new DOMParser()
		const doc = parser.parseFromString(html, "text/html")
		doc.querySelectorAll("script").forEach((script) => {
			if (!script.hasAttribute("nonce")) {
				script.setAttribute("nonce", nonce)
			}
		})
		return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML
	}, [html])

	// ── Helper: send a JSON-RPC message into the iframe ──────────────────────
	const sendToIframe = useCallback((msg: unknown) => {
		iframeRef.current?.contentWindow?.postMessage(msg, "*")
	}, [])

	// ── Route proxy results from the extension back to the iframe ────────────
	const onExtensionMessage = useCallback(
		(event: MessageEvent) => {
			const msg = event.data as ExtensionMessage
			if (msg.type !== "mcpAppProxyResult" || !msg.values) return

			const { requestId, result, error } = msg.values as {
				requestId: string
				result?: unknown
				error?: string
			}

			const resolver = pendingRef.current.get(requestId)
			if (resolver) {
				pendingRef.current.delete(requestId)
				resolver({ result, error })
			}
		},
		[], // stable – uses a ref
	)
	useEvent("message", onExtensionMessage)

	// ── Handle messages that originate from the sandboxed iframe ─────────────
	useEffect(() => {
		const handleIframeMessage = (event: MessageEvent) => {
			// Accept only messages from our specific iframe
			if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return
			const msg = event.data
			if (!msg?.jsonrpc) return

			const { method, id, params } = msg as {
				method: string
				id?: string | number
				params?: Record<string, unknown>
			}

			switch (method) {
				// ── Handshake ────────────────────────────────────────────────
				case "ui/initialize": {
					sendToIframe({
						jsonrpc: "2.0",
						id,
						result: {
							protocolVersion: "2026-01-26",
							hostCapabilities: {
								serverTools: {},
								serverResources: {},
								openLinks: {},
							},
							hostInfo: { name: "Roo Code", version: "1.0.0" },
							hostContext: {
								theme: document.body.classList.contains("vscode-dark") ? "dark" : "light",
								displayMode: "inline",
								containerDimensions: { maxWidth: 800, maxHeight: 600 },
							},
						},
					})
					break
				}

				case "ui/notifications/initialized": {
					if (initializedRef.current) break
					initializedRef.current = true
					// Send tool arguments first, then the result
					sendToIframe({
						jsonrpc: "2.0",
						method: "ui/notifications/tool-input",
						params: { arguments: toolArguments },
					})
					if (toolResult) {
						sendToIframe({
							jsonrpc: "2.0",
							method: "ui/notifications/tool-result",
							params: toolResult,
						})
					}
					break
				}

				// ── Proxy tool call to MCP server ────────────────────────────
				case "tools/call": {
					const requestId = `${executionId}-${id}`
					pendingRef.current.set(requestId, ({ result, error }) => {
						if (error) {
							sendToIframe({ jsonrpc: "2.0", id, error: { code: -32000, message: error } })
						} else {
							sendToIframe({ jsonrpc: "2.0", id, result })
						}
					})
					vscode.postMessage({
						type: "mcpAppProxyToolCall",
						values: {
							requestId,
							serverName,
							toolName: (params as { name?: string })?.name ?? "",
							toolArguments: (params as { arguments?: Record<string, unknown> })?.arguments,
						},
					})
					break
				}

				// ── Proxy resource read to MCP server ────────────────────────
				case "resources/read": {
					const requestId = `${executionId}-${id}`
					pendingRef.current.set(requestId, ({ result, error }) => {
						if (error) {
							sendToIframe({ jsonrpc: "2.0", id, error: { code: -32000, message: error } })
						} else {
							sendToIframe({ jsonrpc: "2.0", id, result })
						}
					})
					vscode.postMessage({
						type: "mcpAppProxyResourceRead",
						values: { requestId, serverName, uri: (params as { uri?: string })?.uri ?? "" },
					})
					break
				}

				// ── Open an external URL ─────────────────────────────────────
				case "ui/open-link": {
					const url = (params as { url?: string })?.url
					if (url) {
						vscode.postMessage({ type: "openExternal", url })
					}
					sendToIframe({ jsonrpc: "2.0", id, result: {} })
					break
				}

				// ── App→Chat message ─────────────────────────────────────────
				case "ui/message": {
					const text = ((params as { content?: { text?: string } })?.content?.text ?? "").trim()
					if (text) {
						vscode.postMessage({ type: "mcpAppSendMessage", values: { text } })
					}
					sendToIframe({ jsonrpc: "2.0", id, result: {} })
					break
				}

				// ── Dynamic resize ───────────────────────────────────────────
				case "ui/notifications/size-changed": {
					const { width, height } = (params ?? {}) as { width?: number; height?: number }
					if (iframeRef.current) {
						if (height) iframeRef.current.style.height = `${height}px`
						if (width) iframeRef.current.style.width = `${width}px`
					}
					break
				}

				default:
					break
			}
		}

		window.addEventListener("message", handleIframeMessage)
		return () => {
			// Notify the iframe that we're tearing it down
			sendToIframe({
				jsonrpc: "2.0",
				id: Date.now(),
				method: "ui/resource-teardown",
				params: { reason: "unmount" },
			})
			window.removeEventListener("message", handleIframeMessage)
		}
	}, [executionId, serverName, sendToIframe, toolArguments, toolResult])

	return (
		<iframe
			ref={iframeRef}
			srcDoc={processedHtml}
			sandbox="allow-scripts"
			style={{
				width: "100%",
				minHeight: 200,
				border: "none",
				borderRadius: 4,
				display: "block",
			}}
			title={`MCP App: ${toolName}`}
		/>
	)
}

McpAppViewInternal.displayName = "McpAppView"
export const McpAppView = memo(McpAppViewInternal)
