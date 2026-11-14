//! The interface for the browser board, as a plain C ABI so that no
//! binding generator is needed. Text goes both ways through one shared
//! buffer: the page asks for room with `buffer`, writes its request there,
//! calls `describe` or `think`, and reads the JSON reply from the address
//! `reply` returns.
//!
//! A request is a FEN on the first line and the moves played since, in
//! coordinate notation, on the second. The page keeps no chess rules of
//! its own.

#![allow(unsafe_code)] // only for the `no_mangle` exports; no unsafe blocks

use std::sync::Mutex;

use crate::bitboard::WHITE;
use crate::game::{position_from_moves, status};
use crate::movegen::legal_moves;
use crate::notation::{move_to_san, move_to_uci};
use crate::position::Position;
use crate::search::{Limits, Searcher};
use crate::uci::mate_in;

static BUFFER: Mutex<Vec<u8>> = Mutex::new(Vec::new());
static SEARCHER: Mutex<Option<Searcher>> = Mutex::new(None);

/// Table size for the page, in megabytes.
const HASH: usize = 16;

fn request() -> Result<Position, String> {
    let buffer = BUFFER.lock().map_err(|_| "buffer lock")?;
    let text = std::str::from_utf8(&buffer).map_err(|_| "request is not text")?;
    let mut lines = text.lines();
    let fen = lines.next().unwrap_or("");
    let moves: Vec<&str> = lines.next().unwrap_or("").split_whitespace().collect();
    position_from_moves(fen, &moves)
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

/// The engine's move: `best` is null when there is none; the score is in
/// centipawns for the side to move, or `mate` in that many moves.
pub fn think_json(searcher: &mut Searcher, pos: &mut Position, milliseconds: f64) -> String {
    let limits = Limits { move_time: Some(milliseconds), ..Limits::default() };
    let outcome = searcher.search(pos, &limits, &mut |_| {});
    let info = outcome.info;
    format!(
        "{{\"best\":{},\"depth\":{},\"score\":{},\"mate\":{},\"nodes\":{},\"time\":{}}}",
        outcome.best.map_or("null".to_string(), |m| format!("\"{}\"", move_to_uci(m))),
        info.depth,
        info.score,
        mate_in(info.score).map_or("null".to_string(), |n| n.to_string()),
        info.nodes,
        info.time.round()
    )
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
    respond(request().map(|mut pos| describe_json(&mut pos)))
}

#[no_mangle]
pub extern "C" fn think(milliseconds: f64) -> usize {
    respond(request().map(|mut pos| {
        let mut searcher = SEARCHER.lock().expect("searcher lock");
        think_json(searcher.get_or_insert_with(|| Searcher::new(HASH)), &mut pos, milliseconds)
    }))
}
