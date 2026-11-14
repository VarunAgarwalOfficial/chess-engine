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
