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