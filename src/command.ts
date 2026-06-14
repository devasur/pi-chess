/**
 * /chess command — opens the interactive board and wires the
 * `ChessComponent`'s `onUserMove` callback to the shared state and tools.
 *
 * On startup, tries to load the latest saved game from disk so the
 * player can resume where they left off. If no save exists, starts a
 * fresh game as White.
 *
 * Keyboard shortcuts during play:
 *   G — browse saved games
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
	GAMES_SENTINEL,
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
	listSavedGames,
	loadGameByPath,
} from "./persistence.js";
import { GameBrowserComponent } from "./game-browser.js";
import {
	emitGameOverMessage,
	triggerAgentTurn,
	activateChessTools,
	deactivateChessTools,
} from "./turn.js";
import type { PlayerColor } from "./types.js";

/** Return value from the board's done() callback — signals next action. */
type BoardExitAction = "games" | undefined;

export function registerChessCommand(pi: ExtensionAPI): void {
	pi.registerCommand("chess", {
		description: "Play chess against the agent ('black', 'new', 'games' to browse saves)",

		async handler(args, ctx) {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Chess requires interactive mode", "error");
				return;
			}

			const raw = args?.trim().toLowerCase() ?? "";

			// Browse saved games (from command line)
			if (raw === "games" || raw === "history") {
				const selected = await runGameBrowser(pi, ctx);
				if (selected) {
					await openBoardWithGame(pi, ctx, selected);
				}
				return;
			}

			// Explicit new game requested
			if (raw === "new" || raw === "new white" || raw === "new black") {
				const playerColor: PlayerColor = raw.endsWith("black") ? "b" : "w";
				await runBoardLoop(pi, ctx, createInitialState(playerColor));
				return;
			}

			const playerColor: PlayerColor = raw === "black" ? "b" : "w";

			// Try to load saved game from disk, unless the user explicitly
			// specified a color (which implies they want a fresh game).
			if (!args?.trim()) {
				const saved = await loadLatestGame();
				if (saved) {
					const restored = reconstructFromDiskData(saved);
					await runBoardLoop(pi, ctx, restored);
					return;
				}
			}

			// No saved game found, or user specified a color — start fresh
			await runBoardLoop(pi, ctx, createInitialState(playerColor));
		},
	});
}

// ---------------------------------------------------------------------------
// Board loop — the board's done() returns a BoardExitAction that drives
// what happens next (reopen board, open game browser, or exit).
// ---------------------------------------------------------------------------

/**
 * Run the main board loop. Opens the chess board; when it closes, checks
 * the exit action and either opens the game browser or exits.
 * If the game browser returns a selected file, loads it and re-enters
 * the board loop. If the browser is cancelled, reopens the current game.
 */
async function runBoardLoop(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	initialState: import("./types.js").BoardState,
): Promise<void> {
	let state = initialState;

	while (true) {
		const exitAction = await openBoard(pi, ctx, state);

		if (exitAction === "games") {
			// Save current state before opening browser
			await saveGame(pi);
			const selected = await runGameBrowser(pi, ctx);
			if (selected) {
				// Load selected game and re-enter loop
				const data = await loadGameByPath(selected);
				if (data) {
					state = reconstructFromDiskData(data);
					continue; // reopen board with new game
				} else {
					ctx.ui.notify("Could not load selected game", "error");
					// Fall through to reopen current game
				}
			}
			// Browser cancelled — reopen current game
			if (boardState) {
				state = boardState;
			}
			continue;
		}

		// Normal exit (undefined) — done
		break;
	}
}

/**
 * Open the chess board as a ctx.ui.custom() and return the exit action.
 * This is the ONLY place that calls ctx.ui.custom() for the board.
 */
async function openBoard(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	state: import("./types.js").BoardState,
): Promise<BoardExitAction> {
	setBoardState(state);
	setGameActive(!state.gameOver);
	if (!state.gameOver) {
		activateChessTools(pi);
	} else {
		deactivateChessTools(pi);
	}
	pi.setSessionName(`Chess — ${state.playerColor === "w" ? "White" : "Black"}`);
	await saveGame(pi);

	return ctx.ui.custom<BoardExitAction>((tui, _theme, _kb, done) => {
		const component = new ChessComponent(
			tui,
			() => {
				setChessComponent(null);
				setGameActive(false);
				deactivateChessTools(pi);
				done(undefined);
			},
			(from: Square, to: Square, promotion?: string) => {
				const action = handleUserMove(pi, ctx, from, to, promotion);
				if (action) {
					// Close the board with a next-action signal
					setChessComponent(null);
					setGameActive(false);
					deactivateChessTools(pi);
					done(action);
				}
			},
			state,
		);
		setChessComponent(component);

		// If it's the agent's turn, trigger the LLM to move.
		// Must be inside ctx.ui.custom() — after the board is visible.
		if (!state.gameOver && state.game.turn() !== state.playerColor) {
			setTimeout(() => triggerAgentTurn(pi), 100);
		}

		return component;
	});
}

/**
 * Open the game browser, return the filepath of the selected game,
 * or null if cancelled.
 */
async function runGameBrowser(
	_pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
): Promise<string | null> {
	const games = await listSavedGames();
	if (games.length === 0) {
		ctx.ui.notify("No saved games found", "info");
		return null;
	}

	return ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
		const component = new GameBrowserComponent(
			tui,
			(selected) => done(selected),
			games,
		);
		return component;
	});
}

/**
 * Load a game from disk and open the board loop with it.
 * Used when /chess games selects a game.
 */
async function openBoardWithGame(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	filepath: string,
): Promise<void> {
	const data = await loadGameByPath(filepath);
	if (!data) {
		ctx.ui.notify("Could not load selected game", "error");
		return;
	}
	const state = reconstructFromDiskData(data);
	await runBoardLoop(pi, ctx, state);
}

// ---------------------------------------------------------------------------
// Move handlers — called from the ChessComponent's onUserMove callback.
// Return a BoardExitAction if the board should close, or undefined to
// keep it open.
// ---------------------------------------------------------------------------

/**
 * Handle a move event from the `ChessComponent`. Sentinel squares are
 * used to signal non-move actions (restart, undo, new game, games browser).
 *
 * Returns a BoardExitAction if the board should close (e.g. "games"),
 * or undefined to keep it open.
 *
 * Reads `playerColor` from live `boardState` rather than a closure capture
 * so that N (new game) and R (restart) color changes are respected.
 */
function handleUserMove(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	from: Square,
	to: Square,
	promotion?: string,
): BoardExitAction {
	if (!boardState) return undefined;

	const playerColor = boardState.playerColor;

	if (from === RESTART_SENTINEL) {
		handleRestart(pi, playerColor);
		return undefined;
	}

	if (from === UNDO_SENTINEL) {
		handleUndo(pi);
		return undefined;
	}

	if (from === NEW_GAME_SENTINEL) {
		handleNewGame(pi, ctx, playerColor);
		return undefined;
	}

	if (from === GAMES_SENTINEL) {
		// Signal the board to close so the game browser can open
		return "games";
	}

	handleRegularMove(pi, ctx, from, to, promotion);
	return undefined;
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