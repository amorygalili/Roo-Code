/**
 * @roo-code/plugin-api
 *
 * WebSocket-based plugin server/client for code assistant integrations.
 *
 * Agents (e.g. Roo Code) create a {@link PluginServer} that listens on a TCP
 * port and reacts to plugin commands via typed EventEmitter events.
 *
 * Plugins (in any language/editor that speaks WebSocket) create a
 * {@link PluginClient} that connects to the server and calls methods that
 * mirror the in-process {@link AgentPluginHandle} API from `@roo-code/plugin-api`.
 *
 * ─── Quick start (server / agent side) ────────────────────────────────────
 *
 * ```ts
 * import { PluginServer } from "@roo-code/plugin-api"
 *
 * const server = new PluginServer({ port: 7777 })
 * server.listen()
 *
 * server.on("upsertProfile", (clientId, name, settings, activate, reply) => {
 *   const id = myProfileManager.upsert(name, settings, activate)
 *   reply(id)
 * })
 *
 * server.on("startTask", (clientId, text, images, reply) => {
 *   const taskId = myTaskManager.start(text, images)
 *   reply(taskId)
 * })
 * ```
 *
 * ─── Quick start (client / plugin side) ───────────────────────────────────
 *
 * ```ts
 * import { PluginClient } from "@roo-code/plugin-api"
 *
 * const client = new PluginClient({ url: "ws://localhost:7777" })
 * await client.connect()
 *
 * const profileId = await client.upsertProfile("my-profile", { apiProvider: "anthropic" }, true)
 *
 * client.registerTool({
 *   name: "hello",
 *   description: "Say hello",
 *   execute: async () => "Hello from my plugin!",
 * })
 *
 * client.onAgentMessage((taskId, action, message) => {
 *   console.log(`[${taskId}] ${action}:`, message.text)
 * })
 * ```
 */

export { PluginServer } from "./plugin-server.js"
export type { PluginServerOptions, PluginServerEvents, ReplyFn } from "./plugin-server.js"

export { PluginClient } from "./plugin-client.js"
export type { PluginClientOptions } from "./plugin-client.js"

export type { C2SMessage, S2CMessage, WireToolDefinition, WireToolContext } from "./protocol.js"

// Re-export agent-agnostic types so that consumers only need to import from @roo-code/plugin-api.
export type { JsonSchema, AgentToolContext, AgentToolDefinition } from "./tool.js"
export type { AgentProfile, AgentProfileManager } from "./profile.js"
export type { AgentMessage, AgentSayKind, AgentAskKind } from "./message.js"
export type { AgentTokenUsage } from "./token-usage.js"
export type { AgentMcpServerConfig } from "./mcp.js"
export type { AgentTaskContext } from "./task.js"
