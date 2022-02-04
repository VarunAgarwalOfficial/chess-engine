import numpy as np

class Piece:
    def __init__(self , color  , type):
        self.color = color
        self.type = type


class Board():
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
                [Piece("white", "rook"), None,None,None, Piece("white", "king"),None,None, Piece("white", "rook")]]
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




        '''
        TODO
        self.in_checkmate = False
        self.in_stalemate = False
        self.in_threefold_repetition = False
        self.half_move_clock = 0
        self.full_move_number = 1
        '''
        
       

    '''
    function to reset check
    '''
    def reset_check(self):
            self.check = False
            self.checks = []
            self.double_check = False


    '''
    Moving a piece
    '''
    def move(self,initial,move):
        final = move[0]
  
        '''
        Add move to move_log
        '''
        '''
        TODO
        '''
        '''
        Check for special moves
        '''
        if len(move) == 2 :
            if ( (move[1] == "KSC" or move[1] == "QSC")):
                self.castling[self.to_move]["king"] = False
                self.castling[self.to_move]["queen"] = False
                if(move[1] == "KSC"):
                    self.state[final[0]][final[1]] , self.state[initial[0]][initial[1]] = self.state[initial[0]][initial[1]] , None
                    self.state[initial[0]][5] , self.state[initial[0]][7]= self.state[initial[0]][7],None
                else:
                    self.state[final[0]][final[1]] , self.state[initial[0]][initial[1]] = self.state[initial[0]][initial[1]] , None
                    self.state[initial[0]][3] , self.state[initial[0]][0]= self.state[initial[0]][0],None
            
        else:

            '''
            Checking if the king moved
            '''
            if(self.state[initial[0]][initial[1]].type == "king"):
                self.king_positions[self.to_move] = final
                '''
                Remove castling rights
                '''
                self.castling[self.to_move]["king"] = False
                self.castling[self.to_move]["queen"] = False



            '''
            Checking if the rook moved
            '''
            if(self.state[initial[0]][initial[1]].type == "rook"):
                if(initial[1] == 0):
                    self.castling[self.to_move]["king"] = False
                if(initial[1] == 7):
                    self.castling[self.to_move]["queen"] = False


            self.state[final[0]][final[1]] = self.state[initial[0]][initial[1]]
            self.state[initial[0]][initial[1]] = None


        if(self.to_move == "white"):
            self.to_move = "black"
        else:
            self.to_move = "white"
        if(len(checks := self.in_check()) > 0):
            self.check = True
            self.checks = checks
            print("Check")
            if(len(checks) == 2):
                print("Double Check")
                self.double_check = True
            if(len(checks) > 2):
                print("Something is Wrong")
        else:
            self.reset_check()



    '''
    check if a piece is pined
    '''
    def is_pinned(self, row , col):
        opponent = "black" if self.to_move == 'white' else "white"
        '''
        diagonal checks
        '''
        directions = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
        for direction in directions:
            found = False
            for i in range(1,8):
                end_row = self.king_positions[self.to_move][0] + direction[0] * i
                end_col = self.king_positions[self.to_move][1] + direction[1] * i
                if(end_row <= 7 and end_row >= 0 and end_col <= 7 and end_col >= 0):
                    if self.state[end_row][end_col] != None :
                        if not found:
                            '''
                            Found the piece before opponent
                            '''
                            if(end_row == row and col == end_col):
                                found = True
                            else: 
                                break 
                        else:           
                            if self.state[end_row][end_col].color == opponent:
                                if self.state[end_row][end_col].type == "bishop" or self.state[end_row][end_col].type == "queen":
                                    return True
                            break
                else:
                    break
        
        '''
        horizontal and vertical checks
        '''
        directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
        for direction in directions:
            found = False
            for i in range(1,8):
                end_row = self.king_positions[self.to_move][0] + direction[0] * i
                end_col = self.king_positions[self.to_move][1] + direction[1] * i
                if(end_row <= 7 and end_row >= 0 and end_col <= 7 and end_col >= 0):
                    if self.state[end_row][end_col] != None :
                        if not found:
                            '''Found the piece before opponent'''
                            if(end_row == row and col == end_col):
                                found = True
                            else: 
                                break 
                        else:           
                            if self.state[end_row][end_col].color == opponent:
                                if self.state[end_row][end_col].type == "rook" or self.state[end_row][end_col].type == "queen":
                                    return True
                            break
                else:
                    break

    '''
    checks if the king is in check
    '''
    def in_check(self , pos = None):
        opponent = "black" if self.to_move == "white" else "white"
        if pos:
            king_pos = pos
        else:
            king_pos = self.king_positions[self.to_move]

        '''
        Diagonal checks
        '''
        def diagonal():
            directions = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
            for direction in directions:
                for i in range(1,8):
                    end_row = king_pos[0] + direction[0] * i
                    end_col = king_pos[1] + direction[1] * i
                    if(end_row <= 7 and end_row >= 0 and end_col <= 7 and end_col >= 0):
                        if self.state[end_row][end_col] != None:
                            if self.state[end_row][end_col].color == opponent:
                                if self.state[end_row][end_col].type == "bishop" or self.state[end_row][end_col].type == "queen":
                                    return (direction , (end_row, end_col))
                            break
                    else:
                        break
            return None
            
        '''
        Horizontal and vertical checks
        '''
        def linear():
            directions = [(-1, 0), (1, 0), (0, -1), (0, 1)]
            for direction in directions:
                for i in range(1,8):
                    end_row = king_pos[0] + direction[0] * i
                    end_col = king_pos[1] + direction[1] * i
                    if(end_row <= 7 and end_row >= 0 and end_col <= 7 and end_col >= 0):
                        if self.state[end_row][end_col] != None:
                            if self.state[end_row][end_col].color == opponent:
                                if self.state[end_row][end_col].type == "rook" or self.state[end_row][end_col].type == "queen":
                                    return (direction , (end_row, end_col))
                            break
                    else:
                        break
            return None
        

        
        '''
        Knight checks
        '''
        def knight():
            directions = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
            for direction in directions:
                end_row = king_pos[0] + direction[0]
                end_col = king_pos[1] + direction[1]
                if(end_row <= 7 and end_row >= 0 and end_col <= 7 and end_col >= 0):
                    if self.state[end_row][end_col] != None:
                        if self.state[end_row][end_col].color == opponent:
                            if self.state[end_row][end_col].type == "knight":
                                return (direction , (end_row, end_col))
            return None
        
        '''
        Pawn checks
        '''
        def pawn():
            if self.to_move == "white":
                if king_pos[0] - 1 >= 0 and king_pos[1] - 1 >= 0 and (self.state[king_pos[0] - 1][king_pos[1] - 1]):
                    if self.state[king_pos[0] - 1][king_pos[1] - 1].color == opponent and self.state[king_pos[0] - 1][king_pos[1] - 1].type == "pawn":
                        return ([-1, -1], (king_pos[0] - 1, king_pos[1] - 1))
                if king_pos[0] - 1 >= 0 and king_pos[1] + 1 <= 7 and (self.state[king_pos[0] - 1][king_pos[1] + 1]):
                    if self.state[king_pos[0] - 1][king_pos[1] + 1].color == opponent and self.state[king_pos[0] - 1][king_pos[1] + 1].type == "pawn":
                        return ([-1, 1], (king_pos[0] - 1, king_pos[1] + 1))
            else:
                if king_pos[0] + 1 <= 7 and king_pos[1] - 1 >= 0 and (self.state[king_pos[0] + 1][king_pos[1] - 1]):
                    if self.state[king_pos[0] + 1][king_pos[1] - 1].color == opponent and self.state[king_pos[0] + 1][king_pos[1] - 1].type == "pawn":
                        return ([1, -1], (king_pos[0] + 1, king_pos[1] - 1))
                if king_pos[0] + 1 <= 7 and king_pos[1] + 1 <= 7 and (self.state[king_pos[0] + 1][king_pos[1] + 1]):
                    if self.state[king_pos[0] + 1][king_pos[1] + 1].color == opponent and self.state[king_pos[0] + 1][king_pos[1] + 1].type == "pawn":
                        return ([1, 1], (king_pos[0] + 1, king_pos[1] + 1))
            return None
    
        '''
        checks in the format (type , direction, atackers posn)
        '''
        checks = []
        if(diag := diagonal()):
            checks.append(("diag",) + diag)
        if(lin := linear()):
            checks.append(("lin",) + lin)
        if(kni := knight()):
            checks.append(("knight",)+kni)
        if(pa := pawn()):
            checks.append(("pawn",) + pa)
        
        return checks 


    '''
    Returns a list of all possible moves for the current board state and piece at the given position
    '''
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

    '''
    Returns a list of all possible PAWN moves 
    '''
    '''
    TODO en passant
    TODO promotion
    '''
    def pawn_moves(self , row , col):
        if self.is_pinned(row,col):
            return []
        moves = []
        if(self.to_move == "white"):

            '''
            moving the pawn forward
            '''
            if(self.state[row-1][col] == None):
                moves.append([(row-1,col)])

                '''
                if the pawn is on the first row, it can move two spaces forward
                '''
                if(self.state[row-2][col] == None and row == 6):
                    moves.append([(row-2,col)])

            '''
            the pawn can take a piece diagonally
            '''
            if(col <= 6 and self.state[row-1][col+1] and self.state[row-1][col+1].color == "black"):
                moves.append([(row-1,col+1)])
            if(col >= 1 and self.state[row-1][col-1] and self.state[row-1][col-1].color == "black"):
                moves.append([(row-1,col-1)])


        else:
            '''
            moving the pawn forward
            '''
            if(self.state[row+1][col] == None):
                moves.append([(row+1,col)])
                '''
                if the pawn is on the second last row, it can move two spaces forward
                '''
                if(self.state[row+2][col] == None and row == 1):
                    moves.append([(row+2,col)])

            '''
            the pawn can take a piece diagonally
            '''
            if(col <= 6 and self.state[row+1][col+1] and self.state[row+1][col+1].color == "white"):
                moves.append([(row+1,col+1)])
            if(col >= 1 and self.state[row+1][col-1] and self.state[row+1][col-1].color == "white"):
                moves.append([(row+1,col-1)])
            

        return moves

    '''
    Returns a list of all possible ROOK moves
    '''
    '''
    TODO castling
    '''
    def rook_moves(self , row , col):
        if self.is_pinned(row,col):
            return []
        moves = []
        '''
        directions in which a rook can move
        '''
        directions = [(-1, 0), (0, -1), (1, 0), (0, 1)]
        opponent = "black" if self.to_move == 'white' else "white"
        for direction in directions:
            '''
            a rook can move a maximum of 7 spaces in any direction
            '''
            for i in range(1,8):
                end_row = row + direction[0] * i
                end_col = col + direction[1] * i
                if(end_row <= 7 and end_row >= 0 and end_col <= 7 and end_col >= 0):
                    if self.state[end_row][end_col] == None:
                        '''
                        move is valid if the space is empty
                        '''
                        moves.append([(end_row,end_col)])
                    elif self.state[end_row][end_col].color == opponent:
                        moves.append([(end_row,end_col)])
                        '''
                        stop when you hit an opponent piece
                        '''
                        break
                    else: 
                        '''
                        stop when you hit your own piece
                        '''
                        break
                else: 
                    '''
                    stop when you hit the edge of the board
                    '''
                    break

        return moves

    '''
    Returns a list of all possible BISHOP moves
    '''
    def bishop_moves(self , row , col):
        if self.is_pinned(row,col):
            return []
        moves = []
        '''
        directions in which a bishop can move
        '''
        directions = [(-1, -1), (-1, 1), (1, -1), (1, 1)]
        opponent = "black" if self.to_move == 'white' else "white"
        for direction in directions:
            '''
            a bishop can move a maximum of 7 spaces in any direction
            '''
            for i in range(1,8):
                end_row = row + direction[0] * i
                end_col = col + direction[1] * i
                if(end_row <= 7 and end_row >= 0 and end_col <= 7 and end_col >= 0):
                    if self.state[end_row][end_col] == None:
                        '''
                        move is valid if the space is empty
                        '''
                        moves.append([(end_row,end_col)])
                    elif self.state[end_row][end_col].color == opponent:
                        moves.append([(end_row,end_col)])
                        '''
                        stop when you hit an opponent piece
                        '''
                        break
                    else: 
                        '''
                        stop when you hit your own piece
                        '''
                        break
                else: 
                    '''
                    stop when you hit the edge of the board
                    '''
                    break

        return moves

    '''
    Returns a list of all possible KNIGHT moves
    '''
    def knight_moves(self , row , col):
        if self.is_pinned(row,col):
            return []
        moves = []
        '''
        directions in which a knight can move
        '''
        directions = [(-2, -1), (-2, 1), (-1, -2), (-1, 2), (1, -2), (1, 2), (2, -1), (2, 1)]
        opponent = "black" if self.to_move == 'white' else "white"
        for direction in directions:
            end_row = row + direction[0]
            end_col = col + direction[1]
            if(end_row <= 7 and end_row >= 0 and end_col <= 7 and end_col >= 0):
                if self.state[end_row][end_col] == None:
                    '''
                    move is valid if the space is empty
                    '''
                    moves.append([(end_row,end_col)])
                elif self.state[end_row][end_col].color == opponent:
                    '''
                    move is valid if the space is occupied by an opponent piece
                    '''
                    moves.append([(end_row,end_col)])


        return moves
    
    '''
    Returns a list of all possible QUEEN moves
    '''
    def queen_moves(self , row , col):
        if self.is_pinned(row,col):
            return []
        moves = []
        '''
        directions in which a queen can move
        '''
        directions = [(-1, -1), (-1, 1), (1, -1), (1, 1), (-1, 0), (0, -1), (0, 1), (1, 0)]
        opponent = "black" if self.to_move == 'white' else "white"
        for direction in directions:
            '''
            a queen can move a maximum of 7 spaces in any direction
            '''
            for i in range(1,8):
                end_row = row + direction[0] * i
                end_col = col + direction[1] * i
                if(end_row <= 7 and end_row >= 0 and end_col <= 7 and end_col >= 0):
                    if self.state[end_row][end_col] == None:
                        '''
                        move is valid if the space is empty
                        '''
                        moves.append([(end_row,end_col)])
                    elif self.state[end_row][end_col].color == opponent:
                        moves.append([(end_row,end_col)])
                        '''
                        stop when you hit an opponent piece
                        '''
                        break
                    else: 
                        '''
                        stop when you hit your own piece
                        '''
                        break
                else: 
                    '''
                    stop when you hit the edge of the board
                    '''
                    break

        return moves


    '''
    returns a list of all possible KING moves
    '''
    '''
    TODO castling
    '''
    def king_moves(self , row , col):
        moves = []
        '''
        Check Castling
        '''
        if not self.check:

            '''
            King Side Castling
            '''
            if self.castling[self.to_move]["king"]:
                if self.state[row][col+1] == None and self.state[row][col+2] == None and self.state[row][col+3].type == "rook":
                    if  len(self.in_check((row,col+1))) == 0 and len(self.in_check((row,col+2))) == 0 and len(self.in_check((row,col+3))) == 0:
                        moves.append([(row,col+2) , "KSC"])
                        print("KSC")
            
            if self.castling[self.to_move]["queen"]:
                if self.state[row][col-1] == None and self.state[row][col-2] == None and self.state[row][col-3] == None and self.state[row][col-4].type == "rook":
                    if  len(self.in_check((row,col-1))) == 0 and len(self.in_check((row,col-2))) == 0 and len(self.in_check((row,col-3))) == 0 and len(self.in_check((row,col-4))) == 0:
                        moves.append([(row,col-2) , "QSC"])
                        print("QSC")


        '''
        directions in which a king can move
        '''
        directions = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
        opponent = "black" if self.to_move == 'white' else "white"
        for direction in directions:
            end_row = row + direction[0]
            end_col = col + direction[1]
            if(end_row <= 7 and end_row >= 0 and end_col <= 7 and end_col >= 0):
                if self.state[end_row][end_col] == None and len(self.in_check((end_row, end_col))) == 0:
                    '''
                    move is valid if the space is empty and not in check
                    '''
                    moves.append([(end_row,end_col)])
                elif self.state[end_row][end_col] and self.state[end_row][end_col].color == opponent and len(self.in_check((end_row, end_col))) == 0:
                    '''
                    move is valid if the space is occupied by an opponent piece
                    '''
                    moves.append([(end_row,end_col)])

        return moves