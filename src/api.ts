import { getLatestTokens, type TokenResult } from "./index";
import { logger } from "./libs/logger";

/**
 * Get YouTube visitor data and poToken
 * Used for authentication with YouTube API
 *
 * @param {boolean} forceUpdate - Whether to force a fresh token generation
 * @returns Promise<TokenResult> containing visitorData and poToken
 */
export async function getTokens(
	forceUpdate: boolean = false,
): Promise<TokenResult> {
	try {
		logger.setQuiet(true);
		return await getLatestTokens(forceUpdate);
	} catch (error) {
		throw new Error(
			`Failed to get tokens: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

if (import.meta.main) {
	try {
		const forceUpdate = process.argv.includes("--force");
		const result = await getTokens(forceUpdate);
		logger.info(JSON.stringify(result, null, 2));
	} catch (error) {
		logger.error(error instanceof Error ? error : String(error));
		process.exit(1);
	}
}

export type { TokenResult };
