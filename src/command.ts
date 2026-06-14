/**
 * /chess command — opens the interactive board and wires the
 * `ChessComponent`'s `onUserMove` callback to the shared state and tools.
 *
 * The command is the only place that constructs a `ChessComponent`.
 * Both the player-driven (Enter on the board) and agent-driven
 * (`chess_move` tool) move paths end up writing to the same `boardState`
 * and calling `pi.appendEntry` to persist progress.
 */

import type { Square } from "chess.js";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { ChessComponent } from "./chess-component.js";
import { RESTART_SENTINEL, SAVE_TYPE, UNDO_SENTINEL } from "./constants.js";
import {
	boardState,
	chessComponent,
	createInitialState,
	getGameResult,
	getSaveData,
	setBoardState,
	setChessComponent,
	setGameActive,
} from "./state.js";
import { emitGameOverMessage, triggerAgentTurn, activateChessTools, deactivateChessTools } from "./turn.js";
import type { PlayerColor } from "./types.js";

export function registerChessCommand(pi: ExtensionAPI): void {
	pi.registerCommand("chess", {
		description: "Play chess against the agent (use 'black' to play as Black)",

		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Chess requires interactive mode", "error");
				return;
			}

			const playerColor: PlayerColor =
				args?.trim().toLowerCase() === "black" ? "b" : "w";

			// Initialize a fresh game
			const initial = createInitialState(playerColor);
			setBoardState(initial);
			setGameActive(true);
			activateChessTools(pi);
			pi.setSessionName(`Chess — ${playerColor === "w" ? "White" : "Black"}`);

			await ctx.ui.custom<void>((tui, _theme, _kb, done) => {
				const component = new ChessComponent(
					tui,
					() => {
						setChessComponent(null);
						setGameActive(false);
						deactivateChessTools(pi);
						done(undefined);
					},
					(from: Square, to: Square, promotion?: string) => {
						handleUserMove(pi, ctx, playerColor, from, to, promotion);
					},
					initial,
				);
				setChessComponent(component);
				return component;
			});

			// If the player is Black, the agent (White) moves first.
			if (playerColor === "b") {
				setTimeout(() => triggerAgentTurn(pi), 100);
			}
		},
	});
}

/**
 * Handle a move event from the `ChessComponent`. The `RESTART_SENTINEL` and
 * `UNDO_SENTINEL` squares are sentinels (not real chess squares) used to
 * signal restart / undo actions.
 */
function handleUserMove(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	playerColor: PlayerColor,
	from: Square,
	to: Square,
	promotion?: string,
): void {
	if (!boardState) return;

	if (from === RESTART_SENTINEL) {
		handleRestart(pi, playerColor);
		return;
	}

	if (from === UNDO_SENTINEL) {
		handleUndo(pi);
		return;
	}

	handleRegularMove(pi, ctx, from, to, promotion);
}

/** Reset the game to the initial position and persist. */
function handleRestart(pi: ExtensionAPI, playerColor: PlayerColor): void {
	const fresh = createInitialState(playerColor);
	setBoardState(fresh);
	setGameActive(true);
	chessComponent?.updateState(fresh);
	pi.appendEntry(SAVE_TYPE, getSaveData());
	if (playerColor === "b") {
		triggerAgentTurn(pi);
	}
}

/**
 * Undo the last move pair (agent's response + player's move). If only
 * the player's opening move exists, undo just that one.
 */
function handleUndo(pi: ExtensionAPI): void {
	if (!boardState) return;
	const history = boardState.game.history();
	if (history.length >= 2) {
		boardState.game.undo();
		boardState.game.undo();
	} else if (history.length === 1) {
		boardState.game.undo();
	} else {
		return;
	}
	// Refresh last-move highlight from the new verbose history.
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
}

/** Apply a regular move from the player, persist, and trigger the agent's turn. */
function handleRegularMove(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	from: Square,
	to: Square,
	promotion?: string,
): void {
	if (!boardState) return;
	const game = boardState.game;
	try {
		const moveObj: { from: Square; to: Square; promotion?: string } = { from, to };
		if (promotion) moveObj.promotion = promotion;
		const move = game.move(moveObj);

		boardState.lastMoveFrom = move.from as Square;
		boardState.lastMoveTo = move.to as Square;
		boardState.selectedSquare = null;
		boardState.legalMoves = [];

		if (game.isGameOver()) {
			boardState.gameOver = true;
			boardState.gameResult = getGameResult(game);
			chessComponent?.updateState(boardState);
			pi.appendEntry(SAVE_TYPE, getSaveData());
			emitGameOverMessage(pi);
			setGameActive(false);
			deactivateChessTools(pi);
			return;
		}

		chessComponent?.updateState(boardState);
		pi.appendEntry(SAVE_TYPE, getSaveData());
		triggerAgentTurn(pi);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		// Unreachable in practice — the UI filters illegal moves — but
		// guard anyway in case the chess.js API rejects a move.
		ctx.ui.notify(`Illegal move: ${msg}`, "error");
	}
}
