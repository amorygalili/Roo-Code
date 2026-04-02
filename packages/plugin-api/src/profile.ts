/**
 * AgentProfile
 *
 * A named configuration profile for an agent's AI settings.
 *
 * Profiles let users maintain multiple pre-configured sets of provider
 * settings (API provider, model, parameters, etc.) and switch between
 * them quickly without manually reconfiguring each time.
 */
export interface AgentProfile {
	/** Stable, unique identifier for this profile. */
	id: string

	/** Human-readable name for the profile (used to look it up by name). */
	name: string

	/**
	 * The AI provider/model settings for this profile.
	 *
	 * The shape is intentionally generic so that this interface can be used
	 * across different agents without being tied to any one provider's schema.
	 * Common keys include `apiProvider`, `model`, `apiKey`, `baseUrl`, etc.
	 */
	settings: Record<string, unknown>
}

/**
 * AgentProfileManager
 *
 * Manages the set of named AI configuration profiles available to the agent.
 *
 * Profiles are identified by their human-readable `name`. Most methods that
 * reference a profile accept this name rather than an opaque ID.
 */
export interface AgentProfileManager {
	/**
	 * Returns the names of all configured profiles.
	 * The order matches the agent's internal ordering (typically creation order).
	 */
	getProfiles(): string[]

	/**
	 * Returns the full profile entry for a given name, or `undefined` if it
	 * does not exist.
	 *
	 * @param name - The profile name to look up.
	 */
	getProfile(name: string): AgentProfile | undefined

	/**
	 * Returns the name of the currently active profile, or `undefined` when
	 * no profile is selected.
	 */
	getActiveProfile(): string | undefined

	/**
	 * Returns the raw AI settings in effect right now.
	 *
	 * This reflects the currently active profile's settings merged with any
	 * in-session overrides. The shape depends on the agent implementation.
	 */
	getCurrentSettings(): Record<string, unknown>

	/**
	 * Creates a new profile with the given name and optional initial settings.
	 *
	 * @param name - A unique, human-readable name for the new profile.
	 * @param settings - Initial AI settings for the profile; defaults to `{}`.
	 * @param activate - If `true` (default), switch to this profile immediately.
	 * @returns The stable ID of the newly created profile.
	 * @throws If a profile with the same name already exists.
	 */
	createProfile(name: string, settings?: Record<string, unknown>, activate?: boolean): Promise<string>

	/**
	 * Updates an existing profile's settings.
	 *
	 * @param name - The name of the profile to update.
	 * @param settings - The new AI settings to apply (replaces existing settings).
	 * @param activate - If `true` (default), switch to this profile after updating.
	 * @returns The profile's stable ID, or `undefined` if the profile was not found.
	 * @throws If the profile does not exist.
	 */
	updateProfile(name: string, settings: Record<string, unknown>, activate?: boolean): Promise<string | undefined>

	/**
	 * Creates a profile if it does not exist, or updates it if it does.
	 *
	 * This is the preferred method when your plugin wants to ensure a specific
	 * profile exists without caring about its prior state.
	 *
	 * @param name - The name of the profile to create or update.
	 * @param settings - The AI settings to apply.
	 * @param activate - If `true` (default), switch to this profile after the operation.
	 * @returns The profile's stable ID, or `undefined` if the operation did not produce one.
	 */
	upsertProfile(name: string, settings: Record<string, unknown>, activate?: boolean): Promise<string | undefined>

	/**
	 * Deletes the profile with the given name.
	 *
	 * @param name - The name of the profile to delete.
	 * @throws If the profile does not exist.
	 */
	deleteProfile(name: string): Promise<void>

	/**
	 * Switches the agent to use the named profile as the active configuration.
	 *
	 * @param name - The name of the profile to activate.
	 * @throws If the profile does not exist.
	 */
	setActiveProfile(name: string): Promise<void>
}
