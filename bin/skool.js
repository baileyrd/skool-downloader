#!/usr/bin/env node
// Packaging tradeoff: this package ships TypeScript sources and runs them
// via tsx at runtime (tsx is a regular dependency) instead of shipping a
// compiled dist/. This keeps the publish pipeline trivial — no build step,
// stack traces point at real sources — at the cost of a slightly larger
// install and a small esbuild transform on startup.
import { spawn } from 'child_process';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Resolve tsx through normal module resolution rather than a hardcoded
// node_modules/.bin path, so it works wherever npm hoists the dependency
// (local checkout, npx cache, nested install). Spawning the CLI entry with
// the current node executable also avoids .cmd shim issues on Windows.
const require = createRequire(import.meta.url);
const tsxCli = require.resolve('tsx/cli');

const entry = path.join(projectRoot, 'src', 'cli.ts');
const args = process.argv.slice(2);

const child = spawn(process.execPath, [tsxCli, entry, ...args], {
    stdio: 'inherit'
});

child.on('exit', (code) => {
    process.exit(code ?? 0);
});
