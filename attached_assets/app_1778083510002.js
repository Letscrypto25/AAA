/**
 * App Controller
 * Handles canvas interaction, rendering, presets, UI updates
 */

(function () {
  const canvas = document.getElementById('graph-canvas');
  const ctx = canvas.getContext('2d');
  const predictor = new PatternPredictor();

  // State
  let dataPoints = []; // { x, y } in canvas coords
  let predictionResult = null;
  let animFrame = null;
  let noiseLevel = 0.1;
  let predN = 3;
  let aggregator = 'average';
  let quantileQ = 0.75;
  let scenariosCount = 1;
  let xAxisLabel = 'X';
  let yAxisLabel = 'Y';
  let yScale = 1;
  let events = [];
  let dataXs = null; // optional x values for base series
  let importedSeries = []; // [{ ys:number[], weight:number, on:boolean }]
  let customSetup = 'standard';
  let liveTimer = null;
  let autoRun = true;
  let maxDrawPoints = 500;
  let externalPreds = [];
  let externalAlpha = 0.5;
  let useTimeAxis = false;
  let timeFrame = '5m';
  let showPersp = { cyclic: true, trend: true, movingAvg: true, constraint: true };

  // Colors
  const C = {
    grid: '#1c2030',
    axis: '#262a35',
    data: '#e8c547',
    dataPoint: '#fff',
    cyclic: '#4fe3c1',
    trend: '#e87d4f',
    mavg: '#a78bfa',
    constraint: '#f472b6',
    ensemble: '#e8c547',
    predPoint: '#ffffff',
    confBand: 'rgba(232,197,71,0.08)'
  };

  // ─── CANVAS SETUP ─────────────────────────────────────────────────────────────

  function resize() {
    const wrapper = canvas.parentElement;
    canvas.width = wrapper.clientWidth * devicePixelRatio;
    canvas.height = wrapper.clientHeight * devicePixelRatio;
    canvas.style.width = wrapper.clientWidth + 'px';
    canvas.style.height = wrapper.clientHeight + 'px';
    ctx.scale(devicePixelRatio, devicePixelRatio);
    draw();
  }

  window.addEventListener('resize', resize);

  // ─── COORDINATE HELPERS ───────────────────────────────────────────────────────

  function getCanvasRect() {
    return {
      w: canvas.clientWidth,
      h: canvas.clientHeight,
      padL: 56,
      padR: 40,
      padT: 30,
      padB: 40
    };
  }

  function toScreen(index, value, allValues) {
    const r = getCanvasRect();
    const totalPoints = allValues.length;
    let minV = Math.min(...allValues);
    let maxV = Math.max(...allValues);
    const baseRange = maxV - minV || 1;
    const mid = (maxV + minV) / 2;
    const half = (baseRange / 2) * yScale;
    minV = mid - half;
    maxV = mid + half;
    const range = maxV - minV || 1;
    const plotW = r.w - r.padL - r.padR;
    const plotH = r.h - r.padT - r.padB;
    const x = r.padL + (index / Math.max(totalPoints - 1, 1)) * plotW;
    const y = r.padT + (1 - (value - minV) / range) * plotH;
    return { x, y };
  }

  function toDataIndex(canvasX) {
    const r = getCanvasRect();
    const plotW = r.w - r.padL - r.padR;
    const n = dataPoints.length;
    return ((canvasX - r.padL) / plotW) * Math.max(n - 1, 1);
  }

  function toDataValue(canvasY, allValues) {
    const r = getCanvasRect();
    const plotH = r.h - r.padT - r.padB;
    const minV = Math.min(...allValues);
    const maxV = Math.max(...allValues);
    const range = maxV - minV || 1;
    return minV + (1 - (canvasY - r.padT) / plotH) * range;
  }

  // ─── DRAWING ──────────────────────────────────────────────────────────────────

  function draw() {
    const r = getCanvasRect();
    ctx.clearRect(0, 0, r.w, r.h);
    drawBackground(r);
    if (dataPoints.length < 2) {
      drawEmptyHint(r);
      return;
    }
    drawGridAndAxes(r);
    drawPerspectives(r);
    drawScenarios(r);
    drawImportedSeries(r); // Call the new function to draw imported series
    drawDataLine(r);
    drawDataPoints(r);
    if (predictionResult) drawPredictions(r);
  }

  function drawImportedSeries(r) {
    if (importedSeries.length === 0) return;
    const allValues = getDisplayValues();
    const cols = ['#80ed99', '#ffc300', '#da2c38', '#007bff', '#6a0572']; // Different colors for imported series
    const xsAll = getAllXs();
    const rct = getCanvasRect();
    let minX = null, maxX = null;
    if (xsAll) { minX = Math.min(...xsAll); maxX = Math.max(...xsAll); }
    importedSeries.forEach((s, seriesIdx) => {
      if (s.ys.length < 2) return;
      ctx.beginPath();
      const seriesColor = cols[seriesIdx % cols.length];
      const idxs = decimateIndices(s.ys.length, maxDrawPoints);
      idxs.forEach((i, k) => {
        const v = s.ys[i];
        if (Array.isArray(s.xs) && xsAll) {
          const x = mapX(s.xs[i], rct, minX, maxX);
          let minV = Math.min(...allValues);
          let maxV = Math.max(...allValues);
          const baseRange = maxV - minV || 1;
          const mid = (maxV + minV) / 2;
          const half = (baseRange / 2) * yScale;
          minV = mid - half;
          maxV = mid + half;
          const rangeV = maxV - minV || 1;
          const plotH = rct.h - rct.padT - rct.padB;
          const y = rct.padT + (1 - (v - minV) / rangeV) * plotH;
          k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        } else {
          const { x, y } = toScreen(i, v, allValues);
          k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
      });
      ctx.strokeStyle = seriesColor;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      ctx.globalAlpha = 1;
    });
  }

  function drawBackground(r) {
    ctx.fillStyle = '#0b0c0f';
    ctx.fillRect(0, 0, r.w, r.h);
  }

  function drawEmptyHint(r) {
    ctx.fillStyle = '#2a2e3a';
    ctx.font = '13px "Syne Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Click on the canvas to add data points', r.w / 2, r.h / 2);
    ctx.font = '10px "Syne Mono", monospace';
    ctx.fillStyle = '#3a3e4a';
    ctx.fillText('Add at least 4 points, then click Run Forecast', r.w / 2, r.h / 2 + 24);
  }

  function drawGridAndAxes(r) {
    const series = dataPoints.map(p => p.y);
    const allValues = [...series, ...(predictionResult ? predictionResult.predictions : [])];
    let minV = Math.min(...allValues);
    let maxV = Math.max(...allValues);
    const baseRange = maxV - minV || 1;
    const mid = (maxV + minV) / 2;
    const half = (baseRange / 2) * yScale;
    minV = mid - half;
    maxV = mid + half;
    const range = maxV - minV || 1;
    const plotH = r.h - r.padT - r.padB;
    const plotW = r.w - r.padL - r.padR;

    // Horizontal grid lines
    const gridLines = 5;
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= gridLines; i++) {
      const val = minV + (i / gridLines) * range;
      const y = r.padT + (1 - i / gridLines) * plotH;
      ctx.beginPath();
      ctx.moveTo(r.padL, y);
      ctx.lineTo(r.w - r.padR, y);
      ctx.stroke();

      // Labels
      ctx.fillStyle = '#3a3e4a';
      ctx.font = '9px "Syne Mono", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1), r.padL - 6, y + 3);
    }

    // Vertical grid lines
    const vLines = Math.min(dataPoints.length, 10);
    const xsAll = getAllXs();
    for (let i = 0; i <= vLines; i++) {
      const x = r.padL + (i / vLines) * plotW;
      ctx.strokeStyle = C.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, r.padT);
      ctx.lineTo(x, r.h - r.padB);
      ctx.stroke();

      // X label: index or actual X
      let label = '';
      if (xsAll && xsAll.length) {
        const minX = Math.min(...xsAll);
        const maxX = Math.max(...xsAll);
        const val = minX + (i / vLines) * ((maxX - minX) || 1);
        if (useTimeAxis) {
          label = formatTimeLabel(val);
        } else {
          label = (Math.abs(val) < 1000 ? val.toFixed(2) : Math.round(val)).toString();
        }
      } else {
        const idx = Math.round((i / vLines) * (dataPoints.length - 1));
        label = idx.toString();
      }
      ctx.fillStyle = '#3a3e4a';
      ctx.font = '9px "Syne Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, r.h - r.padB + 14);
    }

    // Axes
    ctx.strokeStyle = C.axis;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(r.padL, r.padT);
    ctx.lineTo(r.padL, r.h - r.padB);
    ctx.lineTo(r.w - r.padR, r.h - r.padB);
    ctx.stroke();

    ctx.fillStyle = '#6b7280';
    ctx.font = '10px \"Syne Mono\", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(xAxisLabel, r.padL + plotW / 2, r.h - 8);
    ctx.textAlign = 'right';
    ctx.fillText(yAxisLabel, r.padL - 8, r.padT - 8);
    if (useTimeAxis) {
      const xsAll2 = getAllXs();
      if (xsAll2 && xsAll2.length) {
        ctx.strokeStyle = C.axis;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.padL, r.padT);
        ctx.lineTo(r.w - r.padR, r.padT);
        ctx.stroke();
        const ticks = vLines;
        for (let i = 0; i <= ticks; i++) {
          const x = r.padL + (i / ticks) * plotW;
          const minX = Math.min(...xsAll2);
          const maxX = Math.max(...xsAll2);
          const val = minX + (i / ticks) * ((maxX - minX) || 1);
          const tLabel = formatTimeLabel(val);
          ctx.fillStyle = '#6b7280';
          ctx.font = '9px "Syne Mono", monospace';
          ctx.textAlign = 'center';
          ctx.fillText(tLabel, x, r.padT - 8);
        }
      }
    }
  }

  function drawDataLine(r) {
    const series = dataPoints.map(p => p.y);
    const allValues = getDisplayValues();
    if (series.length < 2) return;

    ctx.beginPath();
    if (Array.isArray(dataXs) && dataXs.length === series.length) {
      const rct = getCanvasRect();
      const plotH = rct.h - rct.padT - rct.padB;
      let minV = Math.min(...allValues);
      let maxV = Math.max(...allValues);
      const baseRange = maxV - minV || 1;
      const mid = (maxV + minV) / 2;
      const half = (baseRange / 2) * yScale;
      minV = mid - half;
      maxV = mid + half;
      const rangeV = maxV - minV || 1;
      const xsAll = getAllXs();
      const minX = xsAll ? Math.min(...xsAll) : Math.min(...dataXs);
      const maxX = xsAll ? Math.max(...xsAll) : Math.max(...dataXs);
      const idxs = decimateIndices(series.length, maxDrawPoints);
      idxs.forEach((i, k) => {
        const v = series[i];
        const x = mapX(dataXs[i], rct, minX, maxX);
        const y = rct.padT + (1 - (v - minV) / rangeV) * plotH;
        k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
    } else {
      const idxs = decimateIndices(series.length, maxDrawPoints);
      idxs.forEach((i, k) => {
        const v = series[i];
        const { x, y } = toScreen(i, v, allValues);
        k === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
    }
    ctx.strokeStyle = C.data;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function drawDataPoints(r) {
    const series = dataPoints.map(p => p.y);
    const allValues = getDisplayValues();
    if (Array.isArray(dataXs) && dataXs.length === series.length) {
      const rct = getCanvasRect();
      const plotH = rct.h - rct.padT - rct.padB;
      let minV = Math.min(...allValues);
      let maxV = Math.max(...allValues);
      const baseRange = maxV - minV || 1;
      const mid = (maxV + minV) / 2;
      const half = (baseRange / 2) * yScale;
      minV = mid - half;
      maxV = mid + half;
      const rangeV = maxV - minV || 1;
      const xsAll = getAllXs();
      const minX = xsAll ? Math.min(...xsAll) : Math.min(...dataXs);
      const maxX = xsAll ? Math.max(...xsAll) : Math.max(...dataXs);
      const idxs = decimateIndices(series.length, Math.floor(maxDrawPoints * 0.7));
      idxs.forEach((i) => {
        const v = series[i];
        const x = mapX(dataXs[i], rct, minX, maxX);
        const y = rct.padT + (1 - (v - minV) / rangeV) * plotH;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = C.data;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
    } else {
      const idxs = decimateIndices(series.length, Math.floor(maxDrawPoints * 0.7));
      idxs.forEach((i) => {
        const v = series[i];
        const { x, y } = toScreen(i, v, allValues);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = C.data;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });
    }
  }
  function decimateIndices(n, maxN) {
    if (n <= maxN) return Array.from({ length: n }, (_, i) => i);
    const step = (n - 1) / (maxN - 1);
    const out = [];
    for (let i = 0; i < maxN; i++) out.push(Math.round(i * step));
    if (out[out.length - 1] !== n - 1) out[out.length - 1] = n - 1;
    return out;
  }

  function drawPerspectives(r) {
    if (!predictionResult) return;
    const { perspectives } = predictionResult;
    const series = dataPoints.map(p => p.y);
    const n = series.length;
    const allValues = getDisplayValues();
    const perspConfig = [
      { key: 'cyclic', color: C.cyclic },
      { key: 'trend', color: C.trend },
      { key: 'movingAvg', color: C.mavg },
      { key: 'constraint', color: C.constraint }
    ];

    perspConfig.forEach(({ key, color }) => {
      const preds = perspectives[key];
      if (!preds || preds.length === 0) return;
      if (!showPersp[key]) return;
      // Start from last data point
      const lastPt = toScreen(n - 1, series[n - 1], allValues);
      ctx.beginPath();
      ctx.moveTo(lastPt.x, lastPt.y);
      preds.forEach((v, i) => {
        const { x, y } = toScreen(n + i, v, allValues);
        ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });
  }

  function drawScenarios(r) {
    if (!predictionResult || !predictionResult.scenarios) return;
    const series = dataPoints.map(p => p.y);
    const n = series.length;
    const allValues = getDisplayValues();
    const cols = ['#66d9e8', '#f59f00', '#845ef7', '#20c997', '#ffa8a8'];
    const xsAll = getAllXs();
    const rct = getCanvasRect();
    let minX = null, maxX = null;
    if (xsAll) { minX = Math.min(...xsAll); maxX = Math.max(...xsAll); }
    predictionResult.scenarios.forEach((sc, idx) => {
      const preds = sc.predictions || [];
      if (preds.length === 0) return;
      if (Array.isArray(sc.predictedXs) && xsAll) {
        let minV = Math.min(...allValues);
        let maxV = Math.max(...allValues);
        const baseRange = maxV - minV || 1;
        const mid = (maxV + minV) / 2;
        const half = (baseRange / 2) * yScale;
        minV = mid - half;
        maxV = mid + half;
        const rangeV = maxV - minV || 1;
        const lastX = Array.isArray(dataXs) ? dataXs[dataXs.length - 1] : (xsAll ? Math.max(...xsAll) : (n - 1));
        const startX = mapX(lastX, rct, minX, maxX);
        const lastY = toScreen(n - 1, series[n - 1], allValues).y;
        ctx.beginPath();
        ctx.moveTo(startX, lastY);
        preds.forEach((v, i) => {
          const x = mapX(sc.predictedXs[i], rct, minX, maxX);
          const plotH = rct.h - rct.padT - rct.padB;
          const y = rct.padT + (1 - (v - minV) / rangeV) * plotH;
          ctx.lineTo(x, y);
        });
      } else {
        const lastPt = toScreen(n - 1, series[n - 1], allValues);
        ctx.beginPath();
        ctx.moveTo(lastPt.x, lastPt.y);
        preds.forEach((v, i) => {
          const { x, y } = toScreen(n + i, v, allValues);
          ctx.lineTo(x, y);
        });
      }
      ctx.strokeStyle = cols[idx % cols.length];
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.3;
      ctx.setLineDash([2, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });
  }

  function drawPredictions(r) {
    const { predictions, diagnostics } = predictionResult;
    if (!predictions || predictions.length === 0) return;
    const series = dataPoints.map(p => p.y);
    const n = series.length;
    const allValues = getDisplayValues();
    const conf = diagnostics.confidence ?? 0.5;

    // Confidence band
    const bandWidth = (diagnostics.std || 0.2) * (1 - conf) * 2;
    ctx.beginPath();
    if (Array.isArray(dataXs) && dataXs.length === series.length && Array.isArray(predictionResult.predictedXs)) {
      const rct = getCanvasRect();
      const plotW = rct.w - rct.padL - rct.padR;
      const plotH = rct.h - rct.padT - rct.padB;
      let minV = Math.min(...allValues);
      let maxV = Math.max(...allValues);
      const baseRange = maxV - minV || 1;
      const mid = (maxV + minV) / 2;
      const half = (baseRange / 2) * yScale;
      minV = mid - half;
      maxV = mid + half;
      const rangeV = maxV - minV || 1;
      const xs = [...dataXs, ...predictionResult.predictedXs];
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const rangeX = maxX - minX || 1;
      const lastX = dataXs[dataXs.length - 1];
      const startX = rct.padL + ((lastX - minX) / rangeX) * plotW;
      const startY = rct.padT + (1 - (series[n - 1] - minV) / rangeV) * plotH;
      ctx.moveTo(startX, startY - (bandWidth));
      predictions.forEach((v, i) => {
        const xVal = predictionResult.predictedXs[i];
        const x = rct.padL + ((xVal - minX) / rangeX) * plotW;
        const y = rct.padT + (1 - (v - minV) / rangeV) * plotH;
        const factor = 1 + i * 0.5;
        ctx.lineTo(x, y - (bandWidth * factor));
      });
      for (let i = predictions.length - 1; i >= 0; i--) {
        const xVal = predictionResult.predictedXs[i];
        const x = rct.padL + ((xVal - minX) / rangeX) * plotW;
        const y = rct.padT + (1 - (predictions[i] - minV) / rangeV) * plotH;
        const factor = 1 + i * 0.5;
        ctx.lineTo(x, y + (bandWidth * factor));
      }
    } else {
      const lastPt = toScreen(n - 1, series[n - 1], allValues);
      ctx.moveTo(lastPt.x, toScreen(n - 1, series[n - 1] + bandWidth, allValues).y);
      predictions.forEach((v, i) => {
        const factor = 1 + i * 0.5;
        const { x } = toScreen(n + i, v, allValues);
        ctx.lineTo(x, toScreen(n + i, v + bandWidth * factor, allValues).y);
      });
      for (let i = predictions.length - 1; i >= 0; i--) {
        const factor = 1 + i * 0.5;
        const { x } = toScreen(n + i, predictions[i], allValues);
        ctx.lineTo(x, toScreen(n + i, predictions[i] - bandWidth * factor, allValues).y);
      }
    }
    ctx.closePath();
    ctx.fillStyle = C.confBand;
    ctx.fill();

    // Ensemble line
    ctx.beginPath();
    if (Array.isArray(dataXs) && dataXs.length === series.length && Array.isArray(predictionResult.predictedXs)) {
      const rct = getCanvasRect();
      const plotW = rct.w - rct.padL - rct.padR;
      const plotH = rct.h - rct.padT - rct.padB;
      const minV = Math.min(...allValues);
      const maxV = Math.max(...allValues);
      const rangeV = maxV - minV || 1;
      const xs = [...dataXs, ...predictionResult.predictedXs];
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const rangeX = maxX - minX || 1;
      const lastX = dataXs[dataXs.length - 1];
      const startX = rct.padL + ((lastX - minX) / rangeX) * plotW;
      const startY = rct.padT + (1 - (series[n - 1] - minV) / rangeV) * plotH;
      ctx.moveTo(startX, startY);
      predictions.forEach((v, i) => {
        const xVal = predictionResult.predictedXs[i];
        const x = rct.padL + ((xVal - minX) / rangeX) * plotW;
        const y = rct.padT + (1 - (v - minV) / rangeV) * plotH;
        ctx.lineTo(x, y);
      });
    } else {
      const lastSc = toScreen(n - 1, series[n - 1], allValues);
      ctx.moveTo(lastSc.x, lastSc.y);
      predictions.forEach((v, i) => {
        const { x, y } = toScreen(n + i, v, allValues);
        ctx.lineTo(x, y);
      });
    }
    ctx.strokeStyle = C.ensemble;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.setLineDash([6, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Prediction dots
    predictions.forEach((v, i) => {
      const { x, y } = toScreen(n + i, v, allValues);
      // Glow
      const grad = ctx.createRadialGradient(x, y, 0, x, y, 12);
      grad.addColorStop(0, 'rgba(232,197,71,0.3)');
      grad.addColorStop(1, 'rgba(232,197,71,0)');
      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = C.ensemble;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Value label
      ctx.fillStyle = '#e8c547';
      ctx.font = 'bold 10px "Syne Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(v.toFixed(2), x, y - 14);
    });
  }

  function getDisplayValues() {
    const series = dataPoints.map(p => p.y);
    const imported = importedSeries.flatMap(s => s.ys);
    if (!predictionResult) return [...series, ...imported];
    const pPts = predictionResult.predictions || [];
    const persp = Object.values(predictionResult.perspectives || {}).flat();
    const scns = (predictionResult.scenarios || []).flatMap(s => s.predictions || []);
    return [...series, ...imported, ...pPts, ...persp, ...scns];
  }
  function getAllXs() {
    const xs = [];
    if (Array.isArray(dataXs)) xs.push(...dataXs);
    importedSeries.forEach(s => { if (Array.isArray(s.xs)) xs.push(...s.xs); });
    if (predictionResult && Array.isArray(predictionResult.predictedXs)) xs.push(...predictionResult.predictedXs);
    if (predictionResult && Array.isArray(predictionResult.scenarios)) {
      predictionResult.scenarios.forEach(sc => {
        if (Array.isArray(sc.predictedXs)) xs.push(...sc.predictedXs);
      });
    }
    return xs.length ? xs : null;
  }
  function timeFrameMs(val) {
    const map = { '5m': 5*60*1000, '15m': 15*60*1000, '30m': 30*60*1000, '1h': 60*60*1000, '4h': 4*60*60*1000, '1d': 24*60*60*1000, '1w': 7*24*60*60*1000, '1mo': 30*24*60*60*1000, '3mo': 90*24*60*60*1000, '6mo': 180*24*60*60*1000, '1y': 365*24*60*60*1000 };
    return map[val] || map['5m'];
  }
  function formatTimeLabel(xMs) {
    const d = new Date(Math.round(xMs));
    if (timeFrame === '5m' || timeFrame === '15m' || timeFrame === '30m' || timeFrame === '1h' || timeFrame === '4h') {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (timeFrame === '1d' || timeFrame === '1w') {
      return d.toLocaleDateString();
    }
    return d.toLocaleDateString();
  }
  function ensureTimeXs() {
    if (!useTimeAxis) return;
    const step = timeFrameMs(timeFrame);
    const n = dataPoints.length;
    const start = Date.now() - (n - 1) * step;
    dataXs = Array.from({ length: n }, (_, i) => start + i * step);
  }
  function mapX(xVal, rct, minX, maxX) {
    const plotW = rct.w - rct.padL - rct.padR;
    const rangeX = (maxX - minX) || 1;
    return rct.padL + ((xVal - minX) / rangeX) * plotW;
  }
  function screenToX(cx) {
    const rct = getCanvasRect();
    const xsAll = getAllXs();
    if (!xsAll) return null;
    const minX = Math.min(...xsAll);
    const maxX = Math.max(...xsAll);
    const plotW = rct.w - rct.padL - rct.padR;
    const t = Math.max(0, Math.min(1, (cx - rct.padL) / plotW));
    return minX + t * ((maxX - minX) || 1);
  }

  // ─── CANVAS INTERACTION ───────────────────────────────────────────────────────

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    // Convert to data value
    const series = dataPoints.map(p => p.y);
    const dummy = series.length > 0 ? series : [0, 1];
    const value = toDataValue(cy, dummy.length >= 2 ? dummy : [0, 1]);

    // Add noise
    const noise = noiseLevel * (Math.random() * 2 - 1) * 2;
    dataPoints.push({ x: cx, y: value + noise });

    predictionResult = null;
    document.getElementById('canvas-hint').textContent =
      `${dataPoints.length} point${dataPoints.length !== 1 ? 's' : ''} · Right-click to remove last`;
    draw();
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (dataPoints.length > 0) {
      dataPoints.pop();
      predictionResult = null;
      draw();
    }
  });

  // ─── PRESETS ──────────────────────────────────────────────────────────────────

  const PRESETS = {
    sine: (n = 32) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const noise = noiseLevel * (Math.random() * 2 - 1);
        pts.push(Math.sin(i / (n / (Math.PI * 4))) + noise);
      }
      return pts;
    },
    trend: (n = 32) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const noise = noiseLevel * (Math.random() * 2 - 1);
        pts.push(0.05 * i + Math.sin(i / 3) * 0.3 + noise);
      }
      return pts;
    },
    seasonal: (n = 48) => {
      const pts = [];
      for (let i = 0; i < n; i++) {
        const noise = noiseLevel * (Math.random() * 2 - 1);
        pts.push(Math.sin(i / (n / (Math.PI * 6))) + 0.03 * i + noise);
      }
      return pts;
    },
    noisy: (n = 40) => {
      const pts = [];
      let v = 0;
      for (let i = 0; i < n; i++) {
        v += (Math.random() * 2 - 1) * 0.5 + (0.1 - v * 0.05); // mean-reverting random walk
        pts.push(v);
      }
      return pts;
    },
    stationary: (n = 40) => {
      const pts = [];
      let v = 0;
      const target = 2;
      for (let i = 0; i < n; i++) {
        v += (target - v) * 0.1 + noiseLevel * (Math.random() * 2 - 1);
        pts.push(v);
      }
      return pts;
    }
  };

  function loadPreset(name) {
    const values = PRESETS[name]();
    dataPoints = values.map((v, i) => ({ x: i, y: v }));
    predictionResult = null;
    if (useTimeAxis) ensureTimeXs();
    draw();
  }

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadPreset(btn.dataset.preset);
    });
  });

  // ─── CONTROLS ─────────────────────────────────────────────────────────────────

  const predSlider = document.getElementById('pred-points');
  const predVal = document.getElementById('pred-val');
  predSlider.addEventListener('input', () => {
    predN = +predSlider.value;
    predVal.textContent = predN;
  });

  const scnSlider = document.getElementById('scenarios-count');
  const scnVal = document.getElementById('scn-val');
  if (scnSlider) {
    scnSlider.addEventListener('input', () => {
      scenariosCount = +scnSlider.value;
      scnVal.textContent = scenariosCount;
    });
  }

  const aggButtons = [
    document.getElementById('agg-average'),
    document.getElementById('agg-median'),
    document.getElementById('agg-mode'),
    document.getElementById('agg-weighted'),
    document.getElementById('agg-quantile')
  ].filter(Boolean);
  aggButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      aggButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      aggregator = btn.dataset.agg;
      if (aggregator === 'quantile') quantileQ = 0.75;
    });
  });

  const noiseSlider = document.getElementById('noise-level');
  const noiseVal = document.getElementById('noise-val');
  noiseSlider.addEventListener('input', () => {
    noiseLevel = +noiseSlider.value;
    noiseVal.textContent = noiseLevel.toFixed(2);
  });
  const qSlider = document.getElementById('quantile-q');
  const qVal = document.getElementById('q-val');
  if (qSlider && qVal) {
    qSlider.addEventListener('input', () => {
      quantileQ = parseFloat(qSlider.value);
      qVal.textContent = quantileQ.toFixed(2);
    });
  }
  const yScaleSlider = document.getElementById('y-scale');
  const yScaleVal = document.getElementById('yscale-val');
  if (yScaleSlider && yScaleVal) {
    yScaleSlider.addEventListener('input', () => {
      yScale = parseFloat(yScaleSlider.value);
      yScaleVal.textContent = yScale.toFixed(2);
      draw();
    });
  }
  const useTimeChk = document.getElementById('use-time-axis');
  const timeFrameSel = document.getElementById('time-frame');
  if (useTimeChk) {
    useTimeAxis = !!useTimeChk.checked;
    useTimeChk.addEventListener('change', () => {
      useTimeAxis = !!useTimeChk.checked;
      if (useTimeAxis) { ensureTimeXs(); }
      draw();
    });
  }
  if (timeFrameSel) {
    timeFrameSel.addEventListener('change', () => {
      timeFrame = timeFrameSel.value;
      if (useTimeAxis) { ensureTimeXs(); }
      draw();
    });
  }

  const xLabelInput = document.getElementById('x-label');
  const yLabelInput = document.getElementById('y-label');
  if (xLabelInput) {
    xLabelInput.addEventListener('input', () => {
      xAxisLabel = xLabelInput.value || 'X';
      draw();
    });
  }
  if (yLabelInput) {
    yLabelInput.addEventListener('input', () => {
      yAxisLabel = yLabelInput.value || 'Y';
      draw();
    });
  }

  const loadBtn = document.getElementById('load-data-btn');
    const dataInput = document.getElementById('data-input');
    if (loadBtn && dataInput) {
      loadBtn.addEventListener('click', () => {
        const raw = dataInput.value.trim();
        if (!raw) return;
        const parsed = parseSeriesText(raw);
        if (parsed.ys.length >= 2) {
          dataPoints = parsed.ys.map((v, i) => ({ x: i, y: v }));
          dataXs = parsed.xs && parsed.xs.length === parsed.ys.length ? parsed.xs : null;
          predictionResult = null;
          draw();
        }
      });
    }

    const uploadBtn = document.getElementById('upload-base-btn');
    const baseFileInput = document.getElementById('base-file');
    if (uploadBtn && baseFileInput) {
      uploadBtn.addEventListener('click', () => {
        if (baseFileInput.files.length > 0) {
          const file = baseFileInput.files[0];
          const reader = new FileReader();
          reader.onload = (e) => {
            const raw = e.target.result;
            const parsed = parseSeriesText(raw);
            if (parsed.ys.length >= 2) {
              dataPoints = parsed.ys.map((v, i) => ({ x: i, y: v }));
              dataXs = parsed.xs && parsed.xs.length === parsed.ys.length ? parsed.xs : null;
              predictionResult = null;
              draw();
            }
          };
          reader.readAsText(file);
        }
      });
    }
  const loadSeriesBtn = document.getElementById('load-series-btn');
  if (loadSeriesBtn) {
    loadSeriesBtn.addEventListener('click', () => {
      importedSeries = [];
      for (let i = 1; i <= 5; i++) {
        const on = document.getElementById(`series-${i}-on`);
        const ta = document.getElementById(`series-${i}`);
        const w = document.getElementById(`series-${i}-weight`);
        if (!ta) continue;
        const raw = (ta.value || '').trim();
        if (!raw) continue;
        const parsed = parseSeriesText(raw);
        const ys = parsed.ys;
        if (ys.length >= 2 && (!on || on.checked)) {
          const item = { ys, weight: w ? parseFloat(w.value || '1') : 1 };
          if (parsed.xs && parsed.xs.length === ys.length) item.xs = parsed.xs;
          importedSeries.push(item);
        }
      }
      document.getElementById('canvas-hint').textContent = `${importedSeries.length} external series loaded`;
    });
  }
  for (let i = 1; i <= 5; i++) {
    const fileInput = document.getElementById(`series-${i}-file`);
    const uploadBtn = document.getElementById(`upload-series-${i}-btn`);
    const ta = document.getElementById(`series-${i}`);
    if (fileInput && uploadBtn && ta) {
      uploadBtn.addEventListener('click', () => {
        if (fileInput.files && fileInput.files.length > 0) {
          const reader = new FileReader();
          reader.onload = (e) => { ta.value = e.target.result || ''; };
          reader.readAsText(fileInput.files[0]);
        }
      });
    }
  }

  const eventsList = document.getElementById('events-list');
  const addEventBtn = document.getElementById('add-event-btn');
  const clearEventBtn = document.getElementById('clear-event-btn');
  const eventIndexInput = document.getElementById('event-index');
  const eventImpactInput = document.getElementById('event-impact');
  function renderEvents() {
    if (!eventsList) return;
    eventsList.innerHTML = events.map((ev, idx) => `
      <div class="weight-row">
        <span class="weight-label">t+${ev.index}</span>
        <div class="weight-bar-track"><div class="weight-bar" style="width:${Math.min(100, Math.abs(ev.impact) * 10)}%; background:#e8c547"></div></div>
        <span class="weight-pct">${ev.impact}</span>
        <button data-i="${idx}" class="preset-btn" style="padding:0.1rem 0.4rem">x</button>
      </div>
    `).join('');
    eventsList.querySelectorAll('button[data-i]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.getAttribute('data-i');
        events.splice(i, 1);
        renderEvents();
      });
    });
  }
  if (addEventBtn) {
    addEventBtn.addEventListener('click', () => {
      const idx = parseInt(eventIndexInput.value, 10);
      const imp = parseFloat(eventImpactInput.value);
      if (Number.isFinite(idx) && Number.isFinite(imp)) {
        events.push({ index: idx, impact: imp });
        renderEvents();
      }
    });
  }
  if (clearEventBtn) {
    clearEventBtn.addEventListener('click', () => {
      events = [];
      renderEvents();
    });
  }
  const exportBtn = document.getElementById('export-json-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!predictionResult) return;
      const payload = {
        predictions: predictionResult.predictions || [],
        predictedXs: predictionResult.predictedXs || null,
        diagnostics: predictionResult.diagnostics || {},
        scenarios: (predictionResult.scenarios || []).map(s => s.predictions || []),
        timestamp: Date.now(),
        mode: aggregator
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prediction.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
  const exportPngBtn = document.getElementById('export-png-btn');
  if (exportPngBtn) {
    exportPngBtn.addEventListener('click', () => {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = 'chart.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }
  const exportCsvBtn = document.getElementById('export-csv-btn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      if (!predictionResult) return;
      const n = (predictionResult.predictions || []).length;
      const header = ['x','ensemble','cyclic','trend','movingAvg','constraint'];
      const scCount = (predictionResult.scenarios || []).length;
      for (let i = 0; i < scCount; i++) header.push(`scenario${i+1}`);
      const rows = [header.join(',')];
      for (let i = 0; i < n; i++) {
        const x = Array.isArray(predictionResult.predictedXs) ? predictionResult.predictedXs[i] : (i + (dataPoints.length));
        const e = predictionResult.predictions[i] ?? '';
        const cy = (predictionResult.perspectives && predictionResult.perspectives.cyclic) ? predictionResult.perspectives.cyclic[i] ?? '' : '';
        const tr = (predictionResult.perspectives && predictionResult.perspectives.trend) ? predictionResult.perspectives.trend[i] ?? '' : '';
        const ma = (predictionResult.perspectives && predictionResult.perspectives.movingAvg) ? predictionResult.perspectives.movingAvg[i] ?? '' : '';
        const co = (predictionResult.perspectives && predictionResult.perspectives.constraint) ? predictionResult.perspectives.constraint[i] ?? '' : '';
        const row = [x, e, cy, tr, ma, co];
        (predictionResult.scenarios || []).forEach(sc => { row.push(sc.predictions ? (sc.predictions[i] ?? '') : ''); });
        rows.push(row.join(','));
      }
      const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'prediction.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
  const saveSessionBtn = document.getElementById('save-session-btn');
  const loadSessionBtn = document.getElementById('load-session-btn');
  if (saveSessionBtn) {
    saveSessionBtn.addEventListener('click', () => {
      const session = {
        dataPoints: dataPoints.map(p => p.y),
        dataXs: Array.isArray(dataXs) ? dataXs : null,
        importedSeries: importedSeries.map(s => ({ ys: s.ys, xs: s.xs || null, weight: s.weight || 1 })),
        events,
        predN,
        aggregator,
        quantileQ,
        scenariosCount,
        xAxisLabel,
        yAxisLabel,
        yScale,
        externalPreds,
        externalAlpha,
        customSetup,
        maxDrawPoints
      };
      try {
        localStorage.setItem('pattern_session', JSON.stringify(session));
        document.getElementById('canvas-hint').textContent = 'Session saved';
      } catch (_) {}
    });
  }
  if (loadSessionBtn) {
    loadSessionBtn.addEventListener('click', () => {
      try {
        const raw = localStorage.getItem('pattern_session');
        if (!raw) return;
        const s = JSON.parse(raw);
        if (Array.isArray(s.dataPoints)) {
          dataPoints = s.dataPoints.map((v, i) => ({ x: i, y: v }));
        }
        dataXs = Array.isArray(s.dataXs) ? s.dataXs : null;
        importedSeries = Array.isArray(s.importedSeries) ? s.importedSeries.map(it => ({ ys: it.ys || [], xs: it.xs || null, weight: it.weight || 1 })) : [];
        events = Array.isArray(s.events) ? s.events : [];
        predN = Number.isFinite(s.predN) ? s.predN : predN;
        aggregator = s.aggregator || aggregator;
        quantileQ = Number.isFinite(s.quantileQ) ? s.quantileQ : quantileQ;
        scenariosCount = Number.isFinite(s.scenariosCount) ? s.scenariosCount : scenariosCount;
        xAxisLabel = s.xAxisLabel || xAxisLabel;
        yAxisLabel = s.yAxisLabel || yAxisLabel;
        yScale = Number.isFinite(s.yScale) ? s.yScale : yScale;
        externalPreds = Array.isArray(s.externalPreds) ? s.externalPreds : [];
        externalAlpha = Number.isFinite(s.externalAlpha) ? s.externalAlpha : externalAlpha;
        customSetup = s.customSetup || customSetup;
        maxDrawPoints = Number.isFinite(s.maxDrawPoints) ? s.maxDrawPoints : maxDrawPoints;
        const scnSlider = document.getElementById('scenarios-count');
        const scnVal = document.getElementById('scn-val');
        if (scnSlider && scnVal) { scnSlider.value = String(scenariosCount); scnVal.textContent = String(scenariosCount); }
        const yScaleSlider = document.getElementById('y-scale');
        const yScaleVal = document.getElementById('yscale-val');
        if (yScaleSlider && yScaleVal) { yScaleSlider.value = String(yScale); yScaleVal.textContent = yScale.toFixed(2); }
        const alphaSlider = document.getElementById('alpha-slider');
        const alphaVal = document.getElementById('alpha-val');
        if (alphaSlider && alphaVal) { alphaSlider.value = String(externalAlpha); alphaVal.textContent = externalAlpha.toFixed(2); }
        document.getElementById('x-label').value = xAxisLabel;
        document.getElementById('y-label').value = yAxisLabel;
        predictionResult = null;
        renderEvents();
        applyCustomSetup(customSetup);
        updateDiagnosticsUI({ diagnostics: {}, weights: {} });
        draw();
      } catch (_) {}
    });
  }
  const equalWeightBtn = document.getElementById('equal-weight-btn');
  if (equalWeightBtn) {
    equalWeightBtn.addEventListener('click', () => {
      for (let i = 1; i <= 5; i++) {
        const input = document.getElementById(`series-${i}-weight`);
        if (input) input.value = '1';
      }
    });
  }
  const panelWrap = document.getElementById('perspective-panels');
  if (panelWrap) {
    panelWrap.querySelectorAll('.panel').forEach(el => {
      const k = el.getAttribute('data-persp');
      if (k && showPersp[k] !== undefined) {
        el.addEventListener('click', () => {
          showPersp[k] = !showPersp[k];
          el.classList.toggle('inactive', !showPersp[k]);
          draw();
        });
      }
    });
  }
  document.getElementById('run-btn').addEventListener('click', runForecast);
  document.getElementById('clear-btn').addEventListener('click', () => {
    dataPoints = [];
    predictionResult = null;
    clearDiagnostics();
    draw();
  });
  const setupSel = document.getElementById('custom-setup');
  if (setupSel) {
    setupSel.addEventListener('change', () => {
      customSetup = setupSel.value;
      applyCustomSetup(customSetup);
    });
  }
  const autoWeightBtn = document.getElementById('auto-weight-btn');
  if (autoWeightBtn) {
    autoWeightBtn.addEventListener('click', () => {
      autoComputeWeights();
    });
  }
  const extTA = document.getElementById('external-preds');
  const alphaSlider = document.getElementById('alpha-slider');
  const alphaVal = document.getElementById('alpha-val');
  if (alphaSlider && alphaVal) {
    alphaSlider.addEventListener('input', () => {
      externalAlpha = parseFloat(alphaSlider.value);
      alphaVal.textContent = externalAlpha.toFixed(2);
    });
  }
  const feedUrlInput = document.getElementById('feed-url');
  const feedIntervalInput = document.getElementById('feed-interval');
  const autoRunChk = document.getElementById('auto-run');
  if (autoRunChk) {
    autoRunChk.addEventListener('change', () => { autoRun = !!autoRunChk.checked; });
    autoRun = !!autoRunChk.checked;
  }
  const maxDrawSlider = document.getElementById('max-draw-points');
  const mdpVal = document.getElementById('mdp-val');
  if (maxDrawSlider && mdpVal) {
    maxDrawPoints = parseInt(maxDrawSlider.value, 10);
    mdpVal.textContent = maxDrawPoints.toString();
    maxDrawSlider.addEventListener('input', () => {
      maxDrawPoints = parseInt(maxDrawSlider.value, 10);
      mdpVal.textContent = maxDrawPoints.toString();
      draw();
    });
  }
  const startLiveBtn = document.getElementById('start-live');
  const stopLiveBtn = document.getElementById('stop-live');
  if (startLiveBtn) startLiveBtn.addEventListener('click', startLive);
  if (stopLiveBtn) stopLiveBtn.addEventListener('click', stopLive);
  const feedsList = document.getElementById('feeds-list');
  const addFeedRowBtn = document.getElementById('add-feed-row');
  const startAllFeedsBtn = document.getElementById('start-all-feeds');
  const stopAllFeedsBtn = document.getElementById('stop-all-feeds');
  const liveFeeds = [];
  function addFeedRow() {
    const idx = liveFeeds.length;
    const row = document.createElement('div');
    row.className = 'feed-row';
    row.innerHTML = `
      <input type="text" class="feed-url" placeholder="https://example.com/feed.json" style="flex:2"/>
      <input type="number" class="feed-interval" value="5" min="1" style="width:80px"/>
      <select class="feed-assign" style="width:130px">
        <option value="base">Base</option>
        <option value="series1">Series 1</option>
        <option value="series2">Series 2</option>
        <option value="series3">Series 3</option>
        <option value="series4">Series 4</option>
        <option value="series5">Series 5</option>
      </select>
      <input type="text" class="feed-xkey" placeholder="x" style="width:70px"/>
      <input type="text" class="feed-ykey" placeholder="y" style="width:70px"/>
      <label style="display:flex; align-items:center; gap:0.3rem"><input type="checkbox" class="feed-auto" checked/>Auto</label>
      <button class="preset-btn feed-start">Start</button>
      <button class="preset-btn feed-stop">Stop</button>
      <button class="preset-btn feed-remove">Remove</button>
    `;
    feedsList.appendChild(row);
    liveFeeds.push({ row, timer: null });
    const urlEl = row.querySelector('.feed-url');
    const intEl = row.querySelector('.feed-interval');
    const assignEl = row.querySelector('.feed-assign');
    const xEl = row.querySelector('.feed-xkey');
    const yEl = row.querySelector('.feed-ykey');
    const autoEl = row.querySelector('.feed-auto');
    const startEl = row.querySelector('.feed-start');
    const stopEl = row.querySelector('.feed-stop');
    const rmEl = row.querySelector('.feed-remove');
    const startOne = () => {
      const url = urlEl.value.trim();
      const intervalSec = parseInt(intEl.value || '5', 10);
      if (!url || !(intervalSec > 0)) return;
      const assign = assignEl.value;
      const xKey = xEl.value.trim() || 'x';
      const yKey = yEl.value.trim() || 'y';
      stopOne();
      fetchFeedGeneric(url, assign, xKey, yKey).catch(() => {});
      liveFeeds[idx].timer = setInterval(() => { fetchFeedGeneric(url, assign, xKey, yKey).catch(() => {}); }, intervalSec * 1000);
    };
    const stopOne = () => {
      if (liveFeeds[idx].timer) {
        clearInterval(liveFeeds[idx].timer);
        liveFeeds[idx].timer = null;
      }
    };
    startEl.addEventListener('click', startOne);
    stopEl.addEventListener('click', stopOne);
    rmEl.addEventListener('click', () => {
      stopOne();
      feedsList.removeChild(row);
      liveFeeds[idx].removed = true;
    });
    if (autoEl.checked) startOne();
  }
  function fetchFeedGeneric(url, assign, xKey, yKey) {
    return fetch(url, { cache: 'no-store' }).then(res => res.json()).then(data => {
      let xs = null, ys = null;
      if (Array.isArray(data)) {
        if (data.length && Array.isArray(data[0]) && data[0].length >= 2) {
          xs = data.map(p => Number(p[0])).filter(Number.isFinite);
          ys = data.map(p => Number(p[1])).filter(Number.isFinite);
        } else if (data.length && typeof data[0] === 'object') {
          xs = data.map(p => Number(p[xKey])).filter(Number.isFinite);
          ys = data.map(p => Number(p[yKey])).filter(Number.isFinite);
        } else {
          ys = data.map(Number).filter(Number.isFinite);
        }
      } else if (data && typeof data === 'object') {
        if (Array.isArray(data.values)) {
          ys = data.values.map(Number).filter(Number.isFinite);
        } else if (Array.isArray(data.series)) {
          ys = data.series.map(Number).filter(Number.isFinite);
        }
      }
      if (assign === 'base') {
        if (ys && ys.length > 0) {
          dataPoints = ys.map((v, i) => ({ x: i, y: v }));
          dataXs = xs && xs.length === ys.length ? xs : (useTimeAxis ? null : null);
          if (useTimeAxis && (!dataXs || dataXs.length !== ys.length)) ensureTimeXs();
          predictionResult = null;
          if (autoRun) runForecast(); else draw();
        }
      } else {
        const idx = parseInt(assign.replace('series', ''), 10) - 1;
        if (idx >= 0 && idx < 5 && ys && ys.length > 0) {
          const weightInput = document.getElementById(`series-${idx + 1}-weight`);
          const onInput = document.getElementById(`series-${idx + 1}-on`);
          if (onInput) onInput.checked = true;
          importedSeries[idx] = { ys, xs: xs && xs.length === ys.length ? xs : undefined, weight: weightInput ? parseFloat(weightInput.value || '1') : 1 };
          document.getElementById('canvas-hint').textContent = `${importedSeries.filter(s => s && s.ys && s.ys.length).length} external series loaded`;
          draw();
        }
      }
    });
  }
  if (addFeedRowBtn) addFeedRowBtn.addEventListener('click', addFeedRow);
  if (startAllFeedsBtn) startAllFeedsBtn.addEventListener('click', () => { liveFeeds.forEach((f, i) => { if (!f.removed) f.row.querySelector('.feed-start').click(); }); });
  if (stopAllFeedsBtn) stopAllFeedsBtn.addEventListener('click', () => { liveFeeds.forEach(f => { if (f.timer) { clearInterval(f.timer); f.timer = null; } }); });

  // ─── FORECAST ─────────────────────────────────────────────────────────────────

  function runForecast() {
    if (dataPoints.length < 4) {
      document.getElementById('canvas-hint').textContent = 'Need at least 4 points to forecast!';
      return;
    }
    const series = dataPoints.map(p => p.y);
    if (importedSeries.length > 0) {
      const lists = [series, ...importedSeries.map(s => s.ys)];
      const weights = [1, ...importedSeries.map(s => Number.isFinite(s.weight) ? s.weight : 1)];
      const opts = { aggregator, events };
      if (aggregator === 'weighted') opts.weights = weights;
      if (aggregator === 'quantile') opts.q = quantileQ;
      predictionResult = predictor.predictMulti(lists, predN, opts);
      if (Array.isArray(predictionResult.scenarios)) {
        predictionResult.scenarios.forEach((sc, i) => {
          if (i === 0 && Array.isArray(dataXs) && dataXs.length === series.length) {
            sc.predictedXs = predictFutureXs(dataXs, predN);
          } else {
            const src = importedSeries[i - 1];
            if (src && Array.isArray(src.xs) && src.xs.length === src.ys.length) {
              sc.predictedXs = predictFutureXs(src.xs, predN);
            }
          }
        });
      }
    } else if (scenariosCount > 1) {
      const lists = buildScenarios(series, scenariosCount);
      const opts = { aggregator, events };
      if (aggregator === 'quantile') opts.q = quantileQ;
      predictionResult = predictor.predictMulti(lists, predN, opts);
      if (Array.isArray(dataXs) && dataXs.length === series.length && Array.isArray(predictionResult.scenarios)) {
        const px = predictFutureXs(dataXs, predN);
        predictionResult.scenarios.forEach(sc => { sc.predictedXs = px.slice(); });
      }
    } else {
      predictionResult = predictor.predict(series, predN);
      if (predictionResult && predictionResult.predictions) {
        events.forEach(ev => {
          if (ev.index >= 0 && ev.index < predictionResult.predictions.length) {
            predictionResult.predictions[ev.index] += ev.impact;
          }
        });
      }
    }
    if (Array.isArray(dataXs) && dataXs.length === series.length) {
      predictionResult.predictedXs = useTimeAxis ? Array.from({ length: predN }, (_, i) => dataXs[dataXs.length - 1] + timeFrameMs(timeFrame) * (i + 1)) : predictFutureXs(dataXs, predN);
    }
    if (extTA) {
      externalPreds = parseExternalPreds(extTA.value.trim());
      if (externalPreds.length >= predN && externalAlpha > 0) {
        predictionResult.predictions = predictionResult.predictions.map((v, i) => externalAlpha * externalPreds[i] + (1 - externalAlpha) * v);
      }
    }
    updateDiagnosticsUI(predictionResult);
    draw();
  }

  // ─── DIAGNOSTICS UI ───────────────────────────────────────────────────────────

  function updateDiagnosticsUI(result) {
    const d = result.diagnostics || {};
    const w = result.weights || {};

    document.getElementById('d-type').textContent = (d.type || '—').toString().toUpperCase();
    document.getElementById('d-period').textContent = d.period !== undefined && d.period > 0 ? d.period : (d.aggregator ? d.aggregator : 'none');
    document.getElementById('d-amp').textContent = d.amplitude !== undefined ? d.amplitude.toFixed(3) : '—';
    document.getElementById('d-slope').textContent = d.slope !== undefined ? d.slope.toFixed(4) : '—';
    document.getElementById('d-cycles').textContent = d.cycles !== undefined ? d.cycles.toFixed(1) : (d.seriesCount !== undefined ? d.seriesCount : '—');
    document.getElementById('d-conf').textContent = d.confidence !== undefined ? (d.confidence * 100).toFixed(0) + '%' : '—';

    const weightsDom = document.getElementById('weights-display');
    if (result.weights) {
      const wEntries = [
        { label: 'Cyclic', key: 'cyclic', color: '#4fe3c1' },
        { label: 'Trend', key: 'trend', color: '#e87d4f' },
        { label: 'Mov Avg', key: 'movingAvg', color: '#a78bfa' },
        { label: 'Constraint', key: 'constraint', color: '#f472b6' }
      ];
      weightsDom.innerHTML = wEntries.map(e => `
        <div class="weight-row">
          <span class="weight-label">${e.label}</span>
          <div class="weight-bar-track">
            <div class="weight-bar" style="width:${(w[e.key] * 100).toFixed(1)}%; background:${e.color}"></div>
          </div>
          <span class="weight-pct">${(w[e.key] * 100).toFixed(0)}%</span>
        </div>
      `).join('');
    } else {
      weightsDom.innerHTML = `<div class="weight-row"><span class="weight-label">Mode</span><div class="weight-bar-track"><div class="weight-bar" style="width:100%; background:#e8c547"></div></div><span class="weight-pct">${(d.aggregator || 'avg').toString()}</span></div>`;
    }
    updateSeriesLegend();
  }

  function clearDiagnostics() {
    ['d-type', 'd-period', 'd-amp', 'd-slope', 'd-cycles', 'd-conf'].forEach(id => {
      document.getElementById(id).textContent = '—';
    });
    document.getElementById('weights-display').innerHTML = '';
    const legendEl = document.getElementById('series-legend');
    if (legendEl) legendEl.innerHTML = '';
  }
  function updateSeriesLegend() {
    const legendEl = document.getElementById('series-legend');
    if (!legendEl) return;
    const cols = ['#80ed99', '#ffc300', '#da2c38', '#007bff', '#6a0572'];
    if (importedSeries.length === 0) {
      legendEl.innerHTML = `<div class="legend-item"><span>No external series loaded</span></div>`;
      return;
    }
    legendEl.innerHTML = importedSeries.map((s, i) => {
      const c = cols[i % cols.length];
      const w = Number.isFinite(s.weight) ? s.weight : 1;
      const hasXs = Array.isArray(s.xs);
      return `<div class="legend-item"><span class="legend-swatch" style="background:${c}"></span><span>Series ${i+1}${hasXs ? ' [x,y]': ''}</span><span style="margin-left:auto">W:${w}</span></div>`;
    }).join('');
  }
  const tooltipEl = document.getElementById('hover-tooltip');
  canvas.addEventListener('mousemove', (e) => {
    if (!tooltipEl) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const series = dataPoints.map(p => p.y);
    const allValues = getDisplayValues();
    const rct = getCanvasRect();
    const candidates = [];
    // base points
    for (let i = 0; i < series.length; i++) {
      if (Array.isArray(dataXs) && dataXs.length === series.length) {
        const x = mapX(dataXs[i], rct, Math.min(...(getAllXs() || dataXs)), Math.max(...(getAllXs() || dataXs)));
        const { y } = toScreen(i, series[i], allValues);
        candidates.push({ x, y, label: `base x:${dataXs[i]} y:${series[i].toFixed(2)}` });
      } else {
        const { x, y } = toScreen(i, series[i], allValues);
        candidates.push({ x, y, label: `base t:${i} y:${series[i].toFixed(2)}` });
      }
    }
    // ensemble predictions
    if (predictionResult && Array.isArray(predictionResult.predictions)) {
      const preds = predictionResult.predictions;
      for (let i = 0; i < preds.length; i++) {
        if (Array.isArray(predictionResult.predictedXs)) {
          const x = mapX(predictionResult.predictedXs[i], rct, Math.min(...(getAllXs() || predictionResult.predictedXs)), Math.max(...(getAllXs() || predictionResult.predictedXs)));
          const { y } = toScreen(series.length + i, preds[i], allValues);
          candidates.push({ x, y, label: `ensemble x:${predictionResult.predictedXs[i]} y:${preds[i].toFixed(2)}` });
        } else {
          const { x, y } = toScreen(series.length + i, preds[i], allValues);
          candidates.push({ x, y, label: `ensemble t+${i+1} y:${preds[i].toFixed(2)}` });
        }
      }
    }
    // nearest
    let best = null; let bestD = 999999;
    candidates.forEach(pt => {
      const dx = pt.x - cx, dy = pt.y - cy;
      const d = Math.sqrt(dx*dx + dy*dy);
      if (d < bestD) { bestD = d; best = pt; }
    });
    if (best && bestD < 16) {
      tooltipEl.style.left = Math.round(best.x) + 'px';
      tooltipEl.style.top = Math.round(best.y) + 'px';
      tooltipEl.textContent = best.label;
      tooltipEl.style.display = 'block';
    } else {
      tooltipEl.style.display = 'none';
    }
  });
  canvas.addEventListener('mouseleave', () => {
    if (tooltipEl) tooltipEl.style.display = 'none';
  });

  function buildScenarios(series, count) {
    const out = [];
    const mavg = (arr, w) => {
      const res = [];
      for (let i = 0; i < arr.length; i++) {
        const s = Math.max(0, i - Math.floor(w / 2));
        const e = Math.min(arr.length, i + Math.ceil(w / 2));
        const seg = arr.slice(s, e);
        res.push(seg.reduce((a, b) => a + b, 0) / seg.length);
      }
      return res;
    };
    if (customSetup === 'markets') {
      out.push(series);
      if (count >= 2) out.push(mavg(series, 5));
      if (count >= 3) out.push(mavg(series, 10));
      if (count >= 4) out.push(series.map(v => v * 0.98));
      if (count >= 5) out.push(series.map(v => v * 1.02));
    } else if (customSetup === 'crypto') {
      out.push(series.map(v => v));
      if (count >= 2) out.push(mavg(series, 3));
      if (count >= 3) out.push(mavg(series, 7));
      if (count >= 4) out.push(series.map(v => v * 0.9));
      if (count >= 5) out.push(series.map(v => v * 1.1));
    } else if (customSetup === 'data') {
      out.push(mavg(series, 3));
      if (count >= 2) out.push(mavg(series, 5));
      if (count >= 3) out.push(mavg(series, 9));
      if (count >= 4) out.push(series.map(v => v * 0.97));
      if (count >= 5) out.push(series.map(v => v * 1.03));
    } else {
      out.push(series);
      if (count >= 2) out.push(mavg(series, 3));
      if (count >= 3) out.push(mavg(series, 5));
      if (count >= 4) out.push(series.map(v => v * 0.95));
      if (count >= 5) out.push(series.map(v => v * 1.05));
    }
    return out.slice(0, count);
  }
  function parseSeriesText(raw) {
    // returns { xs: number[]|null, ys: number[] }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        if (parsed.length && Array.isArray(parsed[0]) && parsed[0].length >= 2) {
          const xs = parsed.map(p => Number(p[0])).filter(v => Number.isFinite(v));
          const ys = parsed.map(p => Number(p[1])).filter(v => Number.isFinite(v));
          return { xs: xs.length === ys.length ? xs : null, ys };
        }
        if (parsed.length && typeof parsed[0] === 'object' && parsed[0] !== null && 'x' in parsed[0] && 'y' in parsed[0]) {
          const xs = parsed.map(p => Number(p.x)).filter(v => Number.isFinite(v));
          const ys = parsed.map(p => Number(p.y)).filter(v => Number.isFinite(v));
          return { xs: xs.length === ys.length ? xs : null, ys };
        }
        const ys = parsed.map(Number).filter(v => Number.isFinite(v));
        return { xs: null, ys };
      }
    } catch (_) {}
    // CSV / whitespace
    const lines = raw.split(/\n+/).map(s => s.trim()).filter(Boolean);
    const xs = [];
    const ys = [];
    let pairFound = false;
    lines.forEach(line => {
      const parts = line.split(/[\s,;]+/).filter(Boolean);
      if (parts.length >= 2) {
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          xs.push(x); ys.push(y); pairFound = true;
        }
      } else if (parts.length === 1) {
        const y = Number(parts[0]);
        if (Number.isFinite(y)) ys.push(y);
      }
    });
    if (pairFound && xs.length === ys.length) return { xs, ys };
    if (ys.length > 0) return { xs: null, ys };
    // fallback: split whole raw
    const nums = raw.split(/[\s,;]+/).map(Number).filter(v => Number.isFinite(v));
    return { xs: null, ys: nums };
  }
  function predictFutureXs(xs, n) {
    if (!xs || xs.length < 2) return Array.from({ length: n }, (_, i) => xs && xs.length ? xs[xs.length - 1] + (i + 1) : i + 1);
    const diffs = [];
    for (let i = 1; i < xs.length; i++) diffs.push(xs[i] - xs[i - 1]);
    const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const start = xs[xs.length - 1];
    return Array.from({ length: n }, (_, i) => start + avg * (i + 1));
  }
  function applyCustomSetup(name) {
    if (name === 'markets') {
      aggregator = 'median';
      scenariosCount = Math.max(3, scenariosCount);
    } else if (name === 'crypto') {
      aggregator = 'quantile';
      quantileQ = 0.75;
      scenariosCount = 5;
    } else if (name === 'data') {
      aggregator = 'average';
      scenariosCount = Math.max(3, scenariosCount);
    } else {
      aggregator = 'average';
    }
    if (document.getElementById('scenarios-count')) {
      document.getElementById('scenarios-count').value = String(scenariosCount);
      document.getElementById('scn-val').textContent = String(scenariosCount);
    }
    const map = {
      average: 'agg-average',
      median: 'agg-median',
      mode: 'agg-mode',
      weighted: 'agg-weighted',
      quantile: 'agg-quantile'
    };
    const id = map[aggregator];
    if (id) {
      document.querySelectorAll('[data-agg]').forEach(b => b.classList.remove('active'));
      const el = document.getElementById(id);
      if (el) el.classList.add('active');
    }
  }
  function autoComputeWeights() {
    if (importedSeries.length === 0) return;
    const base = dataPoints.map(p => p.y);
    const basePred = predictor.predict(base, Math.max(3, predN));
    const baseStd = std(basePred.predictions || []);
    const weights = [];
    importedSeries.forEach((s, idx) => {
      const r = predictor.predict(s.ys, Math.max(3, predN));
      const sstd = std(r.predictions || []);
      const w = clamp((baseStd || 1) / (sstd || 1), 0.1, 3);
      weights.push(w);
      const input = document.getElementById(`series-${idx + 1}-weight`);
      if (input) input.value = String(w.toFixed(2));
    });
  }
  function std(arr) {
    if (!arr || arr.length === 0) return 0;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
    return Math.sqrt(v);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function parseExternalPreds(raw) {
    if (!raw) return [];
    try {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) return j.map(Number).filter(Number.isFinite);
    } catch (_) {}
    return raw.split(/[\s,;]+/).map(Number).filter(Number.isFinite);
  }
  async function fetchFeedOnce(url) {
    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();
    if (Array.isArray(data)) {
      if (data.length && Array.isArray(data[0]) && data[0].length >= 2) {
        const xs = data.map(p => Number(p[0])).filter(Number.isFinite);
        const ys = data.map(p => Number(p[1])).filter(Number.isFinite);
        if (xs.length === ys.length && ys.length > 0) {
          dataXs = xs;
          dataPoints = ys.map((v, i) => ({ x: i, y: v }));
        }
      } else if (data.length && typeof data[0] === 'object' && data[0] && 'x' in data[0] && 'y' in data[0]) {
        const xs = data.map(p => Number(p.x)).filter(Number.isFinite);
        const ys = data.map(p => Number(p.y)).filter(Number.isFinite);
        if (xs.length === ys.length && ys.length > 0) {
          dataXs = xs;
          dataPoints = ys.map((v, i) => ({ x: i, y: v }));
        }
      } else {
        const ys = data.map(Number).filter(Number.isFinite);
        if (ys.length > 0) {
          dataPoints = ys.map((v, i) => ({ x: i, y: v }));
          dataXs = null;
        }
      }
    } else if (data && typeof data === 'object') {
      if (Array.isArray(data.values)) {
        const ys = data.values.map(Number).filter(Number.isFinite);
        dataPoints = ys.map((v, i) => ({ x: i, y: v }));
        dataXs = null;
      } else if (Array.isArray(data.series)) {
        const ys = data.series.map(Number).filter(Number.isFinite);
        dataPoints = ys.map((v, i) => ({ x: i, y: v }));
        dataXs = null;
      }
    }
    predictionResult = null;
    if (autoRun) runForecast(); else draw();
  }
  function startLive() {
    const url = (feedUrlInput && feedUrlInput.value) || '';
    const intervalSec = parseInt(feedIntervalInput && feedIntervalInput.value || '5', 10);
    if (!url || !(intervalSec > 0)) return;
    stopLive();
    fetchFeedOnce(url).catch(() => {});
    liveTimer = setInterval(() => { fetchFeedOnce(url).catch(() => {}); }, intervalSec * 1000);
  }
  function stopLive() {
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
  }
  // ─── INIT ─────────────────────────────────────────────────────────────────────

  resize();
  loadPreset('sine');

})();
