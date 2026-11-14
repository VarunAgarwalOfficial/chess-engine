//! The network's sums are updated move by move; they must always equal the
//! sums of the same position set up from scratch.

use chess::movegen::legal_moves;
use chess::nnue::{install, Network, HIDDEN, INPUTS};
use chess::position::Position;

#[test]
fn incremental_accumulator_matches_a_fresh_one() {
    let mut seed = 0x9e37_79b9_7f4a_7c15u64;
    let mut random = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let mut small = |limit: u64| (random() % (2 * limit + 1)) as i16 - limit as i16;
    let network = Network {
        feature_weights: (0..INPUTS * HIDDEN).map(|_| small(60)).collect(),
        feature_bias: std::array::from_fn(|_| small(60)),
        output_weights: std::array::from_fn(|_| small(60)),
        output_bias: 1234,
        scale: 400,
    };
    install(&network.to_bytes()).expect("the network round-trips through its file format");

    // Random games: castling, en passant and promotions all turn up.
    for _ in 0..40 {
        let mut pos = Position::start();
        let mut line = Vec::new();
        for _ in 0..120 {
            let list = legal_moves(&pos);
            if list.is_empty() {
                break;
            }
            let m = list.as_slice()[(random() % list.len() as u64) as usize];
            pos.make(m);
            line.push(m);
            let fresh = Position::from_fen(&pos.fen()).unwrap();
            assert_eq!(pos.network_eval(), fresh.network_eval(), "after {}", pos.fen());
        }
        while let Some(m) = line.pop() {
            pos.unmake(m);
        }
        assert_eq!(pos.network_eval(), Position::start().network_eval());
    }
}
