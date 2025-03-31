import { promises as fs } from "node:fs";
import { join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";
import { url, userAgent } from "./consts";

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

	return {
		stop: () => destroy?.(),
		start: async () => {
			while (true) {
				const { poToken } = await new Promise<{ poToken: string }>(
					(res, rej) => {
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
							res({ poToken });
						};

						window.eval(
							baseContent.replace(
								/}\s*\)\(_yt_player\);\s*$/,
								(matched) => `;${baseAppendContent};${matched}`,
							),
						);

						destroy = () => {
							window.close();
							rej(new Error("Window is closed"));
						};
					},
				).finally(() => destroy?.());

				if (poToken.length === 160) {
					return { poToken };
				}
			}
		},
	};
};
