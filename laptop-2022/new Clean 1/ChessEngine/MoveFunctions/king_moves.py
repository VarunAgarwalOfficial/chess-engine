'''
returns a list of all possible KING moves
Input:
    self
    row -> integer
    col -> integer
Output:
    moves -> List of valid moves in the form [(row,col) , (special_move_if_applicable)]
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
                    moves.append([(row,col+3) , "KSC"])
                    print("KSC")
        
        if self.castling[self.to_move]["queen"]:
            if self.state[row][col-1] == None and self.state[row][col-2] == None and self.state[row][col-3] == None and self.state[row][col-4] == "rook":
                if  len(self.in_check((row,col-1))) == 0 and len(self.in_check((row,col-2))) == 0 and len(self.in_check((row,col-3))) == 0 and len(self.in_check((row,col-4))) == 0:
                    moves.append([(row,col-4) , "QSC"])



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