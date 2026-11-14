//! The Universal Chess Interface: parsing and formatting as pure functions,
//! and the program loop that reads standard input while a search runs on
//! its own thread, so that `stop` and `isready` are answered at once.

use crate::bitboard::WHITE;
use crate::game::position_from_moves;
use crate::notation::move_to_uci;
use crate::position::{Position, START_FEN};
use crate::search::{Info, Limits, MATE, MATE_BOUND};

pub const ENGINE_NAME: &str = "Chess 2.0";
pub const ENGINE_AUTHOR: &str = "Varun Agarwal";

/// The numbers given to `go`.
#[derive(Debug, Default, PartialEq)]
pub struct Go {
    pub depth: Option<u64>,
    pub nodes: Option<u64>,
    pub movetime: Option<u64>,
    pub wtime: Option<u64>,
    pub btime: Option<u64>,
    pub winc: Option<u64>,
    pub binc: Option<u64>,
    pub movestogo: Option<u64>,
    pub infinite: bool,
}

pub fn parse_go(tokens: &[&str]) -> Go {
    let mut go = Go { infinite: tokens.contains(&"infinite"), ..Go::default() };
    for pair in tokens.windows(2) {
        // Clocks can be reported negative; treat that as nothing left.
        let Ok(value) = pair[1].parse::<i64>() else { continue };
        let value = Some(value.max(0) as u64);
        match pair[0] {
            "depth" => go.depth = value,
            "nodes" => go.nodes = value,
            "movetime" => go.movetime = value,
            "wtime" => go.wtime = value,
            "btime" => go.btime = value,
            "winc" => go.winc = value,
            "binc" => go.binc = value,
            "movestogo" => go.movestogo = value,
            _ => {}
        }
    }
    go
}

/// Turns `go` parameters into limits for the search. With a clock, plan to
/// spend an even share of the remaining time plus most of the increment.
/// The soft limit is where the search stops deepening; the hard limit only
/// catches an iteration that runs long, and never risks the flag.
pub fn search_limits(go: &Go, side: usize) -> Limits {
    let mut limits = Limits {
        depth: go.depth.filter(|&d| d > 0).map(|d| d as i32),
        nodes: go.nodes.filter(|&n| n > 0),
        move_time: go.movetime.map(|t| t as f64),
        soft_time: None,
    };
    let (clock, increment) = if side == WHITE { (go.wtime, go.winc) } else { (go.btime, go.binc) };
    if let (Some(clock), false, None) = (clock, go.infinite, go.movetime) {
        let clock = clock as f64;
        let moves_left = go.movestogo.filter(|&m| m > 0).map_or(25.0, |m| m as f64 + 1.0);
        let share = clock / moves_left + increment.unwrap_or(0) as f64 * 0.75;
        let available = (clock - 10.0).max(1.0);
        limits.soft_time = Some((share * 0.6).min(available));
        limits.move_time = Some((share * 3.0).min(available * 0.5).max(1.0));
    }
    limits
}

/// "position startpos moves e2e4" or "position fen <six fields> moves ...".
pub fn parse_position(tokens: &[&str]) -> Result<Position, String> {
    let split = tokens.iter().position(|&t| t == "moves").unwrap_or(tokens.len());
    let (head, moves) = (&tokens[..split], tokens.get(split + 1..).unwrap_or(&[]));
    match head.first() {
        Some(&"startpos") => position_from_moves(START_FEN, moves),
        Some(&"fen") if head.len() > 1 => position_from_moves(&head[1..].join(" "), moves),
        _ => Err("expected \"startpos\" or \"fen\"".into()),
    }
}

/// Moves to mate, positive when the side to move is mating; `None` for an
/// ordinary score.
pub fn mate_in(score: i32) -> Option<i32> {
    if score >= MATE_BOUND {
        Some((MATE - score + 1) / 2)
    } else if score <= -MATE_BOUND {
        Some(-(MATE + score + 1) / 2)
    } else {
        None
    }
}

pub fn format_score(score: i32) -> String {
    match mate_in(score) {
        Some(moves) => format!("mate {moves}"),
        None => format!("cp {score}"),
    }
}

pub fn format_info(info: &Info) -> String {
    let nps = (info.nodes as f64 * 1000.0 / info.time.max(1.0)) as u64;
    let mut line = format!(
        "info depth {} score {} nodes {} nps {} time {}",
        info.depth,
        format_score(info.score),
        info.nodes,
        nps,
        info.time as u64
    );
    if !info.pv.is_empty() {
        line.push_str(" pv");
        for &m in &info.pv {
            line.push(' ');
            line.push_str(&move_to_uci(m));
        }
    }
    line
}

#[cfg(not(target_arch = "wasm32"))]
pub use program::{bench, run};

#[cfg(not(target_arch = "wasm32"))]
mod program {
    use super::*;
    use crate::clock::now_ms;
    use crate::movegen::perft;
    use crate::search::Searcher;
    use std::io::BufRead;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;

    const DEFAULT_HASH: usize = 64;

    const BENCH_POSITIONS: [&str; 8] = [
        START_FEN,
        "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
        "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
        "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
        "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
        "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
        "r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R w KQ - 3 9",
        "8/5pk1/6p1/1p2P2p/1P3P1P/4K1P1/8/8 w - - 0 40",
    ];

    /// Searches a fixed set of positions to a fixed depth. Returns nodes and
    /// milliseconds. A speed and regression check, not a measure of strength.
    pub fn bench(searcher: &mut Searcher, depth: i32) -> (u64, f64) {
        let (mut nodes, mut time) = (0, 0.0);
        for fen in BENCH_POSITIONS {
            searcher.clear();
            let mut pos = Position::from_fen(fen).expect("bench positions are valid");
            let limits = Limits { depth: Some(depth), ..Limits::default() };
            let outcome = searcher.search(&mut pos, &limits, &mut |_| {});
            nodes += outcome.info.nodes;
            time += outcome.info.time;
        }
        (nodes, time)
    }

    fn set_option(searcher: &mut Searcher, name: &str, value: &str) {
        if name.eq_ignore_ascii_case("hash") {
            searcher.resize(value.parse().unwrap_or(DEFAULT_HASH).clamp(1, 4096));
        }
    }

    /// Runs the engine on standard input and output until `quit` or the
    /// end of input.
    pub fn run() {
        let searcher = Arc::new(Mutex::new(Searcher::new(DEFAULT_HASH)));
        let stop = searcher.lock().expect("searcher lock").stop.clone();
        let mut pos = Position::start();
        let mut worker: Option<JoinHandle<()>> = None;
        let mut infinite = false;
        let searching = Arc::new(AtomicBool::new(false));

        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            let tokens: Vec<&str> = line.split_whitespace().collect();
            let Some(&command) = tokens.first() else { continue };
            // The worker clears `searching` just before it prints its move, so
            // a command sent in reply to "bestmove" never finds it busy; all
            // that is left of the thread by then is to end, which is awaited.
            let busy = searching.load(Ordering::Acquire);
            if !busy {
                if let Some(worker) = worker.take() {
                    let _ = worker.join();
                }
            }
            match command {
                "uci" => {
                    println!("id name {ENGINE_NAME}");
                    println!("id author {ENGINE_AUTHOR}");
                    println!("option name Hash type spin default {DEFAULT_HASH} min 1 max 4096");
                    println!("uciok");
                }
                "isready" => println!("readyok"),
                "ucinewgame" => {
                    if !busy {
                        searcher.lock().expect("searcher lock").clear();
                    }
                    pos = Position::start();
                }
                "position" => match parse_position(&tokens[1..]) {
                    Ok(parsed) => pos = parsed,
                    Err(message) => println!("info string {message}"),
                },
                "setoption" if !busy => {
                    let value_at = tokens.iter().position(|&t| t == "value").unwrap_or(tokens.len());
                    let name = tokens.get(2..value_at).unwrap_or(&[]).join(" ");
                    let value = tokens.get(value_at + 1..).unwrap_or(&[]).join(" ");
                    set_option(&mut searcher.lock().expect("searcher lock"), &name, &value);
                }
                "go" if busy => println!("info string search already running"),
                "go" if tokens.get(1) == Some(&"perft") => {
                    let depth = tokens.get(2).and_then(|t| t.parse().ok()).unwrap_or(1);
                    println!("nodes {}", perft(&mut pos.clone(), depth));
                }
                "go" => {
                    let go = parse_go(&tokens[1..]);
                    let limits = search_limits(&go, pos.side);
                    infinite = go.infinite;
                    stop.store(false, Ordering::Relaxed);
                    searching.store(true, Ordering::Release);
                    let (searcher, stop, searching, mut pos) =
                        (searcher.clone(), stop.clone(), searching.clone(), pos.clone());
                    worker = Some(thread::spawn(move || {
                        let mut searcher = searcher.lock().expect("searcher lock");
                        let outcome = searcher.search(&mut pos, &limits, &mut |info| println!("{}", format_info(info)));
                        // "go infinite" may not answer until told to stop,
                        // even if the search has nothing left to do.
                        while go.infinite && !stop.load(Ordering::Relaxed) {
                            thread::sleep(Duration::from_millis(1));
                        }
                        drop(searcher);
                        searching.store(false, Ordering::Release);
                        println!("bestmove {}", outcome.best.map_or("0000".into(), move_to_uci));
                    }));
                }
                "stop" => stop.store(true, Ordering::Relaxed),
                "quit" => {
                    stop.store(true, Ordering::Relaxed);
                    break;
                }
                // The protocol says to ignore anything unknown.
                _ => {}
            }
        }
        // At the end of input, let a running search report its move before
        // leaving. An infinite one would never end, so it is stopped.
        if let Some(worker) = worker {
            if infinite {
                stop.store(true, Ordering::Relaxed);
            }
            let _ = worker.join();
        }
    }

    /// `uci bench [depth]` and `uci perft <depth> [fen]` from the command line.
    pub fn command_line(args: &[String]) -> bool {
        match args.first().map(String::as_str) {
            Some("bench") => {
                let depth = args.get(1).and_then(|d| d.parse().ok()).unwrap_or(10);
                let (nodes, time) = bench(&mut Searcher::new(DEFAULT_HASH), depth);
                println!(
                    "{nodes} nodes, {:.0} ms, {:.0} nodes per second",
                    time,
                    nodes as f64 * 1000.0 / time.max(1.0)
                );
            }
            Some("perft") => {
                let depth = args.get(1).and_then(|d| d.parse().ok()).unwrap_or(5);
                let fen = if args.len() > 2 { args[2..].join(" ") } else { START_FEN.to_string() };
                match Position::from_fen(&fen) {
                    Ok(mut pos) => {
                        let start = now_ms();
                        let nodes = perft(&mut pos, depth);
                        let time = now_ms() - start;
                        println!(
                            "perft {depth}: {nodes} positions, {time:.0} ms, {:.0} per second",
                            nodes as f64 * 1000.0 / time.max(1.0)
                        );
                    }
                    Err(message) => eprintln!("{message}"),
                }
            }
            _ => return false,
        }
        true
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub use program::command_line;
