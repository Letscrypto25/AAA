/**
 * Pattern-Based Time Series Predictor Engine
 * Multi-perspective ensemble forecasting
 */

class PatternPredictor {
  constructor() {
    this.history = []; // stores prediction errors for feedback loop
  }

  /**
   * Main entry: analyze series and predict next N points
   * @param {number[]} series - array of values
   * @param {number} n - how many points to predict
   * @returns {object} { predictions, diagnostics, perspectives }
   */
  predict(series, n = 3) {
    if (series.length < 4) {
      return { predictions: [], diagnostics: { type: 'insufficient_data' }, perspectives: {} };
    }

    const diagnostics = this.analyzeSeries(series);
    const perspectives = this.computePerspectives(series, diagnostics, n);
    const weights = this.computeWeights(diagnostics, perspectives);
    const predictions = this.ensembleCombine(perspectives, weights, n);

    // Apply constraint clamping
    const { lower, upper } = diagnostics.constraints;
    const clamped = predictions.map(v => {
      let val = v;
      if (lower !== null) val = Math.max(val, lower - (upper - lower) * 0.05);
      if (upper !== null) val = Math.min(val, upper + (upper - lower) * 0.05);
      return val;
    });

    return { predictions: clamped, diagnostics, perspectives, weights };
  }

  predictMulti(seriesList, n = 3, options = {}) {
    const agg = options.aggregator || 'average';
    const weights = Array.isArray(options.weights) ? options.weights : [];
    const perSeries = seriesList.map(s => this.predict(s, n));
    const matrix = perSeries.map(r => r.predictions || Array(n).fill(0));
    const cols = Array.from({ length: n }, (_, i) => matrix.map(row => row[i] ?? 0));
    const final = cols.map((col, idx) => {
      if (agg === 'median') return this._median(col);
      if (agg === 'mode') return this._mode(col);
      if (agg === 'quantile') return this._quantile(col, typeof options.q === 'number' ? options.q : 0.5);
      if (agg === 'weighted' && weights.length === matrix.length) return this._weighted(col, weights);
      return this._average(col);
    });
    const adj = this._applyEvents(final, options.events || []);
    const perStepStd = cols.map(col => {
      const m = this._average(col);
      const v = this._average(col.map(v => (v - m) * (v - m)));
      return Math.sqrt(v);
    });
    const avgStd = this._average(perStepStd);
    const conf = Math.max(0, Math.min(1, 1 / (1 + avgStd)));
    let finalPreds = adj;
    if (typeof options.externalPredictor === 'function') {
      try {
        const ext = options.externalPredictor(seriesList[0], n) || [];
        const alpha = typeof options.alpha === 'number' ? Math.max(0, Math.min(1, options.alpha)) : 0.5;
        if (Array.isArray(ext) && ext.length >= n) {
          finalPreds = finalPreds.map((v, i) => alpha * ext[i] + (1 - alpha) * v);
        }
      } catch (_) {}
    }
    return { predictions: finalPreds, diagnostics: { type: 'multi', aggregator: agg, seriesCount: seriesList.length, std: avgStd, confidence: conf }, scenarios: perSeries };
  }

  // ─── PATTERN IDENTIFICATION ──────────────────────────────────────────────────

  analyzeSeries(series) {
    const n = series.length;
    const mean = series.reduce((a, b) => a + b, 0) / n;
    const variance = series.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
    const std = Math.sqrt(variance);

    // Linear trend via least-squares
    const slope = this.linearSlope(series);
    const detrended = series.map((v, i) => v - slope * i);

    // Autocorrelation to detect period
    const acf = this.autocorrelation(detrended, Math.min(Math.floor(n / 2), 30));
    const period = this.detectPeriod(acf);

    // Amplitude: half of peak-to-peak
    const amplitude = (Math.max(...series) - Math.min(...series)) / 2;

    // Cycles completed (approx)
    const cycles = period > 0 ? n / period : 0;

    // Pattern type classification
    const trendStrength = Math.abs(slope) / (std + 1e-9);
    const cyclicStrength = period > 0 ? this.cyclicStrength(detrended, period) : 0;
    const stationarity = std < 0.1 * (Math.abs(mean) + 1e-9) ? 1 : 0;

    let type;
    if (trendStrength > 0.5 && cyclicStrength > 0.4) type = 'seasonal';
    else if (cyclicStrength > 0.4) type = 'cyclic';
    else if (trendStrength > 0.5) type = 'trend';
    else if (stationarity > 0) type = 'stationary';
    else type = 'noisy';

    // Confidence: based on cycles completed + cyclic strength + trend consistency
    const confidence = Math.min(1, (
      Math.min(cycles / 3, 0.4) +
      cyclicStrength * 0.4 +
      Math.min(trendStrength * 0.2, 0.2)
    ));

    // Constraints: observed min/max with small buffer
    const constraints = {
      lower: Math.min(...series),
      upper: Math.max(...series)
    };

    // Temporal position within cycle
    const cyclicPosition = period > 0 ? (n % period) : 0;

    return {
      type, period, amplitude, slope, cycles,
      confidence, constraints, cyclicStrength,
      trendStrength, mean, std, acf, cyclicPosition,
      n
    };
  }

  linearSlope(series) {
    const n = series.length;
    const xs = Array.from({ length: n }, (_, i) => i);
    const xMean = (n - 1) / 2;
    const yMean = series.reduce((a, b) => a + b, 0) / n;
    const num = xs.reduce((acc, x, i) => acc + (x - xMean) * (series[i] - yMean), 0);
    const den = xs.reduce((acc, x) => acc + (x - xMean) ** 2, 0);
    return den === 0 ? 0 : num / den;
  }

  autocorrelation(series, maxLag) {
    const n = series.length;
    const mean = series.reduce((a, b) => a + b, 0) / n;
    const variance = series.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
    if (variance === 0) return Array(maxLag + 1).fill(0);
    const acf = [1]; // lag 0
    for (let lag = 1; lag <= maxLag; lag++) {
      let cov = 0;
      for (let i = 0; i < n - lag; i++) {
        cov += (series[i] - mean) * (series[i + lag] - mean);
      }
      acf.push(cov / ((n - lag) * variance));
    }
    return acf;
  }

  detectPeriod(acf) {
    // Find the first significant positive peak after lag 2
    let bestLag = 0;
    let bestVal = -Infinity;
    for (let lag = 2; lag < acf.length; lag++) {
      if (acf[lag] > bestVal && acf[lag] > 0.2) {
        // Check it's a local max
        const prev = acf[lag - 1] ?? -1;
        const next = acf[lag + 1] ?? -1;
        if (acf[lag] >= prev && acf[lag] >= next) {
          bestVal = acf[lag];
          bestLag = lag;
        }
      }
    }
    return bestLag;
  }

  cyclicStrength(series, period) {
    if (period < 2) return 0;
    // Measure consistency of cycles via correlation between adjacent cycles
    const n = series.length;
    if (n < period * 2) return 0.2; // weak evidence
    const cycle1 = series.slice(0, period);
    const cycle2 = series.slice(period, period * 2);
    return Math.max(0, this.pearsonCorr(cycle1, cycle2));
  }

  pearsonCorr(a, b) {
    const n = Math.min(a.length, b.length);
    const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
    const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
    let num = 0, dA = 0, dB = 0;
    for (let i = 0; i < n; i++) {
      num += (a[i] - meanA) * (b[i] - meanB);
      dA += (a[i] - meanA) ** 2;
      dB += (b[i] - meanB) ** 2;
    }
    return dA * dB === 0 ? 0 : num / Math.sqrt(dA * dB);
  }

  // ─── PERSPECTIVE GENERATORS ──────────────────────────────────────────────────

  computePerspectives(series, diag, n) {
    return {
      cyclic: this.perspectiveCyclic(series, diag, n),
      trend: this.perspectiveTrend(series, diag, n),
      movingAvg: this.perspectiveMovingAvg(series, diag, n),
      constraint: this.perspectiveConstraint(series, diag, n)
    };
  }

  perspectiveCyclic(series, diag, n) {
    const { period, slope, n: len } = diag;
    if (period < 2) {
      // Fallback: repeat last cycle of 4
      return Array.from({ length: n }, (_, i) => series[len - 4 + ((i) % 4)] || series[len - 1]);
    }
    // Detrend, pick values at matching cyclic positions
    const predictions = [];
    for (let i = 0; i < n; i++) {
      const pos = (len + i) % period;
      // Collect all historical values at this cyclic position
      const matches = [];
      for (let j = pos; j < len; j += period) {
        matches.push(series[j] - slope * j);
      }
      const base = matches.length > 0
        ? matches.reduce((a, b) => a + b, 0) / matches.length
        : series[len - 1];
      // Re-add trend
      predictions.push(base + slope * (len + i));
    }
    return predictions;
  }

  perspectiveTrend(series, diag, n) {
    const { slope, mean, n: len } = diag;
    // Linear extrapolation from last point
    const intercept = mean - slope * ((len - 1) / 2);
    return Array.from({ length: n }, (_, i) => intercept + slope * (len + i));
  }

  perspectiveMovingAvg(series, diag, n) {
    const window = Math.max(3, Math.min(Math.floor(diag.period || 5), 8));
    const recent = series.slice(-window);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    // Extend with slope bias
    return Array.from({ length: n }, (_, i) => avg + diag.slope * (i + 1) * 0.5);
  }

  perspectiveConstraint(series, diag, n) {
    const { lower, upper } = diag.constraints;
    const range = upper - lower;
    const last = series[series.length - 1];
    // Predict regression to mean if near bounds
    const mid = (lower + upper) / 2;
    return Array.from({ length: n }, (_, i) => {
      const t = (i + 1) / (n + 1);
      return last + (mid - last) * t * 0.4;
    });
  }

  // ─── WEIGHTS & ENSEMBLE ──────────────────────────────────────────────────────

  computeWeights(diag, perspectives) {
    const { type, cyclicStrength, trendStrength, cycles, confidence } = diag;

    let wCyclic = 0.1;
    let wTrend = 0.1;
    let wMovingAvg = 0.4;
    let wConstraint = 0.4;

    if (type === 'cyclic' || type === 'seasonal') {
      wCyclic = 0.5 * cyclicStrength;
      wTrend = type === 'seasonal' ? 0.2 * trendStrength : 0.05;
      wMovingAvg = 0.2;
      wConstraint = 0.1;
    } else if (type === 'trend') {
      wTrend = 0.55;
      wMovingAvg = 0.3;
      wCyclic = 0.05;
      wConstraint = 0.1;
    } else if (type === 'stationary') {
      wMovingAvg = 0.5;
      wConstraint = 0.3;
      wTrend = 0.1;
      wCyclic = 0.1;
    } else { // noisy
      wMovingAvg = 0.45;
      wConstraint = 0.35;
      wTrend = 0.1;
      wCyclic = 0.1;
    }

    // Scale cyclic weight by number of cycles observed
    wCyclic *= Math.min(1, cycles / 2);

    const total = wCyclic + wTrend + wMovingAvg + wConstraint;
    return {
      cyclic: wCyclic / total,
      trend: wTrend / total,
      movingAvg: wMovingAvg / total,
      constraint: wConstraint / total
    };
  }

  ensembleCombine(perspectives, weights, n) {
    return Array.from({ length: n }, (_, i) => {
      return (
        (perspectives.cyclic[i] || 0) * weights.cyclic +
        (perspectives.trend[i] || 0) * weights.trend +
        (perspectives.movingAvg[i] || 0) * weights.movingAvg +
        (perspectives.constraint[i] || 0) * weights.constraint
      );
    });
  }

  _average(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
    }

  _median(arr) {
    if (arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  _mode(arr) {
    if (arr.length === 0) return 0;
    const counts = new Map();
    arr.forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
    let best = arr[0], bestC = 0;
    counts.forEach((c, v) => { if (c > bestC) { best = v; bestC = c; } });
    return best;
  }

  _weighted(arr, weights) {
    if (arr.length === 0) return 0;
    const wsum = weights.reduce((a, b) => a + b, 0) || 1;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i] * (weights[i] || 0);
    return s / wsum;
  }

  _applyEvents(preds, events) {
    if (!events || events.length === 0) return preds;
    const out = preds.slice();
    events.forEach(ev => {
      const idx = ev.index ?? 0;
      const impact = ev.impact ?? 0;
      if (idx >= 0 && idx < out.length) out[idx] += impact;
    });
    return out;
  }
  _quantile(arr, q) {
    if (!arr || arr.length === 0) return 0;
    const s = [...arr].sort((a, b) => a - b);
    const pos = (s.length - 1) * Math.min(Math.max(q, 0), 1);
    const base = Math.floor(pos);
    const frac = pos - base;
    if (s[base + 1] !== undefined) return s[base] + frac * (s[base + 1] - s[base]);
    return s[base];
  }

  // ─── FEEDBACK LOOP ───────────────────────────────────────────────────────────

  recordFeedback(predicted, actual) {
    const errors = predicted.map((p, i) => actual[i] !== undefined ? Math.abs(p - actual[i]) : null).filter(e => e !== null);
    this.history.push({ errors, timestamp: Date.now() });
    if (this.history.length > 50) this.history.shift();
  }

  averageError() {
    if (this.history.length === 0) return null;
    const allErrors = this.history.flatMap(h => h.errors);
    return allErrors.reduce((a, b) => a + b, 0) / allErrors.length;
  }
}

if (typeof window !== 'undefined') window.PatternPredictor = PatternPredictor;
if (typeof module !== 'undefined' && module.exports) module.exports = PatternPredictor;
if (typeof define === 'function' && define.amd) define(function () { return PatternPredictor; });
