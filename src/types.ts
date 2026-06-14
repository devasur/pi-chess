/**
 * Type definitions for the chess extension.
 */

import type { Chess, Square, Move } from "chess.js";

export type PlayerColor = "w" | "b";

export interface BoardState {
	game: Chess;
	playerColor: PlayerColor;
	// Cursor position (display coordinates: row 0 = top, col 0 = left)
	cursorRow: number;
	cursorCol: number;
	// Selection state
	selectedSquare: Square | null;
	legalMoves: Move[];
	// Promotion state
	promotionFrom: Square | null;
	promotionTo: Square | null;
	promotionIndex: number;
	// Last move for highlighting
	lastMoveFrom: Square | null;
	lastMoveTo: Square | null;
	// Game status
	gameOver: boolean;
	gameResult: string;
}

// Persisted state (FEN + metadata) — written to session entries
export interface SaveData {
	fen: string;
	playerColor: PlayerColor;
	lastMoveFrom: string | null;
	lastMoveTo: string | null;
	pgn: string;
}

// Disk save format — written to ~/.pi/agent/extensions/pi-chess/.games/
export interface DiskSaveData extends SaveData {
	/** ISO timestamp of the last move */
	savedAt: string;
}

// Details sent to the LLM
export interface BoardDetails {
	board: string;
	fen: string;
	turn: string;
	lastMove: string;
	legalMoves: string[];
	isCheck: boolean;
	isCheckmate: boolean;
	isDraw: boolean;
	isStalemate: boolean;
	gameOver: boolean;
}