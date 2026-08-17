// ---------------- SCOPE RENDERER ----------------
// Draws the 3 scrolling waveform panels (Paw / Flow / Vol) onto the scope
// canvas each frame, reading from BreathHistory and using Autoscale for
// vertical range.
export class ScopeRenderer {
  constructor(canvas, history, autoscale) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.history = history;
    this.autoscale = autoscale;
  }

  fitCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render() {
    const { canvas, ctx, autoscale, history } = this;
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);

    const panelH = h / 3;
    this._drawGraphPanel(
      0,
      panelH,
      history.paw,
      autoscale.scaleFor("paw"),
      "#e8a43d",
      "Paw cmH\u2082O",
      autoscale.scaleLabels("paw"),
    );
    this._drawGraphPanel(
      panelH,
      panelH,
      history.flow,
      autoscale.scaleFor("flow"),
      "#5fcf86",
      "FLOW l/min",
      autoscale.scaleLabels("flow"),
    );
    this._drawGraphPanel(
      panelH * 2,
      panelH,
      history.vol,
      autoscale.scaleFor("vol"),
      "#5cc9da",
      "V ml",
      autoscale.scaleLabels("vol"),
      true,
    );

    // divider lines
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, panelH);
    ctx.lineTo(w, panelH);
    ctx.moveTo(0, panelH * 2);
    ctx.lineTo(w, panelH * 2);
    ctx.stroke();
  }

  _drawGraphPanel(yTop, panelH, hist, scale, color, label, labels, baseline0) {
    const { canvas, ctx, history } = this;
    const w = canvas.clientWidth;
    const padTop = 14,
      padBottom = 6;
    const innerH = panelH - padTop - padBottom;

    const yFor = (val) => {
      const t = (val - scale.min) / (scale.max - scale.min);
      return yTop + padTop + innerH * (1 - t);
    };

    // gridline at zero / baseline
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    const zeroY = yFor(baseline0 ? scale.min : 0);
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();

    // trace
    const n = history.len;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const idx = (history.idx + i) % n; // oldest..newest across buffer
      const x = (i / n) * w;
      const y = yFor(hist[idx]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // label
    ctx.fillStyle = "#8c9094";
    ctx.font = "10px IBM Plex Mono, monospace";
    ctx.fillText(String(labels.top), 4, yTop + 11);
    ctx.fillText(String(labels.bottom), 4, yTop + panelH - 3);
    ctx.fillStyle = "#aeb1b4";
    ctx.font = "11px IBM Plex Mono, monospace";
    ctx.fillText(label, 22, yTop + 11);
  }
}
