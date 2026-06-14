/**
 * Chess extension — play chess against the current LLM model in the TUI.
 *
 * Usage: /chess          — resume last saved game, or start new (White)
 *        /chess black    — start a new game (you play Black)
 *        /chess new      — start a new game (you play White)
 *
 * Controls:
 *   Arrow keys  — move cursor
 *   Enter        — select piece / confirm destination / choose promotion
 *   Escape       — deselect piece / quit (on empty selection)
 *   Q            — quit
 *   R            — restart with same color (when game is over)
 *   N            — start a new game (swaps color)
 *   U            — undo last move pair
 *
 * Games are auto-saved to ~/.pi/agent/extensions/pi-chess/.games/
 *
 * File layout:
 *   src/constants.ts        — ANSI codes, piece symbols, message types, sentinels
 *   src/types.ts            — BoardState, SaveData, DiskSaveData, BoardDetails, etc.
 *   src/utils.ts            — coordinate helpers, text padding
 *   src/ascii-board.ts      — board → ASCII for the LLM
 *   src/state.ts            — boardState, gameActive, helpers, save/disk persistence
 *   src/persistence.ts      — saveGameToDisk, loadLatestGame, listSavedGames, loadGameByPath, deleteAllSaves
 *   src/game-browser.ts    — GameBrowserComponent for browsing saved games
 *   src/move-annotations.ts  — annotate legal moves with threat/safety indicators
 *   src/turn.ts             — turn-related side effects + context pruning
 *   src/messages.ts         — custom message components & renderer registration
 *   src/chess-component.ts  — interactive TUI board
 *   src/command.ts          — /chess command (resume, new game)
 *   src/tools.ts            — chess_move and chess_get_board tools
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { reconstructState } from "./src/state.js";
import { registerChessCommand } from "./src/command.js";
import { registerMessageRenderers } from "./src/messages.js";
import { registerTools } from "./src/tools.js";
import { registerContextPruner } from "./src/turn.js";
import { boardState, gameActive } from "./src/state.js";
import { boardToAscii } from "./src/ascii-board.js";
import { annotateMoves, formatAnnotatedMoves } from "./src/move-annotations.js";

export default function (pi: ExtensionAPI) {
	// -------------------------------------------------------------------
	// State restoration — re-hydrate boardState on session start / tree.
	// -------------------------------------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		reconstructState(ctx);
	});
	pi.on("session_tree", async (_event, ctx) => {
		reconstructState(ctx);
	});

	// -------------------------------------------------------------------
	// before_agent_start — REPLACE the system prompt with chess-only
	// instructions when a game is active.
	//
	// The base pi system prompt (~4-5k tokens of coding instructions)
	// is irrelevant when the agent is just playing chess. By replacing
	// it entirely, the up-token cost drops from ~6000 to ~300-400 per
	// turn. Tool descriptions (chess_move, chess_get_board) are injected
	// separately by pi and remain available regardless.
	// -------------------------------------------------------------------
	pi.on("before_agent_start", async (event) => {
		if (!gameActive || !boardState) return undefined;

		const game = boardState.game;
		if (game.isGameOver()) return undefined;

		const isAgentTurn = game.turn() !== boardState.playerColor;
		const agentColor = boardState.playerColor === "w" ? "Black" : "White";
		const playerColor = boardState.playerColor === "w" ? "White" : "Black";

		const boardAscii = boardToAscii(game);
		const annotations = annotateMoves(game);
		const movesFormatted = formatAnnotatedMoves(annotations);

		const checkLine = game.isCheck()
			? "You are in check! You must get out of check.\n"
			: "";
		const turnLine = isAgentTurn
			? `Your turn (${agentColor})`
			: `${playerColor}'s turn`;
		const actLine = isAgentTurn ? "Make your move now." : "";

		const instructions = [
			`You are a chess engine. You play ${agentColor}. The human plays ${playerColor}.`,
			"",
			"```",
			boardAscii,
			"```",
			`FEN: ${game.fen()}`,
			checkLine + `Turn: ${turnLine}`,
			movesFormatted,
			"",
			"Pick a move from the numbered list above. Copy the SAN exactly (e.g. chess_move with move=\"e4\"). ● = safe, ◐ = trade (attacked but defended), ○ = risky (piece may be lost). Captured piece shown in parens. Prefer safe moves; avoid ○ unless strategically sound.",
			"Respond with ONLY your chess_move call — no text before or after it.",
			actLine,
		].join("\n");

		return {
			systemPrompt: instructions,
		};
	});

	// -------------------------------------------------------------------
	// Context pruner — strip stale chess messages before each LLM call
	// -------------------------------------------------------------------
	registerContextPruner(pi);

	// -------------------------------------------------------------------
	// /chess command, tools, and custom message renderers
	// -------------------------------------------------------------------
	registerChessCommand(pi);
	registerTools(pi);
	registerMessageRenderers(pi);
}