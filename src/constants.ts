/**
 * Constants used throughout the chess extension.
 */

import { type Square } from "chess.js";

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

export const PIECE_SYMBOLS: Record<string, Record<string, string>> = {
	w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
	b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

export const PIECE_LETTERS: Record<string, Record<string, string>> = {
	w: { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" },
	b: { k: "k", q: "q", r: "r", b: "b", n: "n", p: "p" },
};

// ANSI 256-color codes
export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";

// Square backgrounds
export const LIGHT_SQ = "\x1b[48;5;254m";
export const DARK_SQ = "\x1b[48;5;238m";
// Highlights
export const CURSOR_BG = "\x1b[48;5;22m";   // dark green
export const SELECTED_BG = "\x1b[48;5;55m";  // dark purple
export const LAST_MOVE_LIGHT = "\x1b[48;5;186m";
export const LAST_MOVE_DARK = "\x1b[48;5;137m";
export const CHECK_BG = "\x1b[48;5;160m";
export const LEGAL_CAPTURE_BG_LIGHT = "\x1b[48;5;151m";
export const LEGAL_CAPTURE_BG_DARK = "\x1b[48;5;65m";
export const LEGAL_EMPTY_BG_LIGHT = "\x1b[48;5;194m";
export const LEGAL_EMPTY_BG_DARK = "\x1b[48;5;22m";
// Piece foregrounds
export const WHITE_PIECE_FG = "\x1b[38;5;33m";   // bright blue
export const BLACK_PIECE_FG = "\x1b[38;5;202m";   // bright orange
export const HIGHLIGHT_FG = "\x1b[38;5;255m";    // bright white (for pieces on highlighted squares)
export const LEGAL_DOT_FG = "\x1b[38;5;82m";    // bright green
export const DIM_FG = "\x1b[38;5;245m";          // dim gray (for empty square dots)
export const PROMOTE_FG = "\x1b[38;5;226m";      // bright yellow

// Promotion pieces in order
export const PROMOTION_CHOICES: { piece: string; label: string; symbol: string }[] = [
	{ piece: "q", label: "Queen", symbol: "♕/♛" },
	{ piece: "r", label: "Rook", symbol: "♖/♜" },
	{ piece: "b", label: "Bishop", symbol: "♗/♝" },
	{ piece: "n", label: "Knight", symbol: "♘/♞" },
];

// Custom entry / message types
export const SAVE_TYPE = "chess-save";
export const MOVE_MESSAGE_TYPE = "chess-move";
export const GAME_OVER_MESSAGE_TYPE = "chess-game-over";

// Special "squares" used as sentinel values for non-move actions
export const RESTART_SENTINEL = "__restart__" as unknown as Square;
export const UNDO_SENTINEL = "__undo__" as unknown as Square;
export const NEW_GAME_SENTINEL = "__newgame__" as unknown as Square;
export const GAMES_SENTINEL = "__games__" as unknown as Square;
export const FLIP_SENTINEL = "__flip__" as unknown as Square;

// Disk persistence directory (relative to agent dir)
export const GAMES_DIR_NAME = ".games";