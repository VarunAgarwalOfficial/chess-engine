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
                                    return True
                            break
                    else:
                        break
            
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
                                    return True
                            break
                    else:
                        break
        

        
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
                                return True
        
        '''
        Pawn checks
        '''
        def pawn():
            if self.to_move == "white":
                if self.state[king_pos[0] - 1][king_pos[1] - 1]:
                    if self.state[king_pos[0] - 1][king_pos[1] - 1].color == opponent and self.state[king_pos[0] - 1][king_pos[1] - 1].type == "pawn":
                        return True
                if self.state[king_pos[0] - 1][king_pos[1] + 1]:
                    if self.state[king_pos[0] - 1][king_pos[1] + 1].color == opponent and self.state[king_pos[0] - 1][king_pos[1] + 1].type == "pawn":
                        return True
            else:
                if self.state[king_pos[0] + 1][king_pos[1] - 1]:
                    if self.state[king_pos[0] + 1][king_pos[1] - 1].color == opponent and self.state[king_pos[0] + 1][king_pos[1] - 1].type == "pawn":
                        return True
                if self.state[king_pos[0] + 1][king_pos[1] + 1]:
                    if self.state[king_pos[0] + 1][king_pos[1] + 1].color == opponent and self.state[king_pos[0] + 1][king_pos[1] + 1].type == "pawn":
                        return True
