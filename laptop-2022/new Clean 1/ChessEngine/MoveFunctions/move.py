'''
Moving a piece
Input:
    self
    initial -> (row,col)
    move -> [(row,col) , special_move_if_applicable]

Output:
    None(for now)
'''
def move(self,initial,move):
    final = move[0]

    '''
    Add move to move_log
    '''
    '''
    TODO
    '''

    if len(move) == 2 and (move[1] == "KSC" or move[1] == "QSC"):
        self.castling[self.to_move]["king"] = False
        self.castling[self.to_move]["queen"] = False
        self.state[final[0]][final[1]] , self.state[initial[0]][initial[1]] = self.state[initial[0]][initial[1]] , self.state[final[0]][final[1]]

        return

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


