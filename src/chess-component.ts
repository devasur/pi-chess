/**
 * ChessComponent — the interactive TUI board.
 *
 * Renders the 8×8 board with Unicode pieces, highlights (cursor, selected,
 * legal moves, last move, check), and a promotion dialog. Handles all
 * keyboard input for navigation, selection, and confirmation.
 */

import { type Square } from "chess.js";
import type { Component } from "@earendil-works/pi-tui";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import {
	BOLD,
	BLACK_PIECE_FG,
	CHECK_BG,
	CURSOR_BG,
	DARK_SQ,
	DIM,
	DIM_FG,
	FILES,
	HIGHLIGHT_FG,
	LAST_MOVE_DARK,
	LAST_MOVE_LIGHT,
	LEGAL_CAPTURE_BG_DARK,
	LEGAL_CAPTURE_BG_LIGHT,
	LEGAL_DOT_FG,
	LIGHT_SQ,
	PIECE_SYMBOLS,
	PROMOTE_FG,
	PROMOTION_CHOICES,
	RANKS,
	RESET,
	RESTART_SENTINEL,
	SELECTED_BG,
	UNDO_SENTINEL,
	NEW_GAME_SENTINEL,
	GAMES_SENTINEL,
	WHITE_PIECE_FG,
} from "./constants.js";
import type { BoardState } from "./types.js";
import { centerPad, squareFromCoords } from "./utils.js";

export type UserMoveHandler = (
	from: Square,
	to: Square,
	promotion?: string,
) => void;

export type CloseHandler = () => void;

export class ChessComponent implements Component {
	private state: BoardState;
	private onClose: CloseHandler;
	private onUserMove: UserMoveHandler;
	private tui: { requestRender: () => void };
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private version = 0;
	private cachedVersion = -1;

	constructor(
		tui: { requestRender: () => void },
		onClose: CloseHandler,
		onUserMove: UserMoveHandler,
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
				this.onUserMove(RESTART_SENTINEL, RESTART_SENTINEL);
			} else if (data === "n" || data === "N") {
				this.onUserMove(NEW_GAME_SENTINEL, NEW_GAME_SENTINEL);
			} else if (data === "g" || data === "G") {
				this.onUserMove(GAMES_SENTINEL, GAMES_SENTINEL);
			} else if (data === "f" || data === "F") {
				s.flipped = !s.flipped;
				this.version++;
				this.tui.requestRender();
			}
			return;
		}

		// New game
		if (data === "n" || data === "N") {
			this.onUserMove(NEW_GAME_SENTINEL, NEW_GAME_SENTINEL);
			return;
		}

		// Browse saved games
		if (data === "g" || data === "G") {
			this.onUserMove(GAMES_SENTINEL, GAMES_SENTINEL);
			return;
		}

		// Flip board
		if (data === "f" || data === "F") {
			s.flipped = !s.flipped;
			this.version++;
			this.tui.requestRender();
			return;
		}

		// Undo
		if (data === "u" || data === "U") {
			this.onUserMove(UNDO_SENTINEL, UNDO_SENTINEL);
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
			this.handleEnter();
		}
	}

	/** Get the board square at the current cursor position (respects flip). */
	private cursorSquare(): Square {
		const s = this.state;
		const row = s.flipped ? 7 - s.cursorRow : s.cursorRow;
		const col = s.flipped ? 7 - s.cursorCol : s.cursorCol;
		return squareFromCoords(row, col);
	}

	/** Handle Enter / Space — selection / move logic. */
	private handleEnter(): void {
		const s = this.state;
		const sq = this.cursorSquare();
		const piece = s.game.get(sq);

		if (s.selectedSquare) {
			// Second click: try to move to this square
			const legalMovesToTarget = s.legalMoves.filter((m) => m.to === sq);
			if (legalMovesToTarget.length > 0) {
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

	invalidate(): void {
		this.cachedWidth = 0;
	}

	render(width: number): string[] {
		if (width === this.cachedWidth && this.cachedVersion === this.version) {
			return this.cachedLines;
		}

		const lines: string[] = [];
		lines.push(this.renderHeader(width));
		lines.push(this.renderStatusLine(width));
		lines.push("");

		if (this.state.promotionFrom) {
			lines.push(...this.renderPromotionDialog(width));
		} else {
			lines.push(...this.renderBoard(width));
		}

		lines.push("");
		lines.push(this.renderControls(width));
		lines.push(...this.renderMoveHistory(width));
		lines.push(DIM + "─".repeat(width) + RESET);

		this.cachedLines = lines;
		this.cachedWidth = width;
		this.cachedVersion = this.version;
		return this.cachedLines;
	}

	private renderHeader(width: number): string {
		const s = this.state;
		const playerLabel = s.playerColor === "w" ? "White" : "Black";
		const agentLabel = s.playerColor === "w" ? "Black" : "White";
		const title = `${BOLD}♟ Chess${RESET} — You: ${playerLabel} vs Agent: ${agentLabel}`;
		return centerPad(title, width);
	}

	private renderStatusLine(width: number): string {
		const s = this.state;
		const game = s.game;
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
		return centerPad(statusLine, width);
	}

	private renderControls(width: number): string {
		const s = this.state;
		const game = s.game;
		let controls: string;
		if (s.gameOver) {
			controls = `${BOLD}R${RESET} restart  ${DIM}|${RESET}  ${BOLD}N${RESET} new  ${DIM}|${RESET}  ${BOLD}F${RESET} flip  ${DIM}|${RESET}  ${BOLD}G${RESET} games  ${DIM}|${RESET}  ${BOLD}Q${RESET}/${BOLD}ESC${RESET} quit`;
		} else if (s.promotionFrom) {
			controls = `${BOLD}↑↓${RESET} choose  ${DIM}|${RESET}  ${BOLD}ENTER${RESET} confirm  ${DIM}|${RESET}  ${BOLD}ESC${RESET} cancel`;
		} else if (game.turn() !== s.playerColor) {
			controls = `${BOLD}N${RESET} new  ${DIM}|${RESET}  ${BOLD}F${RESET} flip  ${DIM}|${RESET}  ${BOLD}G${RESET} games  ${DIM}|${RESET}  ${DIM}Waiting for agent's move...${RESET}`;
		} else if (s.selectedSquare) {
			controls = `${BOLD}↑↓←→${RESET} move  ${DIM}|${RESET}  ${BOLD}ENTER${RESET} confirm  ${DIM}|${RESET}  ${BOLD}F${RESET} flip  ${DIM}|${RESET}  ${BOLD}N${RESET} new  ${DIM}|${RESET}  ${BOLD}G${RESET} games  ${DIM}|${RESET}  ${BOLD}ESC${RESET} deselect  ${DIM}|${RESET}  ${BOLD}U${RESET} undo`;
		} else {
			controls = `${BOLD}↑↓←→${RESET} move  ${DIM}|${RESET}  ${BOLD}ENTER${RESET} select  ${DIM}|${RESET}  ${BOLD}F${RESET} flip  ${DIM}|${RESET}  ${BOLD}N${RESET} new  ${DIM}|${RESET}  ${BOLD}G${RESET} games  ${DIM}|${RESET}  ${BOLD}Q${RESET}/${BOLD}ESC${RESET} quit  ${DIM}|${RESET}  ${BOLD}U${RESET} undo`;
		}
		return centerPad(controls, width);
	}

	private renderMoveHistory(width: number): string[] {
		const history = this.state.game.history();
		if (history.length === 0) return [];

		const moveNums: string[] = [];
		for (let i = 0; i < history.length; i += 2) {
			const num = Math.floor(i / 2) + 1;
			const whiteMove = history[i];
			const blackMove = history[i + 1] ? ` ${history[i + 1]}` : "";
			moveNums.push(`${num}. ${whiteMove}${blackMove}`);
		}
		const historyLine = `${DIM}Moves:${RESET} ${moveNums.join("  ")}`;
		return [centerPad(historyLine, width)];
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

		// When flipped, display row 0 = board row 7 (rank 1),
		// display col 0 = board col 7 (file h).
		const boardRow = (displayRow: number) => s.flipped ? 7 - displayRow : displayRow;
		const boardCol = (displayCol: number) => s.flipped ? 7 - displayCol : displayCol;

		const buildRow = (displayRow: number, lineInCell: number): string => {
			const br = boardRow(displayRow);
			const rank = RANKS[br];
			const midLine = Math.floor(CELL_H / 2);

			let line = "";

			if (lineInCell === midLine) {
				line += ` ${DIM}${rank}${RESET} `;
			} else {
				line += "   ";
			}

			for (let displayCol = 0; displayCol < 8; displayCol++) {
				const bc = boardCol(displayCol);
				const sq = squareFromCoords(br, bc);
				const piece = board[br][bc];
				const isLight = (br + bc) % 2 === 0;
				const isCursor = displayRow === s.cursorRow && displayCol === s.cursorCol;
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

		// File labels follow display order (flipped = h..a, normal = a..h)
		const displayFiles = s.flipped ? [...FILES].reverse() : FILES;
		const fileRow = "   " + displayFiles.map((f) => centerStr(f, CELL_W)).join("") + "  ";
		lines.push(centerPad(DIM + fileRow + RESET, width));

		for (let displayRow = 0; displayRow < 8; displayRow++) {
			for (let lineInCell = 0; lineInCell < CELL_H; lineInCell++) {
				lines.push(centerPad(buildRow(displayRow, lineInCell), width));
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
