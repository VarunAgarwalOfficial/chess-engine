//! The UCI program run as a real process.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::time::Instant;

struct Engine {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    lines: Vec<String>,
}

impl Engine {
    fn start() -> Engine {
        let mut child =
            Command::new(env!("CARGO_BIN_EXE_uci")).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let (input, output) = (child.stdin.take().unwrap(), BufReader::new(child.stdout.take().unwrap()));
        Engine { child, input, output, lines: Vec::new() }
    }

    fn send(&mut self, text: &str) {
        writeln!(self.input, "{text}").unwrap();
    }

    /// Reads until a line starting with `prefix`, keeping everything read.
    fn wait_for(&mut self, prefix: &str) -> String {
        loop {
            let mut line = String::new();
            assert!(self.output.read_line(&mut line).unwrap() > 0, "engine exited before \"{prefix}\"");
            self.lines.push(line.trim_end().to_string());
            if line.starts_with(prefix) {
                return line.trim_end().to_string();
            }
        }
    }

    fn end(mut self) {
        drop(self.input);
        assert!(self.child.wait().unwrap().success());
    }
}

#[test]
fn handshake_a_mate_score_and_repetition_history_from_the_move_list() {
    let mut engine = Engine::start();
    engine.send("uci");
    engine.wait_for("uciok");

    engine.send("position fen 6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1");
    engine.send("go depth 4");
    assert_eq!(engine.wait_for("bestmove"), "bestmove a1a8");
    assert!(engine.lines.iter().any(|l| l.contains("score mate 1")));

    // White has a rook against a queen. The moves shuffle there and back,
    // so the position after Ra2 has occurred before; playing it again is a
    // draw the engine can only know about from the move list.
    engine.send("position fen 3q3k/8/8/8/8/8/8/R6K w - - 0 1 moves a1a2 d8d7 a2a1 d7d8");
    engine.send("go depth 4");
    assert_eq!(engine.wait_for("bestmove"), "bestmove a1a2");
    let last_info = &engine.lines[engine.lines.len() - 2];
    assert!(last_info.contains("score cp 0 "), "{last_info}");
    engine.end();
}

#[test]
fn answers_during_a_search_and_stop_ends_it_at_once() {
    let mut engine = Engine::start();
    engine.send("position startpos moves e2e4");
    engine.send("go infinite");
    engine.wait_for("info depth 6");
    engine.send("isready");
    engine.wait_for("readyok");
    assert!(!engine.lines.iter().any(|l| l.starts_with("bestmove")), "still searching");
    let started = Instant::now();
    engine.send("stop");
    let reply = engine.wait_for("bestmove");
    assert!(started.elapsed().as_millis() < 1000);
    assert!(chess::notation::find_move(
        &chess::uci::parse_position(&["startpos", "moves", "e2e4"]).unwrap(),
        reply.trim_start_matches("bestmove ")
    )
    .is_some());
    engine.end();
}
