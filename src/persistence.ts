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

/** Lightweight summary of a saved game — no Chess object needed. */
export interface GameSummary {
	/** Filename (e.g. "game-2026-06-14T17-30-22-123Z.json") */
	filename: string;
	/** Full disk path */
	filepath: string;
	/** ISO timestamp from the save */
	savedAt: string;
	/** Player color: "w" or "b" */
	playerColor: "w" | "b";
	/** Number of half-moves (ply) from the PGN */
	moveCount: number;
	/** Game result: "" if in progress, otherwise "Checkmate! ..." etc. */
	result: string;
	/** Last move in SAN (from PGN) */
	lastMove: string;
}

/**
 * List all saved games, newest first, with lightweight metadata.
 * Reads each file but does NOT create a Chess object — just parses JSON.
 */
export async function listSavedGames(): Promise<GameSummary[]> {
	const dir = getGamesDir();

	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return [];
	}

	const jsonFiles = entries
		.filter((e) => e.startsWith("game-") && e.endsWith(".json"))
		.sort(); // oldest → newest

	const summaries: GameSummary[] = [];

	for (const filename of jsonFiles) {
		const filepath = join(dir, filename);
		try {
			const content = await readFile(filepath, "utf-8");
			const data = JSON.parse(content) as DiskSaveData;
			if (typeof data.fen !== "string" || typeof data.playerColor !== "string") continue;

			// Extract move count from PGN
			const pgn = data.pgn ?? "";
			const moves = pgn
				.replace(/\[.*?\]\s*/gs, "") // strip headers
				.trim()
				.split(/\s+/)
				.filter((token) => !token.match(/^\d+\./)); // remove move numbers
			const moveCount = moves.filter((m) => m.length > 0 && m !== "*" && m !== "1-0" && m !== "0-1" && m !== "1/2-1/2").length;

			// Last move
			const lastMove = moveCount > 0 ? moves[moves.length - 1] : "—";

			// Detect result from FEN or PGN
			let result = "";
			if (pgn.includes("1-0")) result = "1-0 White wins";
			else if (pgn.includes("0-1")) result = "0-1 Black wins";
			else if (pgn.includes("1/2-1/2")) result = "½-½ Draw";
			else {
				// Check FEN for checkmate/stalemate
				const fenParts = data.fen.split(" ");
				if (fenParts.length > 0) {
					// Simple heuristic: if no legal moves indicated by FEN patterns
					// We can't fully determine without chess.js, so just mark in-progress
				}
			}

			summaries.push({
				filename,
				filepath,
				savedAt: data.savedAt,
				playerColor: data.playerColor as "w" | "b",
				moveCount,
				result,
				lastMove,
			});
		} catch {
			// Skip corrupt files
		}
	}

	// Newest first
	summaries.reverse();
	return summaries;
}

/** Load a specific saved game by filename. Returns null on error. */
export async function loadGameByPath(filepath: string): Promise<DiskSaveData | null> {
	try {
		const content = await readFile(filepath, "utf-8");
		const data = JSON.parse(content) as DiskSaveData;
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