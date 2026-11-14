// A small table of opening names with their ECO codes. Names and codes
// follow the Lichess openings list (lichess-org/chess-openings, CC0), in
// British spelling; where a line is not there under these exact moves, the
// entry for the same position reached another way is used.
// A game is named by the longest line here that its moves begin with.

const TEXT = `
A00|Polish Opening|b4
A00|Grob Opening|g4
A00|Van't Kruijs Opening|e3
A00|Hungarian Opening|g3
A01|Nimzo-Larsen Attack|b3
A02|Bird Opening|f4
A02|Bird Opening, From's Gambit|f4 e5
A03|Bird Opening, Dutch Variation|f4 d5
A04|Zukertort Opening|Nf3
A05|Zukertort Opening|Nf3 Nf6
A06|Zukertort Opening|Nf3 d5
A07|King's Indian Attack|Nf3 d5 g3
A09|Réti Opening|Nf3 d5 c4
A10|English Opening|c4
A13|English Opening, Agincourt Defence|c4 e6
A15|English Opening, Anglo-Indian Defence|c4 Nf6
A20|English Opening, King's English Variation|c4 e5
A22|English Opening, King's English Variation, Two Knights Variation|c4 e5 Nc3 Nf6
A30|English Opening, Symmetrical Variation|c4 c5
A40|Queen's Pawn Game|d4
A40|Englund Gambit|d4 e5
A41|Queen's Pawn Game|d4 d6
A43|Benoni Defence, Old Benoni|d4 c5
A45|Indian Defence|d4 Nf6
A45|Trompowsky Attack|d4 Nf6 Bg5
A46|Indian Defence, Knights Variation|d4 Nf6 Nf3
A48|London System|d4 Nf6 Nf3 g6 Bf4
A50|Indian Defence, Normal Variation|d4 Nf6 c4
A51|Indian Defence, Budapest Gambit|d4 Nf6 c4 e5
A53|Old Indian Defence|d4 Nf6 c4 d6
A56|Benoni Defence|d4 Nf6 c4 c5
A57|Benko Gambit|d4 Nf6 c4 c5 d5 b5
A60|Benoni Defence, Modern Variation|d4 Nf6 c4 c5 d5 e6
A80|Dutch Defence|d4 f5
A82|Dutch Defence, Staunton Gambit|d4 f5 e4
B00|King's Pawn Game|e4
B00|Nimzowitsch Defence|e4 Nc6
B00|Owen Defence|e4 b6
B01|Scandinavian Defence|e4 d5
B01|Scandinavian Defence, Modern Variation|e4 d5 exd5 Nf6
B01|Scandinavian Defence, Main Line|e4 d5 exd5 Qxd5 Nc3 Qa5
B02|Alekhine Defence|e4 Nf6
B06|Modern Defence|e4 g6
B00|Pirc Defence|e4 d6
B07|Pirc Defence|e4 d6 d4 Nf6 Nc3 g6
B09|Pirc Defence, Austrian Attack|e4 d6 d4 Nf6 Nc3 g6 f4
B10|Caro-Kann Defence|e4 c6
B12|Caro-Kann Defence, Advance Variation|e4 c6 d4 d5 e5
B13|Caro-Kann Defence, Exchange Variation|e4 c6 d4 d5 exd5 cxd5
B13|Caro-Kann Defence, Panov Attack|e4 c6 d4 d5 exd5 cxd5 c4
B15|Caro-Kann Defence|e4 c6 d4 d5 Nc3
B17|Caro-Kann Defence, Karpov Variation|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Nd7
B18|Caro-Kann Defence, Classical Variation|e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5
B20|Sicilian Defence|e4 c5
B21|Sicilian Defence, McDonnell Attack|e4 c5 f4
B21|Sicilian Defence, Smith-Morra Gambit|e4 c5 d4 cxd4 c3
B22|Sicilian Defence, Alapin Variation|e4 c5 c3
B23|Sicilian Defence, Closed|e4 c5 Nc3
B27|Sicilian Defence|e4 c5 Nf3
B30|Sicilian Defence, Old Sicilian|e4 c5 Nf3 Nc6
B30|Sicilian Defence, Nyezhmetdinov-Rossolimo Attack|e4 c5 Nf3 Nc6 Bb5
B32|Sicilian Defence, Open|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4
B33|Sicilian Defence, Lasker-Pelikan Variation|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 Nf6 Nc3 e5
B32|Sicilian Defence, Accelerated Dragon|e4 c5 Nf3 Nc6 d4 cxd4 Nxd4 g6
B40|Sicilian Defence, French Variation|e4 c5 Nf3 e6
B41|Sicilian Defence, Kan Variation|e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6
B44|Sicilian Defence, Taimanov Variation|e4 c5 Nf3 e6 d4 cxd4 Nxd4 Nc6
B50|Sicilian Defence, Modern Variations|e4 c5 Nf3 d6
B51|Sicilian Defence, Moscow Variation|e4 c5 Nf3 d6 Bb5
B54|Sicilian Defence, Modern Variations, Main Line|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6
B56|Sicilian Defence, Classical Variation|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6
B60|Sicilian Defence, Richter-Rauzer Variation|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6 Bg5
B70|Sicilian Defence, Dragon Variation|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6
B75|Sicilian Defence, Dragon Variation, Yugoslav Attack, Early Deviations|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6 Be3 Bg7 f3
B80|Sicilian Defence, Scheveningen Variation|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 e6
B90|Sicilian Defence, Najdorf Variation|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6
B90|Sicilian Defence, Najdorf Variation, English Attack|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3
B94|Sicilian Defence, Najdorf Variation|e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5
C00|French Defence|e4 e6
C01|French Defence, Exchange Variation|e4 e6 d4 d5 exd5
C02|French Defence, Advance Variation|e4 e6 d4 d5 e5
C03|French Defence, Tarrasch Variation|e4 e6 d4 d5 Nd2
C10|French Defence, Paulsen Variation|e4 e6 d4 d5 Nc3
C10|French Defence, Rubinstein Variation|e4 e6 d4 d5 Nc3 dxe4
C11|French Defence, Classical Variation|e4 e6 d4 d5 Nc3 Nf6
C15|French Defence, Winawer Variation|e4 e6 d4 d5 Nc3 Bb4
C20|King's Pawn Game|e4 e5
C21|Centre Game Accepted|e4 e5 d4 exd4
C21|Danish Gambit|e4 e5 d4 exd4 c3
C23|Bishop's Opening|e4 e5 Bc4
C25|Vienna Game|e4 e5 Nc3
C29|Vienna Game, Vienna Gambit|e4 e5 Nc3 Nf6 f4
C30|King's Gambit|e4 e5 f4
C30|King's Gambit Declined, Classical Variation|e4 e5 f4 Bc5
C31|King's Gambit Declined, Falkbeer Countergambit|e4 e5 f4 d5
C33|King's Gambit Accepted|e4 e5 f4 exf4
C40|King's Knight Opening|e4 e5 Nf3
C40|Latvian Gambit|e4 e5 Nf3 f5
C40|Elephant Gambit|e4 e5 Nf3 d5
C41|Philidor Defence|e4 e5 Nf3 d6
C42|Petrov's Defence|e4 e5 Nf3 Nf6
C44|King's Knight Opening, Normal Variation|e4 e5 Nf3 Nc6
C44|Ponziani Opening|e4 e5 Nf3 Nc6 c3
C44|Scotch Game|e4 e5 Nf3 Nc6 d4
C44|Scotch Game, Scotch Gambit|e4 e5 Nf3 Nc6 d4 exd4 Bc4
C45|Scotch Game|e4 e5 Nf3 Nc6 d4 exd4 Nxd4
C46|Three Knights Opening|e4 e5 Nf3 Nc6 Nc3
C47|Four Knights Game|e4 e5 Nf3 Nc6 Nc3 Nf6
C48|Four Knights Game, Spanish Variation|e4 e5 Nf3 Nc6 Nc3 Nf6 Bb5
C50|Italian Game|e4 e5 Nf3 Nc6 Bc4
C50|Italian Game, Hungarian Defence|e4 e5 Nf3 Nc6 Bc4 Be7
C50|Italian Game, Giuoco Piano|e4 e5 Nf3 Nc6 Bc4 Bc5
C50|Italian Game, Giuoco Pianissimo|e4 e5 Nf3 Nc6 Bc4 Bc5 d3
C51|Italian Game, Evans Gambit|e4 e5 Nf3 Nc6 Bc4 Bc5 b4
C53|Italian Game, Classical Variation|e4 e5 Nf3 Nc6 Bc4 Bc5 c3
C55|Italian Game, Two Knights Defence|e4 e5 Nf3 Nc6 Bc4 Nf6
C57|Italian Game, Two Knights Defence, Knight Attack|e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5
C60|Ruy Lopez|e4 e5 Nf3 Nc6 Bb5
C61|Ruy Lopez, Bird Variation|e4 e5 Nf3 Nc6 Bb5 Nd4
C62|Ruy Lopez, Steinitz Defence|e4 e5 Nf3 Nc6 Bb5 d6
C63|Ruy Lopez, Schliemann Defence|e4 e5 Nf3 Nc6 Bb5 f5
C64|Ruy Lopez, Classical Variation|e4 e5 Nf3 Nc6 Bb5 Bc5
C65|Ruy Lopez, Berlin Defence|e4 e5 Nf3 Nc6 Bb5 Nf6
C68|Ruy Lopez, Exchange Variation|e4 e5 Nf3 Nc6 Bb5 a6 Bxc6
C70|Ruy Lopez, Morphy Defence|e4 e5 Nf3 Nc6 Bb5 a6
C78|Ruy Lopez, Morphy Defence|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O
C80|Ruy Lopez, Open|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Nxe4
C84|Ruy Lopez, Closed|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7
C88|Ruy Lopez, Closed|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O
C89|Ruy Lopez, Marshall Attack|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5
C92|Ruy Lopez, Closed|e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3
D00|Queen's Pawn Game|d4 d5
D00|Queen's Pawn Game, Accelerated London System|d4 d5 Bf4
D00|Blackmar-Diemer Gambit|d4 d5 e4
D01|Richter-Veresov Attack|d4 d5 Nc3 Nf6 Bg5
D02|Queen's Pawn Game, Zukertort Variation|d4 d5 Nf3
D02|Queen's Pawn Game, London System|d4 d5 Nf3 Nf6 Bf4
D04|Queen's Pawn Game, Colle System|d4 d5 Nf3 Nf6 e3
D06|Queen's Gambit|d4 d5 c4
D07|Queen's Gambit Declined, Chigorin Defence|d4 d5 c4 Nc6
D08|Queen's Gambit Declined, Albin Countergambit|d4 d5 c4 e5
D10|Slav Defence|d4 d5 c4 c6
D11|Slav Defence, Modern Line|d4 d5 c4 c6 Nf3
D15|Slav Defence, Three Knights Variation|d4 d5 c4 c6 Nf3 Nf6 Nc3
D17|Slav Defence, Czech Variation|d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5
D20|Queen's Gambit Accepted|d4 d5 c4 dxc4
D30|Queen's Gambit Declined|d4 d5 c4 e6
D31|Queen's Gambit Declined, Queen's Knight Variation|d4 d5 c4 e6 Nc3
D32|Tarrasch Defence|d4 d5 c4 e6 Nc3 c5
D35|Queen's Gambit Declined, Normal Defence|d4 d5 c4 e6 Nc3 Nf6
D35|Queen's Gambit Declined, Exchange Variation|d4 d5 c4 e6 Nc3 Nf6 cxd5
D37|Queen's Gambit Declined, Three Knights Variation|d4 d5 c4 e6 Nc3 Nf6 Nf3
D43|Semi-Slav Defence|d4 d5 c4 e6 Nc3 Nf6 Nf3 c6
D50|Queen's Gambit Declined, Modern Variation|d4 d5 c4 e6 Nc3 Nf6 Bg5
D53|Queen's Gambit Declined|d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7
D80|Grünfeld Defence|d4 Nf6 c4 g6 Nc3 d5
D85|Grünfeld Defence, Exchange Variation|d4 Nf6 c4 g6 Nc3 d5 cxd5 Nxd5
E00|Indian Defence|d4 Nf6 c4 e6
E00|Catalan Opening|d4 Nf6 c4 e6 g3
E10|Indian Defence, Anti-Nimzo-Indian|d4 Nf6 c4 e6 Nf3
E11|Bogo-Indian Defence|d4 Nf6 c4 e6 Nf3 Bb4
E12|Queen's Indian Defence|d4 Nf6 c4 e6 Nf3 b6
E15|Queen's Indian Defence, Fianchetto Variation|d4 Nf6 c4 e6 Nf3 b6 g3
E20|Nimzo-Indian Defence|d4 Nf6 c4 e6 Nc3 Bb4
E24|Nimzo-Indian Defence, Sämisch Variation|d4 Nf6 c4 e6 Nc3 Bb4 a3
E32|Nimzo-Indian Defence, Classical Variation|d4 Nf6 c4 e6 Nc3 Bb4 Qc2
E40|Nimzo-Indian Defence, Rubinstein System|d4 Nf6 c4 e6 Nc3 Bb4 e3
E60|Indian Defence, West Indian Defence|d4 Nf6 c4 g6
E61|King's Indian Defence|d4 Nf6 c4 g6 Nc3
E70|King's Indian Defence, Normal Variation|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6
E76|King's Indian Defence, Four Pawns Attack|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f4
E80|King's Indian Defence, Sämisch Variation|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 f3
E90|King's Indian Defence, Normal Variation, Rare Defences|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3
E91|King's Indian Defence, Orthodox Variation|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2
E97|King's Indian Defence, Orthodox Variation, Aronin-Taimanov Defence|d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6
`;

// Moves, as one string, to { eco, name }.
export const LINES = new Map(
  TEXT.trim()
    .split('\n')
    .map((line) => line.split('|'))
    .map(([eco, name, moves]) => [moves, { eco, name }]),
);

// The opening a list of moves (in algebraic notation) belongs to:
// { eco, name, length }, or null when no line here matches.
export function findOpening(sans) {
  const plain = sans.slice(0, 20).map((san) => san.replace(/[+#]/g, ''));
  for (let length = plain.length; length > 0; length--) {
    const found = LINES.get(plain.slice(0, length).join(' '));
    if (found) return { ...found, length };
  }
  return null;
}
