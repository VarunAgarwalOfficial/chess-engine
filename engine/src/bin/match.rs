//! Plays two UCI engines against each other and reports the Elo difference
//! with error bars.
//!
//!   match --engine1 CMD --engine2 CMD [--options1 "Name=value ..."]
//!         [--options2 "..."] [--games 200] [--tc 1+0.01] [--concurrency 4]
//!         [--seed 1] [--sprt "0 20"]
//!
//! With `--sprt "elo0 elo1"` the match is a sequential probability ratio
//! test of "engine 1 is elo1 stronger" against "it is elo0 stronger", with
//! 5% error rates each way: it stops as soon as the games played decide it,
//! and `--games` is only the cap. The log-likelihood ratio is the normal
//! approximation of the generalised test (Van den Bergh), taken over
//! opening pairs, the unit that varies independently.
//!
//! Each opening is a few random moves from the start position, kept only if
//! a short search calls it roughly level, and is played twice with colours
//! swapped. Games are judged by this crate's rules; a game also ends early
//! when both engines agree for several moves that it is won or dead level.
//! A crash, an illegal move or a lost clock is a loss and is counted as a
//! fault: any fault means the result should not be trusted.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use chess::bitboard::WHITE;
use chess::game::status;
use chess::movegen::legal_moves;
use chess::notation::{find_move, move_to_uci};
use chess::position::Position;
use chess::search::{Limits, Searcher};

const OPENING_PLIES: usize = 8;
const OPENING_BALANCE: i32 = 50;
/// Both engines must see at least this much for a win to be called.
const RESIGN_SCORE: i32 = 700;
const RESIGN_PLIES: usize = 6;
const DRAW_SCORE: i32 = 8;
const DRAW_PLIES: usize = 12;
const DRAW_AFTER_PLY: usize = 80;
const MAX_PLIES: usize = 500;

#[derive(Clone)]
struct Spec {
    command: String,
    options: Vec<(String, String)>,
}

struct Engine {
    child: Child,
    input: ChildStdin,
    lines: Receiver<String>,
}

impl Engine {
    fn start(spec: &Spec) -> Engine {
        let mut parts = spec.command.split_whitespace();
        let mut child = Command::new(parts.next().expect("an engine command"))
            .args(parts)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap_or_else(|e| panic!("cannot start {}: {e}", spec.command));
        let input = child.stdin.take().expect("engine stdin");
        let output = BufReader::new(child.stdout.take().expect("engine stdout"));
        let (sender, lines) = channel();
        thread::spawn(move || {
            for line in output.lines().map_while(Result::ok) {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        let mut engine = Engine { child, input, lines };
        engine.send("uci");
        engine.wait_for("uciok", Duration::from_secs(10));
        for (name, value) in &spec.options {
            engine.send(&format!("setoption name {name} value {value}"));
        }
        engine.send("isready");
        engine.wait_for("readyok", Duration::from_secs(10)).expect("engine did not start");
        engine
    }

    fn send(&mut self, text: &str) {
        let _ = writeln!(self.input, "{text}");
        let _ = self.input.flush();
    }

    /// The first line starting with `prefix`, with the last score reported
    /// before it. `None` if the engine dies or takes longer than `limit`.
    fn wait_for(&mut self, prefix: &str, limit: Duration) -> Option<(String, Option<i32>)> {
        let deadline = Instant::now() + limit;
        let mut score = None;
        loop {
            let line = self.lines.recv_timeout(deadline.saturating_duration_since(Instant::now())).ok()?;
            if line.starts_with(prefix) {
                return Some((line, score));
            }
            let tokens: Vec<&str> = line.split_whitespace().collect();
            if let Some(at) = tokens.iter().position(|&t| t == "score") {
                let value = tokens.get(at + 2).and_then(|v| v.parse::<i32>().ok());
                score = match (tokens.get(at + 1), value) {
                    (Some(&"cp"), Some(v)) => Some(v),
                    (Some(&"mate"), Some(v)) => Some(if v > 0 { 30000 } else { -30000 }),
                    _ => score,
                };
            }
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.send("quit");
        thread::sleep(Duration::from_millis(20));
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Played {
    /// 1, 0.5 or 0 for White.
    white_score: f64,
    fault: Option<String>,
    seconds: f64,
}

/// One game. `engines[0]` plays White.
fn play(engines: [&mut Engine; 2], opening: &[String], base: f64, increment: f64) -> Played {
    let started = Instant::now();
    let done = |white_score, fault| Played { white_score, fault, seconds: started.elapsed().as_secs_f64() };
    let [white, black] = engines;
    for engine in [&mut *white, &mut *black] {
        engine.send("ucinewgame");
        engine.send("isready");
        if engine.wait_for("readyok", Duration::from_secs(10)).is_none() {
            return done(0.5, Some("engine not ready".into()));
        }
    }

    let mut pos = Position::start();
    let mut moves: Vec<String> = opening.to_vec();
    for text in opening {
        pos.make(find_move(&pos, text).expect("openings are legal"));
    }
    let mut clocks = [base, base];
    // Scores from White's point of view, one per ply.
    let mut scores: Vec<i32> = Vec::new();

    loop {
        let state = status(&pos);
        if state.over {
            return done(
                match state.result {
                    Some("white") => 1.0,
                    Some("black") => 0.0,
                    _ => 0.5,
                },
                None,
            );
        }
        if scores.len() >= MAX_PLIES {
            return done(0.5, None);
        }
        let recent = |n: usize| &scores[scores.len().saturating_sub(n)..];
        if scores.len() >= RESIGN_PLIES && recent(RESIGN_PLIES).iter().all(|&s| s >= RESIGN_SCORE) {
            return done(1.0, None);
        }
        if scores.len() >= RESIGN_PLIES && recent(RESIGN_PLIES).iter().all(|&s| s <= -RESIGN_SCORE) {
            return done(0.0, None);
        }
        if moves.len() >= DRAW_AFTER_PLY
            && scores.len() >= DRAW_PLIES
            && recent(DRAW_PLIES).iter().all(|&s| s.abs() <= DRAW_SCORE)
        {
            return done(0.5, None);
        }

        let side = pos.side;
        let lost = if side == WHITE { 0.0 } else { 1.0 };
        let engine = if side == WHITE { &mut *white } else { &mut *black };
        engine.send(&format!("position startpos moves {}", moves.join(" ")));
        let ms = |seconds: f64| (seconds * 1000.0) as u64;
        engine.send(&format!(
            "go wtime {} btime {} winc {} binc {}",
            ms(clocks[0]),
            ms(clocks[1]),
            ms(increment),
            ms(increment)
        ));
        let asked = Instant::now();
        let reply = engine.wait_for("bestmove", Duration::from_secs_f64(clocks[side] + 2.0));
        clocks[side] -= asked.elapsed().as_secs_f64();
        let Some((line, score)) = reply else {
            return done(lost, Some("no reply (crash or hang)".into()));
        };
        if clocks[side] < 0.0 {
            return done(lost, Some("lost on time".into()));
        }
        clocks[side] += increment;
        let text = line.split_whitespace().nth(1).unwrap_or("");
        let Some(m) = find_move(&pos, text) else {
            return done(lost, Some(format!("illegal move {text} in {}", pos.fen())));
        };
        pos.make(m);
        moves.push(move_to_uci(m));
        let score = score.unwrap_or(0);
        scores.push(if side == WHITE { score } else { -score });
    }
}

/// Random openings that a short search calls level. The same seed gives
/// the same openings, so different matches are played on the same ground.
fn openings(count: usize, mut seed: u64) -> Vec<Vec<String>> {
    let mut random = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let mut searcher = Searcher::new(8);
    let mut found: Vec<Vec<String>> = Vec::new();
    while found.len() < count {
        let mut pos = Position::start();
        let mut line = Vec::new();
        for _ in 0..OPENING_PLIES {
            let list = legal_moves(&pos);
            if list.is_empty() {
                break;
            }
            let m = list.as_slice()[(random() % list.len() as u64) as usize];
            line.push(move_to_uci(m));
            pos.make(m);
        }
        if line.len() < OPENING_PLIES || status(&pos).over || found.contains(&line) {
            continue;
        }
        let limits = Limits { depth: Some(8), ..Limits::default() };
        if searcher.search(&mut pos, &limits, &mut |_| {}).info.score.abs() <= OPENING_BALANCE {
            found.push(line);
        }
    }
    found
}

fn elo(score: f64) -> f64 {
    let p = score.clamp(0.001, 0.999);
    -400.0 * (1.0 / p - 1.0).log10()
}

/// Expected score for an Elo advantage.
fn expected(elo: f64) -> f64 {
    1.0 / (1.0 + 10f64.powf(-elo / 400.0))
}

/// Log-likelihood ratio of H1 (elo1) against H0 (elo0) given the scores of
/// the finished opening pairs: (s1 - s0)(2 mean - s0 - s1) / (2 var / n).
fn llr(pair_scores: &[f64], elo0: f64, elo1: f64) -> f64 {
    let n = pair_scores.len() as f64;
    if n < 2.0 {
        return 0.0;
    }
    let mean = pair_scores.iter().sum::<f64>() / n;
    let variance = pair_scores.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
    if variance <= 0.0 {
        return 0.0;
    }
    let (s0, s1) = (expected(elo0), expected(elo1));
    (s1 - s0) * (2.0 * mean - s0 - s1) / (2.0 * variance / n)
}

/// ln((1 - beta) / alpha) with alpha = beta = 0.05; the lower bound is its negative.
const SPRT_BOUND: f64 = 2.944;

fn finished_pairs(results: &[[Option<f64>; 2]]) -> Vec<f64> {
    results.iter().filter_map(|p| Some((p[0]? + p[1]?) / 2.0)).collect()
}

fn parse_options(text: &str) -> Vec<(String, String)> {
    text.split_whitespace()
        .filter_map(|pair| pair.split_once('='))
        .map(|(n, v)| (n.to_string(), v.to_string()))
        .collect()
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let (Some(command1), Some(command2)) = (value("--engine1"), value("--engine2")) else {
        eprintln!("usage: match --engine1 CMD --engine2 CMD [--options1 \"Name=value ...\"] [--options2 \"...\"]");
        eprintln!("             [--games 200] [--tc 1+0.01] [--concurrency 4] [--seed 1]");
        std::process::exit(2);
    };
    let specs = [
        Spec { command: command1, options: parse_options(&value("--options1").unwrap_or_default()) },
        Spec { command: command2, options: parse_options(&value("--options2").unwrap_or_default()) },
    ];
    let games: usize = value("--games").and_then(|v| v.parse().ok()).unwrap_or(200);
    let concurrency: usize = value("--concurrency").and_then(|v| v.parse().ok()).unwrap_or(4).clamp(1, 4);
    let seed: u64 = value("--seed").and_then(|v| v.parse().ok()).unwrap_or(1).max(1);
    let tc = value("--tc").unwrap_or("1+0.01".into());
    let sprt: Option<(f64, f64)> = value("--sprt").map(|v| {
        let mut parts = v.split_whitespace().map(|x| x.parse::<f64>().expect("--sprt \"elo0 elo1\""));
        (parts.next().expect("--sprt elo0"), parts.next().expect("--sprt elo1"))
    });
    let (base, increment) = tc.split_once('+').unwrap_or((&tc, "0"));
    let (base, increment): (f64, f64) = (base.parse().expect("--tc base"), increment.parse().expect("--tc increment"));

    let pairs = games.div_ceil(2);
    let lines = Arc::new(openings(pairs, seed.wrapping_mul(0x9e37_79b9_7f4a_7c15)));
    // Per pair: engine 1's score in the game it has White, then Black.
    let results = Arc::new(Mutex::new(vec![[None::<f64>; 2]; pairs]));
    let next = Arc::new(Mutex::new(0usize));
    let faults = Arc::new(Mutex::new(Vec::<String>::new()));
    let game_seconds = Arc::new(Mutex::new(0.0f64));
    let started = Instant::now();

    let workers: Vec<_> = (0..concurrency)
        .map(|_| {
            let (specs, lines, results, next, faults, game_seconds) =
                (specs.clone(), lines.clone(), results.clone(), next.clone(), faults.clone(), game_seconds.clone());
            thread::spawn(move || {
                let mut engines = [Engine::start(&specs[0]), Engine::start(&specs[1])];
                loop {
                    let game = {
                        let mut next = next.lock().unwrap();
                        *next += 1;
                        *next - 1
                    };
                    if game >= pairs * 2 {
                        break;
                    }
                    let (pair, first_is_white) = (game / 2, game % 2 == 0);
                    let [first, second] = &mut engines;
                    let order = if first_is_white { [first, second] } else { [second, first] };
                    let played = play(order, &lines[pair], base, increment);
                    let score = if first_is_white { played.white_score } else { 1.0 - played.white_score };
                    {
                        let mut results = results.lock().unwrap();
                        results[pair][game % 2] = Some(score);
                        if let Some((elo0, elo1)) = sprt {
                            let done = finished_pairs(&results);
                            if llr(&done, elo0, elo1).abs() >= SPRT_BOUND && done.len() >= 16 {
                                // Decided: hand out no more games.
                                *next.lock().unwrap() = usize::MAX / 2;
                            }
                        }
                    }
                    *game_seconds.lock().unwrap() += played.seconds;
                    if let Some(fault) = played.fault {
                        let culprit = if (played.white_score == 0.0) == first_is_white { 1 } else { 2 };
                        faults.lock().unwrap().push(format!("game {game}, engine {culprit}: {fault}"));
                        // Start afresh after a fault rather than trust the processes.
                        engines = [Engine::start(&specs[0]), Engine::start(&specs[1])];
                    }
                }
            })
        })
        .collect();
    for worker in workers {
        worker.join().expect("match worker");
    }

    let results = results.lock().unwrap();
    // Only whole pairs count: a test that stops early leaves some half played.
    let all: Vec<f64> =
        results.iter().filter(|p| p[0].is_some() && p[1].is_some()).flatten().flatten().copied().collect();
    let count = |s: f64| all.iter().filter(|&&x| x == s).count();
    let mean = all.iter().sum::<f64>() / all.len() as f64;
    // The two games of a pair share an opening, so the pair is the unit
    // that varies independently; error bars come from pair scores.
    let pair_means = finished_pairs(&results);
    let variance =
        pair_means.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (pair_means.len() as f64 - 1.0).max(1.0);
    let error = 1.96 * (variance / pair_means.len() as f64).sqrt();
    let (low, high) = (elo(mean - error), elo(mean + error));

    println!("engine 1: {} {:?}", specs[0].command, specs[0].options);
    println!("engine 2: {} {:?}", specs[1].command, specs[1].options);
    println!("{} games at {tc}, {concurrency} at a time, seed {seed}", all.len());
    println!("engine 1: +{} ={} -{}  score {:.1}%", count(1.0), count(0.5), count(0.0), mean * 100.0);
    if count(1.0) == all.len() || count(0.0) == all.len() {
        // A clean sweep has no spread to estimate from. All that can be said
        // is how strong the winner must be for it to happen 1 time in 20.
        let bound = elo(0.05f64.powf(1.0 / all.len() as f64));
        println!("Elo difference: one side won every game; at least {bound:.0} at 95% confidence, no upper bound");
    } else {
        println!("Elo difference {:+.0}, 95% interval {:+.0} to {:+.0}", elo(mean), low, high);
    }
    if let Some((elo0, elo1)) = sprt {
        let value = llr(&pair_means, elo0, elo1);
        let verdict = if value >= SPRT_BOUND {
            "H1 accepted (passes)"
        } else if value <= -SPRT_BOUND {
            "H0 accepted (fails)"
        } else {
            "undecided at the cap"
        };
        println!(
            "SPRT [{elo0}, {elo1}]: LLR {value:+.2} (bounds +-{SPRT_BOUND}) over {} pairs: {verdict}",
            pair_means.len()
        );
    }
    println!(
        "game time {:.0} s in total, {:.0} s on the wall",
        game_seconds.lock().unwrap(),
        started.elapsed().as_secs_f64()
    );
    let faults = faults.lock().unwrap();
    println!("faults: {}", faults.len());
    for fault in faults.iter() {
        println!("  {fault}");
    }
}
