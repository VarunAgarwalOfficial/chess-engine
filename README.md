# Chess

A chess engine and a browser board to play against it. The engine knows the full rules, searches
ahead with alpha-beta, and also speaks UCI so it can be plugged into any chess GUI.

## The idea

The original was a two-player chess board written in Python with Pygame in 2021. Its first version
found legal moves the obvious way: try every move, then check whether the king is attacked. The
rewrite that followed did something better. Before generating anything it looked outward from the
king, recorded every check and every pinned piece, and then let each piece move only where those
facts allowed, so no move had to be played and taken back to be judged. It came with a small
script that counted positions several moves deep to see whether the generator was right, and an
`ai.py` that got as far as an empty piece-square "map" and a loop to add it up. This version keeps
that generator design, turns the counting script into a real test, and finishes the opponent.

## How it works

Everything about chess lives in `src/engine` and is plain JavaScript with no dependencies. It runs
unchanged in Node and in the browser.

**Board.** A 0x88 board: 128 bytes where `square = rank * 16 + file`. A square is on the board
exactly when `(square & 0x88) === 0`, so walking off an edge is one test. A move is a single
integer holding from, to, the moving and captured piece, promotion and flags, which is enough to
undo it.

**Legal moves** (`movegen.js`). One scan outward from the king along the eight lines, plus the
knight and pawn squares, gives three things:

- the number of checking pieces;
- for a single check, the squares that answer it (the checker and the squares between);
- for each pinned piece, the direction of its pin.

Then: in double check only the king moves; in single check other pieces may only land on an
answering square; a pinned piece may only move along its pin. King moves are tested with the king
lifted off the board, so it cannot hide behind itself. En passant is the one move that is simply
tried on the board, because it removes two pawns from one rank at once.

**Rules that end the game** (`game.js`). Checkmate, stalemate, threefold repetition, the
fifty-move rule and insufficient material. Positions are compared by a Zobrist hash kept as two
32-bit halves and updated move by move. The en passant square is recorded only when a capture is
actually possible, so repetition is counted the way the rules define it.

**Evaluation** (`eval.js`). Material, a table per piece for where it stands well, bishop pair,
doubled, isolated and passed pawns, rooks on open files, and two king tables blended by how much
material is left: sheltered early, central late. With a decisive lead it also rewards pushing the
enemy king to the edge, which is what lets it finish king and rook against king.

**Search** (`search.js`). Iterative deepening over a principal-variation alpha-beta search:

- a transposition table, with mate scores stored relative to the node;
- move ordering: table move, captures by most valuable victim and least valuable attacker,
  killer moves, then a history score;
- null-move pruning, late-move reductions, and an extension when in check;
- a quiescence search that plays out captures before evaluating;
- repetition and the fifty-move rule are seen inside the tree.

On an ordinary laptop it reaches depth 10 to 12 in one second from the opening.

**Around the engine.** `src/uci` is the UCI protocol as text in, text out; `bin/uci.js` runs the
search in a worker thread so `stop` is heard immediately. `web/` is the page: it draws the board,
passes clicks to the engine's rules, and runs the search in a Web Worker.

```
src/engine/   board, movegen, eval, search, notation, game   (pure, tested)
src/uci/      UCI protocol and its worker thread
bin/          serve.js (web server), uci.js (UCI engine), perft.js
web/          the page
test/         node:test suites
```

## Run

Needs Node 22 or newer.

```
npm install     # only lint and format tools; the program itself has no dependencies
npm start       # then open http://localhost:8000/
```

The port comes from `PORT` (copy `.env.example` to `.env` to change it).

On the page: click a piece, then a marked square. Choose your side, or "Both sides" for two
players at one board as in the original. Any position can be loaded as FEN, also by URL:
`/web/?side=black&fen=...`.

As a UCI engine, give a chess GUI this command:

```
node /path/to/chess/bin/uci.js
```

Supported: `uci`, `isready`, `ucinewgame`, `position`, `go` (`depth`, `nodes`, `movetime`,
`wtime`/`btime`/`winc`/`binc`/`movestogo`, `infinite`), `stop`, `quit`.

Counting positions from the command line:

```
npm run perft -- 5
npm run perft -- 4 "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"
```

## Test

```
npm test              # everything, about a second
npm run test:deep     # perft to full published depth, a few seconds
npm run lint
npm run format:check
```

The move generator is checked two ways: against the published node counts for the six standard
perft positions, and against a second, naive generator (the original's first method) over
thousands of random positions. Other tests cover each draw rule, hashing, notation, evaluation
symmetry, forced mates, the basic endgame mates, the UCI program run as a real process, and the
web server.

## Limits

Draws by repetition and the fifty-move rule are applied automatically rather than claimed. The
engine has no opening book or endgame tables, and searches on one thread. The evaluation is hand
written and simple, so it plays sensibly but is far from a top engine.

## Credit

Based on the Pygame chess game by Varun Agarwal, 2021. Piece-square values follow Tomasz
Michniewski's "simplified evaluation function".
