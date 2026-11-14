# Chess

A chess engine in Rust and a browser board to play against it. The engine knows the full rules,
searches ahead with alpha-beta, speaks UCI so it can be plugged into any chess GUI, and runs in
the page as WebAssembly.

## The idea

The original was a two-player chess board written in Python with Pygame in 2021. Its first version
only listed where each piece could go and knew nothing about check. The rewrite that followed did
the hard part properly: it looked outward from the king, recorded every check and every pinned
piece, noted double check, and then let each piece move only where those facts allowed. It came
with a small script that counted positions several moves deep to see whether the generator was
right, and an `ai.py` that got as far as an empty piece-square "map" and a loop to add it up. This
version keeps that generator design, turns the counting script into a real test, and finishes the
opponent.

## How it works

There is one engine, written in Rust, in `engine/`. It is a library with no dependencies; the
UCI program, the match runner and the WebAssembly build for the page are thin layers over it.
An earlier version of this project had the engine in JavaScript; `STRENGTH.md` compares the two.

**Board** (`bitboard.rs`, `position.rs`). A set of squares is one 64-bit word, one bit per
square, so "all white pawns" or "every square a knight attacks" is a single number and
combining sets is a single instruction. Bishop and rook attacks use magic bitboards: the pieces
standing on the slider's lines are multiplied by a constant that gathers them into a table
index, and the table holds the attack set. The constants are found at start-up. A move is 16
bits; moves are made and unmade in place, and the undo stack doubles as the game history.

**Legal moves** (`movegen.rs`). The original design, in bitboard form. One look outward from
the king along the eight lines, plus the knight and pawn squares, gives three things:

- the checking pieces;
- for a single check, the squares that answer it (the checker and the squares between);
- the pinned pieces, each with the line it is pinned on.

Then: in double check only the king moves; in single check other pieces may only land on an
answering square; a pinned piece may only move along its pin. King moves are tested with the
king lifted off the board, so it cannot hide behind itself. En passant is the one move that is
simply tried, because it removes two pawns from one rank at once. No other move is ever made
and then checked.

**Rules that end the game** (`game.rs`). Checkmate, stalemate, threefold repetition, the
fifty-move rule and insufficient material. Positions are compared by a 64-bit Zobrist hash
updated move by move. The en passant square is recorded only when a capture is actually
possible, so repetition is counted the way the rules define it.

**Evaluation** (`eval.rs`). Every term has a middlegame and an endgame value, blended by how
much material is left. Material and a table per piece for where it stands well are kept up to
date as moves are made. On top of that: mobility, doubled, isolated and passed pawns, the
bishop pair, rooks on open files, and, in a won ending without pawns, driving the losing king
to the edge.

**Search** (`search.rs`, `tt.rs`). Iterative deepening over a principal-variation alpha-beta
search:

- aspiration windows around the previous iteration's score;
- a transposition table, with mate scores stored relative to the node;
- move ordering: table move, winning captures (judged by static exchange evaluation), killer
  moves, countermoves, history, losing captures last;
- null-move pruning, reverse futility pruning, futility pruning, late move pruning and
  exchange pruning;
- late move reductions that grow with depth and move number and shrink for moves with a good
  history, and an extension when in check;
- a quiescence search that plays out captures before evaluating;
- repetition and the fifty-move rule are seen inside the tree;
- on a clock, a soft limit that stretches when the best move has just changed and shrinks when
  it has been stable, and a hard limit that cuts off a long iteration.

Each group of ideas beyond the plain alpha-beta search was kept only after it won a self-play
match against the version without it. `STRENGTH.md` has the method and the numbers, including
what was tried and removed.

**Around the engine.** `uci.rs` is the UCI protocol: parsing and formatting as pure functions,
and a loop that reads standard input while the search runs on its own thread, so `stop` is
heard at once. `wasm.rs` is the interface for the page: text in, JSON out, through one shared
buffer, with no binding generator. It has two requests. `describe` takes a start position and
the moves played, and returns the position, how the game stands and every legal move with its
notation. `go` takes the same plus UCI `go` parameters, and returns the best move, the score
and the expected line in both notations.

**The page** (`web/`). A static site with no framework and no dependencies. It keeps no chess
rules of its own: which moves are legal, how they are written, whether the game is over and
whether a set-up position can be played are all asked of the engine. One copy of the engine
answers those questions on the main thread; two more run in Web Workers, one to play and one
to analyse.

- A search in WebAssembly cannot be interrupted from outside. Analysis therefore runs as a
  series of searches, each one ply deeper and sharing the transposition table, and gives way
  to a newer request between them; a search that must stop at once has its worker replaced.
- The weaker levels do not search less well, they choose less well: every legal move is
  scored by a shallow search, random noise is added to the scores, and the best noisy score
  is played. A forced mate is never passed up. Stronger levels search to a fixed depth, and
  the strongest has only the clock.
- Pieces slide because the board compares the position before and after: a piece that left
  one square and a piece of the same kind that appeared on another are the same piece. That
  covers castling, en passant and takebacks without the board knowing what they are.
- A premove is two squares remembered until the turn arrives, then tried against the legal
  moves.
- A review searches every position of the game once. The value of a move is the score of
  the position after it, so one search per position gives both the best move and what the
  played move cost. Scores are turned into winning chances (the curve Lichess fitted to its
  games) and a move is an inaccuracy, mistake or blunder when it gives up 10, 20 or 30
  points of winning chance.
- PGN import drops comments, variations and annotations, then matches each word against
  the notation of the legal moves.
- Opening names come from a hand-written table of about 170 lines in `eco.js` (its codes were
  checked against the Lichess openings list where the same line appears there); a game is
  named by the longest line its moves begin with.
- Sounds are made with WebAudio; there are no audio files.

```
engine/src/        the engine library (pure, tested)
engine/src/bin/    uci.rs (UCI engine, perft, bench), match.rs (engine against engine)
engine/tests/      perft, rules, search, the UCI program as a process
web/               the page, and engine.wasm built from the library
  app.js             holds the game and wires everything together
  board.js           drawing, drag and drop, premoves, arrows, keyboard
  game.js            the moves played and the engine's description of each position
  engine.js, worker.js, client.js   the WebAssembly engine and its workers
  pgn.js, eco.js, review.js, clock.js, text.js   pure logic
  sound.js, store.js   WebAudio and localStorage
  pieces/            the piece images, with their own licence
bin/serve.js       a small web server for the page
test/              the page's code against the real engine.wasm
```

## Run

Needs Node 22 or newer for the page, and Rust (stable) for everything else.

```
npm install     # only lint and format tools; the program itself has no dependencies
npm start       # then open http://localhost:8000/
```

The port comes from `PORT` (copy `.env.example` to `.env` to change it).

On the page:

- **Moving.** Drag a piece, or click it and then a marked square; both work with a mouse and
  with a finger. While the engine thinks you can line up your reply. With the board focused,
  Enter picks up and puts down and the arrow keys move between squares.
- **Drawing.** Right-click and drag for an arrow, right-click a square to mark it; Shift, Alt
  and Ctrl give other colours. A left click clears them.
- **New game.** Play White, Black, a random side, or both sides for two players at one board
  as in the original. Eight engine levels from beginner to full strength. No clock, or one of
  seven time controls.
- **During a game.** Takeback, hint, offer a draw (the engine accepts when it stands worse),
  resign. The evaluation bar and the engine's line can be switched off.
- **Looking back.** Click a move or use the arrow keys; F flips the board. Review marks
  inaccuracies, mistakes and blunders and shows the better move. A move made while looking
  back at a finished game starts a new game from that point.
- **Position.** Copy or load FEN and PGN. The editor sets up any position the engine accepts.
  A position can also be given by URL: `/web/?side=black&fen=...`.
- **Games** are kept in the browser's localStorage and can be reopened from the list.
- **Settings.** Light or dark, four board colours, sounds, coordinates, legal-move dots.

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
```

Playing two UCI engines against each other, with an Elo difference and error bars:

```
engine/target/release/match --engine1 engine/target/release/uci --engine2 "some other engine" --games 200 --tc 1+0.01
```

## Test

```
npm test              # Rust tests and the page test, a few seconds
npm run test:deep     # perft to full published depth
npm run lint          # clippy and eslint
npm run format:check  # rustfmt and prettier
```

The tests are few on purpose. The move generator is checked against the published node counts
for the six standard perft positions, which exercises every rule of movement. The rest cover the
ways a game ends, a handful of search results (forced mates, a basic endgame mate, an
evaluation that is the same for both colours), the UCI program run as a real process, and the
page's logic against the real `engine.wasm`: a game played through it, PGN out and back, the
review's marks, the clock, and the weak levels' choice of move.

## Limits

Draws by repetition and the fifty-move rule are applied automatically rather than claimed. A
flag falls even when the other side could never mate. PGN import reads the first game and
only its main line. Arrows cannot be drawn on a touch screen. The engine levels are not
calibrated to ratings. The
engine has no opening book or endgame tables, and searches on one thread. The evaluation is
hand written and its weights are untuned; it knows nothing about king safety, which was tried
and did not show a gain. Its strength on an absolute scale has not been measured.

## Credit

Based on the Pygame chess game by Varun Agarwal, 2021. Piece-square tables are PeSTO's, by
Ronald Friederich. The chess pieces are by Cburnett, from Wikimedia Commons, under
CC BY-SA 3.0 (`web/pieces/LICENSE.txt`); the rest of the project is under the MIT licence.
