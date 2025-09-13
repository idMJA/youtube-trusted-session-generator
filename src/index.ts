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
import Fastify from "fastify";
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { cpus } from "node:os";
import { formatError } from "./libs/utils";

const REFRESH_INTERVAL = Number.parseInt(
	process.env.REFRESH_INTERVAL || "30000",
	10,
);

let latestTokens: TokenResult | null = null;
let lastUpdateTime = 0;
let updatePromise: Promise<TokenResult> | null = null;
let isGenerating = false;

const generateSingleThread = async (): Promise<TokenResult> => {
	try {
		logger.info("Generating tokens in single-thread mode...");

		const visitorData = await fetchVisitorData();
		logger.info("Creating token generation task...");

		const task: Task = await createTask(visitorData);

		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => {
				task.stop?.();
				const err = new Error(
					"Single-threaded token generation timeout after 2 minutes",
				);
				logger.error(err);
				reject(err);
			}, 120000);
		});

		const { poToken } = await Promise.race([task.start(), timeoutPromise]);

		lastUpdateTime = Date.now();
		latestTokens = { visitorData, poToken };
		return latestTokens;
	} catch (error) {
		logger.error(`Token generation failed: ${formatError(error)}`);
		throw error;
	}
};

const generateMultiThread = async (): Promise<TokenResult> => {
	if (isGenerating) {
		logger.warn("Token generation already in progress, skipping this attempt.");
		const err = new Error("Token generation already in progress");
		logger.error(err);
		throw err;
	}

	isGenerating = true;

	try {
		logger.info("Generating tokens with multi-threading...");
		const visitorData = await fetchVisitorData();

		const workerCount = Math.max(1, cpus().length - 1);

		logger.info(`Starting ${workerCount} worker threads...`);

		const result = await new Promise<TokenResult>((res, rej) => {
			try {
				let hasResolved = false;
				let completedWorkers = 0;
				const workers = Array(workerCount)
					.fill(0)
					.map(() => new Worker(__filename));

				const timeout = setTimeout(() => {
					if (!hasResolved) {
						hasResolved = true;
						logger.error("Token generation timeout - all workers failed");

						for (const worker of workers) {
							worker.postMessage({ action: "stop" });
						}
						rej(new Error("Token generation timeout - all workers failed"));
					}
				}, 120000);

				workers.forEach((worker, i) => {
					worker.on("message", ({ result, data }) => {
						if (result === "success" && !hasResolved) {
							hasResolved = true;
							clearTimeout(timeout);
							logger.success("Token generated successfully");

							for (const worker of workers) {
								worker.postMessage({ action: "stop" });
							}

							res(data);
						} else if (result === "failure") {
							completedWorkers++;
							logger.warn(`Worker ${i + 1} failed: ${data.reason}`);

							if (completedWorkers >= workerCount && !hasResolved) {
								hasResolved = true;
								clearTimeout(timeout);
								rej(new Error("All workers failed to generate tokens"));
							}
						}
					});

					worker.on("error", (err) => {
						completedWorkers++;

						if (!hasResolved) {
							logger.error(`Worker ${i + 1} error: ${formatError(err)}`);
						}

						if (completedWorkers >= workerCount && !hasResolved) {
							hasResolved = true;
							clearTimeout(timeout);
							rej(new Error("All workers failed with errors"));
						}
					});

					worker.on("exit", (code) => {
						completedWorkers++;

						if (completedWorkers >= workerCount && !hasResolved) {
							hasResolved = true;
							clearTimeout(timeout);
							rej(new Error("All workers exited without generating tokens"));
						}
					});

					worker.postMessage({ action: "start", data: { visitorData } });
				});
			} catch (err) {
				logger.error(err instanceof Error ? err.message : String(err));
				rej(err);
			}
		});

		latestTokens = result;
		lastUpdateTime = Date.now();

		return result;
	} catch (error) {
		logger.error(`Token generation failed: ${formatError(error)}`);
		throw error;
	} finally {
		isGenerating = false;
	}
};

const generate = generateMultiThread;

const getLatestTokens = async (forceUpdate = false): Promise<TokenResult> => {
	const now = Date.now();
	const isExpired = now - lastUpdateTime > REFRESH_INTERVAL;

	if (updatePromise) {
		return updatePromise;
	}

	if (!latestTokens || isExpired || forceUpdate) {
		if (forceUpdate) {
			logger.info("Force updating tokens...");
		} else if (!latestTokens) {
			logger.info("Generating initial tokens...");
		} else if (isExpired) {
			logger.info("Refreshing expired tokens...");
		}

		updatePromise = generate();

		try {
			await updatePromise;
			return updatePromise;
		} finally {
			updatePromise = null;
		}
	}

	return latestTokens;
};

const isOneshot = () => {
	return process.argv.includes("--oneshot");
};

const startServer = async () => {
	const port = Number(process.env.PORT || 3000);
	const fastify = Fastify({
		logger: false,
	});

	fastify.get("/update", async (request, reply) => {
		logger.info("Received force update request from /update endpoint");
		await getLatestTokens(true);

		return {
			status: "success",
			code: 200,
			message: "Tokens have been successfully updated",
			instructions: "Please get the updated tokens from the /token endpoint",
		};
	});

	fastify.get("/token", async (request, reply) => {
		const tokens = await getLatestTokens();
		return tokens;
	});

	fastify.get("/", async (request, reply) => {
		reply.header("Content-Type", "text/html");
		const refreshIntervalSeconds = REFRESH_INTERVAL / 1000;
		const timeUntilNextUpdate = latestTokens
			? Math.max(
					0,
					Math.floor((REFRESH_INTERVAL - (Date.now() - lastUpdateTime)) / 1000),
				)
			: 0;

		return `
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
                .countdown { font-weight: bold; color: #c00; }
                .status { font-weight: bold; }
                .status.generating { color: #ff6600; }
                .status.idle { color: #006600; }
              </style>
            </head>
            <body>
              <h1>YouTube Trusted Session Generator</h1>
              <p>Current status: <span class="status ${
								isGenerating ? "generating" : "idle"
							}">${isGenerating ? "Generating tokens..." : "Idle"}</span></p>
              <p>Last update: ${
								lastUpdateTime
									? new Date(lastUpdateTime).toLocaleString()
									: "Never"
							}</p>
              <div class="info">
                <p>Next update in: <span class="countdown" id="countdown">${
									latestTokens ? timeUntilNextUpdate : "?"
								}</span> seconds</p>
                <p>Refresh interval: ${refreshIntervalSeconds} seconds</p>
              </div>
              <a href="/update" class="button">Force Update</a>
              <a href="/token" class="button">Get Tokens</a>
              <h2>Latest Tokens:</h2>
              <pre>${
								JSON.stringify(latestTokens, null, 2) ||
								"No tokens generated yet"
							}</pre>

              <script>
                let countdownElement = document.getElementById('countdown');
                let lastUpdateTime = ${lastUpdateTime || 0};
                let refreshInterval = ${REFRESH_INTERVAL};
                let hasTokens = ${JSON.stringify(!!latestTokens)};
                
                function updateCountdown() {
                  if (!hasTokens) {
                    countdownElement.textContent = '?';
                    return;
                  }
                  
                  let now = Date.now();
                  let timeSinceLastUpdate = now - lastUpdateTime;
                  let timeUntilNext = Math.max(0, Math.floor((refreshInterval - timeSinceLastUpdate) / 1000));
                  
                  countdownElement.textContent = timeUntilNext;
                  
                  
                  if (timeUntilNext === 0) {
                    setTimeout(() => {
                      window.location.reload();
                    }, 1000);
                  }
                }
                
                
                setInterval(updateCountdown, 1000);
                
                
                updateCountdown();
              </script>
            </body>
          </html>
        `;
	});

	fastify.setNotFoundHandler((request, reply) => {
		reply.code(404).send({ error: "Not found" });
	});

	try {
		await fastify.listen({ port, host: "0.0.0.0" });
		logger.info(`Server is running on port ${port}`);
	} catch (err) {
		logger.error(`Error starting server: ${formatError(err)}`);
		process.exit(1);
	}

	return fastify;
};

const startAutoUpdate = () => {
	let running = true;

	const updateLoop = async () => {
		while (running) {
			try {
				await getLatestTokens();

				await new Promise((resolve) => setTimeout(resolve, REFRESH_INTERVAL));
			} catch (error) {
				logger.error(
					`Auto-update error: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);

				await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
			}
		}
	};

	updateLoop();

	return () => {
		running = false;
	};
};

if (!isMainThread && parentPort) {
	let flagStop = false;
	let visitorData: string | undefined = undefined;
	let stop: (() => void) | undefined;
	const port = parentPort;

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

if (import.meta.main && isMainThread) {
	try {
		if (isOneshot()) {
			logger.setQuiet(false);

			logger.banner();
			logger.info("One-shot Mode");
			logger.separator();

			const result = await generateSingleThread();

			logger.separator();
			logger.success("Tokens generated successfully");

			logger.data("VISITOR DATA", result.visitorData);
			logger.data("PO TOKEN", result.poToken);

			logger.separator();
			logger.success("Done! Copy the tokens above.");
		} else {
			logger.banner();
			logger.info("Starting YouTube Trusted Session Generator");

			startServer();
			startAutoUpdate();

			getLatestTokens();
		}
	} catch (error) {
		logger.setQuiet(false);
		logger.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}

export { generate, getLatestTokens, isOneshot };
export type { TokenResult, Task };
