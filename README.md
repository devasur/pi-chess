# pi-chess

A [pi](https://github.com/earendil-works/pi-coding-agent) extension that lets you play chess against the current LLM model directly in the TUI.

## Installation

```bash
# Install dependencies
cd pi-chess && npm install

# Run with pi (quick test)
pi -e ./index.ts

# Or install as a pi package
pi install /path/to/pi-chess
```

## Usage

Start a game with the `/chess` command:

- `/chess` — start a new game (you play **White**)
- `/chess black` — start a new game (you play **Black**)

### Controls

| Key | Action |
|-----|--------|
| `↑↓←→` | Move cursor |
| `Enter` / `Space` | Select piece / confirm destination / confirm promotion |
| `Escape` | Deselect piece (or quit if no selection) |
| `Q` | Quit the game |
| `R` | Restart (when game is over) |
| `U` | Undo last move pair |

### How It Works

1. You navigate the board with arrow keys and select a piece with `Enter`
2. Legal move targets are highlighted with green dots (`●`)
3. Navigate to a destination and press `Enter` to move
4. After your move, the LLM (playing the opposite color) receives the board state and makes its move using the `chess_move` tool
5. The board updates and play continues

### LLM Integration

The LLM plays via two tools:

- **`chess_move`** — Make a move using standard algebraic notation (SAN). Examples: `e4`, `Nf3`, `Bxb5`, `O-O`, `e8=Q`
- **`chess_get_board`** — View the current board position, FEN, and legal moves

When it's the LLM's turn, the system prompt includes full chess instructions with the current board state in both visual and FEN notation.

### Features

- ♟️ Full chess rules via [chess.js](https://github.com/jhlywa/chess.js) (castling, en passant, promotion, etc.)
- 🎨 Color-coded board with Unicode chess pieces
- ✨ Visual highlights: cursor, selected piece, legal moves, last move, check
- 🔄 Undo support (`U` key undoes your move and the agent's response)
- 💾 Game state persisted across session reloads
- 🎯 Custom message renderers for move announcements and game-over
- 🤖 Works with any model — the LLM receives clear instructions and a well-structured board representation
- 📉 **Constant context cost** — context pruning keeps the LLM's context window small regardless of game length (see below)
- ⚡ **Single-call moves** — each agent move uses exactly 1 LLM call, no wasteful follow-up (see below)

## Context Pruning

Chess is a game of **perfect information**: the FEN string encodes the complete game state. The agent never needs to see previous moves — only the current position.

Without pruning, each move adds ~500+ tokens of context (board ASCII, FEN, legal moves, tool call + result). By move 100, that's 50,000+ tokens of stale history.

The extension uses pi's `context` event to strip all chess-related messages before each LLM call:

- **Custom messages** (`chess-move`, `chess-game-over`) — turn trigger announcements
- **Tool call/result messages** for `chess_move` and `chess_get_board`
- **Assistant messages** containing chess tool calls

The current board state is always injected fresh into the system prompt by the `before_agent_start` hook, so the agent always has the latest position. Context cost stays **constant** from move 1 through move 100.

## Single-Call Moves

Each agent move requires exactly **1 LLM call**. The `chess_move` tool returns `terminate: true`, which tells pi to skip the automatic follow-up LLM call that would otherwise generate unnecessary commentary after the tool result.

Without `terminate: true`, the standard tool-use loop would make **2 LLM calls per move**:
1. The LLM decides on a move and calls `chess_move`
2. The LLM receives the tool result and generates a text commentary response

With `terminate: true`, the tool result marks the turn as complete — the move, commentary, and board state are all captured in the single tool call. The next LLM call only happens when the player makes their next move and triggers a new turn.

If the agent makes an illegal move, `terminate` is not set (the tool throws an error), so the agent gets the error message and can retry with a legal move.

## Architecture

```
index.ts              — Extension entry point: session handlers, prompt injection, context pruning
src/constants.ts      — ANSI codes, piece symbols, message types, sentinels
src/types.ts          — BoardState, SaveData, BoardDetails, PlayerColor
src/utils.ts          — Coordinate conversion, isLightSquare, centerPad
src/ascii-board.ts    — board → ASCII for the LLM
src/state.ts          — boardState, gameActive, chessComponent, persistence helpers
src/turn.ts           — triggerAgentTurn, emitGameOverMessage, registerContextPruner
src/messages.ts       — BoardMessageComponent, GameOverMessageComponent, renderers
src/chess-component.ts — Interactive TUI board (keyboard input, rendering)
src/command.ts        — /chess command registration
src/tools.ts          — chess_move and chess_get_board tool registration
```

Key design patterns:

- **TUI Component** (`ChessComponent`) renders the board and handles keyboard input
- **Custom Tools** (`chess_move`, `chess_get_board`) allow the LLM to play
- **System Prompt Injection** (`before_agent_start`) provides chess instructions when a game is active
- **Context Pruning** (`context` event) strips stale chess messages before each LLM call
- **State Persistence** (`pi.appendEntry`) saves game state as FEN in the session
- **Custom Message Renderers** display move announcements with board snapshots