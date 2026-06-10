import { describe, expect, it, vi } from 'vitest';

import { createConsoleLogger } from '../src/logger.js';

describe('smoke', () => {
    it('runs the test harness', () => {
        expect(1 + 1).toBe(2);
    });
});

describe('createConsoleLogger', () => {
    it('returns a logger with all four methods', () => {
        const logger = createConsoleLogger();
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
    });

    it('silent mode emits nothing', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const logger = createConsoleLogger({ silent: true });
            logger.info('info');
            logger.warn('warn');
            logger.error('error');
            logger.debug('debug');
            expect(logSpy).not.toHaveBeenCalled();
            expect(warnSpy).not.toHaveBeenCalled();
            expect(errorSpy).not.toHaveBeenCalled();
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('debug only logs when verbose is enabled', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            createConsoleLogger().debug('hidden');
            expect(logSpy).not.toHaveBeenCalled();

            createConsoleLogger({ verbose: true }).debug('shown');
            expect(logSpy).toHaveBeenCalledWith('shown');
        } finally {
            vi.restoreAllMocks();
        }
    });

    it('error forwards the error object when provided', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const logger = createConsoleLogger();
            const cause = new Error('boom');
            logger.error('failed', cause);
            expect(errorSpy).toHaveBeenCalledWith('failed', cause);
        } finally {
            vi.restoreAllMocks();
        }
    });
});
