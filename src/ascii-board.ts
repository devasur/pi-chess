/**
 * Board-to-ASCII rendering for LLM consumption.
 */

import type { Chess } from "chess.js";
import { PIECE_LETTERS } from "./constants.js";

/**
 * Render the current position as an ASCII board for the LLM.
 * Example output:
 *
 *   a b c d e f g h
 * 8 r n b q k b n r 8
 * 7 p p . p p p p p 7
 * ...
 * 1 R N B Q K B N R 1
 *   a b c d e f g h
 */
export function boardToAscii(game: Chess): string {
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
