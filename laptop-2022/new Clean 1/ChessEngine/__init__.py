from ChessEngine.Piece import Piece

class Board:
    
    def __init__(self , state = None):
        if state:
            self.state = state
        else:
            self.state = [
                [Piece("black", "rook"), Piece("black", "knight"), Piece("black", "bishop"), Piece("black", "queen"), Piece("black", "king"), Piece("black", "bishop"), Piece("black", "knight"), Piece("black", "rook")],
                [Piece("black", "pawn"), Piece("black", "pawn"), Piece("black", "pawn"), Piece("black", "pawn"), Piece("black", "pawn"), Piece("black", "pawn"), Piece("black", "pawn"), Piece("black", "pawn")],
                [None, None, None, None, None, None, None, None],
                [None, None, None, None, None, None, None, None],
                [None, None, None, None, None, None, None, None],
                [None, None, None, None, None, None, None, None],
                [Piece("white", "pawn"), Piece("white", "pawn"), Piece("white", "pawn"), Piece("white", "pawn"), Piece("white", "pawn"), Piece("white", "pawn"), Piece("white", "pawn"),Piece("white", "pawn")],
                [Piece("white", "rook"), Piece("white", "knight"), Piece("white", "bishop"), Piece("white", "queen"), Piece("white", "king"),None,None, Piece("white", "rook")]]
        
        
        self.to_move = "white"
        self.move_log = []
        self.valid_moves = []
        self.king_positions = {
            "white": (7, 4),
            "black": (0, 4)
        }
        self.castling = {
            "white": {
                "king": True,
                "queen": True
            },
            "black": {
                "king": True,
                "queen": True
            }
        }


        self.check = False
        self.checks = []
        self.double_check = False

    from ChessEngine.MoveFunctions import move
    from ChessEngine.MoveFunctions import king_moves
    from ChessEngine.MoveFunctions import queen_moves
    from ChessEngine.MoveFunctions import rook_moves
    from ChessEngine.MoveFunctions import bishop_moves
    from ChessEngine.MoveFunctions import knight_moves
    from ChessEngine.MoveFunctions import pawn_moves
    from ChessEngine.CheckFunctions import in_check
    from ChessEngine.CheckFunctions import reset_check
    from ChessEngine.CheckFunctions import get_legal_moves
    from ChessEngine.CheckFunctions import is_pinned

    def __str__(self) -> str:
        return str(self.state)


