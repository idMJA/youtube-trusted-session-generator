import { download } from "./utils";
import { url } from "./consts";

export const fetchVisitorData = async (): Promise<string> => {
	const data = await download(url);
	const matched = data.match(/"visitorData":"([^"]+)/);
	const visitorData = matched?.[1];
	if (visitorData) {
		return visitorData;
	}
	throw new Error("Failed to find visitorData");
};
