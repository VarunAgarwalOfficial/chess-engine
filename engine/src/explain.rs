//! Why the engine prefers a move, in a form a learner can follow. Every
//! legal move is searched on its own to the same depth, so the moves can be
//! compared: each comes with the line the engine expects after it, whose
//! second move is the reply that answers it. A search that lets the
//! opponent move twice in a row shows the threat the position holds.
//!
//! Searching the moves one by one is slower than a normal search, and at
//! the same depth it can rank the top moves differently.

use crate::bitboard::WHITE;
use crate::game::status;
use crate::movegen::legal_moves;
use crate::notation::line_to_san;
use crate::position::{Move, Position};
use crate::search::{Limits, Searcher, MATE, MATE_BOUND};
use crate::uci::mate_in;

/// A threat is shown only if ignoring it costs at least this much against
/// the best move, in centipawns.
pub const THREAT_MARGIN: i32 = 100;

pub struct Choice {
    /// Centipawns for the side to move, or a mate score.
    pub score: i32,
    /// The expected line, from the move itself.
    pub line: Vec<Move>,
}

pub struct Explanation {
    /// Every legal move, best first. Empty when the game is over.
    pub choices: Vec<Choice>,
    /// What the opponent would play if the side to move could pass, with
    /// the score after it. Present only when it matters (see
    /// `THREAT_MARGIN`); never when in check, where passing is no move.
    pub threat: Option<Choice>,
}

pub fn explain(searcher: &mut Searcher, pos: &mut Position, depth: i32) -> Explanation {
    let limits = Limits { depth: Some(depth.max(2) - 1), ..Limits::default() };

    let mut choices: Vec<Choice> = legal_moves(pos)
        .as_slice()
        .iter()
        .map(|&m| {
            pos.make(m);
            let mut choice = reply(searcher, pos, &limits);
            pos.unmake(m);
            choice.line.insert(0, m);
            choice
        })
        .collect();
    choices.sort_by_key(|c| -c.score);

    let threat = match choices.first() {
        Some(best) if !pos.in_check() => {
            pos.make_null();
            let threat = reply(searcher, pos, &limits);
            pos.unmake_null();
            (best.score - threat.score >= THREAT_MARGIN).then_some(threat)
        }
        _ => None,
    };
    Explanation { choices, threat }
}

/// The opponent's best play from here, scored for the side that just moved.
fn reply(searcher: &mut Searcher, pos: &mut Position, limits: &Limits) -> Choice {
    let state = status(pos);
    if state.over {
        let score = if state.reason == Some("checkmate") { MATE - 1 } else { 0 };
        return Choice { score, line: Vec::new() };
    }
    let outcome = searcher.search(pos, limits, &mut |_| {});
    // A mate found from here is one move further away from the position
    // before.
    let score = match -outcome.info.score {
        s if s >= MATE_BOUND => s - 1,
        s if s <= -MATE_BOUND => s + 1,
        s => s,
    };
    Choice { score, line: outcome.info.pv }
}

/// "+0.35", "-1.20", "mate in 2" or "mated in 3".
pub fn score_text(score: i32) -> String {
    match mate_in(score) {
        Some(n) if n > 0 => format!("mate in {n}"),
        Some(n) => format!("mated in {}", -n),
        None => format!("{:+.2}", score as f64 / 100.0),
    }
}

/// The explanation as a few lines of text, with up to `others` other moves.
pub fn explain_text(pos: &mut Position, explanation: &Explanation, others: usize) -> String {
    let Some(best) = explanation.choices.first() else {
        return "No legal move: the game is over.\n".into();
    };
    let san = |pos: &mut Position, line: &[Move]| line_to_san(pos, line).join(" ");
    let mut text = format!("Best: {}, {}\n", san(pos, &best.line[..1]), score_text(best.score));
    text += &format!("Expected line: {}\n", san(pos, &best.line));
    if let Some(threat) = &explanation.threat {
        let (us, them) = if pos.side == WHITE { ("White", "Black") } else { ("Black", "White") };
        pos.make_null();
        let line = san(pos, &threat.line);
        pos.unmake_null();
        let score = score_text(-threat.score);
        text += &format!("Threat: if {us} could pass, {them} would play {line} ({score} for {them})\n");
    }
    if explanation.choices.len() > 1 {
        text += "Other moves:\n";
        for choice in explanation.choices.iter().skip(1).take(others) {
            text += &format!("  {:<10} {}\n", score_text(choice.score), san(pos, &choice.line));
        }
    }
    text
}
