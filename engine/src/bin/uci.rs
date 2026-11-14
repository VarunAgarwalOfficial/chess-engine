//! The engine as a program: a UCI engine on standard input and output, or
//! `uci bench [depth]` and `uci perft <depth> [fen]` from the command line.

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if !chess::uci::command_line(&args) {
        chess::uci::run();
    }
}
