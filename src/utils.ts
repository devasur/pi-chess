/**
 * Utility functions: coordinate conversion, square colors, text padding.
 */

import { type Square } from "chess.js";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { FILES, RANKS } from "./constants.js";

export function squareFromCoords(row: number, col: number): Square {
	return `${FILES[col]}${RANKS[row]}` as Square;
}

export function coordsFromSquare(sq: Square): [number, number] {
	const file = sq.charCodeAt(0) - 97; // 'a' = 0
	const rank = 8 - parseInt(sq[1]);    // '8' = 0
	return [rank, file];
}

export function isLightSquare(sq: Square): boolean {
	const [row, col] = coordsFromSquare(sq);
	return (row + col) % 2 === 0;
}

export function centerPad(text: string, width: number): string {
	const textLen = visibleWidth(text);
	if (textLen >= width) return truncateToWidth(text, width);
	const pad = width - textLen;
	const left = Math.floor(pad / 2);
	return " ".repeat(left) + text + " ".repeat(pad - left);
}
