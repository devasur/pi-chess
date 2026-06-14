/**
 * State management: boardState, gameActive flag, chessComponent reference,
 * and helpers for constructing, serializing, and inspecting state.
 */

import { Chess, type Square } from "chess.js";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SAVE_TYPE } from "./constants.js";
import type { BoardDetails, BoardState, DiskSaveData, PlayerColor, SaveData } from "./types.js";
import { boardToAscii } from "./ascii-board.js";
import { saveGameToDisk } from "./persistence.js";

/** The current game state. Mutated in place. */
export let boardState: BoardState | null = null;

/** Reference to the active ChessComponent (for triggering re-renders). */
export let chessComponent: { updateState: (state: BoardState) => void } | null = null;

/** Whether a chess game is currently in progress. */
export let gameActive = false;

export function setBoardState(state: BoardState | null): void {
	boardState = state;
}

export function setChessComponent(
	component: { updateState: (state: BoardState) => void } | null,
): void {
	chessComponent = component;
}

export function setGameActive(active: boolean): void {
	gameActive = active;
}

/**
 * Construct a fresh board state for a new game.
 * The cursor starts on the e-file, near the player's own back rank.
 */
export function createInitialState(playerColor: PlayerColor = "w"): BoardState {
	const game = new Chess();
	return {
		game,
		playerColor,
		cursorRow: playerColor === "w" ? 6 : 1,
		cursorCol: 4, // e-file
		selectedSquare: null,
		legalMoves: [],
		promotionFrom: null,
		promotionTo: null,
		promotionIndex: 0,
		lastMoveFrom: null,
		lastMoveTo: null,
		gameOver: false,
		gameResult: "",
	};
}

/** Snapshot the current game into a persistable record. */
export function getSaveData(): SaveData {
	if (!boardState) {
		throw new Error("No board state to save");
	}
	return {
		fen: boardState.game.fen(),
		playerColor: boardState.playerColor,
		lastMoveFrom: boardState.lastMoveFrom,
		lastMoveTo: boardState.lastMoveTo,
		pgn: boardState.game.pgn(),
	};
}

/**
 * Save game state both to the session entry and to disk.
 *
 * Call this after every state change (moves, undo, restart) to ensure
 * the game can be resumed even after quitting pi.
 */
export async function saveGame(pi: { appendEntry: (type: string, data: SaveData) => void }): Promise<void> {
	if (!boardState) return;

	// Session entry for reconstruction on reload within the same session
	const data = getSaveData();
	pi.appendEntry(SAVE_TYPE, data);

	// Disk save for cross-session persistence
	const diskData: DiskSaveData = {
		...data,
		savedAt: new Date().toISOString(),
	};
	await saveGameToDisk(diskData);
}

/** Build the LLM-facing details payload for the current position. */
export function getBoardDetails(): BoardDetails {
	if (!boardState) {
		throw new Error("No board state to describe");
	}
	const game = boardState.game;
	const moves = game.moves();
	return {
		board: boardToAscii(game),
		fen: game.fen(),
		turn: game.turn() === "w" ? "White" : "Black",
		lastMove: boardState.lastMoveFrom && boardState.lastMoveTo
			? `${boardState.lastMoveFrom}-${boardState.lastMoveTo}`
			: "none",
		legalMoves: moves,
		isCheck: game.isCheck(),
		isCheckmate: game.isCheckmate(),
		isDraw: game.isDraw(),
		isStalemate: game.isStalemate(),
		gameOver: game.isGameOver(),
	};
}

/**
 * Reconstruct the boardState from the most recent save entry in the session.
 * Called on `session_start` and `session_tree` so the game resumes after reload.
 */
export function reconstructState(ctx: ExtensionContext): void {
	const entries = ctx.sessionManager.getEntries();
	let latestSave: SaveData | null = null;

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === SAVE_TYPE) {
			latestSave = entry.data as SaveData;
			break;
		}
	}

	if (latestSave) {
		try {
			const game = new Chess(latestSave.fen);
			boardState = {
				game,
				playerColor: latestSave.playerColor as PlayerColor,
				cursorRow: latestSave.playerColor === "w" ? 6 : 1,
				cursorCol: 4,
				selectedSquare: null,
				legalMoves: [],
				promotionFrom: null,
				promotionTo: null,
				promotionIndex: 0,
				lastMoveFrom: latestSave.lastMoveFrom as Square | null,
				lastMoveTo: latestSave.lastMoveTo as Square | null,
				gameOver: game.isGameOver(),
				gameResult: game.isGameOver() ? getGameResult(game) : "",
			};
		} catch {
			boardState = createInitialState();
		}
	} else {
		boardState = createInitialState();
	}
	gameActive = false;
}

/**
 * Reconstruct board state from a DiskSaveData (loaded from disk).
 * Used when resuming a game from disk on /chess startup.
 */
export function reconstructFromDiskData(data: DiskSaveData): BoardState {
	const game = new Chess(data.fen);
	return {
		game,
		playerColor: data.playerColor as PlayerColor,
		cursorRow: data.playerColor === "w" ? 6 : 1,
		cursorCol: 4,
		selectedSquare: null,
		legalMoves: [],
		promotionFrom: null,
		promotionTo: null,
		promotionIndex: 0,
		lastMoveFrom: data.lastMoveFrom as Square | null,
		lastMoveTo: data.lastMoveTo as Square | null,
		gameOver: game.isGameOver(),
		gameResult: game.isGameOver() ? getGameResult(game) : "",
	};
}

/** Build a human-readable result string for a finished game. */
export function getGameResult(game: Chess): string {
	if (game.isCheckmate()) {
		const winner = game.turn() === "w" ? "Black" : "White";
		return `Checkmate! ${winner} wins.`;
	}
	if (game.isStalemate()) return "Stalemate! Draw.";
	if (game.isDraw()) {
		if (game.isThreefoldRepetition()) return "Draw by threefold repetition.";
		if (game.isInsufficientMaterial()) return "Draw by insufficient material.";
		return "Draw.";
	}
	return "";
}