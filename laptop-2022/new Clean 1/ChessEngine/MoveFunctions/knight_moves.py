'''
Returns a list of all possible KNIGHT moves
Input:
    self
    row -> integer
    col -> integer
Output:
    moves -> List of valid moves in the form [(row,col) , (special_move_if_applicable)]
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