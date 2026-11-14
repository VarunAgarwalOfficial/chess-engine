//! The search: iterative deepening over a principal-variation alpha-beta
//! search with a transposition table and a quiescence search at the leaves.
//! Each pruning and reduction idea here was kept because it won a self-play
//! match against the version without it; STRENGTH.md has the numbers.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::bitboard::*;
use crate::clock::now_ms;
use crate::eval::evaluate;
use crate::movegen::{generate, MoveList};
use crate::position::{Move, Position};
use crate::tt::{Table, EXACT, LOWER, UPPER};

pub const MATE: i32 = 32000;
pub const MAX_PLY: usize = 128;
/// Scores beyond this are "mate in n", not material.
pub const MATE_BOUND: i32 = MATE - 2 * MAX_PLY as i32;

const TT_MOVE_SCORE: i32 = 1 << 30;
const CAPTURE_SCORE: i32 = 1 << 28;
const KILLER_SCORE: i32 = 1 << 26;
const HISTORY_MAX: i32 = 1 << 14;

#[derive(Clone, Debug, Default)]
pub struct Limits {
    /// Stop after this many plies of iterative deepening.
    pub depth: Option<i32>,
    /// Stop after this many nodes.
    pub nodes: Option<u64>,
    /// Hard limit in milliseconds: the search is cut off here.
    pub move_time: Option<f64>,
    /// Soft limit in milliseconds: about how long the move should take.
    pub soft_time: Option<f64>,
}

/// What is known after a finished iteration.
#[derive(Clone, Debug, Default)]
pub struct Info {
    pub depth: i32,
    /// Centipawns for the side to move, or a mate score near `MATE`.
    pub score: i32,
    pub nodes: u64,
    pub time: f64,
    pub pv: Vec<Move>,
}

pub struct Outcome {
    /// `None` only when the side to move has no legal move.
    pub best: Option<Move>,
    pub info: Info,
}

pub struct Searcher {
    /// Set from another thread to end the search early.
    pub stop: Arc<AtomicBool>,
    tt: Table,
    history: Vec<i32>,
    killers: [[Move; 2]; MAX_PLY],
    /// The reply that last refuted each (piece, target square) move.
    counters: [[Move; 64]; 12],
    /// Piece and target of the move played at each ply, for `counters`.
    played: [usize; MAX_PLY],
    evals: [i32; MAX_PLY],
    pv: Vec<[Move; MAX_PLY]>,
    pv_len: [usize; MAX_PLY],
    reductions: Vec<i32>,
    nodes: u64,
    node_limit: u64,
    deadline: f64,
    aborted: bool,
    can_abort: bool,
    root_move: Move,
    root_score: i32,
}

const NO_COUNTER: usize = usize::MAX;

impl Searcher {
    pub fn new(hash_megabytes: usize) -> Searcher {
        let mut reductions = vec![0; 64 * 64];
        for depth in 1..64 {
            for count in 1..64 {
                reductions[depth * 64 + count] = (0.8 + (depth as f64).ln() * (count as f64).ln() / 2.4) as i32;
            }
        }
        Searcher {
            stop: Arc::new(AtomicBool::new(false)),
            tt: Table::new(hash_megabytes),
            history: vec![0; 2 * 64 * 64],
            killers: [[Move::NONE; 2]; MAX_PLY],
            counters: [[Move::NONE; 64]; 12],
            played: [NO_COUNTER; MAX_PLY],
            evals: [0; MAX_PLY],
            pv: vec![[Move::NONE; MAX_PLY]; MAX_PLY],
            pv_len: [0; MAX_PLY],
            reductions,
            nodes: 0,
            node_limit: u64::MAX,
            deadline: f64::INFINITY,
            aborted: false,
            can_abort: false,
            root_move: Move::NONE,
            root_score: 0,
        }
    }

    pub fn resize(&mut self, hash_megabytes: usize) {
        self.tt = Table::new(hash_megabytes);
    }

    /// Forgets everything learned in earlier searches.
    pub fn clear(&mut self) {
        self.tt.clear();
        self.history.fill(0);
        self.counters = [[Move::NONE; 64]; 12];
    }

    /// Finds the best move for the side to move. `on_info` is called after
    /// each finished iteration.
    pub fn search(&mut self, pos: &mut Position, limits: &Limits, on_info: &mut dyn FnMut(&Info)) -> Outcome {
        let start = now_ms();
        self.deadline = limits.move_time.map_or(f64::INFINITY, |t| start + t);
        self.node_limit = limits.nodes.unwrap_or(u64::MAX);
        self.nodes = 0;
        self.aborted = false;
        self.can_abort = false;
        self.killers = [[Move::NONE; 2]; MAX_PLY];
        self.history.iter_mut().for_each(|h| *h /= 2);

        let mut root = MoveList::new();
        generate(pos, &mut root, false);
        let mut info = Info::default();
        let Some(&first) = root.as_slice().first() else {
            info.score = if pos.in_check() { -MATE } else { 0 };
            return Outcome { best: None, info };
        };
        let mut best = first;
        let mut stable = 0;

        let max_depth = limits.depth.unwrap_or(MAX_PLY as i32 - 1).clamp(1, MAX_PLY as i32 - 1);
        for depth in 1..=max_depth {
            let score = self.search_root(pos, depth, info.score);
            // An interrupted iteration still counts if it finished at least
            // one move: the previous best move is searched first, so
            // anything that replaced it was proven better.
            let previous = best;
            if self.root_move != Move::NONE {
                best = self.root_move;
                info.score = if self.aborted { self.root_score } else { score };
            }
            if self.aborted {
                break;
            }
            stable = if best == previous { stable + 1 } else { 0 };
            info.depth = depth;
            info.nodes = self.nodes;
            info.time = now_ms() - start;
            info.pv = self.pv[0][..self.pv_len[0]].to_vec();
            on_info(&info);
            // The first iteration always completes, so there is always a move.
            self.can_abort = true;

            if score.abs() >= MATE_BOUND && depth >= MATE - score.abs() {
                break;
            }
            if let Some(soft) = limits.soft_time {
                // Spend less on a move that has stayed best for several
                // iterations, more on one that has just changed.
                let scale = [1.6, 1.25, 1.0, 0.85, 0.7][stable.min(4)];
                if root.len() == 1 || info.time >= soft * scale {
                    break;
                }
            }
        }
        info.nodes = self.nodes;
        info.time = now_ms() - start;
        Outcome { best: Some(best), info }
    }

    /// One iteration. From depth 5 the window is a narrow band around the
    /// previous score, widened and searched again when the score falls
    /// outside it.
    fn search_root(&mut self, pos: &mut Position, depth: i32, previous: i32) -> i32 {
        self.root_move = Move::NONE;
        if depth < 5 || previous.abs() >= MATE_BOUND {
            return self.negamax(pos, depth, -MATE, MATE, 0, false);
        }
        let mut margin = 25;
        let (mut alpha, mut beta) = (previous - margin, previous + margin);
        loop {
            let score = self.negamax(pos, depth, alpha, beta, 0, false);
            if self.aborted {
                return score;
            }
            margin *= 2;
            if score <= alpha {
                beta = (alpha + beta) / 2;
                alpha = if margin > 800 { -MATE } else { score - margin };
            } else if score >= beta {
                beta = if margin > 800 { MATE } else { score + margin };
            } else {
                return score;
            }
        }
    }

    fn check_limits(&mut self) {
        if self.can_abort
            && (self.nodes >= self.node_limit || self.stop.load(Ordering::Relaxed) || now_ms() >= self.deadline)
        {
            self.aborted = true;
        }
    }

    #[inline]
    fn history_index(side: usize, m: Move) -> usize {
        (side * 64 + m.from()) * 64 + m.to()
    }

    fn negamax(
        &mut self,
        pos: &mut Position,
        mut depth: i32,
        mut alpha: i32,
        mut beta: i32,
        ply: usize,
        allow_null: bool,
    ) -> i32 {
        let root = ply == 0;
        let pv_node = beta - alpha > 1;
        self.pv_len[ply] = 0;

        if !root {
            // A position seen before on this line, or in the game, is scored
            // as a draw at once. Waiting for the third occurrence would only
            // make the search see the same thing later.
            if pos.repetitions() > 0 || pos.insufficient_material() {
                return 0;
            }
            if pos.halfmove >= 100 {
                // Checkmate on the hundredth half-move still wins.
                let mut list = MoveList::new();
                generate(pos, &mut list, false);
                return if pos.in_check() && list.is_empty() { -MATE + ply as i32 } else { 0 };
            }
            if ply >= MAX_PLY - 1 {
                return evaluate(pos);
            }
            // No line from here can beat a mate already found nearer the root.
            alpha = alpha.max(-MATE + ply as i32);
            beta = beta.min(MATE - ply as i32 - 1);
            if alpha >= beta {
                return alpha;
            }
        }

        let in_check = pos.in_check();
        if in_check {
            depth += 1;
        }
        if depth <= 0 {
            return self.quiesce(pos, alpha, beta, ply);
        }

        self.nodes += 1;
        if self.nodes & 1023 == 0 {
            self.check_limits();
        }
        if self.aborted {
            return 0;
        }

        let entry = self.tt.probe(pos.hash);
        let mut tt_move = Move::NONE;
        if let Some(entry) = entry {
            tt_move = entry.best;
            if !pv_node && entry.depth as i32 >= depth {
                // Mate scores are stored relative to the node, not the root.
                let mut score = entry.score as i32;
                if score >= MATE_BOUND {
                    score -= ply as i32;
                } else if score <= -MATE_BOUND {
                    score += ply as i32;
                }
                if entry.bound == EXACT
                    || (entry.bound == LOWER && score >= beta)
                    || (entry.bound == UPPER && score <= alpha)
                {
                    return score;
                }
            }
        }

        let static_eval = match entry {
            _ if in_check => -MATE,
            Some(entry) => entry.eval as i32,
            None => evaluate(pos),
        };
        self.evals[ply] = static_eval;
        // Is the position getting better for the side to move? If not,
        // late moves deserve less attention.
        let improving = !in_check && ply >= 2 && static_eval > self.evals[ply - 2];

        if !pv_node && !in_check {
            // Reverse futility: so far ahead that a shallow search cannot
            // be expected to bring the score back under beta.
            if depth <= 7 && beta.abs() < MATE_BOUND && static_eval - 80 * (depth - improving as i32) >= beta {
                return static_eval;
            }
            // Null move: if passing the turn still leaves us at or above
            // beta, a real move will too. Unsafe in pawn endings (zugzwang).
            if allow_null && depth >= 3 && static_eval >= beta && pos.has_pieces(pos.side) {
                let reduction = 3 + depth / 4 + ((static_eval - beta) / 200).min(3);
                pos.make_null();
                self.played[ply] = NO_COUNTER;
                let score = -self.negamax(pos, depth - 1 - reduction, -beta, -beta + 1, ply + 1, false);
                pos.unmake_null();
                if self.aborted {
                    return 0;
                }
                if score >= beta && score < MATE_BOUND {
                    return score;
                }
            }
        }
        // With no move from the table, ordering is poor and a full-depth
        // search is expensive: look a little less deep.
        if depth >= 4 && tt_move == Move::NONE && !in_check {
            depth -= 1;
        }

        let mut list = MoveList::new();
        generate(pos, &mut list, false);
        if list.is_empty() {
            return if in_check { -MATE + ply as i32 } else { 0 };
        }
        let mut scores = [0i32; 256];
        self.score_moves(pos, &list, &mut scores, tt_move, ply);

        let side = pos.side;
        let original_alpha = alpha;
        let mut best = -MATE;
        let mut best_move = Move::NONE;
        let mut searched = 0;
        let mut skip_quiets = false;
        let mut quiets = [Move::NONE; 64];
        let mut quiet_count = 0;

        for i in 0..list.len() {
            let m = pick_next(list.as_mut_slice(), &mut scores, i);
            let quiet = m.is_quiet();
            if quiet && skip_quiets {
                continue;
            }

            if !root && depth <= 6 && best > -MATE_BOUND {
                if quiet && !in_check {
                    // Late move pruning: after enough quiet moves have
                    // failed at low depth, the rest will too.
                    if searched >= (3 + depth * depth) / (2 - improving as i32) {
                        skip_quiets = true;
                        continue;
                    }
                    // Futility: too far below alpha for a quiet move to help.
                    if static_eval + 120 + 90 * depth <= alpha {
                        skip_quiets = true;
                        continue;
                    }
                }
                // Moves that lose material on the spot.
                let threshold = if quiet { -60 * depth } else { -30 * depth * depth };
                if !pos.see_at_least(m, threshold) {
                    continue;
                }
            }

            let moved = pos.board[m.from()] as usize;
            pos.make(m);
            self.played[ply] = (side * 6 + moved) * 64 + m.to();
            let mut score;
            if searched == 0 {
                score = -self.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
            } else {
                // Later moves are expected to fail low: search them with a
                // zero window, and quiet ones far down the list to a reduced
                // depth. Only a surprise is searched again properly.
                let mut reduction = 0;
                if depth >= 3 && searched >= 2 && quiet && !in_check && !pos.in_check() {
                    // More for late moves at high depth; less in the main
                    // line, for killers, and for moves with a good record.
                    reduction = self.reductions[depth.min(63) as usize * 64 + searched.min(63) as usize];
                    reduction -= pv_node as i32;
                    reduction += !improving as i32;
                    reduction -= self.history[Self::history_index(side, m)] / (HISTORY_MAX / 2);
                    reduction -= (scores[i] >= KILLER_SCORE - 1) as i32;
                    reduction = reduction.clamp(0, depth - 2);
                }
                score = -self.negamax(pos, depth - 1 - reduction, -alpha - 1, -alpha, ply + 1, true);
                if score > alpha && reduction > 0 {
                    score = -self.negamax(pos, depth - 1, -alpha - 1, -alpha, ply + 1, true);
                }
                if score > alpha && score < beta {
                    score = -self.negamax(pos, depth - 1, -beta, -alpha, ply + 1, true);
                }
            }
            pos.unmake(m);
            searched += 1;
            if self.aborted {
                return 0;
            }

            if score > best {
                best = score;
                best_move = m;
                if score > alpha {
                    alpha = score;
                    if root {
                        self.root_move = m;
                        self.root_score = score;
                    }
                    if pv_node {
                        let (head, tail) = self.pv.split_at_mut(ply + 1);
                        let length = self.pv_len[ply + 1].min(MAX_PLY - 1);
                        head[ply][0] = m;
                        head[ply][1..=length].copy_from_slice(&tail[0][..length]);
                        self.pv_len[ply] = length + 1;
                    }
                    if alpha >= beta {
                        if quiet {
                            self.reward_quiet(side, m, depth, ply, &quiets[..quiet_count]);
                        }
                        break;
                    }
                }
            }
            if quiet && quiet_count < quiets.len() {
                quiets[quiet_count] = m;
                quiet_count += 1;
            }
        }

        let mut stored = best;
        if stored >= MATE_BOUND {
            stored += ply as i32;
        } else if stored <= -MATE_BOUND {
            stored -= ply as i32;
        }
        let bound = if best <= original_alpha {
            UPPER
        } else if best >= beta {
            LOWER
        } else {
            EXACT
        };
        // A move that failed low was not shown to be good; do not let it
        // displace a move the table already trusts.
        let table_move = if bound == UPPER { Move::NONE } else { best_move };
        let eval = if in_check { 0 } else { static_eval };
        self.tt.store(pos.hash, table_move, stored, eval, depth, bound);
        best
    }

    /// Plays out captures until the position is quiet, so the evaluation is
    /// never taken in the middle of an exchange.
    fn quiesce(&mut self, pos: &mut Position, mut alpha: i32, beta: i32, ply: usize) -> i32 {
        self.nodes += 1;
        if self.nodes & 1023 == 0 {
            self.check_limits();
        }
        if self.aborted {
            return 0;
        }
        if ply >= MAX_PLY - 1 {
            return evaluate(pos);
        }

        // In check there is no "standing pat": every evasion must be tried.
        let in_check = pos.in_check();
        let mut best = -MATE + ply as i32;
        if !in_check {
            best = evaluate(pos);
            if best >= beta {
                return best;
            }
            alpha = alpha.max(best);
        }

        let mut list = MoveList::new();
        generate(pos, &mut list, !in_check);
        let mut scores = [0i32; 256];
        self.score_moves(pos, &list, &mut scores, Move::NONE, ply);
        for i in 0..list.len() {
            let m = pick_next(list.as_mut_slice(), &mut scores, i);
            // A capture that loses material will not rescue the position.
            if !in_check && !pos.see_at_least(m, 0) {
                continue;
            }
            pos.make(m);
            let score = -self.quiesce(pos, -beta, -alpha, ply + 1);
            pos.unmake(m);
            if self.aborted {
                return 0;
            }
            if score > best {
                best = score;
                if score > alpha {
                    alpha = score;
                    if alpha >= beta {
                        break;
                    }
                }
            }
        }
        best
    }

    /// Ordering: the table move, then captures that do not lose material by
    /// most valuable victim and least valuable attacker, the killer moves of
    /// this ply, the usual reply to the opponent's last move, quiet moves by
    /// how often they have caused cutoffs, and last the losing captures.
    fn score_moves(&self, pos: &Position, list: &MoveList, scores: &mut [i32; 256], tt_move: Move, ply: usize) {
        let killers = self.killers[ply];
        let counter = match ply.checked_sub(1).map(|p| self.played[p]) {
            Some(index) if index != NO_COUNTER => self.counters[index / 64][index % 64],
            _ => Move::NONE,
        };
        for (i, &m) in list.as_slice().iter().enumerate() {
            scores[i] = if m == tt_move {
                TT_MOVE_SCORE
            } else if !m.is_quiet() {
                // An en passant victim is not on the target square.
                let victim = if m.is_capture() { (pos.board[m.to()] as usize % 6) as i32 + 1 } else { 0 };
                let gain = victim * 8 - pos.board[m.from()] as i32 + if m.promotion() == Some(QUEEN) { 64 } else { 0 };
                if !pos.see_at_least(m, 0) {
                    gain - CAPTURE_SCORE
                } else {
                    gain + CAPTURE_SCORE
                }
            } else if m == killers[0] {
                KILLER_SCORE + 1
            } else if m == killers[1] {
                KILLER_SCORE
            } else if m == counter {
                KILLER_SCORE - 1
            } else {
                self.history[Self::history_index(pos.side, m)]
            };
        }
    }

    /// A quiet move caused a cutoff: remember it, and mark down the quiet
    /// moves that were tried before it and did not.
    fn reward_quiet(&mut self, side: usize, m: Move, depth: i32, ply: usize, failed: &[Move]) {
        if self.killers[ply][0] != m {
            self.killers[ply][1] = self.killers[ply][0];
            self.killers[ply][0] = m;
        }
        if let Some(index) = ply.checked_sub(1).map(|p| self.played[p]).filter(|&i| i != NO_COUNTER) {
            self.counters[index / 64][index % 64] = m;
        }
        let bonus = (depth * depth).min(400);
        // The update shrinks as the value nears its limit, so scores stay
        // bounded and recent results count most.
        let mut update = |m: Move, bonus: i32| {
            let h = &mut self.history[Self::history_index(side, m)];
            *h += bonus - *h * bonus.abs() / HISTORY_MAX;
        };
        update(m, bonus);
        for &other in failed {
            update(other, -bonus);
        }
    }
}

/// Selection sort step: bring the best remaining move to position `i`.
#[inline]
fn pick_next(moves: &mut [Move], scores: &mut [i32; 256], i: usize) -> Move {
    let mut best = i;
    for j in i + 1..moves.len() {
        if scores[j] > scores[best] {
            best = j;
        }
    }
    moves.swap(i, best);
    scores.swap(i, best);
    moves[i]
}
