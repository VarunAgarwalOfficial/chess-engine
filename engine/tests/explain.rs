//! What the explanation says about positions with a plain answer.

use chess::explain::{explain, explain_text, Explanation};
use chess::movegen::legal_moves;
use chess::notation::line_to_san;
use chess::position::{Position, START_FEN};
use chess::search::Searcher;
use chess::uci::mate_in;
use chess::wasm::explain_json;

/// White's queen and bishop both aim at f7.
const SCHOLAR: &str = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";

fn explained(fen: &str) -> (Position, Explanation) {
    let mut pos = Position::from_fen(fen).unwrap();
    let explanation = explain(&mut Searcher::new(4), &mut pos, 6);
    (pos, explanation)
}

#[test]
fn every_move_once_best_first() {
    let (pos, explanation) = explained(START_FEN);
    assert_eq!(explanation.choices.len(), legal_moves(&pos).len());
    assert!(explanation.choices.windows(2).all(|w| w[0].score >= w[1].score));
    assert!(explanation.threat.is_none(), "nothing is threatened at the start");
}

#[test]
fn a_mate_in_one_is_found_and_named() {
    let (mut pos, explanation) = explained("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
    let best = &explanation.choices[0];
    assert_eq!(line_to_san(&mut pos, &best.line), ["Qxf7#"]);
    assert_eq!(mate_in(best.score), Some(1));
}

#[test]
fn the_threat_is_the_mate_to_stop() {
    let (mut pos, explanation) = explained(SCHOLAR);
    let threat = explanation.threat.expect("Qxf7 is threatened");
    pos.make_null();
    assert_eq!(line_to_san(&mut pos, &threat.line), ["Qxf7#"]);
    pos.unmake_null();
    assert_eq!(mate_in(threat.score), Some(-1));
    // The best move stops it.
    let best = &explanation.choices[0];
    assert!(mate_in(best.score).is_none());
}

#[test]
fn the_text_and_json_agree() {
    let (mut pos, explanation) = explained(SCHOLAR);
    let text = explain_text(&mut pos, &explanation, 3);
    assert!(text.contains("Threat: if Black could pass, White would play Qxf7# (mate in 1 for White)"), "{text}");
    assert_eq!(text.lines().filter(|l| l.starts_with("  ")).count(), 3);

    let json = explain_json(&mut Searcher::new(4), &mut pos, 6);
    assert!(json.starts_with("{\"depth\":6,\"moves\":[{\"score\":"), "{json}");
    assert!(json.contains("\"threat\":{\"score\":-31998,\"mate\":-1,\"pv\":[\"h5f7\"],\"san\":[\"Qxf7#\"]}"), "{json}");
}

#[test]
fn nothing_to_explain_when_the_game_is_over() {
    let (mut pos, explanation) = explained("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
    assert!(explanation.choices.is_empty() && explanation.threat.is_none());
    assert_eq!(explain_text(&mut pos, &explanation, 3), "No legal move: the game is over.\n");
}
