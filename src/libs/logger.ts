/**
 * Enhanced logger utility for YouTube Trusted Session Generator
 * Provides colorful and nicely formatted log output
 */

// ANSI color codes for terminal output
const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",
	underscore: "\x1b[4m",
	blink: "\x1b[5m",
	reverse: "\x1b[7m",
	hidden: "\x1b[8m",

	black: "\x1b[30m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	orange: "\x1b[38;5;208m", // Orange color using 256-color ANSI code

	bgBlack: "\x1b[40m",
	bgRed: "\x1b[41m",
	bgGreen: "\x1b[42m",
	bgYellow: "\x1b[43m",
	bgBlue: "\x1b[44m",
	bgMagenta: "\x1b[45m",
	bgCyan: "\x1b[46m",
	bgWhite: "\x1b[47m",
};

// Log level symbols and colors
const levels = {
	info: { symbol: "ℹ ", color: colors.cyan },
	success: { symbol: "✅", color: colors.green },
	warn: { symbol: "⚠", color: colors.yellow },
	error: { symbol: "❌", color: colors.red },
	step: { symbol: "→", color: colors.magenta },
	data: { symbol: "📊", color: colors.blue },
	debug: { symbol: "🔍", color: colors.yellow },
};

// Format current time
const getTime = () => {
	const now = new Date();
	return `${colors.dim}[${now.toLocaleTimeString()}]${colors.reset}`;
};

// Create a separator line
const separator = () => {
	if (quietMode) return;
	console.log(`${colors.dim}${"─".repeat(50)}${colors.reset}`);
};

const banner = () => {
	if (quietMode) return;
	console.log("\n");
	console.log(
		`${colors.bright}${colors.cyan} YouTube Trusted Session Generator ${colors.reset}`,
	);
	console.log(`${colors.dim} Token generation process started ${colors.reset}`);
	console.log("\n");
};

// Quiet mode flag
let quietMode = false;

export const logger = {
	/**
	 * Set quiet mode on or off
	 */
	setQuiet: (quiet: boolean) => {
		quietMode = quiet;
	},

	/**
	 * Get current quiet mode state
	 */
	isQuiet: () => quietMode,

	/**
	 * Log regular info messages
	 */
	info: (message: string) => {
		if (quietMode) return;
		console.log(
			`${getTime()} ${levels.info.color}${levels.info.symbol} ${message}${colors.reset}`,
		);
	},

	/**
	 * Log success messages
	 */
	success: (message: string) => {
		if (quietMode) return;
		console.log(
			`${getTime()} ${levels.success.color}${levels.success.symbol} ${message}${colors.reset}`,
		);
	},

	/**
	 * Log warning messages
	 */
	warn: (message: string) => {
		if (quietMode) return;
		console.log(
			`${getTime()} ${levels.warn.color}${levels.warn.symbol} ${message}${colors.reset}`,
		);
	},

	/**
	 * Log error messages
	 */
	error: (message: string | Error) => {
		if (quietMode) return;
		const errorMsg = message instanceof Error ? message.message : message;
		console.error(
			`${getTime()} ${levels.error.color}${levels.error.symbol} ${errorMsg}${colors.reset}`,
		);
		if (message instanceof Error && message.stack) {
			console.error(
				`${colors.dim}${message.stack.split("\n").slice(1).join("\n")}${colors.reset}`,
			);
		}
	},

	/**
	 * Debug logging for developers
	 */
	debug: (label: string, data?: unknown) => {
		if (quietMode) return;
		console.log(
			`${getTime()} ${levels.debug.color}${levels.debug.symbol} ${label}${colors.reset}`,
		);
		if (data !== undefined) {
			if (typeof data === "string") {
				console.log(`${colors.dim}${data}${colors.reset}`);
			} else {
				try {
					console.log(
						`${colors.dim}${JSON.stringify(data, null, 2)}${colors.reset}`,
					);
				} catch (e) {
					console.log(`${colors.dim}[Non-serializable data]${colors.reset}`);
					console.dir(data);
				}
			}
		}
	},

	/**
	 * Log step with incrementing numbers
	 */
	step: (stepNumber: number, message: string) => {
		if (quietMode) return;
		console.log(
			`${getTime()} ${levels.step.color}${levels.step.symbol} Step ${stepNumber}: ${message}${colors.reset}`,
		);
	},

	/**
	 * Log data values with a label
	 */
	data: (label: string, value: string) => {
		if (quietMode) return;
		console.log(
			`${getTime()} ${levels.data.color}${levels.data.symbol} ${colors.bright}${colors.orange}${label}:${colors.reset} ${value}`,
		);
	},

	separator,
	banner,
};
