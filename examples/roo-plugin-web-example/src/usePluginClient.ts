import { useState, useRef, useCallback } from "react"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentTaskContext {
	taskId?: string
	mode: string
	workspaceFolders: string[]
	openFiles: string[]
}

export interface AgentTokenUsage {
	tokensIn: number
	tokensOut: number
	cost: number
}

export interface AgentMessageEntry {
	id: string
	taskId: string
	text: string
	ts: number
}

export interface ToolFailureEntry {
	id: string
	taskId: string
	toolName: string
	errorMessage: string
	ts: number
}

interface Pending {
	resolve: (v: unknown) => void
	reject: (e: Error) => void
	timer: ReturnType<typeof setTimeout>
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const DEFAULT_CTX: AgentTaskContext = { taskId: undefined, mode: "code", workspaceFolders: [], openFiles: [] }

export function usePluginClient() {
	const wsRef = useRef<WebSocket | null>(null)
	const sendRef = useRef<((s: string) => void) | null>(null)
	const pendingRef = useRef(new Map<string, Pending>())
	const toolsRef = useRef(new Map<string, (a: unknown) => Promise<string>>())

	const [isConnected, setIsConnected] = useState(false)
	const [connectionError, setConnectionError] = useState<string | null>(null)
	const [context, setContext] = useState<AgentTaskContext>(DEFAULT_CTX)
	const [tokenUsage, setTokenUsage] = useState<AgentTokenUsage | null>(null)
	const [agentMessages, setAgentMessages] = useState<AgentMessageEntry[]>([])
	const [toolFailures, setToolFailures] = useState<ToolFailureEntry[]>([])
	const [profiles, setProfiles] = useState<string[]>([])
	const [activeProfile, setActiveProfile] = useState<string | undefined>(undefined)

	// ── Request helper ─────────────────────────────────────────────────────────

	const request = useCallback(<T>(body: Record<string, unknown>): Promise<T> => {
		return new Promise<T>((resolve, reject) => {
			if (!sendRef.current) {
				reject(new Error("Not connected"))
				return
			}
			const id = crypto.randomUUID()
			const timer = setTimeout(() => {
				pendingRef.current.delete(id)
				reject(new Error(`Timeout: ${body.type as string}`))
			}, 30_000)
			pendingRef.current.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
			sendRef.current(JSON.stringify({ requestId: id, ...body }))
		})
	}, [])

	// ── Message handler ────────────────────────────────────────────────────────

	const onMessage = useCallback((raw: string) => {
		let data: Record<string, unknown>
		try {
			data = JSON.parse(raw) as Record<string, unknown>
		} catch {
			return
		}
		const t = data.type as string

		if (t === "response" || t === "error") {
			const p = pendingRef.current.get(data.requestId as string)
			if (p) {
				clearTimeout(p.timer)
				pendingRef.current.delete(data.requestId as string)
				if (t === "response") {
					p.resolve(data.result)
				} else {
					p.reject(new Error(data.error as string))
				}
			}
			return
		}

		switch (t) {
			case "contextChange":
				setContext(data.context as AgentTaskContext)
				break
			case "tokenUsageUpdated":
				setTokenUsage(data.usage as AgentTokenUsage)
				break
			case "agentMessage": {
				const m = data.message as { type: string; say?: string; text?: string; partial?: boolean }
				if (m.type === "say" && m.say === "text" && !m.partial && m.text)
					setAgentMessages((prev) => [
						...prev,
						{ id: crypto.randomUUID(), taskId: data.taskId as string, text: m.text!, ts: Date.now() },
					])
				break
			}
			case "toolCallFailed":
				setToolFailures((prev) => [
					...prev,
					{
						id: crypto.randomUUID(),
						taskId: data.taskId as string,
						toolName: data.toolName as string,
						errorMessage: data.errorMessage as string,
						ts: Date.now(),
					},
				])
				break
			case "toolCall": {
				const { callId, toolName, args } = data as { callId: string; toolName: string; args: unknown }
				const exec = toolsRef.current.get(toolName)
				void (async () => {
					let result: string | undefined, error: string | undefined
					try {
						if (!exec) {
							error = `Tool not found: ${toolName}`
							return
						}
						result = await exec(args)
					} catch (e) {
						error = e instanceof Error ? e.message : String(e)
					}
					sendRef.current?.(
						JSON.stringify({ requestId: crypto.randomUUID(), type: "toolResult", callId, result, error }),
					)
				})()
				break
			}
		}
	}, [])

	// ── Connect ────────────────────────────────────────────────────────────────

	const connect = useCallback(
		(url: string) => {
			wsRef.current?.close()
			sendRef.current = null
			setConnectionError(null)
			setIsConnected(false)
			setContext(DEFAULT_CTX)
			setTokenUsage(null)
			setAgentMessages([])
			setToolFailures([])
			setProfiles([])
			setActiveProfile(undefined)

			const ws = new WebSocket(url)
			wsRef.current = ws

			ws.onopen = () => {
				sendRef.current = (s) => ws.send(s)
				setIsConnected(true)
				// Register built-in tools locally
				toolsRef.current.set("word_count", async (a) => {
					const { text } = a as { text: string }
					if (typeof text !== "string") return "Error: `text` must be a string."
					const n = text.trim() === "" ? 0 : text.trim().split(/\s+/).length
					return `The text contains ${n} word${n === 1 ? "" : "s"}.`
				})
				toolsRef.current.set("get_datetime", async () => new Date().toISOString())
				// Register with server
				const send = sendRef.current
				send(
					JSON.stringify({
						requestId: crypto.randomUUID(),
						type: "registerTool",
						definition: {
							name: "word_count",
							description: "Count words in text.",
							parameters: {
								type: "object",
								properties: { text: { type: "string" } },
								required: ["text"],
							},
						},
					}),
				)
				send(
					JSON.stringify({
						requestId: crypto.randomUUID(),
						type: "registerTool",
						definition: { name: "get_datetime", description: "Return current ISO 8601 datetime." },
					}),
				)
				// Fetch initial profiles
				void Promise.all([
					request<string | undefined>({ type: "getActiveProfile" }),
					request<string[]>({ type: "getProfiles" }),
				])
					.then(([ap, ps]) => {
						setActiveProfile(ap)
						setProfiles(ps)
					})
					.catch(() => {
						/* best-effort */
					})
			}
			ws.onerror = () =>
				setConnectionError(`Cannot connect to ${url}. Is Roo Code running with the plugin server enabled?`)
			ws.onmessage = (e) => onMessage(e.data as string)
			ws.onclose = () => {
				sendRef.current = null
				setIsConnected(false)
				for (const [id, p] of pendingRef.current) {
					clearTimeout(p.timer)
					p.reject(new Error("Connection closed"))
					pendingRef.current.delete(id)
				}
			}
		},
		[request, onMessage],
	)

	const disconnect = useCallback(() => {
		wsRef.current?.close()
		wsRef.current = null
	}, [])

	const fetchProfiles = useCallback(async () => {
		const [ap, ps] = await Promise.all([
			request<string | undefined>({ type: "getActiveProfile" }),
			request<string[]>({ type: "getProfiles" }),
		])
		setActiveProfile(ap)
		setProfiles(ps)
	}, [request])

	const upsertDemoProfile = useCallback(async () => {
		await request<void>({
			type: "upsertProfile",
			name: "Roo Plugin Demo",
			settings: {
				apiProvider: "openai",
				openAiBaseUrl: "https://api.openai.com/v1",
				openAiModelId: "gpt-4o-mini",
			},
			activate: false,
		})
		await fetchProfiles()
	}, [request, fetchProfiles])

	const activateDemoProfile = useCallback(async () => {
		await request<void>({ type: "setActiveProfile", name: "Roo Plugin Demo" })
		await fetchProfiles()
	}, [request, fetchProfiles])

	const ping = useCallback(async (): Promise<number> => {
		const t = Date.now()
		await request<unknown>({ type: "getActiveProfile" })
		return Date.now() - t
	}, [request])

	return {
		isConnected,
		connectionError,
		context,
		tokenUsage,
		agentMessages,
		toolFailures,
		profiles,
		activeProfile,
		connect,
		disconnect,
		fetchProfiles,
		upsertDemoProfile,
		activateDemoProfile,
		ping,
		sendMessage: useCallback((text: string) => request<void>({ type: "sendMessage", text }), [request]),
		clearMessages: useCallback(() => setAgentMessages([]), []),
		clearFailures: useCallback(() => setToolFailures([]), []),
	}
}
