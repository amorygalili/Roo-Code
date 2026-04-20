/**
 * AgentProfile
 *
 * A named configuration profile for an agent's AI settings.
 */
export interface AgentProfile {
	/** Stable, unique identifier for this profile. */
	id: string

	/** Human-readable name for the profile (used to look it up by name). */
	name: string

	/**
	 * The AI provider/model settings for this profile.
	 */
	settings: Record<string, unknown>
}

/**
 * AgentProfileManager
 *
 * Manages the set of named AI configuration profiles available to the agent.
 */
export interface AgentProfileManager {
	/**
	 * Returns the names of all configured profiles.
	 */
	getProfiles(): string[]

	/**
	 * Returns the full profile entry for a given name, or `undefined` if it
	 * does not exist.
	 */
	getProfile(name: string): AgentProfile | undefined

	/**
	 * Returns the name of the currently active profile, or `undefined` when
	 * no profile is selected.
	 */
	getActiveProfile(): string | undefined

	/**
	 * Returns the raw AI settings in effect right now.
	 */
	getCurrentSettings(): Record<string, unknown>

	/**
	 * Creates a new profile with the given name and optional initial settings.
	 *
	 * @returns The stable ID of the newly created profile.
	 * @throws If a profile with the same name already exists.
	 */
	createProfile(name: string, settings?: Record<string, unknown>, activate?: boolean): Promise<string>

	/**
	 * Updates an existing profile's settings.
	 *
	 * @returns The profile's stable ID, or `undefined` if the profile was not found.
	 * @throws If the profile does not exist.
	 */
	updateProfile(name: string, settings: Record<string, unknown>, activate?: boolean): Promise<string | undefined>

	/**
	 * Creates a profile if it does not exist, or updates it if it does.
	 *
	 * @returns The profile's stable ID, or `undefined` if the operation did not produce one.
	 */
	upsertProfile(name: string, settings: Record<string, unknown>, activate?: boolean): Promise<string | undefined>

	/**
	 * Deletes the profile with the given name.
	 *
	 * @throws If the profile does not exist.
	 */
	deleteProfile(name: string): Promise<void>

	/**
	 * Switches the agent to use the named profile as the active configuration.
	 *
	 * @throws If the profile does not exist.
	 */
	setActiveProfile(name: string): Promise<void>
}
