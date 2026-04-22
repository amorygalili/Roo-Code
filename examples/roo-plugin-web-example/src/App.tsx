import { useState, useRef, useEffect } from "react"
import { ThemeProvider, createTheme } from "@mui/material/styles"
import CssBaseline from "@mui/material/CssBaseline"
import AppBar from "@mui/material/AppBar"
import Toolbar from "@mui/material/Toolbar"
import Typography from "@mui/material/Typography"
import Container from "@mui/material/Container"
import Box from "@mui/material/Box"
import Card from "@mui/material/Card"
import CardContent from "@mui/material/CardContent"
import CardHeader from "@mui/material/CardHeader"
import TextField from "@mui/material/TextField"
import Button from "@mui/material/Button"
import IconButton from "@mui/material/IconButton"
import Chip from "@mui/material/Chip"
import Alert from "@mui/material/Alert"
import Tooltip from "@mui/material/Tooltip"
import CircularProgress from "@mui/material/CircularProgress"
import Divider from "@mui/material/Divider"
import SmartToyIcon from "@mui/icons-material/SmartToy"
import WifiIcon from "@mui/icons-material/Wifi"
import WifiOffIcon from "@mui/icons-material/WifiOff"
import SendIcon from "@mui/icons-material/Send"
import ClearIcon from "@mui/icons-material/Clear"
import RefreshIcon from "@mui/icons-material/Refresh"
import AccessTimeIcon from "@mui/icons-material/AccessTime"
import NetworkPingIcon from "@mui/icons-material/NetworkPing"

import {
	usePluginClient,
	type AgentTaskContext,
	type AgentTokenUsage,
	type AgentMessageEntry,
	type ToolFailureEntry,
} from "./usePluginClient"

// ── Theme ─────────────────────────────────────────────────────────────────────

const theme = createTheme({
	palette: { mode: "dark", primary: { main: "#7c4dff" }, secondary: { main: "#00bcd4" } },
	shape: { borderRadius: 8 },
})

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionCard({
	title,
	action,
	children,
}: {
	title: string
	action?: React.ReactNode
	children: React.ReactNode
}) {
	return (
		<Card variant="outlined" sx={{ mb: 2 }}>
			<CardHeader
				title={title}
				titleTypographyProps={{
					variant: "subtitle2",
					fontWeight: 700,
					textTransform: "uppercase",
					letterSpacing: "0.06em",
					color: "text.secondary",
				}}
				action={action}
				sx={{ pb: 0 }}
			/>
			<CardContent>{children}</CardContent>
		</Card>
	)
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<Box sx={{ display: "flex", gap: 1, mb: 0.5, alignItems: "baseline" }}>
			<Typography variant="caption" color="text.secondary" sx={{ minWidth: 80, flexShrink: 0 }}>
				{label}
			</Typography>
			<Typography variant="body2" sx={{ wordBreak: "break-all" }}>
				{value}
			</Typography>
		</Box>
	)
}

function ContextSection({ context }: { context: AgentTaskContext }) {
	return (
		<>
			<Box sx={{ display: "flex", gap: 1, mb: 1, flexWrap: "wrap" }}>
				<Chip label={context.mode} size="small" color="primary" variant="outlined" />
				{context.taskId ? (
					<Chip
						label={`task:${context.taskId.slice(0, 8)}`}
						size="small"
						color="success"
						variant="outlined"
					/>
				) : (
					<Chip label="idle" size="small" variant="outlined" />
				)}
			</Box>
			<KV
				label="Workspace"
				value={context.workspaceFolders.length ? context.workspaceFolders.join(", ") : <em>—</em>}
			/>
			<KV label="Open files" value={context.openFiles.length ? context.openFiles.join(", ") : <em>—</em>} />
		</>
	)
}

function TokenSection({ tokenUsage }: { tokenUsage: AgentTokenUsage | null }) {
	if (!tokenUsage) {
		return (
			<Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
				No usage yet
			</Typography>
		)
	}
	return (
		<>
			<KV label="Tokens in" value={tokenUsage.tokensIn.toLocaleString()} />
			<KV label="Tokens out" value={tokenUsage.tokensOut.toLocaleString()} />
			<KV
				label="Cost"
				value={
					<Typography component="span" variant="body2" color="success.main">
						${tokenUsage.cost.toFixed(4)}
					</Typography>
				}
			/>
		</>
	)
}

function MessagesSection({
	messages,
	onClear,
	endRef,
}: {
	messages: AgentMessageEntry[]
	onClear: () => void
	endRef: React.RefObject<HTMLDivElement>
}) {
	return (
		<SectionCard
			title="Agent Messages"
			action={
				<Tooltip title="Clear">
					<span>
						<IconButton size="small" onClick={onClear} disabled={messages.length === 0}>
							<ClearIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
			}>
			<Box
				sx={{
					maxHeight: 220,
					overflowY: "auto",
					bgcolor: "action.hover",
					borderRadius: 1,
					p: 1,
					fontFamily: "monospace",
					fontSize: 12,
				}}>
				{messages.length === 0 ? (
					<Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
						No messages yet
					</Typography>
				) : (
					messages.map((m) => (
						<Box key={m.id} sx={{ mb: 0.5, wordBreak: "break-word" }}>
							<Typography component="span" variant="caption" color="text.disabled">
								[{m.taskId.slice(0, 8)}]{" "}
							</Typography>
							<Typography component="span" variant="caption" color="info.main">
								{m.text}
							</Typography>
						</Box>
					))
				)}
				<div ref={endRef} />
			</Box>
		</SectionCard>
	)
}

function FailuresSection({ failures, onClear }: { failures: ToolFailureEntry[]; onClear: () => void }) {
	return (
		<SectionCard
			title="Tool Failures"
			action={
				<Tooltip title="Clear">
					<span>
						<IconButton size="small" onClick={onClear} disabled={failures.length === 0}>
							<ClearIcon fontSize="small" />
						</IconButton>
					</span>
				</Tooltip>
			}>
			{failures.length === 0 ? (
				<Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
					No failures
				</Typography>
			) : (
				failures.map((f) => (
					<Typography
						key={f.id}
						variant="caption"
						color="error.main"
						sx={{ display: "block", mb: 0.5, wordBreak: "break-word" }}>
						[{f.taskId.slice(0, 8)}] <strong>{f.toolName}</strong>: {f.errorMessage}
					</Typography>
				))
			)}
		</SectionCard>
	)
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
	const [wsUrl, setWsUrl] = useState("ws://localhost:7777")
	const [msgText, setMsgText] = useState("")
	const [pingResult, setPingResult] = useState<number | null>(null)
	const [isPinging, setIsPinging] = useState(false)
	const messagesEndRef = useRef<HTMLDivElement>(null!) as React.RefObject<HTMLDivElement>

	const {
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
		sendMessage,
		upsertDemoProfile,
		activateDemoProfile,
		fetchProfiles,
		ping,
		clearMessages,
		clearFailures,
	} = usePluginClient()

	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
	}, [agentMessages])

	const handleConnect = () => (isConnected ? disconnect() : connect(wsUrl))

	const handleSend = async () => {
		if (!msgText.trim()) return
		await sendMessage(msgText)
		setMsgText("")
	}

	const handlePing = async () => {
		setIsPinging(true)
		try {
			setPingResult(await ping())
		} finally {
			setIsPinging(false)
		}
	}

	return (
		<ThemeProvider theme={theme}>
			<CssBaseline />
			<Box sx={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
				{/* ── AppBar ── */}
				<AppBar position="static" elevation={0} sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
					<Toolbar variant="dense">
						<SmartToyIcon sx={{ mr: 1 }} />
						<Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
							Roo Plugin Web Example
						</Typography>
						<Chip
							icon={isConnected ? <WifiIcon /> : <WifiOffIcon />}
							label={isConnected ? `Connected · ${context.mode}` : "Disconnected"}
							color={isConnected ? "success" : "default"}
							size="small"
							sx={{ mr: 1 }}
						/>
						{context.taskId && (
							<Chip label={`task:${context.taskId.slice(0, 8)}`} size="small" color="warning" />
						)}
					</Toolbar>
				</AppBar>

				{/* ── Main content ── */}
				<Container maxWidth="xl" sx={{ py: 3, flexGrow: 1 }}>
					{/* Connection */}
					<SectionCard title="Connection">
						<Box sx={{ display: "flex", gap: 2, alignItems: "flex-start", flexWrap: "wrap" }}>
							<TextField
								label="WebSocket URL"
								value={wsUrl}
								onChange={(e) => setWsUrl(e.target.value)}
								size="small"
								disabled={isConnected}
								sx={{ flexGrow: 1, minWidth: 260 }}
							/>
							<Button
								variant="contained"
								color={isConnected ? "error" : "primary"}
								onClick={handleConnect}
								startIcon={isConnected ? <WifiOffIcon /> : <WifiIcon />}>
								{isConnected ? "Disconnect" : "Connect"}
							</Button>
						</Box>
						{connectionError && (
							<Alert severity="error" sx={{ mt: 1 }}>
								{connectionError}
							</Alert>
						)}
					</SectionCard>

					{/* Two-column grid */}
					<Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
						{/* Left column */}
						<Box>
							<SectionCard title="Context">
								<ContextSection context={context} />
							</SectionCard>

							<SectionCard title="Token Usage">
								<TokenSection tokenUsage={tokenUsage} />
							</SectionCard>

							<SectionCard
								title="Profiles"
								action={
									<Tooltip title="Refresh profiles">
										<span>
											<IconButton
												size="small"
												onClick={() => void fetchProfiles()}
												disabled={!isConnected}>
												<RefreshIcon fontSize="small" />
											</IconButton>
										</span>
									</Tooltip>
								}>
								<KV label="Active" value={activeProfile ?? <em>—</em>} />
								{profiles.length > 0 && (
									<>
										<Divider sx={{ my: 1 }} />
										<Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
											{profiles.map((p) => (
												<Chip
													key={p}
													label={p}
													size="small"
													variant={p === activeProfile ? "filled" : "outlined"}
													color={p === activeProfile ? "primary" : "default"}
												/>
											))}
										</Box>
									</>
								)}
								<Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 1 }}>
									<Button
										size="small"
										variant="outlined"
										disabled={!isConnected}
										onClick={() => void upsertDemoProfile()}>
										Upsert Demo Profile
									</Button>
									<Button
										size="small"
										variant="contained"
										disabled={!isConnected}
										onClick={() => void activateDemoProfile()}>
										Activate Demo
									</Button>
								</Box>
							</SectionCard>

							<SectionCard title="Message Bus">
								<Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
									<Button
										variant="outlined"
										size="small"
										disabled={!isConnected || isPinging}
										startIcon={
											isPinging ? (
												<CircularProgress size={14} color="inherit" />
											) : (
												<NetworkPingIcon />
											)
										}
										onClick={() => void handlePing()}>
										Ping Server
									</Button>
									{pingResult !== null && (
										<Typography variant="body2" color="success.main">
											🏓 Round-trip: {pingResult} ms
										</Typography>
									)}
								</Box>
							</SectionCard>
						</Box>

						{/* Right column */}
						<Box>
							<SectionCard title="Send to Agent">
								<TextField
									multiline
									rows={3}
									fullWidth
									placeholder="Type a message… (Ctrl+Enter to send)"
									value={msgText}
									onChange={(e) => setMsgText(e.target.value)}
									disabled={!isConnected}
									onKeyDown={(e) => {
										if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void handleSend()
									}}
									sx={{ mb: 1 }}
								/>
								<Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
									<Button
										variant="contained"
										startIcon={<SendIcon />}
										disabled={!isConnected || !msgText.trim()}
										onClick={() => void handleSend()}>
										Send
									</Button>
									<Button
										variant="outlined"
										startIcon={<AccessTimeIcon />}
										disabled={!isConnected}
										onClick={() => void sendMessage("What is the current date and time?")}>
										Ask Date &amp; Time
									</Button>
								</Box>
							</SectionCard>

							<MessagesSection messages={agentMessages} onClear={clearMessages} endRef={messagesEndRef} />
							<FailuresSection failures={toolFailures} onClear={clearFailures} />
						</Box>
					</Box>
				</Container>
			</Box>
		</ThemeProvider>
	)
}
