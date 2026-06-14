/**
 * /chess command — opens the interactive board and wires the
 * `ChessComponent`'s `onUserMove` callback to the shared state and tools.
 *
 * On startup, tries to load the latest saved game from disk so the
 * player can resume where they left off. If no save exists, starts a
 * fresh game as White.
 *
 * Keyboard shortcuts during play:
 *   N — start a new game (prompts for color)
 *   R — restart after game over (same color)
 *   U — undo last move pair
 *   Q / ESC — quit
 */

import type { Square } from "chess.js";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { ChessComponent } from "./chess-component.js";
import {
	NEW_GAME_SENTINEL,
	RESTART_SENTINEL,
	UNDO_SENTINEL,
} from "./constants.js";
import {
	boardState,
	chessComponent,
	createInitialState,
	getGameResult,
	reconstructFromDiskData,
	saveGame,
	setBoardState,
	setChessComponent,
	setGameActive,
} from "./state.js";
import {
	loadLatestGame,
} from "./persistence.js";
import {
	emitGameOverMessage,
	triggerAgentTurn,
	activateChessTools,
	deactivateChessTools,
} from "./turn.js";
import type { PlayerColor } from "./types.js";

export function registerChessCommand(pi: ExtensionAPI): void {
	pi.registerCommand("chess", {
		description: "Play chess against the agent (use 'black' to play as Black, 'new' to force a new game)",

		async handler(args, ctx) {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Chess requires interactive mode", "error");
				return;
			}

			const raw = args?.trim().toLowerCase() ?? "";

			// Explicit new game requested
			if (raw === "new" || raw === "new white" || raw === "new black") {
				const playerColor: PlayerColor = raw.endsWith("black") ? "b" : "w";
				await startNewGame(pi, ctx, playerColor);
				return;
			}

			const playerColor: PlayerColor = raw === "black" ? "b" : "w";

			// Try to load saved game from disk, unless the user explicitly
			// specified a color (which implies they want a fresh game).
			if (!args?.trim()) {
				const saved = await loadLatestGame();
				if (saved) {
					// Resume saved game
					const restored = reconstructFromDiskData(saved);
					setBoardState(restored);
					setGameActive(!restored.gameOver);
					activateChessTools(pi);
					pi.setSessionName(`Chess — ${restored.playerColor === "w" ? "White" : "Black"} (resumed)`);

					if (restored.gameOver) {
						setGameActive(false);
						deactivateChessTools(pi);
					}

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
								handleUserMove(pi, ctx, restored.playerColor, from, to, promotion);
							},
							restored,
						);
						setChessComponent(component);
						return component;
					});

					// If it's the agent's turn (e.g. player was Black and game just resumed),
					// trigger the agent to move
					if (restored.gameOver) {
						// Game was already over — do nothing
					} else if (restored.game.turn() !== restored.playerColor) {
						setTimeout(() => triggerAgentTurn(pi), 100);
					}
					return;
				}
			}

			// No saved game found, or user specified a color — start fresh
			await startNewGame(pi, ctx, playerColor);
		},
	});
}

/** Start a brand new game. */
async function startNewGame(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	playerColor: PlayerColor,
): Promise<void> {
	const initial = createInitialState(playerColor);
	setBoardState(initial);
	setGameActive(true);
	activateChessTools(pi);
	pi.setSessionName(`Chess — ${playerColor === "w" ? "White" : "Black"}`);
	await saveGame(pi);

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
}

/**
 * Handle a move event from the `ChessComponent`. Sentinel squares are
 * used to signal non-move actions (restart, undo, new game).
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

	if (from === NEW_GAME_SENTINEL) {
		handleNewGame(pi, ctx, playerColor);
		return;
	}

	handleRegularMove(pi, ctx, from, to, promotion);
}

/** Reset the game to the initial position and persist. */
async function handleRestart(pi: ExtensionAPI, playerColor: PlayerColor): Promise<void> {
	const fresh = createInitialState(playerColor);
	setBoardState(fresh);
	setGameActive(true);
	chessComponent?.updateState(fresh);
	await saveGame(pi);
	if (playerColor === "b") {
		triggerAgentTurn(pi);
	}
}

/** Start a new game, letting the player choose color. */
async function handleNewGame(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	currentPlayerColor: PlayerColor,
): Promise<void> {
	// Toggle color for convenience — if playing White, switch to Black, etc.
	const newColor: PlayerColor = currentPlayerColor === "w" ? "b" : "w";
	const fresh = createInitialState(newColor);
	setBoardState(fresh);
	setGameActive(true);
	chessComponent?.updateState(fresh);
	pi.setSessionName(`Chess — ${newColor === "w" ? "White" : "Black"}`);
	await saveGame(pi);
	if (newColor === "b") {
		triggerAgentTurn(pi);
	}
}

/**
 * Undo the last move pair (agent's response + player's move). If only
 * the player's opening move exists, undo just that one.
 */
async function handleUndo(pi: ExtensionAPI): Promise<void> {
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
	await saveGame(pi);
}

/** Apply a regular move from the player, persist, and trigger the agent's turn. */
async function handleRegularMove(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	from: Square,
	to: Square,
	promotion?: string,
): Promise<void> {
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
			await saveGame(pi);
			emitGameOverMessage(pi);
			setGameActive(false);
			deactivateChessTools(pi);
			return;
		}

		chessComponent?.updateState(boardState);
		await saveGame(pi);
		triggerAgentTurn(pi);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		// Unreachable in practice — the UI filters illegal moves — but
		// guard anyway in case the chess.js API rejects a move.
		ctx.ui.notify(`Illegal move: ${msg}`, "error");
	}
}