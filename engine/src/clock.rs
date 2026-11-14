//! Milliseconds from a fixed point in the past. WebAssembly has no clock of
//! its own, so there the page supplies one.

#[cfg(not(target_arch = "wasm32"))]
pub fn now_ms() -> f64 {
    use std::sync::LazyLock;
    use std::time::Instant;
    static START: LazyLock<Instant> = LazyLock::new(Instant::now);
    START.elapsed().as_secs_f64() * 1000.0
}

#[cfg(target_arch = "wasm32")]
#[allow(unsafe_code)]
pub fn now_ms() -> f64 {
    #[link(wasm_import_module = "env")]
    extern "C" {
        fn now() -> f64;
    }
    // SAFETY: `now` is a plain function imported from the host page; it
    // takes no arguments and touches no memory.
    unsafe { now() }
}
