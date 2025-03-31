interface TokenResult {
	visitorData: string;
	poToken: string;
}

interface Task {
	start: () => Promise<{ poToken: string }>;
	stop?: () => void;
}

import { createTask } from "./libs/task";
import { fetchVisitorData } from "./libs/workflow";
import { logger } from "./libs/logger";
import { createServer } from "node:http";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { cpus } from "node:os";
import { formatError } from "./libs/utils";

// Get token refresh interval from environment variable or use default (30 seconds)
const REFRESH_INTERVAL = Number.parseInt(process.env.REFRESH_INTERVAL || "30000", 10);

// Store the latest tokens
let latestTokens: TokenResult | null = null;
let lastUpdateTime = 0;
let updatePromise: Promise<TokenResult> | null = null;
let isGenerating = false;

// Single-threaded token generation (used by oneshot mode)
const generateSingleThread = async (): Promise<TokenResult> => {
	try {
		// Use the same simplified logging pattern as multi-threaded version
		logger.info("Generating tokens in single-thread mode...");

		const visitorData = await fetchVisitorData();
		logger.info("Creating token generation task...");

		const task: Task = await createTask(visitorData);
		const { poToken } = await task.start();

		// Don't log success here to avoid duplication

		// Update the latest tokens and timestamp
		lastUpdateTime = Date.now();
		latestTokens = { visitorData, poToken };
		return latestTokens;
	} catch (error) {
		logger.error(`Token generation failed: ${formatError(error)}`);
		throw error;
	}
};

// Multi-threaded token generation
const generateMultiThread = async (): Promise<TokenResult> => {
	// Prevent multiple concurrent generations
	if (isGenerating) {
		logger.warn("Token generation already in progress, skipping this attempt.");
		throw new Error("Token generation already in progress");
	}

	isGenerating = true;

	try {
		// Skip banner and separator for cleaner output
		logger.info("Generating tokens with multi-threading...");
		const visitorData = await fetchVisitorData();

		const workerCount = Math.max(1, cpus().length - 1);
		// Minimize logging - just one line instead of multiple
		logger.info(`Starting ${workerCount} worker threads...`);

		const result = await new Promise<TokenResult>((res, rej) => {
			try {
				let hasResolved = false;
				const workers = Array(workerCount)
					.fill(0)
					.map(() => new Worker(__filename));

				workers.forEach((worker, i) => {
					worker.on("message", ({ result, data }) => {
						if (result === "success" && !hasResolved) {
							hasResolved = true;
							logger.success("Token generated successfully");

							// Quietly terminate all workers without logging
							for (const worker of workers) {
								worker.postMessage({ action: "stop" });
							}

							res(data);
						}
					});

					worker.on("error", (err) => {
						// Only log errors if we haven't resolved yet
						if (!hasResolved) {
							logger.error(`Worker error: ${formatError(err)}`);
						}
					});

					worker.on("exit", (code) => {
						// Don't log worker exits at all
					});

					// Don't log individual worker starts
					worker.postMessage({ action: "start", data: { visitorData } });
				});
			} catch (err) {
				logger.error(err instanceof Error ? err.message : String(err));
				rej(err);
			}
		});

		// Update the latest tokens and timestamp
		latestTokens = result;
		lastUpdateTime = Date.now();

		// No additional completion messages
		return result;
	} catch (error) {
		logger.error(`Token generation failed: ${formatError(error)}`);
		throw error;
	} finally {
		isGenerating = false;
	}
};

// Default generation method that uses the multi-threaded approach
const generate = generateMultiThread;

// Get tokens - returns cached tokens if available and not expired
const getLatestTokens = async (forceUpdate = false): Promise<TokenResult> => {
	const now = Date.now();
	const isExpired = now - lastUpdateTime > REFRESH_INTERVAL; // Use environment variable

	// If we already have a pending update, wait for it
	if (updatePromise) {
		return updatePromise;
	}

	// Generate new tokens if:
	// 1. No tokens yet, or
	// 2. Tokens are expired, or
	// 3. Force update is requested
	if (!latestTokens || isExpired || forceUpdate) {
		// More concise messaging
		if (forceUpdate) {
			logger.info("Force updating tokens...");
		} else if (!latestTokens) {
			logger.info("Generating initial tokens...");
		} else if (isExpired) {
			logger.info("Refreshing expired tokens...");
		}

		// Store the promise so concurrent requests can reuse it
		updatePromise = generate();

		try {
			await updatePromise;
			return updatePromise;
		} finally {
			// Clear the promise so future calls can create a new one
			updatePromise = null;
		}
	}

	return latestTokens;
};

const isOneshot = () => {
	return process.argv.includes("--oneshot");
};

// Start HTTP server for handling update requests
const startServer = () => {
	const port = process.env.PORT || 3000;

	const server = createServer(async (req, res) => {
		try {
			if (req.url === "/update") {
				logger.info("Received force update request from /update endpoint");
				await getLatestTokens(true); // Force update

				// Return success message with instructions instead of tokens
				res.statusCode = 200;
				res.setHeader("Content-Type", "application/json");
				res.end(
					JSON.stringify(
						{
							status: "success",
							code: 200,
							message: "Tokens have been successfully updated",
							instructions:
								"Please get the updated tokens from the /token endpoint",
						},
						null,
						2,
					),
				);
			} else if (req.url === "/token") {
				const tokens = await getLatestTokens(); // Use cached tokens if available
				res.statusCode = 200;
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify(tokens, null, 2));
			} else if (req.url === "/") {
				// Simple status page
				res.setHeader("Content-Type", "text/html");
				res.statusCode = 200;
				res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>YouTube Trusted Session Generator</title>
              <style>
                body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
                h1 { color: #c00; }
                pre { background: #f0f0f0; padding: 15px; border-radius: 5px; overflow: auto; }
                .button { display: inline-block; background: #c00; color: white; padding: 10px 15px; 
                          text-decoration: none; border-radius: 4px; margin: 10px 0; }
                .info { background: #eef; padding: 10px; border-radius: 5px; margin: 10px 0; }
              </style>
            </head>
            <body>
              <h1>YouTube Trusted Session Generator</h1>
              <p>Current status: ${isGenerating ? "Generating tokens..." : "Idle"}</p>
              <p>Last update: ${lastUpdateTime ? new Date(lastUpdateTime).toLocaleString() : "Never"}</p>
              <div class="info">
                <p>Next update in: ${
									latestTokens
										? Math.max(
												0,
												Math.floor(
													(REFRESH_INTERVAL - (Date.now() - lastUpdateTime)) / 1000,
												),
											)
										: "?"
								} seconds</p>
                <p>Refresh interval: ${REFRESH_INTERVAL / 1000} seconds</p>
              </div>
              <a href="/update" class="button">Force Update</a>
              <a href="/token" class="button">Get Tokens</a>
              <h2>Latest Tokens:</h2>
              <pre>${JSON.stringify(latestTokens, null, 2) || "No tokens generated yet"}</pre>
            </body>
          </html>
        `);
			} else {
				res.statusCode = 404;
				res.setHeader("Content-Type", "application/json");
				res.end(JSON.stringify({ error: "Not found" }));
			}
		} catch (error) {
			res.statusCode = 500;
			res.setHeader("Content-Type", "application/json");
			res.end(
				JSON.stringify({
					error: "Internal Server Error",
					message: error instanceof Error ? error.message : String(error),
				}),
			);
		}
	});

	server.listen(port, () => {
		logger.success(`Server running at http://localhost:${port}`);
		logger.info("Available endpoints:");
		logger.info("- GET /        : Status page");
		logger.info("- GET /token  : Get current tokens");
		logger.info("- GET /update  : Force update tokens");
	});

	// Handle server errors
	server.on("error", (error) => {
		logger.error(`Server error: ${error.message}`);
	});

	return server;
};

// Continuously update tokens based on REFRESH_INTERVAL
const startAutoUpdate = () => {
	let running = true;

	const updateLoop = async () => {
		while (running) {
			try {
				await getLatestTokens();
				// Use REFRESH_INTERVAL environment variable instead of hardcoded value
				await new Promise((resolve) => setTimeout(resolve, REFRESH_INTERVAL));
			} catch (error) {
				logger.error(
					`Auto-update error: ${error instanceof Error ? error.message : String(error)}`,
				);
				// If there's an error, wait 5 seconds before trying again
				await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
			}
		}
	};

	// Start the update loop
	updateLoop();

	// Return function to stop the update loop
	return () => {
		running = false;
	};
};

// Worker thread code
if (!isMainThread && parentPort) {
	let flagStop = false;
	let visitorData: string | undefined = undefined;
	let stop: (() => void) | undefined;
	const port = parentPort; // Create stable reference that TypeScript knows is non-null

	const start = async () => {
		try {
			if (!visitorData) {
				throw new Error("visitorData is absent");
			}
			const task = await createTask(visitorData);
			stop = task.stop;
			const { poToken } = await task.start();
			return { result: "success", data: { visitorData, poToken } };
		} catch (err) {
			return { result: "failure", data: { reason: formatError(err) } };
		}
	};

	port.on("message", async ({ action, data }) => {
		if (action === "start") {
			visitorData = data.visitorData;
			const message = await start();
			if (flagStop) {
				return;
			}
			port.postMessage(message);
		}
		if (action === "stop") {
			flagStop = true;
			stop?.();
			process.exit(0);
		}
	});
}

// Example usage
if (import.meta.main && isMainThread) {
	try {
		if (isOneshot()) {
			// In oneshot mode, use logger module for proper formatting
			logger.setQuiet(false); // Ensure logging is enabled

			// Display a nice header
			logger.banner();
			logger.info("One-shot Mode");
			logger.separator();

			// Generate tokens using standard logging
			const result = await generateSingleThread();

			// Display results with consistent formatting
			logger.separator();
			logger.success("Tokens generated successfully");

			// Token details with colored headers using logger
			logger.data("VISITOR DATA", result.visitorData);
			logger.data("PO TOKEN", result.poToken);

			logger.separator();
			logger.success("Done! Copy the tokens above.");
		} else {
			// In normal mode with minimal logging
			logger.banner(); // Show banner just once at startup
			logger.info("Starting YouTube Trusted Session Generator");

			// Start server and auto-update with multi-threaded approach
			startServer();
			startAutoUpdate();

			// Don't await initial token generation here
			// Let it happen in the background
			getLatestTokens();
		}
	} catch (error) {
		logger.setQuiet(false); // Ensure errors are visible
		logger.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

export { generate, getLatestTokens, isOneshot };
export type { TokenResult, Task };
