/**
 * Disk persistence: save and load game state to ~/.pi/agent/extensions/pi-chess/.games/
 *
 * Each save is a JSON file named by timestamp. The latest save is loaded
 * on `/chess` startup so the player can resume where they left off.
 */

import { mkdir, readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { DiskSaveData } from "./types.js";
import { GAMES_DIR_NAME } from "./constants.js";

/** Maximum number of saved games to keep on disk. Oldest are pruned. */
const MAX_SAVES = 20;

/**
 * Get the path to the games directory.
 * ~/.pi/agent/extensions/pi-chess/.games/
 */
export function getGamesDir(): string {
	return join(homedir(), ".pi", "agent", "extensions", "pi-chess", GAMES_DIR_NAME);
}

/** Save game state to disk. Returns the path of the saved file. */
export async function saveGameToDisk(data: DiskSaveData): Promise<string> {
	const dir = getGamesDir();
	await mkdir(dir, { recursive: true });

	const timestamp = data.savedAt.replace(/[:.]/g, "-");
	const filename = `game-${timestamp}.json`;
	const filepath = join(dir, filename);

	await writeFile(filepath, JSON.stringify(data, null, 2), "utf-8");

	// Prune old saves beyond MAX_SAVES
	await pruneOldSaves(dir);

	return filepath;
}

/** Load the most recent saved game from disk. Returns null if none found. */
export async function loadLatestGame(): Promise<DiskSaveData | null> {
	const dir = getGamesDir();

	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return null;
	}

	const jsonFiles = entries
		.filter((e) => e.startsWith("game-") && e.endsWith(".json"))
		.sort();

	if (jsonFiles.length === 0) return null;

	const latest = jsonFiles[jsonFiles.length - 1];
	const filepath = join(dir, latest);

	try {
		const content = await readFile(filepath, "utf-8");
		const data = JSON.parse(content) as DiskSaveData;
		// Basic validation
		if (typeof data.fen === "string" && typeof data.playerColor === "string") {
			return data;
		}
		return null;
	} catch {
		return null;
	}
}

/** Delete all saved games from disk (fresh start). */
export async function deleteAllSaves(): Promise<void> {
	const dir = getGamesDir();

	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return;
	}

	for (const entry of entries) {
		if (entry.startsWith("game-") && entry.endsWith(".json")) {
			await unlink(join(dir, entry)).catch(() => {});
		}
	}
}

/** Prune old saves beyond MAX_SAVES, keeping the most recent ones. */
async function pruneOldSaves(dir: string): Promise<void> {
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return;
	}

	const jsonFiles = entries
		.filter((e) => e.startsWith("game-") && e.endsWith(".json"))
		.sort();

	// Keep at most MAX_SAVES; delete the oldest
	while (jsonFiles.length > MAX_SAVES) {
		const toDelete = jsonFiles.shift()!;
		await unlink(join(dir, toDelete)).catch(() => {});
	}
}