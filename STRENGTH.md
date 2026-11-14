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

The whole budget was about 30 minutes of game time (1,695 seconds summed over all games), so
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

Speed, same eight positions, counting every node of the main and quiescence search:

| Engine                                        | Nodes per second |
| --------------------------------------------- | ---------------: |
| JavaScript, depth 9                           |        1,450,000 |
| Rust with the JavaScript engine's search      |       14,000,000 |
| Rust as shipped (fuller evaluation), depth 16 |        4,400,000 |
| Rust as shipped, in WebAssembly under Node    |  about 3,000,000 |

Move generation alone (perft 5 from the start position): 69 million positions a second in
JavaScript, 405 million in Rust.

The shipped engine is slower per node than the plain port because its evaluation does more and
because pruning removes the cheapest nodes. It reaches depth 14 in the position where the plain
port reaches depth 11 in more time.

## Each idea against the version before it

The first Rust version had exactly the JavaScript engine's search (principal variation search,
transposition table, null move, a fixed one- or two-ply late move reduction, killers, history,
check extension, quiescence) and a material and piece-square evaluation. Ideas were then added
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

The last row is worth reading. Pruning late moves depends on the moves being well ordered: on
the plain port it gained nothing measurable, and on top of the ordering group it was the largest
single gain. Adding the three kept steps gives roughly +300 Elo over the plain port in fast
self-play; self-play tends to exaggerate differences, so treat that as an upper estimate.

The ideas were tested in groups, not one by one, because the budget allows about five matches.
Inside a kept group an individual idea may be neutral or harmful; that has not been measured.
The numbers inside each idea (margins, reduction formula, evaluation weights) are sensible
starting values and have not been tuned.

## Absolute strength

Not measured. Stockfish is not installed on this machine, and no other rated engine was
available, so there is no anchor to an Elo scale.
