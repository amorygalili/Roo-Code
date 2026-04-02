/**
 * @roo-code/plugin-api
 *
 * Agent-agnostic TypeScript interfaces for building code assistant plugins.
 *
 * This package defines the contract that any code assistant (agent) must
 * implement to support third-party plugins. Plugin code written against
 * these interfaces is portable across different agent implementations.
 *
 * ─── Quick start ─────────────────────────────────────────────────────────────
 *
 * 1. Obtain the agent's plugin service (agent-specific; see its docs).
 * 2. Call `register()` with your plugin manifest to get a handle.
 * 3. Use the handle to register tools, MCP servers, listen for messages, etc.
 * 4. Call `handle.dispose()` (or push it to VS Code's `context.subscriptions`)
 *    when your extension deactivates.
 *
 * @example
 * ```ts
 * import type { AgentPluginService, AgentPluginManifest } from "@roo-code/plugin-api"
 *
 * function activate(pluginService: AgentPluginService) {
 *   const handle = pluginService.register({
 *     id: "my-publisher.my-plugin",
 *     displayName: "My Plugin",
 *   })
 *
 *   handle.registerTool({
 *     name: "hello",
 *     description: "Say hello.",
 *     execute: async () => "Hello from my plugin!",
 *   })
 *
 *   handle.onAgentMessage((taskId, action, message) => {
 *     console.log(`[${taskId}] ${action}:`, message.text)
 *   })
 *
 *   return handle // dispose() cleans everything up
 * }
 * ```
 */

export type { AgentMessage, AgentSayKind, AgentAskKind } from "./message.js"
export type { AgentTokenUsage } from "./token-usage.js"
export type { AgentMcpServerConfig } from "./mcp.js"
export type { JsonSchema, AgentToolContext, AgentToolDefinition } from "./tool.js"
export type { AgentProfile, AgentProfileManager } from "./profile.js"
export type { AgentTaskContext } from "./task.js"
export type { AgentPluginManifest, AgentPluginHandle, AgentPluginService } from "./plugin.js"
