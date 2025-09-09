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
			let attempts = 0;
			const maxAttempts = 5;

			while (attempts < maxAttempts) {
				attempts++;
				console.log(`Token generation attempt ${attempts}/${maxAttempts}`);

				try {
					const { poToken } = await new Promise<{ poToken: string }>(
						(res, rej) => {
							// Set up timeout to prevent infinite waiting
							const timeout = setTimeout(() => {
								rej(
									new Error(
										`Token generation timeout after 30 seconds (attempt ${attempts})`,
									),
								);
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
								console.log(`Received token with length: ${poToken.length}`);
								res({ poToken });
							};

							// Add error handling for script execution
							window.addEventListener("error", (event) => {
								console.log(
									`Script error: ${event.error?.message || "Unknown error"}`,
								);
							});

							// Add debugging to check if bOa function exists
							window.eval(`
								console.log('Starting script execution...');
								console.log('bOa function exists:', typeof bOa !== 'undefined');
								console.log('ytcfg exists:', typeof ytcfg !== 'undefined');
								console.log('g exists:', typeof g !== 'undefined');
							`);

							window.eval(
								baseContent.replace(
									/}\s*\)\(_yt_player\);\s*$/,
									(matched) => `;${baseAppendContent};${matched}`,
								),
							);

							destroy = () => {
								clearTimeout(timeout);
								window.close();
								rej(new Error("Window is closed"));
							};
						},
					);

					if (poToken && poToken.length >= 160) {
						console.log(
							`Successfully generated token with length: ${poToken.length}`,
						);
						return { poToken };
					} else {
						console.log(
							`Token length ${
								poToken?.length || 0
							} is not valid (expected >= 160), retrying...`,
						);
					}
				} catch (error) {
					console.log(
						`Attempt ${attempts} failed:`,
						error instanceof Error ? error.message : String(error),
					);
					if (attempts >= maxAttempts) {
						throw error;
					}
					// Wait a bit before retrying
					await new Promise((resolve) => setTimeout(resolve, 2000));
				} finally {
					destroy?.();
				}
			}

			throw new Error(`Failed to generate token after ${maxAttempts} attempts`);
		},
	};
};
