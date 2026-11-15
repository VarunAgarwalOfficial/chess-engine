# Strength

What was measured, how, and the numbers. Every figure here comes from games or timings that
were actually run on 14 November 2026 on one machine (Intel Core Ultra 7 265K, Linux), with at
most four games at a time.

## Method

`engine/src/bin/match.rs` plays two UCI engines against each other:

- Openings are eight random moves from the start position, kept only if a depth-8 search calls
  the result level within half a pawn. Each opening is played twice with colours swapped. The
  same seed gives the same openings, so every match below was played from the same positions.
- Games are judged by the engine library's own rules. A game is also stopped when both engines
  have agreed for six plies that one side is ahead by seven pawns or more, or, after move 40,
  for twelve plies that the position is dead level.
- A crash, an illegal move or a lost clock counts as a loss and is reported as a fault. There
  were no faults in any match below.
- The Elo difference comes from the score; the 95% interval comes from the spread of the scores
  of opening pairs, since the two games of a pair are not independent.

```
cd engine && cargo build --release
target/release/match --engine1 CMD --engine2 CMD --games 200 --tc 0.5+0.005
```

The whole budget for the self-play matches was about 30 minutes of game time (1,695 seconds summed over all games), so
matches are short: 200 games at 0.5 seconds plus 5 milliseconds a move. An interval of about
±40 Elo is what that buys. Results at this speed need not carry over exactly to slow games.

## Against the old JavaScript engine

The JavaScript engine is commit `b7723f3` of this repository, run with Node.

| Match                           | Games | Time control | Result    | Elo                                 |
| ------------------------------- | ----: | ------------ | --------- | ----------------------------------- |
| Rust engine v JavaScript engine |    36 | 3 s + 0.1 s  | +36 =0 −0 | at least +425 (95%), no upper bound |

A clean sweep only gives a lower bound: an engine less than 425 Elo stronger would win 36 games
in a row less than one time in twenty. How much more than that it is was not measured; doing so
would need a handicap match (the Rust engine on a fraction of the time).

Speed, counting every node of the main and quiescence search, on the same eight positions
unless noted:

| Engine                                                           | Nodes per second |
| ---------------------------------------------------------------- | ---------------: |
| JavaScript, depth 9                                              |        1,450,000 |
| Rust as shipped, depth 16                                        |        4,400,000 |
| Rust as shipped, in WebAssembly under Node (one position, 1 s)   |        3,000,000 |
| Rust plain port: the same search ideas, but a lighter evaluation |       14,000,000 |

So the shipped engine searches about three times as many nodes a second as the JavaScript one.
The last row is not like for like: the plain port's evaluation was only material and
piece-square tables kept up to date move by move, less work than the JavaScript evaluation did.
Nodes per second also says little across different searches, because pruning removes the
cheapest nodes: in one middlegame position the shipped engine finished depth 14 in 55 ms and
the plain port depth 11 in 144 ms.

Move generation alone (perft 5 from the start position, both counting the last ply without
making the moves): 69 million positions a second in JavaScript, 405 million in Rust.

## Each idea against the version before it

The first Rust version ("plain port") had the same set of search ideas as the JavaScript engine
(principal variation search, transposition table, null move, a fixed one- or two-ply late move
reduction, killers, history, check extension, quiescence). It was not identical: it also had
mate-distance pruning, bounded history scores, the static evaluation stored in the table, and
the clock handling described in the README, and its evaluation was tapered material and
piece-square tables only. Ideas were then added
in groups behind switches and played against the version without them: commit `f5fcaae` has the
switches, and the matches can be repeated from it with `--options1 "Reductions=true"` and so
on. All matches: 200 games at 0.5 s + 0.005 s.

| Added                                                                                                                                                                                                   | Against                           | Result       | Elo, 95% interval  | Verdict            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------ | ------------------ | ------------------ |
| Reductions and ordering: logarithmic late move reductions steered by history, aspiration windows, countermoves, losing captures last, history penalties, deeper null move, internal iterative reduction | plain port                        | +89 =59 −52  | +65, +26 to +105   | kept               |
| Pruning: reverse futility, futility, late move pruning, exchange (SEE) pruning in the main and quiescence search                                                                                        | reductions                        | +111 =64 −25 | +160, +118 to +207 | kept               |
| Evaluation terms: mobility, doubled, isolated and passed pawns, bishop pair, rooks on open files                                                                                                        | reductions + pruning              | +99 =47 −54  | +80, +41 to +120   | kept               |
| King safety: pieces bearing on the king's neighbourhood, pawn shield                                                                                                                                    | reductions + pruning + evaluation | +74 =59 −67  | +12, −28 to +52    | not shown; removed |
| Pruning alone, before the reductions and ordering group                                                                                                                                                 | plain port                        | +74 =50 −76  | −3, −46 to +39     | not shown          |

The last row was the first match played. After it, a diagnostic (how often each configuration at
8 ms a move picks the move a 300 ms search picks, over 150 positions) suggested that pruning
alone chose worse moves and pruning with the ordering group did not, so pruning was tested again
on top of that group. The diagnostic is not a strength measurement and its numbers are not
reported; it used about three minutes of processor time, including short self-play to produce
its positions, which is outside the game-time figure above.

On the plain port pruning gained nothing measurable, and on top of the ordering group it was the
largest single gain. The likely reason, not separately tested, is that pruning late moves
depends on the moves being well ordered. Adding the three kept steps gives roughly +300 Elo over the plain port in fast
self-play; self-play tends to exaggerate differences, so treat that as an upper estimate.

The ideas were tested in groups, not one by one, because the budget allows about five matches.
Inside a kept group an individual idea may be neutral or harmful; that has not been measured.
The numbers inside each idea (margins, reduction formula, evaluation weights) are sensible
starting values and have not been tuned.

## Absolute strength

Measured against Stockfish 19 with its strength limited (`UCI_LimitStrength true`, `UCI_Elo`
set per match), after Stockfish was installed. Same machine, same day, same match runner and
adjudication as above, but a separate budget and a slower time control:

- 10 seconds plus 0.1 seconds a move for each side, one thread each, 64 MB hash each, no
  opening book or endgame tables on either side, four games at a time.
- Openings as in the method above (eight random moves, kept if level), each played with both
  colours.
- 39 minutes on the wall for all games (2,365 seconds; 9,129 seconds of game time), 328 games.

```
target/release/match --engine1 target/release/uci --options1 "Hash=64" \
  --engine2 /usr/bin/stockfish \
  --options2 "Threads=1 Hash=64 UCI_LimitStrength=true UCI_Elo=2650" \
  --games 100 --tc 10+0.1 --seed 2
```

The runner already passed options to either engine, so it was not changed. Stockfish searches
four lines when limited but reports only the first, so the scores used to stop decided games
are those of its best line. There were no faults in any match.

| Stockfish `UCI_Elo` | Games | Seed | Result (this engine) | Score | Elo difference, 95% interval | Implied rating |
| ------------------: | ----: | ---: | -------------------- | ----: | ---------------------------- | -------------: |
|                2200 |     8 |   99 | +6 =0 −2             | 75.0% | +191, −23 to +1200           |    timing test |
|                2500 |    40 |    1 | +30 =3 −7            | 78.8% | +228, +110 to +429           |           2728 |
|                2650 |   100 |    2 | +58 =11 −31          | 63.5% | +96, +35 to +164             |           2746 |
|                2750 |    80 |    3 | +33 =13 −34          | 49.4% | −4, −68 to +59               |           2746 |
|                2850 |   100 |    2 | +30 =19 −51          | 39.5% | −74, −133 to −19             |           2776 |

The first two rows were probes to find the range: the 2200 run only timed a game, and after
78.8% at 2500 there was no reason to spend games at 1800 or 2200, so those levels were not
played further. The budget then went on three levels around the 50% point.

**Estimate: about 2760 on Stockfish's `UCI_Elo` scale at this time control, 95% interval
roughly 2720 to 2800.** That is the average of the implied ratings of the last three matches,
weighted by their precision (2758, standard error 18). The three agree with each other within
their intervals, and the engine scores above half below 2750 and below half above it, so the
bracket is real. Interpolating the 50% point between 2650 and 2850 alone gives 2763.

What that interval covers is only the luck of 280 games. It does not cover these, which are
probably larger:

- **The scale.** Stockfish's source says its limited levels were fitted to games against
  versions of the Stash engine so that they span "CCRL Blitz Elo from 1320 to 3190,
  approximately". So the number is an approximate CCRL Blitz rating as mimicked by a weakened
  Stockfish, on the conditions Stockfish's developers used for that fit (a much slower time
  control than 10 s + 0.1 s, as far as its documentation says; the exact figure was not
  checked here). At a different time control, on different hardware, or with another Stockfish
  version, the same `UCI_Elo` setting is a different opponent.
- **One opponent, and an unusual one.** A limited Stockfish searches well and then
  deliberately picks a worse move some of the time. A rating from one such opponent need not
  match the rating a pool of ordinary engines would give. An actual CCRL-style test against
  several rated engines could easily land 100 or more points away.
- **Speed.** These are 10-second games. Nothing here says how the engine scales to long games.
- **It is not a FIDE or any human rating.** Engine lists and human ratings are separate pools
  with no common games; engine-list numbers are not comparable to FIDE, Lichess or Chess.com
  ratings, and no claim about strength against people is made here beyond the obvious one that
  an engine at this level outplays almost any human at fast time controls.

A fair summary: **in the high 2000s on an engine-list scale, most likely 2650 to 2850**, with
2760 the point estimate under the exact conditions above.

## Second round: tuning, king safety, the clock (14 November 2026, later the same day)

Work on the `strength` branch. Every idea was tested alone against the best version so far
with a sequential probability ratio test (SPRT), now part of the match runner:

```
target/release/match --engine1 NEW --engine2 BEST --games 1000 --tc 0.5+0.005 --sprt "0 20"
```

The test asks whether the new version is 20 Elo stronger (H1) or no stronger (H0), with a 5%
chance of each kind of mistake, and stops as soon as the games decide: the log-likelihood ratio
(LLR) leaves ±2.94. It is computed over opening pairs with the normal approximation of the
generalised SPRT that Fishtest uses. `--games` is only a cap; a test that reaches the cap is
"undecided" and the idea is not kept. Openings are the runner's eight random moves, different
for every test (a new seed each time).

Conditions were worse than in the first round and got worse during the session: the machine
was shared with other heavy jobs (load average 30 to 65 on 20 cores, against four match
threads), and the engine's speed on the bench fell from 4.4 to 2.7 million nodes a second. At
0.5 s + 0.005 s that produced losses on time on both sides, so from the king safety test on,
tests ran at 1 s + 0.02 s with a cap of 400 to 500 games. A test with a time loss is marked.

### Each idea, in the order tested

| #   | Idea                                                                                                                                                               | Time control           |               Games | Elo, 95% interval                                         | SPRT [0, 20]                                                                 | Verdict                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------: | --------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| 1   | Transposition table probed and stored in the quiescence search                                                                                                     | 0.5+0.005              |                1000 | +1, −14 to +17                                            | LLR −2.71, undecided at the cap                                              | not kept                           |
| 2   | Continuation history (one and two plies back) and capture history, in move ordering and in the reduction of late moves                                             | 0.5+0.005              |                 752 | −3, −22 to +16                                            | stopped at the lower bound (H0)                                              | not kept                           |
| 3   | Texel tuning of every weight, including all 768 piece-square entries                                                                                               | 0.5+0.005              |                 506 | −16, −42 to +10                                           | H0 accepted                                                                  | not kept                           |
| 4   | Texel tuning of material and the 16 evaluation terms, piece-square tables keeping their shape                                                                      | 0.5+0.005              |                 568 | +32, +8 to +56                                            | stopped at the upper bound (H1)                                              | **kept**                           |
| 5   | King safety with tuned weights: squares attacked next to the enemy king by piece type, pawn shield, open files at the king                                         | 0.5+0.005, then 1+0.02 | 1000 + 300, then 94 | +21, +4 to +39 and +3, −28 to +35; then +111, +59 to +168 | undecided at the fast control (LLR +2.77, then −0.50); H1 accepted at 1+0.02 | **kept**                           |
| 6   | Clock: aim for a full share of the remaining time a move (clock/25 + 3/4 increment) instead of six tenths of it                                                    | 1+0.02                 |                 186 | +57, +22 to +92                                           | H1 accepted                                                                  | **kept**                           |
| 7   | Singular extensions (depth 7 and up, margin 2 × depth, with multi-cut and a negative extension)                                                                    | 1+0.02                 |                 500 | +3, −19 to +25                                            | LLR −1.17, undecided at the cap                                              | not kept                           |
| 8   | More evaluation terms, tuned: pawn threats, minor-piece threats on rooks and queens, king distance to passed pawns, protected passed pawns, tempo, knight outposts | 1+0.02                 |                 100 | +108, +57 to +163                                         | H1 accepted                                                                  | **kept**                           |
| 9   | Network evaluation (768 → 64×2 → 1, trained on the 1.37 million positions) in place of the hand-written evaluation                                                 | 1+0.02                 |                  50 | −191, −293 to −112                                        | H0 accepted                                                                  | not kept; not installed by default |
| 10  | A third group of tuned terms: connected pawns by rank, rook on the seventh, pawns on the bishop's colour, squares from which a piece could give check              | 1+0.02                 |                 400 | +11, −14 to +37                                           | LLR +0.15, undecided at the cap                                              | not kept                           |
| 11  | Clock again: clock/20 instead of clock/25 a move                                                                                                                   | 1+0.02                 |                 400 | −4, −30 to +21                                            | LLR −1.75, undecided at the cap                                              | not kept                           |

Notes on single rows:

- Row 2 and row 4 crossed a bound and stopped; the few games still in play when they stopped
  are included in the figures, which is why the runner printed an LLR a little inside the bound.
- Row 3 also broke a test: with the noisy tables the engine no longer mated with king and rook
  inside the test's move limit. 1.3 million positions from 16,000 games are too few for 800
  numbers.
- Row 5 was run three times at the fast control. The first reached the cap just short of the
  bound and had one loss on time on each side; the 300-game continuation was level; a third run
  had four losses on time and was thrown away. It was then decided at 1 s + 0.02 s, which is
  nearer the conditions of the absolute measurement. The +111 of that run is what an early stop
  looks like, not the size of the gain; +20 to +40 is a fairer reading of all its games.
- Row 8 stopped after 100 games, so its +108 is again an early-stop figure; the new version
  lost one game on time.
- Row 6 passed although the new version lost two games on time (games 0 and 4, at start-up
  under load); they count as losses for it.
- Rows 1, 2 and 7 are standard ideas that usually gain. All three reduced the nodes needed to
  reach a fixed depth (row 1 halved them) and none showed a gain in games. Not investigated
  further; the always-replace table of 16 MB at these speeds is one suspect for row 1.

### Tuning method

`engine/src/bin/datagen.rs` plays the engine against itself at 5,000 nodes a move from eight or
nine random opening moves and writes each position where the side to move is not in check and
the move chosen is quiet, with the search score and the game's result: 16,233 games and
1,369,370 positions in 8 minutes on four threads (about 2,850 positions a second).

`engine/src/bin/tune.rs` is Texel's method with gradient descent in place of the one-step local
search. The evaluation is linear in its weights, and the tuner calls the engine's own `terms`
function to count features, checking for every position that features times weights reproduces
`evaluate` exactly. K was fitted once on the original weights (K = 1.177) and held. Mean squared
error on the held-out tenth: 0.09439 before, 0.09373 after tuning material and terms, 0.09346
with king safety, 0.09291 with the terms of row 8. The weights live in `engine/src/weights.rs`, which the tuner writes.

### The network evaluation (NNUE): built, working, and far too little data

Everything is in place and runs end to end, but the network loses heavily to the tuned
hand-written evaluation (row 9), so no network ships and the engine uses one only when told
to with `setoption name EvalFile value PATH`.

- `engine/src/nnue.rs`: 768 inputs (colour, piece, square, seen from each side), one hidden
  layer of 64 clipped linear units per side, the side to move's half first, one output. 16-bit
  integer weights, first layer scaled by 255 and output by 64 (the scheme of the bullet
  trainer's `simple` example, with a smaller layer and a plain instead of a squared clip).
- `Position` keeps the first-layer sums on a stack and updates them when a piece is put on or
  taken off a square, so a move costs a few column additions; a test checks them against sums
  built from scratch through random games with castling, en passant and promotions.
- `engine/src/bin/train.rs`: Adam on the squared error between the sigmoid of the output and
  half the game result plus half the squashed search score; four threads; then rounding to the
  engine's integers. One pass over the data takes about one second.

The trainer is not the limit, the data is. On 1.37 million positions the held-out error is at
its lowest after four passes (0.0295) and rises after that while the training error keeps
falling: the network memorises. The generator makes about 2,850 positions a second on four
threads. None of the sources read gives a tested figure for how many positions a network of
this shape needs to beat a tuned hand-written evaluation; the bullet example trains on the
order of a hundred million samples per pass, and forum accounts (not read in full) speak of
around a hundred million positions. On that footing: **about 100 million positions, which is
about 10 hours of generation on four threads here**, then minutes of training, with the hidden
layer widened to 128 or 256. A first sign of life (a network within 50 Elo of the hand-written
evaluation) could reasonably be looked for at 20 to 30 million positions, two to three hours.
Positions should then come from deeper searches than 5,000 nodes as well.

### What was read

Pages that were actually fetched and read during this work, with the idea each one informed.
Pages that could not be fetched are listed as such. Buro's ProbCut paper, the web archive and
the forum threads on network sizes were not read.

| Idea (row above)                              | Source                                                                                                                                                                                                                                                                                                                                                                              | What was taken from it                                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPRT                                          | Michel Van den Bergh, "The generalised SPRT approximation": https://cantate.be/Fishtest/GSPRT_approximation.pdf ; Fishtest `LLRcalc.py`: https://raw.githubusercontent.com/official-stockfish/fishtest/master/server/fishtest/stats/LLRcalc.py ; https://www.chessprogramming.org/Sequential_Probability_Ratio_Test                                                                 | LLR ≈ ½ (s1 − s0)(2ŝ − s0 − s1) / (V/N) over game pairs; bounds ±2.94 for 5% errors                                                                                                                     |
| Texel tuning (3, 4, 5, 8, 10)                 | https://www.chessprogramming.org/Texel's_Tuning_Method                                                                                                                                                                                                                                                                                                                              | The loss, K fitted once and held. The page tunes on quiescence scores of all positions and found dropping "noisy" ones worse; here positions were filtered at generation instead, which is a difference |
| Quiescence table probe (1); table replacement | https://www.chessprogramming.org/Transposition_Table ; Stockfish 16 `tt.cpp`, `search.cpp` (https://github.com/official-stockfish/Stockfish, tag `sf_16`)                                                                                                                                                                                                                           | Cut at any stored depth in quiescence; Stockfish replaces by depth and age within three-entry clusters, which this engine does not do                                                                   |
| Histories (2)                                 | https://www.chessprogramming.org/History_Heuristic ; https://www.chessprogramming.org/Countermove_Heuristic ; https://www.chessprogramming.org/Late_Move_Reductions ; Stockfish 16 `movepick.h`; Ethereal `search.c` (https://github.com/AndyGrant/Ethereal)                                                                                                                        | Table shapes ([piece][to][captured], [previous piece][to][piece][to]), the bounded "gravity" update, history steering reductions                                                                        |
| King safety (5)                               | https://www.chessprogramming.org/King_Safety                                                                                                                                                                                                                                                                                                                                        | King zone and attack counting by piece type. The page's table of attack units is not linear; the linear version here is what the tuner can fit                                                          |
| Clock (6, 11)                                 | https://www.chessprogramming.org/Time_Management ; Ethereal `timeman.c`; Stockfish 16 `timeman.cpp`                                                                                                                                                                                                                                                                                 | Ethereal aims at about clock/20 a move, twice what this engine spent; also best-move stability and node-share scaling, not yet tried                                                                    |
| Singular extensions (7)                       | Stockfish 16 `search.cpp`; https://www.chessprogramming.org/Singular_Extensions (no numbers on the page)                                                                                                                                                                                                                                                                            | Conditions, margin proportional to depth, half-depth verification search, multi-cut, negative extension                                                                                                 |
| Network (9)                                   | Yu Nasu, "Efficiently Updatable Neural-Network-based Evaluation Functions for Computer Shogi" (2018), English translation: https://github.com/asdfjkl/nnue/blob/main/nnue_en.pdf ; Stockfish NNUE notes: https://github.com/official-stockfish/nnue-pytorch/blob/master/docs/nnue.md ; bullet trainer `examples/simple.rs` and `docs/1-basics.md`: https://github.com/jw1912/bullet | The accumulator and its incremental update; clipped units and integer scaling (255 and 64); target blended from result and score                                                                        |
| Not tried                                     | https://www.chessprogramming.org/ProbCut ; https://www.chessprogramming.org/Internal_Iterative_Reductions ; https://www.chessprogramming.org/Pawn_Hash_Table ; https://www.chessprogramming.org/Lazy_SMP                                                                                                                                                                            | Read for the list of what is still missing, below                                                                                                                                                       |

### Result: head-to-head and absolute

Same conditions as the first round's absolute measurement: 10 s + 0.1 s, 64 MB hash, one
thread each, four games at a time, the runner's openings and adjudication. The machine was
heavily loaded throughout (load average 20 to 75), unlike in the first round, so the baseline
engine (commit `acb2bbd`) was measured again the same afternoon as a control, on the same
seeds.

| Match                               | Games | Seed | Result      | Score | Elo difference, 95% interval | Implied rating |
| ----------------------------------- | ----: | ---: | ----------- | ----: | ---------------------------- | -------------: |
| New v baseline                      |   100 |    5 | +48 =32 −20 | 64.0% | **+100, +44 to +161**        |                |
| New v Stockfish `UCI_Elo` 2750      |    80 |    3 | +40 =13 −27 | 58.1% | +57, 0 to +117               |           2807 |
| New v Stockfish `UCI_Elo` 2850      |   100 |    2 | +31 =20 −49 | 41.0% | −63, −131 to 0               |           2787 |
| Baseline v Stockfish 2750 (control) |    80 |    3 | +37 =14 −29 | 55.0% | +35, −35 to +107             |           2785 |
| Baseline v Stockfish 2850 (control) |   100 |    2 | +34 =18 −48 | 43.0% | −49, −112 to +11             |           2801 |

One fault in all of these: Stockfish lost one game on time against the new version at 2850,
which is counted as a win for the new version.

**New estimate: about 2800 on Stockfish's `UCI_Elo` scale at 10 s + 0.1 s, 95% interval
roughly 2750 to 2845** (2807 and 2787 from 180 games, bracketed: above half at 2750, below
half at 2850). All the caveats of the first round about what that scale means still apply.

**The gain is +100 Elo in direct play against the baseline, and not visible against
Stockfish.** Measured the same afternoon, the baseline comes out at about 2795 (2785 and 2801) and the new version at about 2797: a difference of a few points with an uncertainty of
about ±65. Against the first round's 2760 for the baseline the new figure is +40, but that
compares a quiet machine with a loaded one. So:

- Head-to-head, the new version is clearly stronger: +44 at the least, at the 95% level.
- Against the strength-limited Stockfish, 180 games a side cannot tell the two apart. A true
  gain of anything from nothing to about +60 on that scale fits the data.
- Both can be true. Self-play is known to exaggerate differences, as the first round already
  said, and a limited Stockfish is an odd opponent: it searches well and then throws in weak
  moves, so the result depends a good deal on things the changes here did not touch. The
  honest claim is "+100 against its former self, +0 to +60 against others".

Compute used in this round, wall time at four threads or fewer: about 60 minutes of SPRT
matches, 8.5 minutes of data generation, about 2 minutes of tuning and training, about
60 minutes for the five matches in the table above; about 2 hours 20 minutes in all.

### What is still missing compared with top engines

- A trained network evaluation. This is by far the largest gap (several hundred Elo), and
  what it needs is written above.
- Search: the three standard ideas that failed here (table use in quiescence, continuation
  and capture histories, singular extensions) work in every strong engine, so the likely
  fault is in how they interact with this search or in testing at very fast controls on a
  loaded machine. Also absent: ProbCut, a table with buckets and ageing, history-based
  pruning, a pawn hash table, node-share and stability-based clock use beyond what is there.
- Several threads (Lazy SMP), an opening book, endgame tables, pondering.
- Testing capacity. Top engines accept changes on tens of thousands of games with bounds like
  [0, 2]; tests here could only see gains of about 20 Elo and more.

### Next three steps

1. Generate about 100 million positions overnight (`datagen`, ten hours on four threads),
   train a 768 → 128×2 → 1 network with `train`, and accept it only by SPRT against the
   hand-written evaluation.
2. Re-test the three failed search ideas one at a time on a quiet machine at 2 s + 0.02 s or
   slower with a cap of 2,000 games, starting with a bucketed, aged transposition table,
   which the quiescence probe probably depends on.
3. Measure against two or three ordinary engines of known rating (not a weakened Stockfish)
   so that the absolute figure and the gains stop depending on one unusual opponent.
