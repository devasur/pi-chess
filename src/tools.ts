/**
 * Tool registration: exposes `chess_move` and `chess_get_board` to the LLM.
 *
 * - `chess_move`      — make a move in SAN; the LLM uses this to play.
 * - `chess_get_board` — inspect the current position (used less often).
 *
 * Both tools share the same module-level state and reuse the
 * `BoardMessageComponent` for rendering.
 */

import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { boardToAscii } from "./ascii-board.js";
import { SAVE_TYPE } from "./constants.js";
import {
	boardState,
	chessComponent,
	gameActive,
	getBoardDetails,
	getGameResult,
	getSaveData,
	setGameActive,
} from "./state.js";
import { BoardMessageComponent } from "./messages.js";
import { emitGameOverMessage } from "./turn.js";
import type { BoardDetails } from "./types.js";

export function registerTools(pi: ExtensionAPI): void {
	// -------------------------------------------------------------------
	// chess_move tool — the LLM plays via this tool
	// -------------------------------------------------------------------
	pi.registerTool({
		name: "chess_move",
		label: "Chess Move",
		description:
			"Make a chess move in SAN (e4, Nf3, Bxb5, O-O, e8=Q). Returns error with legal moves if illegal.",
		promptSnippet: "Make a chess move",
		promptGuidelines: [
			"Call chess_move once. Use the commentary field for a brief move description. No separate text.",
		],
		parameters: Type.Object({
			move: Type.String({
				description: "Move in SAN (e.g. e4, Nf3, Bxb5, O-O)",
			}),
			commentary: Type.Optional(Type.String({
				description: "Brief move description (e.g. 'Sicilian Defense', 'Developing knight'). Shown in the UI.",
			})),
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
					terminate: true,
				};
			}

			if (game.turn() === boardState.playerColor) {
				const playerColorName = boardState.playerColor === "w" ? "White" : "Black";
				throw new Error(
					`It is the player's turn (${playerColorName}), not yours. Wait for the player to move.`,
				);
			}

			try {
				const move = game.move(params.move);
				boardState.lastMoveFrom = move.from as never;
				boardState.lastMoveTo = move.to as never;

				if (game.isGameOver()) {
					boardState.gameOver = true;
					boardState.gameResult = getGameResult(game);
					chessComponent?.updateState(boardState);
					pi.appendEntry(SAVE_TYPE, getSaveData());
					emitGameOverMessage(pi);
					setGameActive(false);

					return {
						content: [
							{
								type: "text",
								text: `Move ${move.san} recorded.${params.commentary ? ` ${params.commentary}.` : ""} ${boardState.gameResult}`,
							},
						],
						details: getBoardDetails(),
						terminate: true,
					};
				}

				chessComponent?.updateState(boardState);
				pi.appendEntry(SAVE_TYPE, getSaveData());

				const commentary = params.commentary
					? ` ${params.commentary}.`
					: "";
				const turnLabel =
					game.turn() === "w" ? "White (player)" : "Black (agent)";
				return {
					content: [
						{
							type: "text",
							text: `Move ${move.san} recorded.${commentary} Waiting for ${turnLabel}.`,
						},
					],
					details: getBoardDetails(),
					terminate: true,
				};
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				const legalMoves = game.moves();
				throw new Error(
					`Illegal move: "${params.move}". ${msg}. Legal moves: ${legalMoves.join(", ")}. FEN: ${game.fen()}`,
				);
			}
		},

		renderCall(args, theme) {
			const move = typeof args.move === "string" ? args.move : "";
			const commentary = typeof args.commentary === "string" && args.commentary
				? theme.fg("muted", ` — ${args.commentary}`)
				: "";
			return new Text(
				theme.fg("toolTitle", theme.bold("chess_move ")) +
					theme.fg("muted", move) + commentary,
				0,
				0,
			);
		},

		renderResult(result, { expanded }, theme) {
			const details = result.details as BoardDetails | undefined;
			const text = result.content[0];
			const msg = text?.type === "text" ? text.text : "";
			const isError =
				(result.details as { isError?: boolean } | undefined)?.isError ||
				result.content.some(
					(c) => c.type === "text" && c.text?.includes("Illegal move"),
				);
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
			"Return the current board position, FEN, and legal moves.",
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
					terminate: true,
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `${boardToAscii(boardState.game)}\n\nFEN: ${boardState.game.fen()}\nTurn: ${boardState.game.turn() === "w" ? "White" : "Black"}\nLegal moves: ${boardState.game.moves().join(", ")}${boardState.game.isCheck() ? "\nIn check!" : ""}`,
					},
				],
				details: getBoardDetails(),
				terminate: true,
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
				theme.fg(
					"muted",
					`turn: ${details?.turn ?? "?"}, FEN: ${details?.fen?.slice(0, 30) ?? "?"}...`,
				);
			if (expanded && details) {
				return new BoardMessageComponent(summary, details, true, theme);
			}
			return new Text(summary, 0, 0);
		},
	});
}
