// What a new game can be set to: how the engine plays, and the clocks.

// The weaker levels score every move with a shallow search and choose with
// some noise; the stronger ones search to a fixed depth; the last has only
// the clock. None of them is matched to a rating.
export const LEVELS = [
  {
    name: 'Very easy',
    about: 'Barely looks ahead and often picks a weak move.',
    depth: 1,
    noise: 300,
  },
  {
    name: 'Easy',
    about: 'Barely looks ahead and sometimes picks a weak move.',
    depth: 1,
    noise: 140,
  },
  {
    name: 'Casual',
    about: 'Looks a couple of moves ahead, with occasional slips.',
    depth: 2,
    noise: 70,
  },
  {
    name: 'Moderate',
    about: 'Looks a few moves ahead, with rare slips.',
    depth: 3,
    noise: 30,
  },
  {
    name: 'Steady',
    about: 'Searches 5 half-moves deep and plays the best it finds.',
    go: 'depth 5',
  },
  {
    name: 'Hard',
    about: 'Searches 8 half-moves deep and plays the best it finds.',
    go: 'depth 8',
  },
  {
    name: 'Very hard',
    about: 'Searches 11 half-moves deep and plays the best it finds.',
    go: 'depth 11',
  },
  {
    name: 'Full strength',
    about: 'No depth limit: two seconds a move, or what its clock allows.',
    go: '',
  },
];

// Minutes, and seconds added per move; null is no clock.
export const TIMES = [
  { label: 'No clock', time: null },
  { label: '1 min', time: [1, 0] },
  { label: '3 min', time: [3, 0] },
  { label: '3 + 2', time: [3, 2] },
  { label: '5 min', time: [5, 0] },
  { label: '10 min', time: [10, 0] },
  { label: '15 + 10', time: [15, 10] },
  { label: '30 min', time: [30, 0] },
];

export const timeLabel = (time) =>
  TIMES.find((t) => JSON.stringify(t.time) === JSON.stringify(time))?.label ?? 'No clock';
