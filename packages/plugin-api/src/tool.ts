/**
 * JsonSchema
 *
 * A plain JSON Schema object used to describe a tool's parameter structure.
 * Passed to the agent so it can inform the LLM of the expected input shape.
 */
export type JsonSchema = Record<string, unknown>

/**
 * AgentToolContext
 *
 * Runtime context passed to a tool's `execute` function each time the agent
 * invokes it. Provides minimal situational information without exposing
 * internal agent state.
 */
export interface AgentToolContext {
	/** The ID of the task in which the tool is being invoked. */
	taskId: string
	/**
	 * The active mode or persona the agent is operating in
	 * (e.g. `"code"`, `"architect"`, `"ask"`).
	 */
	mode: string
}

/**
 * AgentToolDefinition
 *
 * Describes a custom tool that a plugin contributes to the agent.
 *
 * The agent surfaces the tool's name and description to the LLM so it can
 * decide when to call it. When called, the agent invokes `execute` with the
 * arguments parsed from the LLM's request and the current `AgentToolContext`.
 *
 * @example
 * ```ts
 * const myTool: AgentToolDefinition = {
 *   name: "get_weather",
 *   description: "Fetch the current weather for a given city.",
 *   parameters: {
 *     type: "object",
 *     properties: {
 *       city: { type: "string", description: "City name" },
 *     },
 *     required: ["city"],
 *   },
 *   execute: async ({ city }) => {
 *     const data = await fetchWeather(city)
 *     return `Weather in ${city}: ${data.description}, ${data.temp}°C`
 *   },
 * }
 * ```
 */
export interface AgentToolDefinition {
	/**
	 * Unique name for this tool within the plugin's namespace.
	 * The agent may automatically prefix it with the plugin ID to avoid collisions.
	 */
	name: string

	/**
	 * Human-readable description of what the tool does.
	 * Shown to the LLM to help it decide when to invoke the tool.
	 */
	description: string

	/**
	 * Optional JSON Schema object describing the tool's input parameters.
	 * When provided, the agent will validate and/or document the parameters
	 * for the LLM. Omit for tools that take no arguments.
	 */
	parameters?: JsonSchema

	/**
	 * The function that performs the tool's work.
	 *
	 * @param args - The (validated) arguments supplied by the LLM, typed as `unknown`
	 *   because the schema is provided at runtime. Cast or validate as needed.
	 * @param context - Execution context with task and mode information.
	 * @returns A string result that will be returned to the LLM as the tool's output.
	 */
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	execute: (args: any, context: AgentToolContext) => Promise<string>
}
