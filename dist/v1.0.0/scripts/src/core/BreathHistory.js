// ---------------- BREATH HISTORY ----------------
// Circular buffers backing the 3 scrolling waveform panels (Paw/Flow/Vol).
export class BreathHistory {
  constructor(seconds, fs) {
    this.len = seconds * fs;
    this.paw = new Float32Array(this.len);
    this.flow = new Float32Array(this.len);
    this.vol = new Float32Array(this.len);
    this.idx = 0;
  }

  push(p, f, v) {
    this.paw[this.idx] = p;
    this.flow[this.idx] = f;
    this.vol[this.idx] = v;
    this.idx = (this.idx + 1) % this.len;
  }
}
