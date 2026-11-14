// The six pieces as small SVG drawings on a 45 x 45 grid. Colours come from
// CSS variables set on the wrapper (.piece.white / .piece.black), so one
// drawing serves both sides.

const BODY = 'fill="var(--piece-fill)" stroke="var(--piece-line)"';
const LINE = 'fill="none" stroke="var(--piece-detail)"';

const SHAPES = {
  pawn: `
    <path ${BODY} d="M15 35 C15 28 19.5 25 19.5 20 H25.5 C25.5 25 30 28 30 35 Z"/>
    <circle ${BODY} cx="22.5" cy="14" r="6"/>
    <rect ${BODY} x="11.5" y="35" width="22" height="4.5" rx="1.5"/>`,
  rook: `
    <path ${BODY} d="M12 8 H17 V11.5 H20.5 V8 H24.5 V11.5 H28 V8 H33 V16.5 H12 Z"/>
    <path ${BODY} d="M14.5 16.5 H30.5 L32 33 H13 Z"/>
    <rect ${BODY} x="9.5" y="33" width="26" height="6.5" rx="1.5"/>
    <path ${LINE} d="M15 20.5 H30"/>`,
  knight: `
    <path ${BODY} d="M13.5 35 C13.5 28 21 25.5 19 19.5 L12.5 24 L8 20.5 C8.5 16.5 12 12.5 15 10 L14 4.5 L19.5 8 C29 7.5 35 16 34 35 Z"/>
    <rect ${BODY} x="10.5" y="35" width="26" height="4.5" rx="1.5"/>
    <circle fill="var(--piece-detail)" cx="16.5" cy="14.5" r="1.3"/>
    <path ${LINE} d="M24 10.5 C29 13 30.5 20 30 27"/>`,
  bishop: `
    <path ${BODY} d="M17 33 L19 28 H26 L28 33 Z"/>
    <path ${BODY} d="M22.5 8.5 C17 14 14.5 18.5 14.5 22.5 C14.5 26.5 18 28.5 22.5 28.5 C27 28.5 30.5 26.5 30.5 22.5 C30.5 18.5 28 14 22.5 8.5 Z"/>
    <circle ${BODY} cx="22.5" cy="6.5" r="2.5"/>
    <rect ${BODY} x="10.5" y="33" width="24" height="6.5" rx="1.5"/>
    <path ${LINE} d="M22.5 15.5 V24 M19 19.5 H26"/>`,
  queen: `
    <path ${BODY} d="M7.5 13.5 L12.5 31 H32.5 L37.5 13.5 L30.5 23 L30 10.5 L25.5 22 L22.5 8.5 L19.5 22 L15 10.5 L14.5 23 Z"/>
    <rect ${BODY} x="10.5" y="31" width="24" height="8.5" rx="1.5"/>
    <circle ${BODY} cx="7.5" cy="11.5" r="2.2"/>
    <circle ${BODY} cx="15" cy="8.5" r="2.2"/>
    <circle ${BODY} cx="22.5" cy="6.5" r="2.2"/>
    <circle ${BODY} cx="30" cy="8.5" r="2.2"/>
    <circle ${BODY} cx="37.5" cy="11.5" r="2.2"/>
    <path ${LINE} d="M12 35 H33"/>`,
  king: `
    <path fill="none" stroke="var(--piece-line)" stroke-width="3.6" d="M22.5 3.5 V13 M18.5 7.5 H26.5"/>
    <path fill="none" stroke="var(--piece-fill)" stroke-width="1.4" d="M22.5 4.5 V13 M19.5 7.5 H25.5"/>
    <path ${BODY} d="M22.5 12.5 C19.5 12.5 18 15.5 18.5 18 C13 14.5 6.5 18 8.5 24.5 C9.5 27.5 12.5 29.5 12.5 32 H32.5 C32.5 29.5 35.5 27.5 36.5 24.5 C38.5 18 32 14.5 26.5 18 C27 15.5 25.5 12.5 22.5 12.5 Z"/>
    <rect ${BODY} x="10.5" y="32" width="24" height="7.5" rx="1.5"/>
    <path ${LINE} d="M22.5 18.5 V31 M12 35.5 H33"/>`,
};

export const PIECE_NAMES = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];

// type is 1-6 as in the engine; colour is 'white' or 'black'.
export function pieceSvg(type, colour) {
  return `<svg class="piece ${colour}" viewBox="0 0 45 45" aria-hidden="true" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">${SHAPES[PIECE_NAMES[type]]}</svg>`;
}
