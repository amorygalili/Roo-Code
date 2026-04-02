/**
 * AgentTokenUsage
 *
 * Cumulative token and cost statistics for a single agent task.
 *
 * Updated incrementally as the task runs; each `onTokenUsageUpdated` callback
 * receives the latest snapshot reflecting all LLM requests made so far.
 */
export interface AgentTokenUsage {
	/** Total number of input (prompt) tokens sent to the LLM across all requests. */
	tokensIn: number

	/** Total number of output (completion) tokens received from the LLM across all requests. */
	tokensOut: number

	/**
	 * Total estimated monetary cost of all LLM requests, in USD.
	 * The precision and accuracy depend on the agent implementation and provider pricing data.
	 */
	cost: number

	/**
	 * Current size of the active context window in tokens.
	 * This reflects how many tokens the LLM is currently "seeing", including
	 * conversation history, system prompts, and any injected context.
	 */
	contextTokens: number

	/**
	 * Total prompt-cache write tokens (provider-specific; omitted if not applicable).
	 * Supported by providers such as Anthropic that offer prompt caching.
	 */
	cacheWrites?: number

	/**
	 * Total prompt-cache read tokens (provider-specific; omitted if not applicable).
	 * Cache reads are typically billed at a reduced rate.
	 */
	cacheReads?: number
}
