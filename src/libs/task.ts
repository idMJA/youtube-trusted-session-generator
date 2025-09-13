import { promises as fs } from "node:fs";
import { join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { url, userAgent } from "./consts";
import { logger } from "./logger";

interface Task {
	stop: () => void;
	start: () => Promise<{ poToken: string }>;
}

export const createTask = async (visitorData: string): Promise<Task> => {
	const domContent = await fs.readFile(
		join(import.meta.dirname, "..", "assets", "index.html"),
		"utf-8",
	);
	const baseContent = await fs.readFile(
		join(import.meta.dirname, "..", "assets", "base.js"),
		"utf-8",
	);
	const baseAppendContent = await fs.readFile(
		join(import.meta.dirname, "inject.js"),
		"utf-8",
	);
	let destroy: (() => void) | undefined = undefined;
	let isIntentionalClose = false;

	return {
		stop: () => {
			isIntentionalClose = true;
			destroy?.();
		},
		start: async () => {
			let attempts = 0;
			const maxAttempts = 5;

			while (attempts < maxAttempts) {
				attempts++;

				try {
					const { poToken } = await new Promise<{ poToken: string }>(
						(res, rej) => {
							const timeout = setTimeout(() => {
								const err = new Error(
									`Token generation timeout after 30 seconds (attempt ${attempts})`,
								);
								logger.error(err);
								rej(err);
							}, 30000);

							const { window } = new JSDOM(domContent, {
								url,
								pretendToBeVisual: true,
								runScripts: "dangerously",
								virtualConsole: new VirtualConsole(),
							});

							Object.defineProperty(window.navigator, "userAgent", {
								value: userAgent,
								writable: false,
							});
							window.visitorData = visitorData;
							window.onPoToken = (poToken: string) => {
								clearTimeout(timeout);
								res({ poToken });
							};

							window.addEventListener("error", (event) => {
								const message = event.error?.message || "Unknown error";
								logger.error(message);
							});

							window.eval(
								baseContent.replace(
									/}\s*\)\(_yt_player\);\s*$/,
									(matched) => `;${baseAppendContent};${matched}`,
								),
							);

							destroy = () => {
								clearTimeout(timeout);
								window.close();
								if (!isIntentionalClose) {
									const err = new Error("Window is closed");
									logger.error(err);
									rej(err);
								}
							};
						},
					);

					if (poToken && poToken.length >= 160) {
						return { poToken };
					} else {
					}
				} catch (error) {
					if (attempts >= maxAttempts) {
						throw error;
					}

					await new Promise((resolve) => setTimeout(resolve, 2000));
				} finally {
					isIntentionalClose = true;
					destroy?.();
				}
			}

			throw new Error(`Failed to generate token after ${maxAttempts} attempts`);
		},
	};
};
