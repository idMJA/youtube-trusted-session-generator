import { download } from "./utils";
import { url } from "./consts";
import { logger } from "./logger";

export const fetchVisitorData = async (): Promise<string> => {
	const data = await download(url);
	const matched = data.match(/"visitorData":"([^"]+)/);
	const visitorData = matched?.[1];
	if (visitorData) {
		return visitorData;
	}
	const err = new Error("Failed to find visitorData");
	logger.error(err);
	throw err;
};
