// Short sounds made with WebAudio: a wooden knock for a move, a double
// knock for a capture, a knock and a tone for check, two tones at the end.
// Every sound starts and ends at silence, so nothing clicks, and all of
// them go through one gain, which sets how loud the page is.

const VOLUME = 0.5;

let context = null;
let unlocked = false;
let enabled = true;

// Browsers only allow sound after the player has touched the page.
export function unlockSound() {
  unlocked = true;
}

export function setSound(on) {
  enabled = on;
}

// A burst of filtered noise that dies away, with a low tone under it.
function knock(audio, out, at, pitch, volume) {
  const length = 0.06;
  const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * length), audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / data.length;
    // Up in the first twentieth, then down to nothing.
    data[i] = (Math.random() * 2 - 1) * Math.min(1, t * 20) * (1 - t) ** 3;
  }
  const noise = audio.createBufferSource();
  noise.buffer = buffer;
  const filter = audio.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = pitch;
  filter.Q.value = 1.2;
  const gain = audio.createGain();
  gain.gain.value = volume;
  noise.connect(filter).connect(gain).connect(out);
  noise.start(at);
  tone(audio, out, at, pitch / 5, 0.07, volume * 0.6);
}

function tone(audio, out, at, pitch, length, volume) {
  const oscillator = audio.createOscillator();
  oscillator.frequency.value = pitch;
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  gain.gain.linearRampToValueAtTime(0, at + length + 0.01);
  oscillator.connect(gain).connect(out);
  oscillator.start(at);
  oscillator.stop(at + length + 0.01);
}

// Schedules one sound on any audio context, starting at `at` seconds.
// kind: 'move', 'capture', 'check' or 'end'.
export function scheduleSound(audio, kind, at) {
  const out = audio.createGain();
  out.gain.value = VOLUME;
  out.connect(audio.destination);
  if (kind === 'capture') {
    knock(audio, out, at, 1500, 0.5);
    knock(audio, out, at + 0.045, 900, 0.45);
  } else if (kind === 'check') {
    knock(audio, out, at, 1000, 0.45);
    tone(audio, out, at + 0.02, 660, 0.2, 0.14);
  } else if (kind === 'end') {
    tone(audio, out, at, 523, 0.28, 0.22);
    tone(audio, out, at + 0.16, 392, 0.45, 0.22);
  } else {
    knock(audio, out, at, 1000, 0.45);
  }
}

export function playSound(kind) {
  if (!enabled || !unlocked) return;
  context ??= new AudioContext();
  if (context.state === 'suspended') context.resume();
  scheduleSound(context, kind, context.currentTime + 0.005);
}
