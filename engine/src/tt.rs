//! The transposition table: results of earlier searches, found again by
//! the position's hash. Each slot holds one entry; a new result replaces
//! what is there unless it is a shallower search of the same position.

use crate::position::Move;

pub const EXACT: u8 = 1;
/// The real score is at least the stored one (a beta cutoff).
pub const LOWER: u8 = 2;
/// The real score is at most the stored one (no move raised alpha).
pub const UPPER: u8 = 3;

#[derive(Clone, Copy, Default)]
pub struct Entry {
    key: u32,
    pub best: Move,
    pub score: i16,
    pub eval: i16,
    pub depth: u8,
    /// Zero marks an empty slot.
    pub bound: u8,
}

pub struct Table {
    entries: Vec<Entry>,
}

impl Table {
    pub fn new(megabytes: usize) -> Table {
        let wanted = megabytes.max(1) * 1024 * 1024 / std::mem::size_of::<Entry>();
        // The largest power of two that fits, so a mask picks the slot.
        let slots = 1usize << wanted.ilog2();
        Table { entries: vec![Entry::default(); slots] }
    }

    pub fn clear(&mut self) {
        self.entries.fill(Entry::default());
    }

    #[inline]
    fn slot(&self, hash: u64) -> usize {
        hash as usize & (self.entries.len() - 1)
    }

    #[inline]
    pub fn probe(&self, hash: u64) -> Option<Entry> {
        let entry = self.entries[self.slot(hash)];
        (entry.bound != 0 && entry.key == (hash >> 32) as u32).then_some(entry)
    }

    #[inline]
    pub fn store(&mut self, hash: u64, best: Move, score: i32, eval: i32, depth: i32, bound: u8) {
        let slot = self.slot(hash);
        let key = (hash >> 32) as u32;
        let old = &mut self.entries[slot];
        if old.key == key && old.bound != 0 {
            if bound != EXACT && depth + 3 < old.depth as i32 {
                return;
            }
            // Keep a known best move when the new search found none.
            if best == Move::NONE {
                *old = Entry {
                    best: old.best,
                    ..Entry { key, best, score: score as i16, eval: eval as i16, depth: depth as u8, bound }
                };
                return;
            }
        }
        *old = Entry { key, best, score: score as i16, eval: eval as i16, depth: depth as u8, bound };
    }
}
