'''
Returns a list of all possible ROOK moves
Input:
    self
    row -> integer
    col -> integer
Output:
    moves -> List of valid moves in the form [(row,col) , (special_move_if_applicable)]
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