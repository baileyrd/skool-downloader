export type Logger = {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string, error?: unknown) => void;
    debug: (message: string) => void;
};

type LoggerOptions = {
    verbose?: boolean;
    silent?: boolean;
};

/**
 * Wraps a logger so every message carries a prefix (e.g. a `[module.lesson]`
 * tag). With concurrent lesson downloads the raw console output interleaves;
 * the prefix keeps each line attributable to its lesson.
 */
export function withPrefix(base: Logger, prefix: string): Logger {
    return {
        info: (message) => base.info(`${prefix}${message}`),
        warn: (message) => base.warn(`${prefix}${message}`),
        error: (message, error) => base.error(`${prefix}${message}`, error),
        debug: (message) => base.debug(`${prefix}${message}`)
    };
}

export function createConsoleLogger(options: LoggerOptions = {}): Logger {
    const { verbose = false, silent = false } = options;
    const noop = () => {};

    if (silent) {
        return { info: noop, warn: noop, error: noop, debug: noop };
    }

    return {
        info: (message) => {
            console.log(message);
        },
        warn: (message) => {
            console.warn(message);
        },
        error: (message, error) => {
            if (error) {
                console.error(message, error);
            } else {
                console.error(message);
            }
        },
        debug: verbose
            ? (message) => {
                  console.log(message);
              }
            : noop
    };
}
