/**
 * Turn-helpers: send messages to the agent and the user after state changes,
 * and strip old chess context to keep the LLM's context window small.
 *
 * Both the player-driven path (Enter on the board) and the agent-driven
 * path (`chess_move` tool) call into this module to:
 *   - emit a "your turn" prompt to the agent with the latest board state
 *   - emit a "game over" banner when the game ends
 *   - prune stale chess messages from the LLM context before each call
 *   - restrict active tools to chess-only during a game
 *
 * ## Context pruning
 *
 * The `context` event handler strips chess messages from **previous** turns
 * but **preserves** all messages from the current turn. This ensures the
 * agent can see its own tool calls and results (e.g. `chess_get_board`)
 * within the current turn, while old turns don't accumulate.
 *
 * The "current turn" is identified by scanning backwards through the
 * message list for the most recent chess turn-trigger marker. This can
 * be a custom message (`chess-move`) or a user message containing the
 * trigger pattern. All messages from that point onwards are kept intact.
 *
 * If no turn-trigger is found (edge case on the very first call), the
 * pruner keeps the last few messages as a safety net.
 *
 * Context cost stays constant from move 1 through move 100.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	GAME_OVER_MESSAGE_TYPE,
	MOVE_MESSAGE_TYPE,
} from "./constants.js";
import { boardState, gameActive, getBoardDetails } from "./state.js";

// ---------------------------------------------------------------------------
// Custom message types and tool names that belong to this extension
// ---------------------------------------------------------------------------

const CHESS_CUSTOM_TYPES = new Set([MOVE_MESSAGE_TYPE, GAME_OVER_MESSAGE_TYPE]);

const CHESS_TOOL_NAMES = new Set(["chess_move", "chess_get_board"]);

/** Only chess_move is needed during a game.
 *
 * chess_get_board is intentionally excluded: the system prompt already
 * contains the board, FEN, and legal moves, so calling it wastes an LLM
 * round-trip. Some models also get stuck in loops calling it repeatedly
 * instead of making a move. If the agent makes an illegal move,
 * chess_move returns an error with the legal move list.
 */
const CHESS_ONLY_TOOLS = ["chess_move"];

// ---------------------------------------------------------------------------
// Turn triggers
// ---------------------------------------------------------------------------

/**
 * Send a minimal "your turn" trigger to the agent.
 *
 * The board state, FEN, and legal moves are already injected into the
 * system prompt by `before_agent_start`, so the turn-trigger message
 * only needs the move that was just played and a prompt to act.
 */
export function triggerAgentTurn(pi: ExtensionAPI): void {
	if (!boardState) return;

	const game = boardState.game;
	const playerColor = boardState.playerColor === "w" ? "White" : "Black";
	const agentColor = boardState.playerColor === "w" ? "Black" : "White";
	const playerMoveSan = game.history().length > 0
		? game.history({ verbose: true }).slice(-1)[0]?.san ?? "?"
		: "—";

	pi.sendMessage(
		{
			customType: MOVE_MESSAGE_TYPE,
			content: `${playerColor} played ${playerMoveSan}. Your turn, ${agentColor}.`,
			display: true,
			details: getBoardDetails(),
		},
		{ triggerTurn: true },
	);
}

/** Emit a "game over" banner into the session log. */
export function emitGameOverMessage(pi: ExtensionAPI): void {
	if (!boardState) return;
	pi.sendMessage({
		customType: GAME_OVER_MESSAGE_TYPE,
		content: boardState.gameResult,
		display: true,
		details: getBoardDetails(),
	});
}

// ---------------------------------------------------------------------------
// Context pruning — keep current turn, strip previous turns
// ---------------------------------------------------------------------------

/**
 * Returns `true` if the message is a chess-related message that should
 * be eligible for pruning from **previous** turns.
 */
function isChessMessage(msg: unknown): boolean {
	const m = msg as unknown as Record<string, unknown>;

	// Custom messages from this extension (chess-move, chess-game-over)
	if (m.role === "custom") {
		const customType = m.customType as string | undefined;
		if (customType && CHESS_CUSTOM_TYPES.has(customType)) return true;
	}

	// Tool result messages for chess tools
	if (m.role === "toolResult") {
		const toolName = m.toolName as string | undefined;
		if (toolName && CHESS_TOOL_NAMES.has(toolName)) return true;
	}

	// Assistant messages that contain chess tool calls
	if (m.role === "assistant") {
		const content = m.content;
		if (Array.isArray(content)) {
			const hasChessToolCall = content.some((block: unknown) => {
				const b = block as Record<string, unknown>;
				return b.type === "toolCall" &&
					typeof b.name === "string" &&
					CHESS_TOOL_NAMES.has(b.name);
			});
			if (hasChessToolCall) return true;
		}
	}

	// User messages that are chess turn prompts.
	// Pi may deliver custom messages as user messages in the LLM context,
	// so we match the text pattern as a fallback.
	if (m.role === "user") {
		const raw = m.content;
		const text = typeof raw === "string"
			? raw
			: Array.isArray(raw)
				? raw
					.filter((c: unknown): c is Record<string, unknown> => typeof c === "object" && c !== null && "text" in c)
					.map((c) => (c.text as string) ?? "")
					.join(" ")
				: "";
		// Match both the new short format and the old verbose format
		if (text.includes("Your turn,") || (text.includes("Legal moves:") && text.includes("FEN:"))) {
			return true;
		}
	}

	return false;
}

/**
 * Find the index of the most recent chess turn-trigger message.
 *
 * The turn-trigger can appear as:
 * 1. A custom message with customType "chess-move"
 * 2. A user message containing the pattern "Your turn," or
 *    "Legal moves:" + "FEN:"
 *
 * Returns -1 if no trigger is found.
 */
function findCurrentTurnStart(messages: unknown[]): number {
	// Search backwards for the most recent turn-trigger marker.
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as Record<string, unknown>;

		// Custom message with our turn-trigger type
		if (m.role === "custom" && m.customType === MOVE_MESSAGE_TYPE) {
			return i;
		}

		// User message with the trigger pattern
		if (m.role === "user") {
			const raw = m.content;
			const text = typeof raw === "string"
				? raw
				: Array.isArray(raw)
					? raw
						.filter((c: unknown): c is Record<string, unknown> => typeof c === "object" && c !== null && "text" in c)
						.map((c) => (c.text as string) ?? "")
						.join(" ")
					: "";
			if (text.includes("Your turn,") || (text.includes("Legal moves:") && text.includes("FEN:"))) {
				return i;
			}
		}
	}

	return -1;
}

/**
 * Register the `context` event handler that strips stale context.
 *
 * Algorithm:
 * 1. Find the most recent chess turn-trigger message. This marks the
 *    start of the current agent turn.
 * 2. Keep ALL messages from that point onwards (the current turn),
 *    including the agent's tool calls, results, and text responses.
 * 3. Strip ALL messages from before that point — not just chess messages.
 *    This catches assistant commentary that doesn't contain tool calls,
 *    which `isChessMessage` would miss.
 * 4. If no trigger is found, keep the last few messages as a safety net.
 *
 * Context cost stays constant from move 1 through move 100.
 */
export function registerContextPruner(pi: ExtensionAPI): void {
	pi.on("context", async (event) => {
		if (!gameActive || !boardState) {
			return undefined;
		}

		const turnStartIdx = findCurrentTurnStart(event.messages);

		// If we found a turn-trigger, keep everything from that point
		// onwards and strip EVERYTHING before it. Previous turns are
		// redundant — the system prompt already has the current board.
		if (turnStartIdx >= 0) {
			return { messages: event.messages.slice(turnStartIdx) };
		}

		// Safety net: no turn-trigger found. This can happen on the
		// very first LLM call before any trigger is sent. Keep the
		// last few messages and strip older chess messages.
		const KEEP_TAIL = 6;
		const pruned = event.messages.filter((msg, idx) => {
			if (idx >= event.messages.length - KEEP_TAIL) {
				return true;
			}
			return !isChessMessage(msg);
		});
		return { messages: pruned };
	});
}

// ---------------------------------------------------------------------------
// Tool management — restrict to chess-only tools during a game
// ---------------------------------------------------------------------------

let savedTools: string[] | null = null;

/**
 * Activate chess-only tools and deactivate all others.
 *
 * Pi's built-in tools (bash, read, write, edit, grep, etc.) add ~2000+
 * tokens of descriptions and guidelines to every prompt. During a chess
 * game, the agent only needs `chess_move` and `chess_get_board`.
 * Restricting the active tool set eliminates this overhead.
 */
export function activateChessTools(pi: ExtensionAPI): void {
	if (savedTools !== null) return; // Already active
	savedTools = pi.getActiveTools();
	pi.setActiveTools(CHESS_ONLY_TOOLS);
}

/**
 * Restore the full tool set when a chess game ends.
 */
export function deactivateChessTools(pi: ExtensionAPI): void {
	if (savedTools === null) return; // Not active
	pi.setActiveTools(savedTools);
	savedTools = null;
}