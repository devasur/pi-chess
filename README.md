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

## Architecture

The extension follows the pattern from pi's tic-tac-toe example:

- **TUI Component** (`ChessComponent`) renders the board and handles keyboard input
- **Custom Tools** (`chess_move`, `chess_get_board`) allow the LLM to play
- **System Prompt Injection** (`before_agent_start`) provides chess instructions when a game is active
- **State Persistence** (`pi.appendEntry`) saves game state as FEN in the session
- **Custom Message Renderers** display move announcements with board snapshots