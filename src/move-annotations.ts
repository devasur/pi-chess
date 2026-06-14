/**
 * Move annotations: compute threat/safety indicators for each legal move.
 *
 * For each legal move we determine whether the destination square is
 * attacked by the opponent after the move. This lets the LLM avoid
 * blunders and recognise trade opportunities.
 *
 * Safety categories:
 *   ● safe   — no opponent piece attacks the destination after the move
 *   ◐ trade  — opponent attacks the destination, but we can recapture
 *   ○ risk   — opponent attacks the destination and we cannot recapture
 *              (piece may be lost for free)
 *
 * Captures are annotated with the captured piece type in parens: exd5(p)
 *
 * The annotation pass takes ~50ms for a typical 30-move position —
 * negligible compared to the LLM round-trip (500–2000ms).
 */

import { Chess } from "chess.js";

export type MoveSafety = "safe" | "trade" | "risk";

export interface MoveAnnotation {
	/** SAN notation — the exact string to pass to chess_move */
	san: string;
	/** Safety category */
	safety: MoveSafety;
	/** Piece type captured (p/n/b/r/q), if this is a capture */
	captures?: string;
}

/** Uppercase display labels for captured piece types */
const CAPTURE_LABELS: Record<string, string> = {
	p: "p",
	n: "N",
	b: "B",
	r: "R",
	q: "Q",
};

/**
 * Annotate every legal move with a safety category.
 *
 * Algorithm:
 * 1. For each legal move, clone the game and make the move.
 * 2. Check if any opponent move targets the destination square.
 *    - If not → safe (●)
 *    - If yes, find an opponent capture on that square and check
 *      whether we can recapture → trade (◐) or risk (○).
 */
export function annotateMoves(game: Chess): MoveAnnotation[] {
	const legalMoves = game.moves({ verbose: true });
	const result: MoveAnnotation[] = [];

	for (const move of legalMoves) {
		const afterMove = new Chess(game.fen());
		afterMove.move(move.san);

		const opponentMoves = afterMove.moves({ verbose: true });
		const isAttacked = opponentMoves.some((m) => m.to === move.to);

		let safety: MoveSafety = "safe";

		if (isAttacked) {
			// Find an opponent capture on our destination
			const captureMove = opponentMoves.find(
				(m) => m.to === move.to && m.captured,
			);

			if (captureMove) {
				// Opponent can capture our piece. Can we recapture?
				const afterCapture = new Chess(afterMove.fen());
				afterCapture.move(captureMove.san);
				const ourMoves = afterCapture.moves({ verbose: true });
				const isDefended = ourMoves.some((m) => m.to === move.to);
				safety = isDefended ? "trade" : "risk";
			} else {
				// Opponent can move to the square but not capture —
				// shouldn't normally happen (our piece would be there).
				// Treat as risk to be safe.
				safety = "risk";
			}
		}

		result.push({
			san: move.san,
			safety,
			captures: move.captured
				? (CAPTURE_LABELS[move.captured] ?? move.captured)
				: undefined,
		});
	}

	return result;
}

/**
 * Format annotated moves as a compact, numbered list for the LLM prompt.
 *
 * Output looks like:
 *
 *   Legal moves (●safe ◐trade ○risk):
 *    1.● e4   2.● d4   3.● Nf3   4.● Nc3   5.○ f4   6.● g3
 *    7.◐ exd5(p)  8.● Bc4  9.● O-O
 */
export function formatAnnotatedMoves(annotations: MoveAnnotation[]): string {
	const safetySymbol: Record<MoveSafety, string> = {
		safe: "●",
		trade: "◐",
		risk: "○",
	};

	const entries = annotations.map((a, i) => {
		const sym = safetySymbol[a.safety];
		const cap = a.captures ? `(${a.captures})` : "";
		return `${i + 1}.${sym} ${a.san}${cap}`;
	});

	// Wrap entries into lines of ~6 moves each for readability
	const PER_LINE = 6;
	const lines: string[] = [];
	for (let i = 0; i < entries.length; i += PER_LINE) {
		const chunk = entries.slice(i, i + PER_LINE);
		lines.push(" " + chunk.join("   "));
	}

	return `Legal moves (●safe ◐trade ○risk):\n${lines.join("\n")}`;
}