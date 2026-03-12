import { useEffect, useRef, useState } from "react"

// Acquire the VS Code API once at module scope (must only be called once).
const vscode = acquireVsCodeApi()

// ── Types ─────────────────────────────────────────────────────────────────────

interface TokenUsage {
	totalTokensIn: number
	totalTokensOut: number
	totalCacheWrites?: number
	totalCacheReads?: number
	totalCost: number
	contextTokens: number
}

interface RooTaskContext {
	taskId: string | undefined
	mode: string
	workspaceFolders: string[]
	openFiles: string[]
}

interface AgentMessage {
	ts: number
	type: "ask" | "say"
	say?: string
	ask?: string
	text?: string
	partial?: boolean
}

type IncomingMessage =
	| { type: "contextUpdate"; context: RooTaskContext }
	| { type: "tokenUsage"; taskId: string; tokenUsage: TokenUsage }
	| { type: "toolFailed"; taskId: string; toolName: string; errorMessage: string }
	| { type: "agentMessage"; taskId: string; action: "created" | "updated"; message: AgentMessage }
	| { type: "pingFromExtension"; ts: number }
	| { type: "pongFromExtension"; ts: number; roundTrip: number }
	| { type: "profileUpdate"; activeProfile: string | undefined; profiles: string[] }
	| { type: "error"; text: string }

// ── Component ─────────────────────────────────────────────────────────────────

const DEMO_PROFILE_NAME = "Roo Plugin Demo"

export default function App() {
	const [context, setContext] = useState<RooTaskContext | null>(null)
	const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null)
	const [agentMessages, setAgentMessages] = useState<string[]>([])
	const [failures, setFailures] = useState<string[]>([])
	const [pingStatus, setPingStatus] = useState("–")
	const [sendStatus, setSendStatus] = useState("")
	const [msgInput, setMsgInput] = useState("")
	const [activeProfile, setActiveProfile] = useState<string | undefined>(undefined)
	const [profiles, setProfiles] = useState<string[]>([])
	const messageLogRef = useRef<HTMLDivElement>(null)

	// Listen for messages from the extension host.
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const m = event.data as IncomingMessage
			if (m.type === "contextUpdate") {
				setContext(m.context)
			} else if (m.type === "tokenUsage" && m.tokenUsage) {
				setTokenUsage(m.tokenUsage)
			} else if (m.type === "toolFailed") {
				setFailures((prev) => [...prev, `✗ ${m.toolName}: ${m.errorMessage}`])
			} else if (
				m.type === "agentMessage" &&
				m.message.type === "say" &&
				m.message.say === "text" &&
				!m.message.partial &&
				m.message.text
			) {
				setAgentMessages((prev) => [...prev, `[${m.action}] ${m.message.text!.slice(0, 200)}`])
			} else if (m.type === "pingFromExtension") {
				setPingStatus(`📨 Ping from extension host (${Date.now() - m.ts} ms) — sending pong…`)
				vscode.postMessage({ type: "pong", ts: m.ts })
			} else if (m.type === "pongFromExtension") {
				setPingStatus(`🏓 Pong from extension host — round-trip ${m.roundTrip} ms`)
			} else if (m.type === "profileUpdate") {
				setActiveProfile(m.activeProfile)
				setProfiles(m.profiles)
			} else if (m.type === "error") {
				setSendStatus(`⚠ ${m.text}`)
				setTimeout(() => setSendStatus(""), 4000)
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [])

	// Auto-scroll the agent message log on new messages.
	useEffect(() => {
		if (messageLogRef.current) {
			messageLogRef.current.scrollTop = messageLogRef.current.scrollHeight
		}
	}, [agentMessages])

	const sendToAgent = (text: string) => {
		if (!text.trim()) return
		vscode.postMessage({ type: "sendToAgent", text })
		setSendStatus("✓ Sent")
		setTimeout(() => setSendStatus(""), 2000)
	}

	const handleSend = () => {
		sendToAgent(msgInput)
		setMsgInput("")
	}

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			handleSend()
		}
	}

	const workspaceFolders = context?.workspaceFolders ?? []
	const openFiles = context?.openFiles ?? []

	return (
		<div>
			<section>
				<h3>Context</h3>
				<div className="kv">
					<span className="key">Mode</span>
					<span>
						<span className="pill">{context?.mode ?? "–"}</span>
					</span>
				</div>
				<div className="kv">
					<span className="key">Task</span>
					<span>{context?.taskId ? `${context.taskId.slice(0, 12)}…` : "idle"}</span>
				</div>
				<div className="kv">
					<span className="key">Workspace</span>
					<span className="dim">{workspaceFolders.map((p) => p.split(/[\\/]/).pop()).join(", ") || "–"}</span>
				</div>
				<div className="kv">
					<span className="key">Open Files</span>
					<span className="dim">{openFiles.map((p) => p.split(/[\\/]/).pop()).join(", ") || "none"}</span>
				</div>
			</section>

			<section>
				<h3>Token Usage</h3>
				<div className="kv">
					<span className="key">Tokens In</span>
					<span>{(tokenUsage?.totalTokensIn ?? 0).toLocaleString()}</span>
				</div>
				<div className="kv">
					<span className="key">Tokens Out</span>
					<span>{(tokenUsage?.totalTokensOut ?? 0).toLocaleString()}</span>
				</div>
				<div className="kv">
					<span className="key">Cost</span>
					<span>${(tokenUsage?.totalCost ?? 0).toFixed(4)}</span>
				</div>
				<div className="kv">
					<span className="key">Context</span>
					<span>{(tokenUsage?.contextTokens ?? 0).toLocaleString()} tokens</span>
				</div>
			</section>

			<section>
				<h3>Tool Failures</h3>
				<div className="log">
					{failures.length === 0 ? (
						<span className="dim">None yet.</span>
					) : (
						failures.map((f, i) => (
							<div key={i} className="failure-line">
								{f}
							</div>
						))
					)}
				</div>
			</section>

			<section>
				<h3>Agent Messages</h3>
				<div className="log" ref={messageLogRef}>
					{agentMessages.length === 0 ? (
						<span className="dim">Waiting for messages…</span>
					) : (
						agentMessages.map((msg, i) => (
							<div key={i} className="msg-line">
								{msg}
							</div>
						))
					)}
				</div>
				<button className="sec" onClick={() => setAgentMessages([])}>
					Clear
				</button>
			</section>

			<section>
				<h3>Send to Agent</h3>
				<textarea
					value={msgInput}
					onChange={(e) => setMsgInput(e.target.value)}
					onKeyDown={handleKeyDown}
					placeholder="Type a message… (Ctrl+Enter to send)"
				/>
				<div>
					<button onClick={handleSend}>Send</button>
					<button className="sec" onClick={() => sendToAgent("What is the current date and time?")}>
						Ask Date &amp; Time
					</button>
				</div>
				{sendStatus && <div className="status">{sendStatus}</div>}
			</section>

			<section>
				<h3>Configuration Profile</h3>
				<div className="kv">
					<span className="key">Active</span>
					<span>
						{activeProfile ? (
							<span className={activeProfile === DEMO_PROFILE_NAME ? "pill" : ""}>{activeProfile}</span>
						) : (
							<span className="dim">–</span>
						)}
					</span>
				</div>
				<div className="kv">
					<span className="key">All Profiles</span>
					<span className="dim">{profiles.length > 0 ? profiles.join(", ") : "–"}</span>
				</div>
				<div>
					<button
						className="sec"
						onClick={() => vscode.postMessage({ type: "upsertDemoProfile" })}
						title={`Create or refresh the "${DEMO_PROFILE_NAME}" profile`}>
						Create / Refresh Demo Profile
					</button>
					<button
						onClick={() => vscode.postMessage({ type: "activateDemoProfile" })}
						disabled={activeProfile === DEMO_PROFILE_NAME}
						title={`Switch Roo Code to the "${DEMO_PROFILE_NAME}" profile`}>
						Activate Demo Profile
					</button>
				</div>
			</section>

			<section>
				<h3>Panel Message Bus</h3>
				<button
					onClick={() => {
						vscode.postMessage({ type: "pingExtension", ts: Date.now() })
						setPingStatus("⏳ Waiting for pong…")
					}}>
					Ping Extension Host
				</button>
				<div className="status dim">{pingStatus}</div>
			</section>
		</div>
	)
}
