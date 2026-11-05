/* Canvas charts: home line, coin candles, analyst score ring. No chart library. */
(function (global) {
  'use strict';

  function dpr(canvas) {
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * ratio));
    const h = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, w: rect.width, h: rect.height, ratio };
  }

  function prefersReduced() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /** Home balance line + marks */
  function drawHomeLine(canvas, { points, marks, startValue }) {
    const { ctx, w, h } = dpr(canvas);
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 8, r: 8, t: 28, b: 16 };
    const iw = w - pad.l - pad.r;
    const ih = h - pad.t - pad.b;

    if (!points || points.length === 0) {
      // empty: dashed start line + caption drawn by CSS/DOM; still draw dashed mid line
      const y = pad.t + ih * 0.55;
      ctx.strokeStyle = 'rgba(235,235,245,0.3)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + iw, y);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }

    const vals = points.map((p) => p.v);
    const minV = Math.min(startValue != null ? startValue : vals[0], ...vals);
    const maxV = Math.max(startValue != null ? startValue : vals[0], ...vals);
    const span = maxV - minV || 1;
    const xAt = (i) => pad.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const yAt = (v) => pad.t + ih - ((v - minV) / span) * ih;

    // start value dashed
    if (startValue != null) {
      const y0 = yAt(startValue);
      ctx.strokeStyle = 'rgba(235,235,245,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(pad.l, y0);
      ctx.lineTo(pad.l + iw, y0);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // gradient fill
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, 'rgba(0,211,90,0.28)');
    grad.addColorStop(1, 'rgba(0,211,90,0)');
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i), y = yAt(p.v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(xAt(points.length - 1), pad.t + ih);
    ctx.lineTo(xAt(0), pad.t + ih);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xAt(i), y = yAt(p.v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#00d35a';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // marks — never overlap: stack rows
    if (marks && marks.length) {
      const rows = [];
      marks.forEach((m) => {
        // find nearest point index by time
        let idx = 0, best = Infinity;
        marks; // keep
        for (let i = 0; i < points.length; i++) {
          const dt = Math.abs(Date.parse(points[i].t) - Date.parse(m.t));
          if (dt < best) { best = dt; idx = i; }
        }
        const x = xAt(idx);
        const y = yAt(points[idx].v);
        let row = 0;
        while (rows.some((r) => r.row === row && Math.abs(r.x - x) < 54)) row++;
        rows.push({ row, x, y, m });
        const ty = y - 14 - row * 16;
        ctx.globalAlpha = prefersReduced() ? 1 : 1;
        ctx.fillStyle = m.color || '#fff';
        ctx.font = '11px -apple-system, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(m.label || '', x, Math.max(12, ty));
      });
    }
  }

  /** 1-minute OHLC candles + volume bars + optional exit line */
  function drawCandles(canvas, { candles, exitLine }) {
    const { ctx, w, h } = dpr(canvas);
    ctx.clearRect(0, 0, w, h);
    if (!candles || !candles.length) return;
    const volH = Math.floor(h * 0.22);
    const pad = { l: 4, r: 4, t: 8, b: 4 };
    const chartH = h - volH - pad.t - pad.b;
    const n = candles.length;
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);
    let minV = Math.min(...lows), maxV = Math.max(...highs);
    if (exitLine != null) {
      minV = Math.min(minV, exitLine);
      maxV = Math.max(maxV, exitLine);
    }
    const span = maxV - minV || 1;
    const slot = (w - pad.l - pad.r) / n;
    const bodyW = Math.max(2, slot * 0.6);
    const yAt = (v) => pad.t + chartH - ((v - minV) / span) * chartH;

    if (exitLine != null) {
      const y = yAt(exitLine);
      ctx.strokeStyle = '#ff9f0a';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const maxVol = Math.max(...candles.map((c) => c.v || 0), 1);
    candles.forEach((c, i) => {
      const x = pad.l + i * slot + slot / 2;
      const up = c.c >= c.o;
      const color = up ? '#00d35a' : '#ff453a';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(x, yAt(c.h));
      ctx.lineTo(x, yAt(c.l));
      ctx.stroke();
      const top = yAt(Math.max(c.o, c.c));
      const bot = yAt(Math.min(c.o, c.c));
      ctx.fillRect(x - bodyW / 2, top, bodyW, Math.max(1, bot - top));
      // volume
      const vh = ((c.v || 0) / maxVol) * (volH - 4);
      ctx.globalAlpha = 0.45;
      ctx.fillRect(x - bodyW / 2, h - pad.b - vh, bodyW, vh);
      ctx.globalAlpha = 1;
    });
  }

  /** Score ring 0-100; green from minScore */
  function drawScoreRing(canvas, score, minScore) {
    const { ctx, w, h } = dpr(canvas);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) * 0.38;
    const track = 'rgba(84,84,88,0.55)';
    ctx.lineWidth = Math.max(6, r * 0.18);
    ctx.lineCap = 'round';
    ctx.strokeStyle = track;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (score == null) return;
    const pct = Math.max(0, Math.min(100, score)) / 100;
    const greenFrom = minScore != null ? minScore : 70;
    ctx.strokeStyle = score >= greenFrom ? '#00d35a' : '#ffd60a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${Math.floor(r * 0.7)}px -apple-system, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(score)), cx, cy);
  }

  global.DeskCharts = { drawHomeLine, drawCandles, drawScoreRing, prefersReduced };
})(window);
