import { defineConfig } from 'vitest/config';

// Unit tests live in test/. The tests/ directory is reserved for Playwright
// e2e specs (@playwright/test), which vitest must not try to execute.
export default defineConfig({
    test: {
        include: ['test/**/*.test.ts']
    }
});
