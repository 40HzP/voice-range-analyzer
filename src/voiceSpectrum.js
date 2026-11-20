/* ════════════════════════════════════════════
   Voice Spectrum — 最低音と最高音の発声を FFT で比べる
   ════════════════════════════════════════════
   測定中に記録した数フレーム分の波形を FFT にかけ、
   倍音ごとの強さから「声帯の閉じ方・音色・息漏れ」の目安を出す。
   ブラウザ内だけで完結する（外部送信なし）。 */

export const MAX_HZ = 8000;          // 解析する上限
export const TILT_MAX_HZ = 5000;     // 傾きを測る上限
export const BAND_HZ = [2000, 4000]; // 響き帯域（シンガーズフォルマント付近）

/* ─── FFT ─── */

const hannCache = new Map();
function hann(n) {
  let w = hannCache.get(n);
  if (!w) {
    w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    hannCache.set(n, w);
  }
  return w;
}

/** in-place radix-2 FFT（re, im は長さ 2^m） */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const cr = Math.cos(ang * j), ci = Math.sin(ang * j);
        const a = i + j, b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
      }
    }
  }
}

/** DC除去 → Hann窓 → FFT → パワースペクトル（0〜ナイキスト） */
function powerSpectrum(buf) {
  let n = 1;
  while (n * 2 <= buf.length) n *= 2;
  const w = hann(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = (buf[i] - mean) * w[i];
  fft(re, im);
  const p = new Float64Array(n / 2 + 1);
  for (let k = 0; k <= n / 2; k++) p[k] = re[k] * re[k] + im[k] * im[k];
  return { p, n };
}

const toDb = (p) => 10 * Math.log10(p + 1e-20);
const fromDb = (d) => Math.pow(10, d / 10);

/** center（bin）付近の最大値を放物線補間で求める */
function peakAt(pdb, center, hw) {
  const lo = Math.max(1, Math.floor(center - hw));
  const hi = Math.min(pdb.length - 2, Math.ceil(center + hw));
  let m = lo;
  for (let i = lo + 1; i <= hi; i++) if (pdb[i] > pdb[m]) m = i;
  const a = pdb[m - 1], b = pdb[m], c = pdb[m + 1];
  const den = a - 2 * b + c;
  const d = den < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den)) : 0;
  return { db: b - 0.25 * (a - c) * d, bin: m + d };
}

/** center（bin）±hw のパワー平均（dB） */
function levelAround(p, center, hw) {
  const lo = Math.max(1, Math.round(center - hw));
  const hi = Math.min(p.length - 1, Math.round(center + hw));
  let s = 0, c = 0;
  for (let i = lo; i <= hi; i++) { s += p[i]; c++; }
  return toDb(c ? s / c : 0);
}

/**
 * HNR（dB）。2周期ぶんの短い区間ごとに、周期 ±5% の範囲で一番よく重なるずれ幅を探して
 * 正規化相関を取り、区間平均する（ビブラートで周期が揺れても下がりすぎないように）
 */
function hnrOf(buf, f0, sr) {
  const n = buf.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  const T0 = sr / f0;
  const Lw = Math.max(Math.round(2 * T0), 480);
  const tMin = Math.max(2, Math.floor(T0 * 0.95)), tMax = Math.ceil(T0 * 1.05) + 1;
  if (tMax + Lw > n) return null;
  const corr = (st, T) => {
    let xy = 0, xx = 0, yy = 0;
    for (let i = st; i < st + Lw; i++) {
      const a = buf[i] - mean, b = buf[i + T] - mean;
      xy += a * b; xx += a * a; yy += b * b;
    }
    return xy / Math.sqrt(xx * yy + 1e-20);
  };
  let sum = 0, cnt = 0;
  for (let st = 0; st + tMax + Lw <= n; st += Math.round(Lw / 2)) {
    const rs = [];
    for (let T = tMin - 1; T <= tMax; T++) rs.push(corr(st, T));
    let m = 1;
    for (let i = 2; i < rs.length - 1; i++) if (rs[i] > rs[m]) m = i;
    const a = rs[m - 1], b = rs[m], c = rs[m + 1];
    const den = a - 2 * b + c;
    const best = den < 0 ? b - ((a - c) * (a - c)) / (8 * den) : b;
    const r = Math.min(0.9999, Math.max(1e-4, best));
    sum += 10 * Math.log10(r / (1 - r)); cnt++;
  }
  return cnt ? sum / cnt : null;
}

/* ─── 1フレーム分の倍音解析 ─── */

function analyzeFrame(buf, f0, sr) {
  const { p, n } = powerSpectrum(buf);
  const binHz = sr / n;
  const pdb = new Float64Array(p.length);
  for (let i = 0; i < p.length; i++) pdb[i] = toDb(p[i]);

  const perBin = f0 / binHz;
  const hw = Math.max(1.5, 0.2 * perBin);
  const harmonics = [];
  let est = perBin; // 倍音の位置から f0 を少しずつ補正する（高次倍音のずれ対策）
  for (let k = 1; k * est * binHz <= Math.min(MAX_HZ, sr / 2 - binHz) && k <= 200; k++) {
    const pk = peakAt(pdb, k * est, hw);
    harmonics.push({ k, bin: pk.bin, db: pk.db });
    const ratio = pk.bin / k / est;
    if (Math.abs(ratio - 1) < 0.03) est = est * 0.7 + (pk.bin / k) * 0.3;
  }

  // 倍音と倍音のあいだ（k+0.5 の位置）の強さ。k=0 は基音の下
  const between = [];
  const bw = Math.max(1, 0.12 * perBin);
  for (let k = 0; k < harmonics.length; k++) {
    const lowBin = k === 0 ? 0 : harmonics[k - 1].bin;
    const highBin = harmonics[k].bin;
    const mid = k === 0 ? highBin / 2 : (lowBin + highBin) / 2;
    between.push(levelAround(p, mid, bw));
  }
  const last = harmonics[harmonics.length - 1];
  if (last) between.push(levelAround(p, last.bin + perBin / 2, bw));

  // 倍音のちょうど中間（k+0.5）の山と、その両脇（k+0.25, k+0.75）の谷。
  // 中間に山が立っていれば、検出した音の半分の周波数の振動が重なっている
  const half = [];
  const hw2 = Math.max(1, 0.06 * perBin), qw = Math.max(0.5, 0.04 * perBin);
  for (let k = 1; k < Math.min(harmonics.length, 12); k++) {
    const a = harmonics[k - 1].bin, b = harmonics[k].bin;
    half.push({
      peak: peakAt(pdb, (a + b) / 2, hw2).db,
      quarter: (levelAround(p, (3 * a + b) / 4, qw) + levelAround(p, (a + 3 * b) / 4, qw)) / 2,
    });
  }

  return { p, binHz, harmonics, between, half, hnr: hnrOf(buf, f0, sr), hnr2: hnrOf(buf, f0 / 2, sr) };
}

/* ─── 表示用カーブ（対数周波数軸・ピークホールド） ─── */

export const CURVE_F = (() => {
  const cols = 220, a = Math.log2(30), b = Math.log2(MAX_HZ);
  return Array.from({ length: cols + 1 }, (_, i) => Math.pow(2, a + ((b - a) * i) / cols));
})();

function buildCurve(p, binHz) {
  const out = [];
  for (let i = 0; i < CURVE_F.length - 1; i++) {
    const s = Math.max(1, Math.ceil(CURVE_F[i] / binHz));
    const e = Math.min(p.length - 1, Math.floor(CURVE_F[i + 1] / binHz));
    let m = 0;
    if (e < s) m = p[Math.min(p.length - 1, Math.round((CURVE_F[i] + CURVE_F[i + 1]) / 2 / binHz))];
    else for (let j = s; j <= e; j++) if (p[j] > m) m = p[j];
    out.push(toDb(m));
  }
  const mx = Math.max(...out);
  return out.map((d) => d - mx);
}

/* ─── 複数フレームをまとめて1音の解析結果にする ─── */

/**
 * @param {{buf: Float32Array, f: number}[]} frames 同じ音を保っていた数フレーム
 * @param {number} sr サンプルレート
 * @param {{withFormants?: boolean}} opt 最低音のときだけ母音の共鳴（フォルマント）も推定する
 */
export function analyzeFrames(frames, sr, { withFormants = false } = {}) {
  if (!frames?.length) return null;
  const fs = frames.map((fr) => analyzeFrame(fr.buf, fr.f, sr));
  const f0s = frames.map((fr) => fr.f).sort((a, b) => a - b);
  const f0 = f0s[Math.floor(f0s.length / 2)];
  const binHz = fs[0].binHz;

  // パワー平均
  const K = Math.min(...fs.map((x) => x.harmonics.length));
  const harmonics = [];
  for (let i = 0; i < K; i++) {
    const db = toDb(fs.reduce((s, x) => s + fromDb(x.harmonics[i].db), 0) / fs.length);
    const bin = fs.reduce((s, x) => s + x.harmonics[i].bin, 0) / fs.length;
    harmonics.push({ k: i + 1, freq: bin * binHz, db });
  }
  const between = [];
  for (let i = 0; i <= K; i++) {
    between.push(toDb(fs.reduce((s, x) => s + fromDb(x.between[i] ?? -200), 0) / fs.length));
  }
  const H = Math.min(...fs.map((x) => x.half.length));
  const half = [];
  for (let i = 0; i < H; i++) {
    half.push({
      peak: toDb(fs.reduce((s, x) => s + fromDb(x.half[i].peak), 0) / fs.length),
      quarter: toDb(fs.reduce((s, x) => s + fromDb(x.half[i].quarter), 0) / fs.length),
    });
  }
  const P = new Float64Array(fs[0].p.length);
  for (const x of fs) for (let i = 0; i < P.length; i++) P[i] += x.p[i] / fs.length;

  const ref = Math.max(...harmonics.map((h) => h.db));
  harmonics.forEach((h, i) => {
    h.rel = h.db - ref;
    h.prom = h.db - (between[i] + between[i + 1]) / 2; // 両隣の谷からの突出
  });

  // 奇数倍音の落ち込み：偶数倍音だけ強い＝検出された音の1オクターブ上が主な振動
  // 高い音では倍音がまばらで、母音の共鳴が偶数倍音に乗るだけで同じ形になるので、低い音（160Hz以下）に限る
  const dips = [];
  if (f0 <= 160) {
    for (let k = 3; k + 1 <= Math.min(harmonics.length, 22); k += 2) {
      dips.push(harmonics[k - 1].db - (harmonics[k - 2].db + harmonics[k].db) / 2);
    }
  }
  const oddDip = dips.length >= 5 ? dips.reduce((s, d) => s + d, 0) / dips.length : null;
  const share = dips.length ? dips.filter((d) => d < -2).length / dips.length : 0;
  const sub = oddDip == null || share < 0.7 ? null : oddDip <= -10 ? "strong" : oddDip <= -5 ? "mixed" : null;

  // H1−H2（両方がノイズから 6dB 以上突出しているときだけ）
  // 半分の周期の振動が重なっているときは、主な振動（偶数倍音）の 1本目と2本目で測る
  const [i1, i2] = sub ? [1, 3] : [0, 1];
  const A = harmonics[i1], B = harmonics[i2];
  const h1h2Raw = A && B && A.prom >= 6 && B.prom >= 6 ? A.db - B.db : null;
  const h1h2Freqs = A && B ? [A.freq, B.freq] : null;

  // 半分の周波数の振動が「下に」重なっている（検出したのは主な振動の方）
  // 倍音の中間に、両脇より 6dB 以上立った山が 6割以上の位置で見えるとき。息のノイズは平らなので山にならない
  let subBelow = null;
  if (!sub && f0 >= 60 && half.length >= 5) {
    const rows = half.map((x, i) => ({
      rel: x.peak - (harmonics[i].db + harmonics[i + 1].db) / 2,
      peaky: x.peak - x.quarter,
    }));
    const share = rows.filter((r) => r.peaky >= 6).length / rows.length;
    const rel = rows.reduce((s, r) => s + r.rel, 0) / rows.length;
    if (share >= 0.6 && rel >= -30) subBelow = { f: f0 / 2, rel };
  }

  // HNR：半分の周期の振動が重なっているときは、その長い周期で測る（重なり自体をノイズと数えない）
  const hs = fs.map((x) => (subBelow ? x.hnr2 : x.hnr)).filter((v) => v != null);
  const hnr = hs.length ? hs.reduce((s, v) => s + v, 0) / hs.length : null;

  return {
    f0, harmonics, h1h2Raw, h1h2Freqs, h1h2Main: !!sub, hnr, oddDip, sub, subBelow,
    formants: withFormants ? estimateFormants(frames, sr) : null,
    curve: buildCurve(P, binHz),
  };
}

/* ─── フォルマント推定（LPC） ───
   倍音が密な低い音から声道の共鳴（母音の形）を推定し、H1・H2 への影響を補正するのに使う */

function estimateFormants(frames, sr) {
  const dec = Math.max(1, Math.round(sr / 11025));
  const fs2 = sr / dec;
  const taps = 63, mid = (taps - 1) / 2, fc = 0.45 / dec;
  const h = new Float64Array(taps);
  for (let i = 0; i < taps; i++) {
    const t = i - mid;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    h[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1)));
  }
  const order = 14, step = 10, nf = Math.floor(fs2 / 2 / step);
  const env = new Float64Array(nf);
  let used = 0;
  for (const { buf } of frames) {
    const m = Math.floor((buf.length - taps) / dec);
    if (m < 256) continue;
    const y = new Float64Array(m);
    for (let j = 0; j < m; j++) {
      let acc = 0;
      const o = j * dec;
      for (let i = 0; i < taps; i++) acc += buf[o + i] * h[i];
      y[j] = acc;
    }
    const pre = Math.exp((-2 * Math.PI * 50) / fs2);
    for (let j = m - 1; j > 0; j--) y[j] -= pre * y[j - 1];
    const w = hann(m);
    for (let j = 0; j < m; j++) y[j] *= w[j];
    const r = new Float64Array(order + 1);
    for (let l = 0; l <= order; l++) { let acc = 0; for (let j = 0; j + l < m; j++) acc += y[j] * y[j + l]; r[l] = acc; }
    if (r[0] <= 0) continue;
    r[0] *= 1.0001;
    // Levinson–Durbin
    let a = new Float64Array(order + 1); a[0] = 1;
    let err = r[0];
    for (let i = 1; i <= order; i++) {
      let acc = r[i];
      for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
      const k = -acc / err;
      const na = a.slice();
      for (let j = 1; j < i; j++) na[j] = a[j] + k * a[i - j];
      na[i] = k; a = na;
      err *= 1 - k * k;
      if (err <= 0) break;
    }
    for (let q = 0; q < nf; q++) {
      const wq = (2 * Math.PI * q * step) / fs2;
      let re = 0, im = 0;
      for (let j = 0; j <= order; j++) { re += a[j] * Math.cos(wq * j); im -= a[j] * Math.sin(wq * j); }
      env[q] += -10 * Math.log10(re * re + im * im + 1e-30);
    }
    used++;
  }
  if (!used) return null;
  for (let q = 0; q < nf; q++) env[q] /= used;

  // 包絡のピーク → F1, F2, F3（帯域幅は −3dB 幅）。
  // 幅が広すぎる・谷から十分に立っていない山は、共鳴ではなく包絡のうねりとして捨てる
  const peaks = [];
  for (let q = 1; q < nf - 1; q++) {
    const f = q * step;
    if (f < 200 || f > 4000) continue;
    if (!(env[q] > env[q - 1] && env[q] >= env[q + 1])) continue;
    let l = q, rr = q;
    while (l > 0 && env[l] > env[q] - 3) l--;
    while (rr < nf - 1 && env[rr] > env[q] - 3) rr++;
    const b = (rr - l) * step;
    let lv = q, rv = q;
    while (lv > 0 && env[lv - 1] <= env[lv]) lv--;
    while (rv < nf - 1 && env[rv + 1] <= env[rv]) rv++;
    const prom = env[q] - Math.max(env[lv], env[rv]);
    if (b <= 300 && prom >= 4) peaks.push({ f, b: Math.max(40, b) });
  }
  const out = [];
  for (const pk of peaks) {
    if (out.length >= 3) break;
    if (!out.length || pk.f - out[out.length - 1].f >= 250) out.push(pk);
  }
  // F1 として妥当な範囲（250〜1100Hz）に最初の山が無ければ、補正しない
  if (!out.length || out[0].f < 250 || out[0].f > 1100) return null;
  return out;
}

/** 共鳴（周波数 F・帯域幅 B）が周波数 f の倍音を持ち上げる量（dB、直流で 0） */
function resonanceGain(f, F, B) {
  const hb = B / 2;
  return 20 * Math.log10((F * F + hb * hb) / Math.sqrt(((F - f) ** 2 + hb * hb) * ((F + f) ** 2 + hb * hb)));
}

/** H1*−H2*：F1〜F3 の共鳴で持ち上がった分を差し引いた H1−H2 */
function correctWith(a, fm) {
  const [f1, f2] = a.h1h2Freqs;
  let c = 0;
  for (const F of fm) c += resonanceGain(f1, F.f, F.b) - resonanceGain(f2, F.f, F.b);
  return a.h1h2Raw - c;
}

/**
 * @returns {{value: number, sure: boolean} | null}
 * sure=false：倍音が共鳴の山に乗っていて、フォルマントの推定誤差で値が大きく揺れる
 */
export function correctedH1H2(a, formants, f0lo) {
  if (a.h1h2Raw == null) return null;
  if (!formants) return { value: a.h1h2Raw, sure: a.f0 < 250 };
  const value = correctWith(a, formants);
  // フォルマントの周波数を ±δ、帯域幅を ×1.5 / ÷1.5 ずらしても値が 4dB 以内に収まるか
  // （δ は最低音の倍音間隔の 1/4、最低 20Hz。倍音がまばらなほど推定が粗くなるため）
  const delta = Math.max(20, 0.25 * f0lo);
  let spread = 0;
  for (let i = 0; i < formants.length; i++) {
    for (const [df, kb] of [[-delta, 1], [delta, 1], [0, 1.5], [0, 1 / 1.5], [-delta, 1.5], [delta, 1.5]]) {
      const fm = formants.map((F, j) => (j === i ? { f: F.f + df, b: F.b * kb } : F));
      spread = Math.max(spread, Math.abs(correctWith(a, fm) - value));
    }
  }
  return { value, sure: spread <= 4 };
}

/** 重み付き直線（x = log2 周波数, 重み 1/k でオクターブごとに均等） */
function lineFit(pts) {
  if (pts.length < 3) return null;
  let sw = 0, sx = 0, sy = 0;
  for (const h of pts) { const w = 1 / h.k, x = Math.log2(h.freq); sw += w; sx += w * x; sy += w * h.db; }
  const mx = sx / sw, my = sy / sw;
  let num = 0, den = 0;
  for (const h of pts) {
    const w = 1 / h.k, dx = Math.log2(h.freq) - mx;
    num += w * dx * (h.db - my); den += w * dx * dx;
  }
  if (!(den > 0)) return null;
  const slope = num / den;
  return { slope, at: (f) => my + slope * (Math.log2(f) - mx) };
}

const inBand = (h) => h.freq >= BAND_HZ[0] && h.freq <= BAND_HZ[1];

const wMean = (pts, fn) => {
  let s = 0, w = 0;
  for (const h of pts) { s += fn(h) / h.k; w += 1 / h.k; }
  return w ? s / w : null;
};

/**
 * 共通帯域 [fLo, fHi] の傾き（dB/oct）と、2〜4kHz の「響きの山」（傾きの線からの盛り上がり dB）。
 * 最高音は倍音がまばらで母音の山谷を拾い損ねるので、最低音の密な倍音から求めた
 * 山谷の形を最高音の各倍音の位置で差し引いてから測る（両方とも同じ母音の前提）。
 */
function tiltAndRing(lo, hi, fLo, fHi, excludeBand) {
  // 半分の周期が重なっている音は、主な振動（偶数倍音）だけで包絡を見る
  const usable = (a) => (a.sub ? a.harmonics.filter((h) => h.k % 2 === 0) : a.harmonics);
  const pick = (a) => usable(a).filter((h) => h.freq >= fLo && h.freq <= fHi);
  const loPts = pick(lo), hiPts = pick(hi);
  const loBase = lineFit(excludeBand ? loPts.filter((h) => !inBand(h)) : loPts);
  if (!loBase || hiPts.length < 3) return null;

  const lh = usable(lo);
  const interpLo = (f) => {
    let j = 1;
    while (j < lh.length - 1 && lh[j].freq < f) j++;
    const a = lh[j - 1], b = lh[j];
    const t = Math.max(0, Math.min(1, (f - a.freq) / (b.freq - a.freq)));
    return a.db + (b.db - a.db) * t;
  };
  const shape = (f) => interpLo(f) - loBase.at(f);

  const hiAdj = hiPts.map((h) => ({ ...h, db: h.db - shape(h.freq) }));
  const hiBase = lineFit(excludeBand ? hiAdj.filter((h) => !inBand(h)) : hiAdj);
  if (!hiBase) return null;

  const loBand = loPts.filter(inBand), hiBand = hiAdj.filter(inBand);
  return {
    lo: { tilt: loBase.slope, ring: loBand.length ? wMean(loBand, (h) => h.db - loBase.at(h.freq)) : null },
    hi: {
      tilt: hiBase.slope,
      ring: hiBand.length ? wMean(hiBand, (h) => h.db - hiBase.at(h.freq) + shape(h.freq)) : null,
    },
  };
}

/** 倍音がノイズから 10dB 以上立っている上限の周波数（途中で2本続けて沈んだらそこまで）。
 *  10dB 未満だとノイズが乗って実際より強く測れ、傾きが緩く出る */
function clearTop(a) {
  let top = 0, miss = 0;
  for (const h of a.harmonics) {
    if (a.sub && h.k % 2) continue;
    if (h.prom >= 10) { top = h.freq; miss = 0; } else if (++miss >= 2 && top) break;
  }
  return top;
}

const outsideBandCount = (a, fLo, fHi) =>
  a.harmonics.filter((h) => h.freq >= fLo && h.freq <= fHi && !inBand(h)).length;

/* ─── 最低音と最高音を比べて、言葉にする ─── */

const fmt = (v, d = 1) => (v > 0 ? "+" : "") + v.toFixed(d);

// 「変化あり」とみなす差。合成音での検証で出た推定誤差（H1−H2 ±4dB、傾き ±3dB/oct 程度）より大きく取る
export const TH = { h1h2: 5, tilt: 4, ring: 3, hnr: 4 };

export function compareVoices(lo, hi) {
  if (!lo || !hi) return null;
  const semis = 12 * Math.log2(hi.f0 / lo.f0);
  // 傾きは両方に倍音がある共通の帯域で測る（高い方の音の第2倍音〜5kHz）。
  // 高い方の基音を入れると H1−H2 の影響が混ざるので外す
  const bandFrom = 1.5 * Math.max(lo.f0, hi.f0);
  // 上限は 5kHz と、両方の音で倍音がノイズから立っている範囲の狭い方（ノイズ床を傾きに混ぜない）
  const bandTo = Math.min(TILT_MAX_HZ, clearTop(lo), clearTop(hi));
  const exclude = outsideBandCount(lo, bandFrom, bandTo) >= 3 && outsideBandCount(hi, bandFrom, bandTo) >= 3;
  const tr = bandTo > bandFrom ? tiltAndRing(lo, hi, bandFrom, bandTo, exclude) : null;
  // 母音の共鳴は最低音から推定して、両方の H1−H2 に同じ補正をかける（同じ母音で歌っている前提）
  const formants = lo.formants;
  const loH = correctedH1H2(lo, formants, lo.f0);
  const hiH = correctedH1H2(hi, formants, lo.f0);
  const m = {
    lo: { h1h2: loH?.value ?? null, h1h2Sure: !!loH?.sure, tilt: tr?.lo.tilt ?? null, ring: tr?.lo.ring ?? null, hnr: lo.hnr },
    hi: { h1h2: hiH?.value ?? null, h1h2Sure: !!hiH?.sure, tilt: tr?.hi.tilt ?? null, ring: tr?.hi.ring ?? null, hnr: hi.hnr },
  };
  const diff = (k) => (m.lo[k] == null || m.hi[k] == null ? null : m.hi[k] - m.lo[k]);
  const d = { h1h2: diff("h1h2"), tilt: diff("tilt"), ring: diff("ring"), hnr: diff("hnr") };
  const h1h2Sure = d.h1h2 != null && m.lo.h1h2Sure && m.hi.h1h2Sure;
  // 100Hz 未満の音はビブラートの揺れでも HNR が下がりやすい（合成音で 40Hz・揺れ±3% のとき約 −7dB）ので、基準を上げる
  const th = { ...TH, hnr: lo.f0 < 100 ? 8 : TH.hnr };

  const notes = [];
  if (d.h1h2 != null && !h1h2Sure) {
    notes.push({ tone: "same", text: `H1−H2 は倍音が母音の共鳴の山に重なっていて、${fmt(d.h1h2)} dB の差が発声の変化か母音の影響か切り分けられません。判定には使っていません。` });
  } else if (d.h1h2 != null) {
    if (d.h1h2 >= th.h1h2) notes.push({ tone: "hi", text: `高音で声帯の閉じが緩んでいます（H1−H2 が ${fmt(d.h1h2)} dB）。息っぽい・裏声寄りの発声に移っているサインです。` });
    else if (d.h1h2 <= -th.h1h2) notes.push({ tone: "lo", text: `高音で声帯をより強く閉じています（H1−H2 が ${fmt(d.h1h2)} dB）。地声のまま押し上げる方向の変化です。` });
    else notes.push({ tone: "same", text: `声帯の閉じ方は低音と高音でほぼ同じです（H1−H2 の差 ${fmt(d.h1h2)} dB）。` });
  }
  if (d.tilt != null) {
    if (d.tilt <= -th.tilt) notes.push({ tone: "hi", text: `高音では高い倍音が早く減り、柔らかく細い音色になっています（傾き ${fmt(d.tilt)} dB/oct）。` });
    else if (d.tilt >= th.tilt) notes.push({ tone: "lo", text: `高音のほうが高い倍音まで強く、明るく張った音色です（傾き ${fmt(d.tilt)} dB/oct）。` });
  }
  if (d.ring != null) {
    if (d.ring >= th.ring) notes.push({ tone: "lo", text: `高音で 2〜4kHz の響きの山が強くなり、声が前に抜けやすくなっています（${fmt(d.ring)} dB）。` });
    else if (d.ring <= -th.ring) notes.push({ tone: "hi", text: `高音で 2〜4kHz の響きの山が弱くなっています（${fmt(d.ring)} dB）。` });
  }
  if (d.hnr != null) {
    if (d.hnr <= -th.hnr) notes.push({ tone: "hi", text: `高音で息漏れ・ノイズが増えています（HNR ${fmt(d.hnr)} dB）。` });
    else if (d.hnr >= th.hnr) notes.push({ tone: "lo", text: `高音のほうが息漏れが少なく、澄んだ音です（HNR ${fmt(d.hnr)} dB）。` });
  }
  for (const [a, label] of [[lo, "最低音"], [hi, "最高音"]]) {
    if (a.sub === "strong") notes.push({ tone: "sub", text: `${label}は偶数倍音だけが強く、奇数倍音が抜けています。声帯の主な振動は ${(a.f0 * 2).toFixed(0)}Hz 付近で、その下に半分の周期の振動が重なっている形です（ボーカルフライ・スロートベース・仮声帯の発声で起こる）。測定値の ${a.f0.toFixed(1)}Hz は、この重なった振動の高さです。H1−H2 は主な振動の倍音で測っています。` });
    else if (a.sub === "mixed") notes.push({ tone: "sub", text: `${label}には、半分の周期の振動（サブハーモニクス）が混ざっています。ボーカルフライ・スロートベースなどで起こる形です。H1−H2 は主な振動の倍音で測っています。` });
    if (a.subBelow) notes.push({ tone: "sub", text: `${label}には、測定値 ${a.f0.toFixed(1)}Hz の半分にあたる ${a.subBelow.f.toFixed(1)}Hz の振動（サブハーモニクス）が重なっています（倍音より約 ${Math.round(-a.subBelow.rel)}dB 弱い）。スロートベース・ボーカルフライ・仮声帯の発声で起こる形です。このサイトの音程判定は強い方の ${a.f0.toFixed(1)}Hz を記録しています。${a.subBelow.rel >= -10 ? `耳には ${a.subBelow.f.toFixed(1)}Hz の低い音として聞こえている可能性があります。` : ""}HNR は ${a.subBelow.f.toFixed(1)}Hz の周期で測っています。` });
  }

  const t = d.tilt, h = h1h2Sure ? d.h1h2 : null;
  let verdict;
  if (h != null) {
    if (h >= th.h1h2 && (t == null || t <= -2)) verdict = "高音で裏声（ファルセット）寄りの発声に切り替わっている可能性が高いです";
    else if (h >= th.h1h2) verdict = "高音で声帯の閉じが緩み、裏声寄りに変わりつつあります";
    else if (h <= -th.h1h2 && (t == null || t >= -1)) verdict = "高音でも声帯を強く閉じたまま、張り上げる方向に変わっています";
    else if (h <= -th.h1h2) verdict = "高音で声帯の閉じが強まっています";
    else if (t != null && t <= -th.tilt) verdict = "声帯の閉じ方は近いまま、高音で音色が柔らかくなっています";
    else if (t != null && t >= th.tilt) verdict = "声帯の閉じ方は近いまま、高音で音色が明るくなっています";
    else verdict = "低音から高音まで、ほぼ同じ発声を保てています";
  } else if (t != null && t <= -th.tilt) verdict = "高音で高い倍音が減り、柔らかい音色になっています（声帯の閉じ方は判定できませんでした）";
  else if (t != null && t >= th.tilt) verdict = "高音のほうが高い倍音まで強く、明るい音色です（声帯の閉じ方は判定できませんでした）";
  else if (t != null) verdict = "高い倍音の減り方は、低音と高音でほぼ同じです";
  else verdict = "低音と高音の倍音の出方を比べました";
  if (d.hnr != null && d.hnr <= -Math.max(6, th.hnr)) verdict += "。高音で息漏れが増えています";

  const cautions = ["目安です。マイク・部屋・母音で値が変わるので、同じ環境・同じ母音（「あー」）で測った結果どうしを比べてください。"];
  if (lo.f0 < 100) cautions.push("最低音が100Hz未満です。スマホやPCの内蔵マイクは低い音が弱く録れるため、最低音の H1−H2 が実際より小さく出ることがあります。");
  if (!formants) cautions.push("最低音から母音の共鳴（フォルマント）を推定できなかったため、H1−H2 は補正なしの値です。250Hz以上の音の H1−H2 は判定に使っていません。");
  else if (hi.f0 > 350) cautions.push("H1−H2 は最低音で推定した母音の共鳴で補正しています。高音で母音の形（口の開き）を変えていると、補正がずれます。");
  if (m.lo.h1h2 == null || m.hi.h1h2 == null) cautions.push("基音か第2倍音がノイズに埋もれていて、H1−H2 を計算できなかった音があります。");
  if (m.lo.tilt == null || m.hi.tilt == null) cautions.push(`共通の帯域（${Math.round(bandFrom)}Hz〜${(bandTo / 1000).toFixed(1)}kHz）にはっきりした倍音が3本未満のため、傾きと響きの山は計算していません。`);

  return { lo, hi, semis, bandFrom, bandTo, formants, m, d, h1h2Sure, th, notes, verdict, cautions, comparable: semis >= 3 };
}
