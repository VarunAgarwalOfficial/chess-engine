# Using it

## The page

- **Moving.** Drag a piece, or click it and then a marked square; both work with a mouse and
  with a finger. While the engine thinks you can line up your reply. With the board focused,
  Enter picks up and puts down and the arrow keys move between squares.
- **Drawing.** Right-click and drag for an arrow, right-click a square to mark it; Shift, Alt
  and Ctrl give other colours. On a touch screen press and hold a square that has no
  piece of yours, then drag; the arrow button makes every drag draw. A click or tap clears them.
- **New game.** Play White, Black, a random side, or both sides for two players at one board
  as in the original. Eight engine levels, from very easy to full strength, each described
  in a line; they are not matched to ratings. No clock, or one of seven time controls.
- **During a game.** Takeback, hint, offer a draw (the engine accepts when it stands worse),
  resign. The engine's evaluation is hidden while you play it, unless you switch it on. When
  the game ends a dialog says how, and offers a rematch, a review and the PGN.
- **Looking back.** Click a move or use the arrow keys; F flips the board, M mutes. Review
  marks inaccuracies, mistakes and blunders, shows the better move as an arrow, and draws the
  evaluation as a graph that can be clicked to jump. A move made while looking back at a
  finished game starts a new game from that point.
- **Position.** Copy or load FEN and PGN. The editor sets up any position the engine accepts,
  with castling rights and an en passant square, and says what is wrong with one it does not.
  A position can also be given by URL: `/web/?side=black&fen=...`.
- **Games** are kept in the browser's localStorage and can be reopened from the list.
- **Settings.** Light or dark, four board colours, sounds, coordinates, legal-move dots.

## Rebuilding the engine

`web/engine.wasm` is checked in, so the page runs without building anything. To rebuild it
after changing the engine:

```
npm run build:wasm
```

This needs the `wasm32-unknown-unknown` target (`rustup target add wasm32-unknown-unknown`, or
your distribution's package, for example `rust-wasm` on Arch), and uses `wasm-opt` if present.

As a UCI engine, build it and give a chess GUI the program:

```
cargo build --release --manifest-path engine/Cargo.toml
engine/target/release/uci
```

Supported: `uci`, `isready`, `ucinewgame`, `setoption name Hash`, `position`, `go` (`depth`,
`nodes`, `movetime`, `wtime`/`btime`/`winc`/`binc`/`movestogo`, `infinite`, `perft`), `stop`,
`quit`.

Counting positions and timing the search from the command line:

```
npm run perft -- 5
npm run perft -- 4 "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"
engine/target/release/uci bench 14
engine/target/release/uci explain 8 "<fen>"
```

`uci explain` searches every legal move on its own and prints each one's score and expected line,
best first, then the opponent's threat if there is one. The page gets the same from
`engine.explain(fen, moves, depth)` in `web/engine.js`.

`npm run perft:suite` builds the `perft` runner and checks the engine against every position in
`engine/tests/perft.epd`. The runner works with any UCI engine that answers `go perft`:
`engine/target/release/perft <engine> [--max-nodes N]`.

Playing two UCI engines against each other, with an Elo difference and error bars:

```
engine/target/release/match --engine1 engine/target/release/uci --engine2 "some other engine" --games 200 --tc 1+0.01
```

## Tests

The tests are few on purpose. The move generator is checked against the published node counts
for the six standard perft positions, which exercises every rule of movement. The rest cover the
ways a game ends, a handful of search results (forced mates, a basic endgame mate, an
evaluation that is the same for both colours), the UCI program run as a real process, and the
page's logic against the real `engine.wasm`: a game played through it, PGN out and back, the
review's marks, the clock, a flag fall that is a draw, every line of the opening table, and
the weak levels' choice of move.
