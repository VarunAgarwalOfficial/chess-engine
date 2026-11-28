"""Counts every line of play from the start position (perft) and checks
the totals against the published ones. Run with: python -m unittest test"""

import unittest

from Game import Board


def perft(board, depth):
    if depth == 0:
        return 1
    total = 0
    for row in range(8):
        for col in range(8):
            for move in board.get_legal_moves((row, col)):
                board.move((row, col), move)
                total += perft(board, depth - 1)
                board.undo()
    return total


class TestMoves(unittest.TestCase):
    def test_perft_from_the_start(self):
        board = Board()
        for depth, expected in [(1, 20), (2, 400), (3, 8902)]:
            self.assertEqual(perft(board, depth), expected)


if __name__ == "__main__":
    unittest.main()
