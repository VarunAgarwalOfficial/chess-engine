//! The interface for the browser board, as a plain C ABI so that no
//! binding generator is needed. Text goes both ways through one shared
//! buffer: the page asks for room with `buffer`, writes its request there,
//! calls `describe`, `go` or `explain`, and reads the JSON reply from the
//! address `reply` returns.
//!
//! A request is a FEN on the first line and the moves played since, in
//! coordinate notation, on the second; `go` reads UCI `go` parameters from
//! a third, and `explain` a depth ("depth 6"). The page keeps no chess rules of its own.

#![allow(unsafe_code)] // only for the `no_mangle` exports; no unsafe blocks

use std::sync::Mutex;

use crate::bitboard::WHITE;
use crate::explain::{self, Choice};
use crate::game::{position_from_moves, status};
use crate::movegen::legal_moves;
use crate::notation::{line_to_san, move_to_san, move_to_uci};
use crate::position::{Move, Position};
use crate::search::{Limits, Searcher};
use crate::uci::{mate_in, parse_go, search_limits};

static BUFFER: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static SEARCHER: Mutex<Option<Searcher>> = Mutex::new(None);

/// Table size for the page, in megabytes.
const HASH: usize = 16;

/// The position asked about, and the request's third line.
fn request() -> Result<(Position, String), String> {
    let buffer = BUFFER.lock().map_err(|_| "buffer lock")?;
    let text = std::str::from_utf8(&buffer).map_err(|_| "request is not text")?;
    let mut lines = text.lines();
    let fen = lines.next().unwrap_or("");
    let moves: Vec<&str> = lines.next().unwrap_or("").split_whitespace().collect();
    let pos = position_from_moves(fen, &moves)?;
    Ok((pos, lines.next().unwrap_or("").to_string()))
}

fn respond(json: Result<String, String>) -> usize {
    let json = json.unwrap_or_else(|message| format!("{{\"error\":{message:?}}}"));
    let mut buffer = BUFFER.lock().expect("buffer lock");
    *buffer = json.into_bytes();
    buffer.len()
}

/// The position after the request's moves: FEN, whose turn, how the game
/// stands, and every legal move with its notation.
pub fn describe_json(pos: &mut Position) -> String {
    let state = status(pos);
    let moves: Vec<String> = legal_moves(pos)
        .as_slice()
        .iter()
        .map(|&m| {
            let (uci, san) = (move_to_uci(m), move_to_san(pos, m));
            format!("{{\"uci\":\"{uci}\",\"san\":\"{san}\",\"capture\":{}}}", m.is_capture())
        })
        .collect();
    let quoted = |text: Option<&str>| text.map_or("null".to_string(), |t| format!("\"{t}\""));
    format!(
        "{{\"fen\":\"{}\",\"turn\":\"{}\",\"over\":{},\"result\":{},\"reason\":{},\"check\":{},\"moves\":[{}]}}",
        pos.fen(),
        if pos.side == WHITE { "white" } else { "black" },
        state.over,
        quoted(state.result),
        quoted(state.reason),
        state.check,
        moves.join(",")
    )
}

/// A search under UCI `go` parameters ("depth 8", "movetime 500", "wtime
/// 60000 btime 60000 winc 1000 binc 1000"). `best` is null when there is
/// no legal move; the score is in centipawns for the side to move, or
/// `mate` in that many moves; `pv` is the expected line in coordinate
/// notation and `san` the same line in algebraic.
pub fn go_json(searcher: &mut Searcher, pos: &mut Position, parameters: &str) -> String {
    let tokens: Vec<&str> = parameters.split_whitespace().collect();
    let limits = search_limits(&parse_go(&tokens), pos.side);
    search_json(searcher, pos, &limits)
}

fn search_json(searcher: &mut Searcher, pos: &mut Position, limits: &Limits) -> String {
    let outcome = searcher.search(pos, limits, &mut |_| {});
    let info = outcome.info;
    let (pv, san) = line_json(pos, &info.pv);
    format!(
        "{{\"best\":{},\"depth\":{},\"score\":{},\"mate\":{},\"nodes\":{},\"time\":{},\"pv\":[{}],\"san\":[{}]}}",
        outcome.best.map_or("null".to_string(), |m| format!("\"{}\"", move_to_uci(m))),
        info.depth,
        info.score,
        mate_in(info.score).map_or("null".to_string(), |n| n.to_string()),
        info.nodes,
        info.time.round(),
        pv,
        san
    )
}

/// A line as two JSON lists, coordinate and algebraic, as far as it is
/// legal.
fn line_json(pos: &mut Position, line: &[Move]) -> (String, String) {
    let san = line_to_san(pos, line);
    let uci: Vec<String> = line[..san.len()].iter().map(|&m| format!("\"{}\"", move_to_uci(m))).collect();
    let san: Vec<String> = san.iter().map(|s| format!("\"{s}\"")).collect();
    (uci.join(","), san.join(","))
}

/// Every legal move searched on its own, best first, each with its score
/// (as in `go`) and expected line; and `threat`, the opponent's line if the
/// side to move could pass, or null when there is no threat worth a pawn.
/// See `explain` for how it is found.
pub fn explain_json(searcher: &mut Searcher, pos: &mut Position, depth: i32) -> String {
    let explanation = explain::explain(searcher, pos, depth);
    let choice_json = |pos: &mut Position, choice: &Choice| {
        let (pv, san) = line_json(pos, &choice.line);
        let mate = mate_in(choice.score).map_or("null".to_string(), |n| n.to_string());
        format!("{{\"score\":{},\"mate\":{mate},\"pv\":[{pv}],\"san\":[{san}]}}", choice.score)
    };
    let moves: Vec<String> = explanation.choices.iter().map(|c| choice_json(pos, c)).collect();
    let threat = explanation.threat.as_ref().map_or("null".to_string(), |threat| {
        pos.make_null();
        let json = choice_json(pos, threat);
        pos.unmake_null();
        json
    });
    format!("{{\"depth\":{depth},\"moves\":[{}],\"threat\":{threat}}}", moves.join(","))
}

/// Makes room for a request of `length` bytes and returns where to write it.
#[no_mangle]
pub extern "C" fn buffer(length: usize) -> *mut u8 {
    let mut buffer = BUFFER.lock().expect("buffer lock");
    buffer.clear();
    buffer.resize(length, 0);
    buffer.as_mut_ptr()
}

/// Where the last reply is; its length was returned by the call.
#[no_mangle]
pub extern "C" fn reply() -> *const u8 {
    BUFFER.lock().expect("buffer lock").as_ptr()
}

#[no_mangle]
pub extern "C" fn describe() -> usize {
    respond(request().map(|(mut pos, _)| describe_json(&mut pos)))
}

#[no_mangle]
pub extern "C" fn go() -> usize {
    respond(request().map(|(mut pos, parameters)| {
        let mut searcher = SEARCHER.lock().expect("searcher lock");
        go_json(searcher.get_or_insert_with(|| Searcher::new(HASH)), &mut pos, &parameters)
    }))
}

#[no_mangle]
pub extern "C" fn explain() -> usize {
    respond(request().map(|(mut pos, parameters)| {
        let tokens: Vec<&str> = parameters.split_whitespace().collect();
        let depth = match tokens.as_slice() {
            ["depth", n] => n.parse().unwrap_or(6),
            _ => 6,
        };
        let mut searcher = SEARCHER.lock().expect("searcher lock");
        explain_json(searcher.get_or_insert_with(|| Searcher::new(HASH)), &mut pos, depth)
    }))
}
