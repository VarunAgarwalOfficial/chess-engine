'''
Returns a list of all possible PAWN moves 
Input:
    self
    row -> integer
    col -> integer
Output:
    moves -> List of valid moves in the form [(row,col) , (special_move_if_applicable)]
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