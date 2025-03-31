import { generate } from "./index";
import type { TokenResult } from "./index";
import { logger } from "./libs/logger";

async function main(): Promise<void> {
	try {
		const result: TokenResult = await generate();
		logger.info("Test completed successfully");
		logger.data("Final Result", JSON.stringify(result));
	} catch (error) {
		logger.error(error instanceof Error ? error : String(error));
	}
}

main();
