'''
Returns a list of all possible moves for the current board state and piece at the given position
'''
import numpy as np
def get_legal_moves(self, pos):
    moves = []
    piece = self.state[pos[0]][pos[1]]
    if piece.color == self.to_move:
        if(piece.type == "pawn"):
            moves =  self.pawn_moves(pos[0] , pos[1])
        if(piece.type == "rook"):
            moves =  self.rook_moves(pos[0] , pos[1])
        if(piece.type == "knight"):
            moves =  self.knight_moves(pos[0] , pos[1])
        if(piece.type == "bishop"):
            moves =  self.bishop_moves(pos[0] , pos[1])
        if(piece.type == "queen"):
            moves =  self.queen_moves(pos[0] , pos[1])
        if(piece.type == "king"):
            return self.king_moves(pos[0] , pos[1])
    

    if(self.check):
        if(self.double_check):
            return []

        
        if (self.checks[0][0] == "knight" or self.checks[0][0] == "pawn"):
            return [self.checks[0][2]] if self.checks[0][2] in moves else []

        else:
            if (self.checks[0][0] == "diag"):
                legal_moves = []
                for move in moves:
                    k = (np.array(self.king_positions[self.to_move]) - np.array(move)) / np.array(self.checks[0][1])
                    d = (np.array(self.king_positions[self.to_move]) - np.array(self.checks[0][2])) / np.array(self.checks[0][1])
                    print(k , d)
                    if(k[0] == k[1] and  abs(k[0]) <= abs(d[0])):
                        legal_moves.append(move)
                
                return legal_moves
            else:
                legal_moves = []
                if(self.checks[0][1][0] == 0):
                    for move in moves:
                        if(move[0] == self.checks[0][2][0]):
                            legal_moves.append(move)
                else:
                    for move in moves:
                        if(move[1] == self.checks[0][2][1]):
                            legal_moves.append(move)
                return legal_moves




    return moves

