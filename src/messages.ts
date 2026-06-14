/**
 * Custom message components used to render tool results and announcements
 * in the TUI: a board snapshot component and a game-over banner.
 *
 * Also exposes `registerMessageRenderers` to wire them into the extension.
 */

import type { Component } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Theme } from "@earendil-works/pi-coding-agent";
import {
	GAME_OVER_MESSAGE_TYPE,
	MOVE_MESSAGE_TYPE,
} from "./constants.js";
import type { BoardDetails } from "./types.js";
import { centerPad } from "./utils.js";

/** A framed board snapshot with title, ASCII board, and FEN. */
export class BoardMessageComponent implements Component {
	private readonly title: string;
	private readonly details: BoardDetails | undefined;
	private readonly expanded: boolean;
	private readonly theme: Theme;

	constructor(
		title: string,
		details: BoardDetails | undefined,
		expanded: boolean,
		theme: Theme,
	) {
		this.title = title;
		this.details = details;
		this.expanded = expanded;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const dim = (s: string) => this.theme.fg("dim", s);
		const lines: string[] = [];
		const titleLen = visibleWidth(this.title);
		const fillLen = Math.max(0, width - titleLen - 2);
		const leftFill = Math.floor(fillLen / 2);
		const rightFill = fillLen - leftFill;
		lines.push(
			`${dim("─".repeat(leftFill))} ${this.title} ${dim("─".repeat(rightFill))}`,
		);

		if (this.expanded && this.details) {
			lines.push("");
			for (const line of this.details.board.split("\n")) {
				lines.push(centerPad(dim(line), width));
			}
			lines.push("");
			lines.push(
				centerPad(
					`${dim("FEN:")} ${this.details.fen}`,
					width,
				),
			);
		}

		return lines;
	}
}

/** A highlighted banner announcing the end of the game. */
export class GameOverMessageComponent implements Component {
	private readonly result: string;
	private readonly details: BoardDetails | undefined;
	private readonly theme: Theme;

	constructor(result: string, details: BoardDetails | undefined, theme: Theme) {
		this.result = result;
		this.details = details;
		this.theme = theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const dim = (s: string) => this.theme.fg("dim", s);
		const bold = (s: string) => this.theme.bold(s);
		const accent = (s: string) => this.theme.fg("accent", s);

		const hr = dim("─".repeat(width));
		const lines: string[] = [];
		lines.push(hr);
		lines.push("");
		lines.push(centerPad(bold(accent(this.result)), width));
		lines.push("");

		if (this.details) {
			for (const line of this.details.board.split("\n")) {
				lines.push(centerPad(dim(line), width));
			}
			lines.push("");
		}

		lines.push(hr);
		return lines;
	}
}

/**
 * Register renderers for the custom message types this extension emits.
 * Splitting this out keeps `registerTools` / `registerCommand` from having
 * to know about presentation.
 */
export function registerMessageRenderers(pi: ExtensionAPI): void {
	pi.registerMessageRenderer(
		MOVE_MESSAGE_TYPE,
		(message, { expanded }, theme) => {
			const details = message.details as BoardDetails | undefined;
			const turnLabel =
				details?.turn === "Black"
					? `${theme.fg("warning", theme.bold("Black"))} (Agent)`
					: `${theme.fg("accent", theme.bold("White"))} (You)`;
			const lastMove = details?.lastMove ?? "—";
			const title = `${theme.fg("accent", theme.bold("Move played"))}  ${theme.fg("dim", "→")}  next: ${turnLabel}  ${theme.fg("dim", `(${lastMove})`)}`;
			return new BoardMessageComponent(title, details, expanded, theme);
		},
	);

	pi.registerMessageRenderer(
		GAME_OVER_MESSAGE_TYPE,
		(message, _options, theme) => {
			const details = message.details as BoardDetails | undefined;
			const result = message.content as string;
			return new GameOverMessageComponent(result, details, theme);
		},
	);
}

