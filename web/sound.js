// Short sounds made with WebAudio: a wooden knock for a move, a double
// knock for a capture, a knock and a tone for check, two tones at the end.

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

function knock(at, pitch, volume) {
  const length = 0.05;
  const buffer = context.createBuffer(1, context.sampleRate * length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  }
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = pitch;
  filter.Q.value = 1.2;
  const gain = context.createGain();
  gain.gain.value = volume;
  noise.connect(filter).connect(gain).connect(context.destination);
  noise.start(at);
  tone(at, pitch / 5, 0.06, volume * 0.8);
}

function tone(at, pitch, length, volume) {
  const oscillator = context.createOscillator();
  oscillator.frequency.value = pitch;
  const gain = context.createGain();
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(at);
  oscillator.stop(at + length);
}

// kind: 'move', 'capture', 'check' or 'end'.
export function playSound(kind) {
  if (!enabled || !unlocked) return;
  context ??= new AudioContext();
  if (context.state === 'suspended') context.resume();
  const now = context.currentTime + 0.005;
  if (kind === 'capture') {
    knock(now, 1500, 0.5);
    knock(now + 0.045, 900, 0.45);
  } else if (kind === 'check') {
    knock(now, 1000, 0.45);
    tone(now + 0.02, 660, 0.18, 0.08);
  } else if (kind === 'end') {
    tone(now, 523, 0.25, 0.1);
    tone(now + 0.16, 392, 0.4, 0.1);
  } else {
    knock(now, 1000, 0.45);
  }
}
