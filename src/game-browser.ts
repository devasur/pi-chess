/**
 * GameBrowserComponent — TUI for browsing and selecting a saved game.
 *
 * Shows a scrollable list of saved games sorted by date (newest first).
 * Each entry shows the date, player color, move count, and game status.
 * Arrow keys navigate, Enter loads, Escape cancels, D deletes.
 */

import type { Component } from "@earendil-works/pi-tui";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import {
	BOLD,
	DIM,
	RESET,
} from "./constants.js";
import type { GameSummary } from "./persistence.js";
import { deleteGameFromDisk } from "./persistence.js";
import { centerPad } from "./utils.js";

/** Sentinel "square" to signal loading a saved game. */
export const LOAD_GAME_PREFIX = "__load__";

export interface GameBrowserState {
	games: GameSummary[];
	cursor: number;
}

export class GameBrowserComponent implements Component {
	private state: GameBrowserState;
	private tui: { requestRender: () => void };
	private onDone: (selected: string | null) => void;
	private cachedLines: string[] = [];
	private cachedWidth = 0;
	private version = 0;
	private cachedVersion = -1;

	constructor(
		tui: { requestRender: () => void },
		onDone: (selected: string | null) => void,
		games: GameSummary[],
	) {
		this.tui = tui;
		this.onDone = onDone;
		this.state = {
			games,
			cursor: 0,
		};
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q" || data === "Q") {
			this.onDone(null);
			return;
		}

		if (matchesKey(data, "enter") || data === " ") {
			if (this.state.games.length > 0) {
				this.onDone(this.state.games[this.state.cursor].filepath);
			} else {
				this.onDone(null);
			}
			return;
		}

		if (matchesKey(data, "up") && this.state.cursor > 0) {
			this.state.cursor--;
			this.version++;
			this.tui.requestRender();
		} else if (matchesKey(data, "down") && this.state.cursor < this.state.games.length - 1) {
			this.state.cursor++;
			this.version++;
			this.tui.requestRender();
		} else if ((data === "d" || data === "D") && this.state.games.length > 0) {
			// Delete currently highlighted game from disk
			const target = this.state.games[this.state.cursor];
			deleteGameFromDisk(target.filepath);
			this.state.games.splice(this.state.cursor, 1);
			if (this.state.cursor >= this.state.games.length) {
				this.state.cursor = Math.max(0, this.state.games.length - 1);
			}
			this.version++;
			this.tui.requestRender();
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
		const s = this.state;

		// Header
		const title = `${BOLD}♟ Saved Games${RESET}`;
		lines.push(centerPad(title, width));
		lines.push("");

		if (s.games.length === 0) {
			lines.push(centerPad(`${DIM}No saved games found.${RESET}`, width));
			lines.push("");
			lines.push(centerPad(`${DIM}Press Escape to go back.${RESET}`, width));
		} else {
			// Column headers
			const hdr = `${DIM}  #  Date                  Color  Moves  Last    Result${RESET}`;
			lines.push(hdr);

			const maxVisible = Math.min(s.games.length, 15);
			const startIdx = Math.max(0, Math.min(s.cursor - Math.floor(maxVisible / 2), s.games.length - maxVisible));

			for (let i = startIdx; i < Math.min(startIdx + maxVisible, s.games.length); i++) {
				const g = s.games[i];
				const isCursor = i === s.cursor;
				const prefix = isCursor ? `${BOLD}▸${RESET} ` : "  ";
				const sel = isCursor ? BOLD : DIM;
				const selR = isCursor ? RESET : "";

				const date = formatDate(g.savedAt);
				const color = g.playerColor === "w" ? "White" : "Black";
				const result = g.result || "in progress";
				const lastMv = g.lastMove.padEnd(6);

				const line = `${prefix}${sel}${String(i + 1).padStart(2)}  ${date}  ${color.padEnd(5)}  ${String(g.moveCount).padStart(5)}  ${lastMv} ${result}${selR}`;
				lines.push(line.slice(0, width));
			}

			// Scroll indicator
			if (s.games.length > maxVisible) {
				const pct = Math.round(((s.cursor + 1) / s.games.length) * 100);
				lines.push(centerPad(`${DIM}${s.cursor + 1}/${s.games.length} (${pct}%)${RESET}`, width));
			}

			lines.push("");
			const controls = `${BOLD}Enter${RESET} load  ${DIM}|${RESET}  ${BOLD}D${RESET} delete  ${DIM}|${RESET}  ${BOLD}Esc${RESET} back`;
			lines.push(centerPad(controls, width));
		}

		this.cachedLines = lines;
		this.cachedWidth = width;
		this.cachedVersion = this.version;
		return this.cachedLines;
	}
}

/** Format ISO timestamp into a compact human-readable date. */
function formatDate(iso: string): string {
	try {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso.slice(0, 19);
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, "0");
		const day = String(d.getDate()).padStart(2, "0");
		const hour = String(d.getHours()).padStart(2, "0");
		const min = String(d.getMinutes()).padStart(2, "0");
		return `${year}-${month}-${day} ${hour}:${min}`;
	} catch {
		return iso.slice(0, 16);
	}
}