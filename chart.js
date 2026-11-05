(function (global) {
  function readPoint(point, index) {
    if (typeof point === 'number') return { x: index, y: point };
    if (Array.isArray(point)) return { x: Number(point[0]), y: Number(point[1]) };
    if (!point || typeof point !== 'object') return { x: index, y: NaN };
    var y = point.v;
    if (y == null) y = point.value;
    if (y == null) y = point.equity;
    if (y == null) y = point.balance;
    var x = point.t;
    if (x == null) x = point.time;
    if (x == null) x = point.ts;
    if (x == null) x = index;
    return { x: Number(x), y: Number(y) };
  }

  function Chart(canvas, emptyEl) {
    this.canvas = canvas;
    this.emptyEl = emptyEl;
    this.points = [];
    var self = this;
    this._draw = function () { self.draw(); };
    if (typeof ResizeObserver === 'function') {
      this._observer = new ResizeObserver(this._draw);
      this._observer.observe(canvas);
    } else {
      window.addEventListener('resize', this._draw);
    }
  }

  Chart.prototype.setPoints = function (points) {
    this.points = Array.isArray(points) ? points : [];
    this.draw();
  };

  Chart.prototype.draw = function () {
    var canvas = this.canvas;
    var series = [];
    for (var i = 0; i < this.points.length; i++) {
      var point = readPoint(this.points[i], i);
      if (isFinite(point.x) && isFinite(point.y)) series.push(point);
    }
    if (this.emptyEl) this.emptyEl.hidden = series.length > 0;

    var rect = canvas.getBoundingClientRect();
    var cssW = rect.width || canvas.clientWidth;
    var cssH = rect.height || canvas.clientHeight;
    if (cssW < 2 || cssH < 2) return;

    var dpr = window.devicePixelRatio || 1;
    var pixelW = Math.max(1, Math.round(cssW * dpr));
    var pixelH = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!series.length) return;

    var minX = series[0].x;
    var maxX = series[0].x;
    var minY = series[0].y;
    var maxY = series[0].y;
    for (var j = 1; j < series.length; j++) {
      if (series[j].x < minX) minX = series[j].x;
      if (series[j].x > maxX) maxX = series[j].x;
      if (series[j].y < minY) minY = series[j].y;
      if (series[j].y > maxY) maxY = series[j].y;
    }
    if (minX === maxX) {
      minX -= 1;
      maxX += 1;
    }
    if (minY === maxY) {
      minY -= 1;
      maxY += 1;
    }

    var padX = 10;
    var padY = 14;
    var rising = series[series.length - 1].y >= series[0].y;
    var color = rising ? '#00d35a' : '#ff453a';

    function px(point) {
      return padX + ((point.x - minX) / (maxX - minX)) * (cssW - padX * 2);
    }
    function py(point) {
      return padY + (1 - (point.y - minY) / (maxY - minY)) * (cssH - padY * 2);
    }

    ctx.beginPath();
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    for (var k = 0; k < series.length; k++) {
      var x = px(series[k]);
      var y = py(series[k]);
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    var last = series[series.length - 1];
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(px(last), py(last), 3.5, 0, Math.PI * 2);
    ctx.fill();
  };

  global.DeskChart = Chart;
})(window);
