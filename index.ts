/**
 * Chess extension — play chess against the current LLM model in the TUI.
 *
 * Usage: /chess          — start a new game (you play White)
 *        /chess black    — start a new game (you play Black)
 *
 * Controls:
 *   Arrow keys  — move cursor
 *   Enter        — select piece / confirm destination / choose promotion
 *   Escape       — deselect piece / quit (on empty selection)
 *   Q            — quit
 *   R            — restart (when game is over)
 *   U            — undo last move pair
 *
 * The LLM plays via the `chess_move` tool using standard algebraic notation.
 */

import { Chess, type Square, type Move } from "chess.js";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	matchesKey,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"] as const;

const PIECE_SYMBOLS: Record<string, Record<string, string>> = {
	w: { k: "♔", q: "♕", r: "♖", b: "♗", n: "♘", p: "♙" },
	b: { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" },
};

const PIECE_LETTERS: Record<string, Record<string, string>> = {
	w: { k: "K", q: "Q", r: "R", b: "B", n: "N", p: "P" },
	b: { k: "k", q: "q", r: "r", b: "b", n: "n", p: "p" },
};

// ANSI 256-color codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// Square backgrounds
const LIGHT_SQ = "\x1b[48;5;254m";
const DARK_SQ = "\x1b[48;5;238m";
// Highlights
const CURSOR_BG = "\x1b[48;5;22m";   // dark green
const SELECTED_BG = "\x1b[48;5;55m";  // dark purple
const LAST_MOVE_LIGHT = "\x1b[48;5;186m";
const LAST_MOVE_DARK = "\x1b[48;5;137m";
const CHECK_BG = "\x1b[48;5;160m";
const LEGAL_CAPTURE_BG_LIGHT = "\x1b[48;5;151m";
const LEGAL_CAPTURE_BG_DARK = "\x1b[48;5;65m";
const LEGAL_EMPTY_BG_LIGHT = "\x1b[48;5;194m";
const LEGAL_EMPTY_BG_DARK = "\x1b[48;5;22m";
// Piece foregrounds
const WHITE_PIECE_FG = "\x1b[38;5;33m";   // bright blue
const BLACK_PIECE_FG = "\x1b[38;5;202m";   // bright orange
const HIGHLIGHT_FG = "\x1b[38;5;255m";    // bright white (for pieces on highlighted squares)
const LEGAL_DOT_FG = "\x1b[38;5;82m";    // bright green
const DIM_FG = "\x1b[38;5;245m";          // dim gray (for empty square dots)
const PROMOTE_FG = "\x1b[38;5;226m";      // bright yellow

// Promotion pieces in order
const PROMOTION_CHOICES: { piece: string; label: string; symbol: string }[] = [
	{ piece: "q", label: "Queen", symbol: "♕/♛" },
	{ piece: "r", label: "Rook", symbol: "♖/♜" },
	{ piece: "b", label: "Bishop", symbol: "♗/♝" },
	{ piece: "n", label: "Knight", symbol: "♘/♞" },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlayerColor = "w" | "b";

interface BoardState {
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

// Persisted state (FEN + metadata)
interface SaveData {
	fen: string;
	playerColor: PlayerColor;
	lastMoveFrom: string | null;
	lastMoveTo: string | null;
	pgn: string;
}

// Details sent to the LLM
interface BoardDetails {
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

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

const SAVE_TYPE = "chess-save";
const MOVE_MESSAGE_TYPE = "chess-move";
const GAME_OVER_MESSAGE_TYPE = "chess-game-over";

let boardState: BoardState;
let chessComponent: ChessComponent | null = null;
let gameActive = false;

function squareFromCoords(row: number, col: number): Square {
	return `${FILES[col]}${RANKS[row]}` as Square;
}

function coordsFromSquare(sq: Square): [number, number] {
	const file = sq.charCodeAt(0) - 97; // 'a' = 0
	const rank = 8 - parseInt(sq[1]);    // '8' = 0
	return [rank, file];
}

function isLightSquare(sq: Square): boolean {
	const [row, col] = coordsFromSquare(sq);
	return (row + col) % 2 === 0;
}

function createInitialState(playerColor: PlayerColor = "w"): BoardState {
	const game = new Chess();
	return {
		game,
		playerColor,
		cursorRow: playerColor === "w" ? 6 : 1, // Start near own pieces
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

function getSaveData(): SaveData {
	return {
		fen: boardState.game.fen(),
		playerColor: boardState.playerColor,
		lastMoveFrom: boardState.lastMoveFrom,
		lastMoveTo: boardState.lastMoveTo,
		pgn: boardState.game.pgn(),
	};
}

function getBoardDetails(): BoardDetails {
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

function reconstructState(ctx: any): void {
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

function getGameResult(game: Chess): string {
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

// ---------------------------------------------------------------------------
// Board → ASCII for LLM consumption
// ---------------------------------------------------------------------------

function boardToAscii(game: Chess): string {
	const board = game.board();
	const lines: string[] = [];
	lines.push("  a b c d e f g h");
	for (let row = 0; row < 8; row++) {
		const rank = 8 - row;
		const cells: string[] = [];
		for (let col = 0; col < 8; col++) {
			const piece = board[row][col];
			if (piece) {
				cells.push(PIECE_LETTERS[piece.color][piece.type]);
			} else {
				cells.push(".");
			}
		}
		lines.push(`${rank} ${cells.join(" ")} ${rank}`);
	}
	lines.push("  a b c d e f g h");
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// TUI Board Rendering
// ---------------------------------------------------------------------------

class ChessComponent implements Component {
	private state: BoardState;
	private onClose: () => void;
	private onUserMove: (from: Square, to: Square, promotion?: string) => void;
	private tui: { requestRender: () => void };
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private version = 0;
	private cachedVersion = -1;

	constructor(
		tui: { requestRender: () => void },
		onClose: () => void,
		onUserMove: (from: Square, to: Square, promotion?: string) => void,
		state: BoardState,
	) {
		this.tui = tui;
		this.onClose = onClose;
		this.onUserMove = onUserMove;
		this.state = state;
	}

	updateState(state: BoardState): void {
		this.state = state;
		this.version++;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		const s = this.state;

		// Quit
		if (matchesKey(data, "escape")) {
			if (s.selectedSquare) {
				// Deselect
				s.selectedSquare = null;
				s.legalMoves = [];
				this.version++;
				this.tui.requestRender();
				return;
			}
			this.onClose();
			return;
		}
		if (data === "q" || data === "Q") {
			this.onClose();
			return;
		}

		// Restart when game over
		if (s.gameOver) {
			if (data === "r" || data === "R") {
				this.onUserMove("__restart__" as Square, "__restart__" as Square);
			}
			return;
		}

		// Undo
		if (data === "u" || data === "U") {
			this.onUserMove("__undo__" as Square, "__undo__" as Square);
			return;
		}

		// Promotion selection
		if (s.promotionFrom) {
			if (matchesKey(data, "up") && s.promotionIndex > 0) {
				s.promotionIndex--;
				this.version++;
				this.tui.requestRender();
			} else if (matchesKey(data, "down") && s.promotionIndex < PROMOTION_CHOICES.length - 1) {
				s.promotionIndex++;
				this.version++;
				this.tui.requestRender();
			} else if (matchesKey(data, "enter") || data === " ") {
				const choice = PROMOTION_CHOICES[s.promotionIndex];
				const from = s.promotionFrom;
				const to = s.promotionTo!;
				s.promotionFrom = null;
				s.promotionTo = null;
				s.promotionIndex = 0;
				this.onUserMove(from, to, choice.piece);
			} else if (matchesKey(data, "escape")) {
				s.promotionFrom = null;
				s.promotionTo = null;
				s.promotionIndex = 0;
				this.version++;
				this.tui.requestRender();
			}
			return;
		}

		// Not user's turn
		if (s.game.turn() !== s.playerColor) return;

		// Arrow key movement
		if (matchesKey(data, "up") && s.cursorRow > 0) {
			s.cursorRow--;
			this.version++;
			this.tui.requestRender();
		} else if (matchesKey(data, "down") && s.cursorRow < 7) {
			s.cursorRow++;
			this.version++;
			this.tui.requestRender();
		} else if (matchesKey(data, "left") && s.cursorCol > 0) {
			s.cursorCol--;
			this.version++;
			this.tui.requestRender();
		} else if (matchesKey(data, "right") && s.cursorCol < 7) {
			s.cursorCol++;
			this.version++;
			this.tui.requestRender();
		} else if (matchesKey(data, "enter") || data === " ") {
			const sq = squareFromCoords(s.cursorRow, s.cursorCol);
			const piece = s.game.get(sq);

			if (s.selectedSquare) {
				// Second click: try to move to this square
				const legalMovesToTarget = s.legalMoves.filter((m) => m.to === sq);
				if (legalMovesToTarget.length > 0) {
					// Check for promotion: if any legal move to this square has a promotion field
					const needsPromotion = legalMovesToTarget.some((m) => m.promotion);
					if (needsPromotion) {
						s.promotionFrom = s.selectedSquare;
						s.promotionTo = sq;
						s.promotionIndex = 0;
						s.selectedSquare = null;
						s.legalMoves = [];
						this.version++;
						this.tui.requestRender();
						return;
					}
					const from = s.selectedSquare;
					s.selectedSquare = null;
					s.legalMoves = [];
					this.onUserMove(from, sq);
				} else if (piece && piece.color === s.playerColor) {
					// Click on own piece: re-select
					s.selectedSquare = sq;
					s.legalMoves = s.game.moves({ square: sq, verbose: true });
					this.version++;
					this.tui.requestRender();
				} else {
					// Click on illegal square: deselect
					s.selectedSquare = null;
					s.legalMoves = [];
					this.version++;
					this.tui.requestRender();
				}
			} else {
				// First click: select a piece
				if (piece && piece.color === s.playerColor) {
					s.selectedSquare = sq;
					s.legalMoves = s.game.moves({ square: sq, verbose: true });
					this.version++;
					this.tui.requestRender();
				}
			}
		}
	}

	invalidate(): void {
		this.cachedWidth = 0;
	}

	render(width: number): string[] {
		if (width === this.cachedWidth && this.cachedVersion === this.version) {
			return this.cachedLines;
		}

		const s = this.state;
		const game = s.game;
		const lines: string[] = [];

		// Header
		const playerLabel = s.playerColor === "w" ? "White" : "Black";
		const agentLabel = s.playerColor === "w" ? "Black" : "White";
		const title = `${BOLD}♟ Chess${RESET} — You: ${playerLabel} vs Agent: ${agentLabel}`;
		lines.push(centerPad(title, width));

		// Status line
		let statusLine: string;
		if (s.gameOver) {
			statusLine = `${BOLD}${s.gameResult}${RESET}`;
		} else if (s.promotionFrom) {
			statusLine = `${PROMOTE_FG}${BOLD}Promote pawn to:${RESET}`;
		} else if (game.turn() !== s.playerColor) {
			statusLine = `${DIM}Agent is thinking...${RESET}`;
		} else if (game.isCheck()) {
			statusLine = `${BOLD}\x1b[38;5;196mCheck!${RESET} ${DIM}(You are in check)${RESET}`;
		} else if (s.selectedSquare) {
			statusLine = `${DIM}Selected ${s.selectedSquare} — choose destination${RESET}`;
		} else {
			statusLine = `${DIM}Your turn — select a piece${RESET}`;
		}
		lines.push(centerPad(statusLine, width));
		lines.push("");

		// Board rendering
		if (s.promotionFrom) {
			lines.push(...this.renderPromotionDialog(width));
		} else {
			lines.push(...this.renderBoard(width));
		}

		lines.push("");

		// Controls
		let controls: string;
		if (s.gameOver) {
			controls = `${BOLD}R${RESET} restart  ${DIM}|${RESET}  ${BOLD}Q${RESET}/${BOLD}ESC${RESET} quit`;
		} else if (s.promotionFrom) {
			controls = `${BOLD}↑↓${RESET} choose  ${DIM}|${RESET}  ${BOLD}ENTER${RESET} confirm  ${DIM}|${RESET}  ${BOLD}ESC${RESET} cancel`;
		} else if (game.turn() !== s.playerColor) {
			controls = `${DIM}Waiting for agent's move...${RESET}`;
		} else if (s.selectedSquare) {
			controls = `${BOLD}↑↓←→${RESET} move  ${DIM}|${RESET}  ${BOLD}ENTER${RESET} confirm  ${DIM}|${RESET}  ${BOLD}ESC${RESET} deselect  ${DIM}|${RESET}  ${BOLD}U${RESET} undo`;
		} else {
			controls = `${BOLD}↑↓←→${RESET} move  ${DIM}|${RESET}  ${BOLD}ENTER${RESET} select  ${DIM}|${RESET}  ${BOLD}Q${RESET}/${BOLD}ESC${RESET} quit  ${DIM}|${RESET}  ${BOLD}U${RESET} undo`;
		}
		lines.push(centerPad(controls, width));

		// Move history
		const history = game.history();
		if (history.length > 0) {
			const moveNums: string[] = [];
			for (let i = 0; i < history.length; i += 2) {
				const num = Math.floor(i / 2) + 1;
				const whiteMove = history[i];
				const blackMove = history[i + 1] ? ` ${history[i + 1]}` : "";
				moveNums.push(`${num}. ${whiteMove}${blackMove}`);
			}
			const historyLine = `${DIM}Moves:${RESET} ${moveNums.join("  ")}`;
			lines.push(centerPad(truncateToWidth(historyLine, width), width));
		}

		lines.push(DIM + "─".repeat(width) + RESET);

		this.cachedLines = lines;
		this.cachedWidth = width;
		this.cachedVersion = this.version;
		return this.cachedLines;
	}

	private renderBoard(width: number): string[] {
		const s = this.state;
		const game = s.game;
		const board = game.board();
		const lines: string[] = [];

		const CELL_W = 7;
		const CELL_H = 3;

		const legalTargets = new Set(s.legalMoves.map((m) => m.to));
		const legalCaptures = new Set(
			s.legalMoves.filter((m) => m.captured).map((m) => m.to),
		);

		const centerStr = (str: string, w: number): string => {
			const vlen = visibleWidth(str);
			const totalPad = Math.max(0, w - vlen);
			const left = Math.floor(totalPad / 2);
			return " ".repeat(left) + str + " ".repeat(totalPad - left);
		};

		const buildRow = (row: number, lineInCell: number): string => {
			const rank = RANKS[row];
			const midLine = Math.floor(CELL_H / 2);

			let line = "";

			// Rank label (left side)
			if (lineInCell === midLine) {
				line += ` ${DIM}${rank}${RESET} `;
			} else {
				line += "   ";
			}

			// Board cells
			for (let col = 0; col < 8; col++) {
				const sq = squareFromCoords(row, col);
				const piece = board[row][col];
				const isLight = (row + col) % 2 === 0;
				const isCursor = row === s.cursorRow && col === s.cursorCol;
				const isSelected = sq === s.selectedSquare;
				const isTarget = legalTargets.has(sq);
				const isCapture = legalCaptures.has(sq);
				const isLast = sq === s.lastMoveFrom || sq === s.lastMoveTo;
				const isCheck =
					game.isCheck() && piece?.type === "k" && piece.color === game.turn();

				let bg: string;
				if (isSelected)      bg = SELECTED_BG;
				else if (isCheck)     bg = CHECK_BG;
				else if (isCursor)    bg = CURSOR_BG;
				else if (isCapture)   bg = isLight ? LEGAL_CAPTURE_BG_LIGHT : LEGAL_CAPTURE_BG_DARK;
				else if (isLast)      bg = isLight ? LAST_MOVE_LIGHT : LAST_MOVE_DARK;
				else                  bg = isLight ? LIGHT_SQ : DARK_SQ;

				if (lineInCell === midLine) {
					let content: string;
					let fg: string;
					if (piece) {
						content = PIECE_SYMBOLS[piece.color][piece.type];
						fg = (isSelected || isCursor || isCheck)
							? HIGHLIGHT_FG + BOLD
							: piece.color === "w" ? WHITE_PIECE_FG + BOLD : BLACK_PIECE_FG + BOLD;
					} else if (isTarget) {
						content = "\u25cf";
						fg = LEGAL_DOT_FG;
					} else {
						content = isLight ? " " : "\u00b7";
						fg = isLight ? "" : DIM_FG;
					}
					line += `${bg}${fg}${centerStr(content, CELL_W)}`;
				} else {
					line += `${bg}${" ".repeat(CELL_W)}`;
				}
			}

			line += RESET;
			if (lineInCell === midLine) {
				line += ` ${DIM}${rank}${RESET}`;
			} else {
				line += "  ";
			}

			return line;
		};

		const fileRow = "   " + FILES.map((f) => centerStr(f, CELL_W)).join("") + "  ";
		lines.push(centerPad(DIM + fileRow + RESET, width));

		for (let row = 0; row < 8; row++) {
			for (let lineInCell = 0; lineInCell < CELL_H; lineInCell++) {
				lines.push(centerPad(buildRow(row, lineInCell), width));
			}
		}

		lines.push(centerPad(DIM + fileRow + RESET, width));

		return lines;
	}


	private renderPromotionDialog(width: number): string[] {
		const s = this.state;
		const lines: string[] = [];

		lines.push(centerPad(`${BOLD}Choose promotion piece:${RESET}`, width));
		lines.push("");

		for (let i = 0; i < PROMOTION_CHOICES.length; i++) {
			const choice = PROMOTION_CHOICES[i];
			const prefix = i === s.promotionIndex
				? `${BOLD}${PROMOTE_FG}▸ ${RESET}`
				: "  ";
			const symbol = s.playerColor === "w"
				? PIECE_SYMBOLS.w[choice.piece]
				: PIECE_SYMBOLS.b[choice.piece];
			const highlight = i === s.promotionIndex
				? `${BOLD}${PROMOTE_FG}`
				: DIM;
			lines.push(
				centerPad(
					`${prefix}${highlight}${symbol} ${choice.label}${RESET}`,
					width,
				),
			);
		}

		return lines;
	}
}

function centerPad(text: string, width: number): string {
	const textLen = visibleWidth(text);
	if (textLen >= width) return truncateToWidth(text, width);
	const pad = width - textLen;
	const left = Math.floor(pad / 2);
	return " ".repeat(left) + text + " ".repeat(pad - left);
}

// ---------------------------------------------------------------------------
// Message renderers
// ---------------------------------------------------------------------------

class BoardMessageComponent implements Component {
	private readonly title: string;
	private readonly details: BoardDetails | undefined;
	private readonly expanded: boolean;
	private readonly theme: Theme;

	constructor(
		title: string,
		details: BoardDetails | undefined,
		expanded: boolean,
		theme: Theme,
	) {
		this.title = title;
		this.details = details;
		this.expanded = expanded;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const dim = (s: string) => this.theme.fg("dim", s);
		const lines: string[] = [];
		const titleLen = visibleWidth(this.title);
		const fillLen = Math.max(0, width - titleLen - 2);
		const leftFill = Math.floor(fillLen / 2);
		const rightFill = fillLen - leftFill;
		lines.push(
			`${dim("─".repeat(leftFill))} ${this.title} ${dim("─".repeat(rightFill))}`,
		);

		if (this.expanded && this.details) {
			lines.push("");
			for (const line of this.details.board.split("\n")) {
				lines.push(centerPad(dim(line), width));
			}
			lines.push("");
			lines.push(
				centerPad(
					`${dim("FEN:")} ${this.details.fen}`,
					width,
				),
			);
		}

		return lines;
	}
}

class GameOverMessageComponent implements Component {
	private readonly result: string;
	private readonly details: BoardDetails | undefined;
	private readonly theme: Theme;

	constructor(result: string, details: BoardDetails | undefined, theme: Theme) {
		this.result = result;
		this.details = details;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const dim = (s: string) => this.theme.fg("dim", s);
		const bold = (s: string) => this.theme.bold(s);
		const accent = (s: string) => this.theme.fg("accent", s);

		const hr = dim("─".repeat(width));
		const lines: string[] = [];
		lines.push(hr);
		lines.push("");
		lines.push(centerPad(bold(accent(this.result)), width));
		lines.push("");

		if (this.details) {
			for (const line of this.details.board.split("\n")) {
				lines.push(centerPad(dim(line), width));
			}
			lines.push("");
		}

		lines.push(hr);
		return lines;
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// Reconstruct state on session start
	pi.on("session_start", async (_event, ctx) => {
		reconstructState(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		reconstructState(ctx);
	});

	// -------------------------------------------------------------------
	// before_agent_start — inject chess instructions
	// -------------------------------------------------------------------
	pi.on("before_agent_start", async (event) => {
		if (!gameActive || !boardState) return undefined;

		const game = boardState.game;
		if (game.isGameOver()) return undefined;

		const isAgentTurn = game.turn() !== boardState.playerColor;
		const agentColor = boardState.playerColor === "w" ? "Black" : "White";
		const playerColor = boardState.playerColor === "w" ? "White" : "Black";

		const boardAscii = boardToAscii(game);
		const moves = game.moves();
		const movesStr = moves.length > 0 ? moves.join(", ") : "(none)";

		const instructions = `

## Chess Game (you are ${agentColor})

A chess game is in progress. You are playing ${agentColor}. The human is playing ${playerColor}.

### Current Position

\`\`\`
${boardAscii}
\`\`\`

FEN: ${game.fen()}
${game.isCheck() ? "**You are in check!** You must get out of check." : ""}
Turn: ${isAgentTurn ? `Your turn (${agentColor})` : `${playerColor}'s turn`}
Legal moves: ${movesStr}

### How to Play

Use the \`chess_move\` tool to make your move. Provide your move in **standard algebraic notation** (SAN).

Examples:
- \`e4\` — pawn to e4
- \`Nf3\` — knight to f3
- \`Bxb5\` — bishop captures on b5
- \`O-O\` — kingside castling
- \`O-O-O\` — queenside castling
- \`e8=Q\` — pawn promotes to queen on e8

If your move is illegal, the tool will return an error with the list of legal moves. Try again with a legal move.

### Strategy Tips
1. Control the center with pawns and pieces.
2. Develop your pieces early (knights and bishops before queens).
3. Castle early for king safety.
4. Look for tactics: forks, pins, skewers, discovered attacks.
5. If in check, you MUST get out of check on your move.

**It is your turn. Make your move now using the chess_move tool.**
`;

		return {
			systemPrompt: event.systemPrompt + instructions,
		};
	});

	// -------------------------------------------------------------------
	// /chess command
	// -------------------------------------------------------------------
	pi.registerCommand("chess", {
		description: "Play chess against the agent (use 'black' to play as Black)",

		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Chess requires interactive mode", "error");
				return;
			}

			const playerColor: PlayerColor =
				args?.trim().toLowerCase() === "black" ? "b" : "w";

			// Initialize or reset game
			boardState = createInitialState(playerColor);
			gameActive = true;
			pi.setSessionName(`Chess — ${playerColor === "w" ? "White" : "Black"}`);

			await ctx.ui.custom<void>((tui, _theme, _kb, done) => {
				chessComponent = new ChessComponent(
					tui,
					() => {
						chessComponent = null;
						gameActive = false;
						done(undefined);
					},
					(from, to, promotion) => {
						// Handle restart
						if (from === ("__restart__" as Square)) {
							boardState = createInitialState(playerColor);
							gameActive = true;
							chessComponent?.updateState(boardState);
							pi.appendEntry(SAVE_TYPE, getSaveData());
							// If player is Black, trigger agent's first move
							if (boardState.playerColor === "b") {
								triggerAgentTurn(pi);
							}
							return;
						}

						// Handle undo
						if (from === ("__undo__" as Square)) {
							// Undo two moves (agent + player) to get back to player's turn
							const history = boardState.game.history();
							if (history.length >= 2) {
								boardState.game.undo(); // Undo agent's move
								boardState.game.undo(); // Undo player's move
								// Update last move
								const verboseHistory = boardState.game.history({ verbose: true });
								if (verboseHistory.length > 0) {
									const lastMove = verboseHistory[verboseHistory.length - 1];
									boardState.lastMoveFrom = lastMove.from as Square;
									boardState.lastMoveTo = lastMove.to as Square;
								} else {
									boardState.lastMoveFrom = null;
									boardState.lastMoveTo = null;
								}
								chessComponent?.updateState(boardState);
								pi.appendEntry(SAVE_TYPE, getSaveData());
							} else if (history.length === 1) {
								boardState.game.undo();
								boardState.lastMoveFrom = null;
								boardState.lastMoveTo = null;
								chessComponent?.updateState(boardState);
								pi.appendEntry(SAVE_TYPE, getSaveData());
							}
							return;
						}

						// Make the player's move
						const game = boardState.game;
						try {
							const moveObj: any = { from, to };
							if (promotion) moveObj.promotion = promotion;
							const move = game.move(moveObj);

							boardState.lastMoveFrom = move.from as Square;
							boardState.lastMoveTo = move.to as Square;
							boardState.selectedSquare = null;
							boardState.legalMoves = [];

							// Check for game over
							if (game.isGameOver()) {
								boardState.gameOver = true;
								boardState.gameResult = getGameResult(game);
								chessComponent?.updateState(boardState);
								pi.appendEntry(SAVE_TYPE, getSaveData());
								emitGameOverMessage(pi);
								gameActive = false;
								return;
							}

							chessComponent?.updateState(boardState);
							pi.appendEntry(SAVE_TYPE, getSaveData());

							// Trigger agent's turn
							triggerAgentTurn(pi);
						} catch (e: any) {
							// Illegal move — this shouldn't happen since we filter legal moves in the UI
							ctx.ui.notify(`Illegal move: ${e.message}`, "error");
						}
					},
					boardState,
				);
				return chessComponent;
			});

			// If player is Black, trigger agent's (White) first move after component is shown
			if (playerColor === "b") {
				// Defer to allow the component to render first
				setTimeout(() => triggerAgentTurn(pi), 100);
			}
		},
	});

	// -------------------------------------------------------------------
	// chess_move tool — the LLM plays via this tool
	// -------------------------------------------------------------------
	pi.registerTool({
		name: "chess_move",
		label: "Chess Move",
		description:
			"Make a chess move using standard algebraic notation (SAN). Examples: e4, Nf3, Bxb5, O-O, e8=Q. If the move is illegal, the error will include the list of legal moves.",
		promptSnippet: "Make a chess move",
		promptGuidelines: [
			"When it is your chess turn, decide your move and call chess_move exactly once with a valid SAN move. Do not call it multiple times or with illegal moves.",
			"Use chess_get_board if you need to see the current position restated.",
		],
		parameters: Type.Object({
			move: Type.String({
				description:
					"Your move in standard algebraic notation (SAN). Examples: e4, Nf3, Bxb5, O-O, O-O-O, e8=Q, exd5",
			}),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (!gameActive || !boardState) {
				throw new Error("No active chess game. Start one with /chess.");
			}

			const game = boardState.game;

			if (game.isGameOver()) {
				return {
					content: [
						{
							type: "text",
							text: `Game is already over: ${getGameResult(game)}`,
						},
					],
					details: getBoardDetails(),
				};
			}

			if (game.turn() === boardState.playerColor) {
				throw new Error(`It is the player's turn (${boardState.playerColor === "w" ? "White" : "Black"}), not yours. Wait for the player to move.`);
			}

			try {
				const move = game.move(params.move);
				boardState.lastMoveFrom = move.from as Square;
				boardState.lastMoveTo = move.to as Square;

				// Check for game over
				if (game.isGameOver()) {
					boardState.gameOver = true;
					boardState.gameResult = getGameResult(game);
					chessComponent?.updateState(boardState);
					pi.appendEntry(SAVE_TYPE, getSaveData());
					emitGameOverMessage(pi);
					gameActive = false;

					return {
						content: [
							{
								type: "text",
								text: `You played ${move.san}. ${boardState.gameResult}`,
							},
						],
						details: getBoardDetails(),
					};
				}

				chessComponent?.updateState(boardState);
				pi.appendEntry(SAVE_TYPE, getSaveData());

				const turnLabel =
					game.turn() === "w" ? "White (player)" : "Black (agent)";
				return {
					content: [
						{
							type: "text",
							text: `You played ${move.san}. It is now ${turnLabel}'s turn.\n\nBoard:\n${boardToAscii(game)}\n\nFEN: ${game.fen()}${game.isCheck() ? "\n\nWhite is in check!" : ""}`,
						},
					],
					details: getBoardDetails(),
				};
			} catch (e: any) {
				const legalMoves = game.moves();
				throw new Error(`Illegal move: "${params.move}". ${e.message}. Legal moves: ${legalMoves.join(", ")}. FEN: ${game.fen()}`);
			}
		},

		renderCall(args, theme) {
			const move = typeof args.move === "string" ? args.move : "";
			return new Text(
				theme.fg("toolTitle", theme.bold("chess_move ")) +
					theme.fg("muted", move),
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as BoardDetails | undefined;
			const text = result.content[0];
			const msg = text?.type === "text" ? text.text : "";
			const isError = (result.details as any)?.isError || result.content.some(c => c.type === "text" && c.text?.includes("Illegal move"));
			const prefix = isError
				? theme.fg("error", "✗ ")
				: theme.fg("success", "✓ ");
			const summary = prefix + theme.fg("muted", msg.split("\n")[0]);

			if (expanded && details) {
				return new BoardMessageComponent(summary, details, true, theme);
			}
			return new Text(summary, 0, 0);
		},
	});

	// -------------------------------------------------------------------
	// chess_get_board tool — inspect current position
	// -------------------------------------------------------------------
	pi.registerTool({
		name: "chess_get_board",
		label: "See Chess Board",
		description:
			"Return the current chess board position, FEN, and legal moves. Use this to see the current state if you need it restated.",
		promptSnippet: "Inspect the chess board state",
		parameters: Type.Object({}),

		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			if (!gameActive || !boardState) {
				return {
					content: [
						{
							type: "text",
							text: "No active chess game. Start one with /chess.",
						},
					],
					details: {},
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `Board:\n${boardToAscii(boardState.game)}\n\nFEN: ${boardState.game.fen()}\nTurn: ${boardState.game.turn() === "w" ? "White" : "Black"}\nLegal moves: ${boardState.game.moves().join(", ")}${boardState.game.isCheck() ? "\nIn check!" : ""}`,
					},
				],
				details: getBoardDetails(),
			};
		},

		renderCall(_args, theme) {
			return new Text(
				theme.fg("toolTitle", theme.bold("chess_get_board")),
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as BoardDetails | undefined;
			const summary =
				theme.fg("success", "✓ ") +
				theme.fg("muted", `turn: ${details?.turn ?? "?"}, FEN: ${details?.fen?.slice(0, 30) ?? "?"}...`);
			if (expanded && details) {
				return new BoardMessageComponent(summary, details, true, theme);
			}
			return new Text(summary, 0, 0);
		},
	});

	// -------------------------------------------------------------------
	// Custom message renderers
	// -------------------------------------------------------------------
	pi.registerMessageRenderer(
		MOVE_MESSAGE_TYPE,
		(message, { expanded }, theme) => {
			const details = message.details as BoardDetails | undefined;
			const turnLabel =
				details?.turn === "Black"
					? `${theme.fg("warning", theme.bold("Black"))} (Agent)`
					: `${theme.fg("accent", theme.bold("White"))} (You)`;
			const lastMove = details?.lastMove ?? "—";
			const title = `${theme.fg("accent", theme.bold("Move played"))}  ${theme.fg("dim", "→")}  next: ${turnLabel}  ${theme.fg("dim", `(${lastMove})`)}`;
			return new BoardMessageComponent(title, details, expanded, theme);
		},
	);

	pi.registerMessageRenderer(
		GAME_OVER_MESSAGE_TYPE,
		(message, _options, theme) => {
			const details = message.details as BoardDetails | undefined;
			const result = message.content as string;
			return new GameOverMessageComponent(result, details, theme);
		},
	);

	// -------------------------------------------------------------------
	// Helpers
	// -------------------------------------------------------------------
	function triggerAgentTurn(pi: ExtensionAPI): void {
		const game = boardState.game;
		const lastMove = boardState.lastMoveFrom && boardState.lastMoveTo
			? `${boardState.lastMoveFrom}-${boardState.lastMoveTo}`
			: "start";

		const agentColor = boardState.playerColor === "w" ? "Black" : "White";
		const playerColor = boardState.playerColor === "w" ? "White" : "Black";
		const playerMoveSan = game.history().length > 0
			? game.history({ verbose: true }).slice(-1)[0]?.san ?? "?"
			: "—";

		pi.sendMessage(
			{
				customType: MOVE_MESSAGE_TYPE,
				content: `${playerColor} played ${playerMoveSan}. It is ${agentColor}'s (agent's) turn.\n\nBoard:\n${boardToAscii(game)}\n\nFEN: ${game.fen()}\nLegal moves: ${game.moves().join(", ")}${game.isCheck() ? "\nYou are in check!" : ""}`,
				display: true,
				details: getBoardDetails(),
			},
			{ triggerTurn: true },
		);
	}

	function emitGameOverMessage(pi: ExtensionAPI): void {
		pi.sendMessage({
			customType: GAME_OVER_MESSAGE_TYPE,
			content: boardState.gameResult,
			display: true,
			details: getBoardDetails(),
		});
	}
}