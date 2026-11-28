//! Checks any UCI engine's move generator against the counts in
//! tests/perft.epd. The engine must answer `go perft <depth>` with a last
//! line of `Nodes searched: <n>` (Stockfish and many others) or `nodes <n>`
//! (this engine).
//!
//!   perft ENGINE [--max-nodes 10000000]
//!
//! Each position runs at its deepest depth within the node limit. Any
//! per-move counts the engine prints are shown for a position that fails.
//! Exits with 1 if any count differs.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::time::Instant;

const SUITE: &str = include_str!("../../tests/perft.epd");

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let max_nodes: u64 = match args.iter().position(|a| a == "--max-nodes") {
        Some(at) => args.get(at + 1).and_then(|v| v.parse().ok()).expect("--max-nodes N"),
        None => 10_000_000,
    };
    let command = args.first().filter(|a| !a.starts_with("--")).expect("usage: perft ENGINE [--max-nodes N]");

    let mut child = Command::new(command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap_or_else(|e| panic!("cannot start {command}: {e}"));
    let mut input = child.stdin.take().expect("engine stdin");
    let mut output = BufReader::new(child.stdout.take().expect("engine stdout")).lines().map_while(Result::ok);
    writeln!(input, "uci").expect("engine stdin");
    output.by_ref().find(|line| line == "uciok").expect("no uciok from the engine");

    let (mut run, mut failed) = (0, 0);
    for (number, line) in SUITE.lines().enumerate() {
        let mut fields = line.split(';').map(str::trim);
        let fen = fields.next().expect("a FEN");
        let counts: Vec<u64> =
            fields.map(|f| f.split_once(' ').expect("Dn count").1.parse().expect("a count")).collect();
        let Some(depth) = counts.iter().rposition(|&n| n <= max_nodes) else { continue };
        let expected = counts[depth];

        let started = Instant::now();
        writeln!(input, "position fen {fen}\ngo perft {}", depth + 1).expect("engine stdin");
        let mut divide = Vec::new();
        let got = loop {
            let line = output.next().expect("the engine exited during perft");
            let total = line.strip_prefix("Nodes searched:").or_else(|| line.strip_prefix("nodes "));
            if let Some(total) = total {
                break total.trim().parse::<u64>().expect("a node count");
            }
            if line.split_once(": ").is_some_and(|(mv, n)| mv.len() <= 5 && n.parse::<u64>().is_ok()) {
                divide.push(line);
            }
        };
        let seconds = started.elapsed().as_secs_f64();
        run += 1;
        if got == expected {
            println!("ok    line {:2}  depth {}  {expected:>11}  {seconds:6.2} s  {fen}", number + 1, depth + 1);
        } else {
            failed += 1;
            println!("FAIL  line {:2}  depth {}  expected {expected}, got {got}  {fen}", number + 1, depth + 1);
            for line in divide {
                println!("        {line}");
            }
        }
    }
    let _ = writeln!(input, "quit");
    let _ = child.wait();
    println!("{} of {run} positions match", run - failed);
    std::process::exit(if failed > 0 || run == 0 { 1 } else { 0 });
}
