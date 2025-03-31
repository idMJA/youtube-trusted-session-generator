import https from "node:https";
import type { IncomingMessage } from "node:http";
import { headers } from "./consts";

export const download = (url: string): Promise<string> =>
	new Promise((resolve, reject) => {
		https
			.get(url, { headers }, (res: IncomingMessage) => {
				let data = "";

				res.on("data", (chunk: Buffer) => {
					data += chunk;
				});

				res.on("end", () => {
					resolve(data);
				});
			})
			.on("error", (err: Error) => {
				reject(err);
			});
	});

export const formatError = (err: unknown): string => {
	if (err instanceof Error) {
		return err.message;
	}
	return String(err);
};
