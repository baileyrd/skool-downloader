/**
 * Reconciles the on-disk group folder with the group's current display name,
 * using the immutable URL slug as identity.
 *
 * Group folders are named after the group's display name, but archives made
 * by older versions used the URL slug, and Skool owners can rename their
 * group at any time. Without reconciliation either case makes the whole
 * community look new and re-downloads every course into a fresh folder next
 * to the old one. This pass runs before any download and instead renames the
 * existing folder, matching it by:
 *
 * 1. a `.group.json` manifest whose `slug` matches (written by this pass), or
 * 2. the legacy convention of the folder being named after the slug itself.
 */

import fs from 'fs-extra';
import path from 'path';

import { createConsoleLogger, type Logger } from './logger.js';
import { sanitizeName, writeAtomicJson, type GroupManifest } from './shared.js';

/**
 * Extracts the group slug (first path segment) from any skool.com URL.
 * Returns null when the URL cannot be parsed or has no path.
 */
export function extractGroupSlug(url: string): string | null {
    try {
        const segments = new URL(url).pathname.split('/').filter(Boolean);
        return segments[0] ?? null;
    } catch {
        return null;
    }
}

async function readGroupManifest(dir: string): Promise<GroupManifest | null> {
    try {
        const manifest: GroupManifest = await fs.readJson(path.join(dir, '.group.json'));
        return manifest?.slug ? manifest : null;
    } catch {
        return null;
    }
}

/**
 * Ensures the group folder for `groupName` exists at its current name inside
 * `parentDir`, renaming a folder from a previous name when one can be
 * identified by `slug`. Always (re)writes the folder's `.group.json`.
 *
 * Returns the absolute path of the group folder.
 */
export async function reconcileGroupDir(
    parentDir: string,
    groupName: string,
    slug: string | null,
    logger: Logger = createConsoleLogger()
): Promise<string> {
    const targetDir = path.join(parentDir, sanitizeName(groupName));

    if (slug && !fs.existsSync(targetDir) && fs.existsSync(parentDir)) {
        let legacyDir: string | null = null;

        // Prefer an explicit .group.json slug match anywhere in the parent.
        const entries = await fs.readdir(parentDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const manifest = await readGroupManifest(path.join(parentDir, entry.name));
            if (manifest?.slug === slug) {
                legacyDir = path.join(parentDir, entry.name);
                break;
            }
        }

        // Fall back to the legacy convention: a folder named after the slug.
        if (!legacyDir) {
            const slugDir = path.join(parentDir, sanitizeName(slug));
            if (fs.existsSync(slugDir)) {
                legacyDir = slugDir;
            }
        }

        if (legacyDir) {
            await fs.move(legacyDir, targetDir);
            logger.info(`📦 Renamed group folder: ${path.basename(legacyDir)} → ${path.basename(targetDir)}`);
        }
    } else if (slug && fs.existsSync(targetDir)) {
        // Both the display-name folder and a legacy slug folder existing at
        // once means a previous run already split the archive. Merging
        // automatically risks clobbering content — surface it instead.
        const slugDir = path.join(parentDir, sanitizeName(slug));
        if (slugDir !== targetDir && fs.existsSync(slugDir)) {
            logger.warn(
                `⚠️ Both "${path.basename(targetDir)}" and legacy "${path.basename(slugDir)}" exist — ` +
                'the archive may be split across both. Downloads go to the former; merge or remove the latter manually.'
            );
        }
    }

    await fs.ensureDir(targetDir);
    if (slug) {
        const manifest: GroupManifest = {
            slug,
            groupName,
            updatedAt: new Date().toISOString()
        };
        await writeAtomicJson(path.join(targetDir, '.group.json'), manifest);
    }

    return targetDir;
}
