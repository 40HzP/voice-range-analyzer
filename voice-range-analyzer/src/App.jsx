import { useState, useRef, useCallback, useEffect } from "react";

/* ════════════════════════════════════════════
   Pitch Detection — Autocorrelation (YIN-lite)
   ════════════════════════════════════════════ */

const NOTES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const A4 = 440;

function freqToNote(f) {
  const semi = 12 * Math.log2(f / A4);
  const midi = Math.round(semi) + 69;
  const nm = NOTES[((midi % 12) + 12) % 12];
  const oct = Math.floor(midi / 12) - 1;
  const cents = Math.round((semi - Math.round(semi)) * 100);
  return { nm, oct, cents, midi, full: `${nm}${oct}` };
}

function semiOf(f) { return 12 * Math.log2(f / A4) + 69; }

function detect(buf, sr) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.012) return [null, rms];

  let s = 0, e = n - 1;
  for (let i = 0; i < n / 2; i++) if (Math.abs(buf[i]) < 0.2) { s = i; break; }
  for (let i = 1; i < n / 2; i++) if (Math.abs(buf[n - i]) < 0.2) { e = n - i; break; }
  const b = buf.slice(s, e);
  const len = b.length;
  if (len < 100) return [null, rms];

  const ac = new Float32Array(len);
  for (let lag = 0; lag < len; lag++) {
    let sum = 0;
    for (let j = 0; j < len - lag; j++) sum += b[j] * b[j + lag];
    ac[lag] = sum;
  }

  let d = 0;
  while (d < len - 1 && ac[d] > ac[d + 1]) d++;

  let mxV = -Infinity, mxP = d;
  for (let i = d; i < len; i++) if (ac[i] > mxV) { mxV = ac[i]; mxP = i; }
  if (mxP <= 0 || mxP >= len - 1) return [null, rms];

  const y1 = ac[mxP - 1], y2 = ac[mxP], y3 = ac[mxP + 1];
  const aa = (y1 + y3 - 2 * y2) / 2;
  const bb = (y3 - y1) / 2;
  let T = mxP;
  if (aa !== 0) T -= bb / (2 * aa);

  const freq = sr / T;
  return (freq >= 25 && freq <= 4200) ? [freq, rms] : [null, rms];
}

/* ════════════════════════════════════════════
   Subcomponents
   ════════════════════════════════════════════ */

function PulseRing({ active, level }) {
  const size = 180;
  const r = 76;
  const circ = 2 * Math.PI * r;
  const dash = active ? circ * Math.min(level * 3, 1) : 0;
  return (
    <svg width={size} height={size} className="absolute inset-0 m-auto pointer-events-none">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth="3"/>
      <circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={active ? "#22d3ee" : "#334155"} strokeWidth="3"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ * 0.25}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.12s ease-out, stroke 0.3s" }}
      />
    </svg>
  );
}

function CentsMeter({ cents }) {
  const c = cents ?? 0;
  const pct = 50 + (c / 50) * 45;
  const ok = Math.abs(c) < 10;
  return (
    <div className="w-44 mx-auto mt-2">
      <div className="relative h-1.5 rounded-full" style={{ background: "#1e293b" }}>
        <div className="absolute left-1/2 top-0 w-px h-full" style={{ background: "#475569" }}/>
        <div
          className="absolute top-1/2 w-2.5 h-2.5 rounded-full"
          style={{
            left: `${pct}%`, transform: "translate(-50%,-50%)",
            background: ok ? "#22d3ee" : "#f97316",
            boxShadow: ok ? "0 0 8px #22d3ee80" : "0 0 8px #f9731680",
            transition: "left 0.1s ease-out, background 0.2s"
          }}
        />
      </div>
      <div className="flex justify-between mt-1" style={{ fontSize: 10, color: "#64748b" }}>
        <span>−50¢</span>
        <span style={{ color: ok ? "#22d3ee" : "#f97316" }}>
          {cents != null ? `${c > 0 ? "+" : ""}${c}¢` : "—"}
        </span>
        <span>+50¢</span>
      </div>
    </div>
  );
}

function RangeBar({ lo, hi }) {
  const minS = semiOf(32.7), maxS = semiOf(1046.5), span = maxS - minS;
  const pct = (f) => Math.max(0, Math.min(100, ((semiOf(f) - minS) / span) * 100));
  const marks = [["C1",32.7],["C2",65.4],["C3",130.8],["C4",261.6],["C5",523.3],["C6",1046.5]];
  const loP = lo ? pct(lo) : 0;
  const hiP = hi ? pct(hi) : 0;

  return (
    <div className="w-full mt-1">
      <div className="relative h-5 rounded-full overflow-hidden" style={{ background: "#1e293b" }}>
        {lo && hi && (
          <div className="absolute h-full rounded-full" style={{
            left: `${loP}%`, width: `${Math.max(hiP - loP, 0.8)}%`,
            background: "linear-gradient(90deg, #f97316, #22d3ee 50%, #a855f7)",
            boxShadow: "0 0 12px #22d3ee40"
          }}/>
        )}
      </div>
      <div className="relative h-4 mt-0.5">
        {marks.map(([nm, f]) => (
          <span key={nm} className="absolute" style={{
            left: `${pct(f)}%`, transform: "translateX(-50%)",
            fontSize: 10, color: "#475569"
          }}>{nm}</span>
        ))}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════
   Result Image Generator (Canvas)
   ════════════════════════════════════════════ */

function drawResult(loFreq, hiFreq, loNote, hiNote) {
  const W = 800, H = 420;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");

  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#0a0e1a"); bg.addColorStop(1, "#141b2d");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#1e293b"; g.lineWidth = 1; g.strokeRect(0, 0, W, H);

  g.textAlign = "center";

  g.fillStyle = "#e2e8f0";
  g.font = "bold 26px system-ui, -apple-system, sans-serif";
  g.fillText("Voice Range Result", W / 2, 48);
  g.strokeStyle = "#1e293b"; g.beginPath(); g.moveTo(80, 66); g.lineTo(720, 66); g.stroke();

  g.fillStyle = "#f97316"; g.font = "bold 14px system-ui"; g.fillText("▼ LOWEST", 240, 105);
  g.fillStyle = "#f1f5f9"; g.font = "bold 52px system-ui"; g.fillText(loNote.full, 240, 162);
  g.fillStyle = "#94a3b8"; g.font = "18px system-ui"; g.fillText(`${loFreq.toFixed(1)} Hz`, 240, 190);

  g.fillStyle = "#a855f7"; g.font = "bold 14px system-ui"; g.fillText("▲ HIGHEST", 560, 105);
  g.fillStyle = "#f1f5f9"; g.font = "bold 52px system-ui"; g.fillText(hiNote.full, 560, 162);
  g.fillStyle = "#94a3b8"; g.font = "18px system-ui"; g.fillText(`${hiFreq.toFixed(1)} Hz`, 560, 190);

  const semis = Math.round(Math.abs(semiOf(hiFreq) - semiOf(loFreq)));
  const octs = (semis / 12).toFixed(1);
  g.fillStyle = "#22d3ee"; g.font = "bold 20px system-ui";
  g.fillText(`${semis} semitones  ·  ${octs} octaves`, W / 2, 238);

  const bx = 80, bw = 640, by = 265, bh = 18;
  g.fillStyle = "#1e293b"; g.beginPath();
  g.roundRect(bx, by, bw, bh, 9); g.fill();

  const minS = semiOf(32.7), maxS = semiOf(1046.5), sp = maxS - minS;
  const lp = ((semiOf(loFreq) - minS) / sp) * bw;
  const hp = ((semiOf(hiFreq) - minS) / sp) * bw;
  const gr = g.createLinearGradient(bx + lp, 0, bx + hp, 0);
  gr.addColorStop(0, "#f97316"); gr.addColorStop(0.5, "#22d3ee"); gr.addColorStop(1, "#a855f7");
  g.fillStyle = gr; g.beginPath();
  g.roundRect(bx + lp, by, Math.max(hp - lp, 6), bh, 9); g.fill();

  const ms = [["C1",32.7],["C2",65.4],["C3",130.8],["C4",261.6],["C5",523.3],["C6",1046.5]];
  g.fillStyle = "#475569"; g.font = "11px system-ui";
  ms.forEach(([n, f]) => {
    const x = bx + ((semiOf(f) - minS) / sp) * bw;
    g.fillText(n, x, by + bh + 16);
  });

  const loMidi = loNote.midi;
  let typeLabel = "";
  if (loMidi <= 36) typeLabel = "Bass";
  else if (loMidi <= 40) typeLabel = "Baritone";
  else if (loMidi <= 45) typeLabel = "Tenor";
  else if (loMidi <= 48) typeLabel = "Alto";
  else if (loMidi <= 53) typeLabel = "Mezzo-Soprano";
  else typeLabel = "Soprano";
  if (typeLabel) {
    g.fillStyle = "#64748b"; g.font = "15px system-ui";
    g.fillText(`Estimated range: ${typeLabel}`, W / 2, 330);
  }

  g.fillStyle = "#334155"; g.font = "13px system-ui";
  g.fillText("Voice Range Analyzer — powered by 40HzP", W / 2, 400);

  return c.toDataURL("image/png");
}

/* ════════════════════════════════════════════
   Main App
   ════════════════════════════════════════════ */

export default function VoiceRangeAnalyzer() {
  const [on, setOn] = useState(false);
  const [freq, setFreq] = useState(null);
  const [note, setNote] = useState(null);
  const [loF, setLoF] = useState(null);
  const [hiF, setHiF] = useState(null);
  const [loN, setLoN] = useState(null);
  const [hiN, setHiN] = useState(null);
  const [rms, setRms] = useState(0);
  const [err, setErr] = useState(null);
  const [img, setImg] = useState(null);

  const acRef = useRef(null);
  const anRef = useRef(null);
  const stRef = useRef(null);
  const rafRef = useRef(null);
  const pbRef = useRef([]);
  const loRef = useRef(null);
  const hiRef = useRef(null);

  const start = useCallback(async () => {
    try {
      setErr(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const an = ac.createAnalyser();
      an.fftSize = 8192;
      ac.createMediaStreamSource(stream).connect(an);
      acRef.current = ac; anRef.current = an; stRef.current = stream;
      pbRef.current = [];
      setOn(true);

      const loop = () => {
        const buf = new Float32Array(an.fftSize);
        an.getFloatTimeDomainData(buf);
        const [f, r] = detect(buf, ac.sampleRate);
        setRms(Math.min(r * 8, 1));

        if (f) {
          const pb = pbRef.current;
          pb.push(f); if (pb.length > 6) pb.shift();
          if (pb.length >= 3) {
            const last = pb.slice(-3).map(semiOf);
            if (Math.max(...last) - Math.min(...last) < 1.5) {
              const sf = pb[pb.length - 1];
              const sn = freqToNote(sf);
              setFreq(sf); setNote(sn);
              if (loRef.current === null || sf < loRef.current) {
                loRef.current = sf; setLoF(sf); setLoN(sn);
              }
              if (hiRef.current === null || sf > hiRef.current) {
                hiRef.current = sf; setHiF(sf); setHiN(sn);
              }
            }
          }
        } else { setFreq(null); setNote(null); }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch {
      setErr("マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。");
    }
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stRef.current?.getTracks().forEach(t => t.stop());
    acRef.current?.close();
    setOn(false); setFreq(null); setNote(null); setRms(0);
  }, []);

  const reset = useCallback(() => {
    loRef.current = null; hiRef.current = null;
    setLoF(null); setHiF(null); setLoN(null); setHiN(null); setImg(null);
    pbRef.current = [];
  }, []);

  const save = useCallback(() => {
    if (!loN || !hiN) return;
    setImg(drawResult(loF, hiF, loN, hiN));
  }, [loF, hiF, loN, hiN]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    stRef.current?.getTracks().forEach(t => t.stop());
    acRef.current?.close();
  }, []);

  const hasRange = loN && hiN;
  const semis = hasRange ? Math.round(Math.abs(semiOf(hiF) - semiOf(loF))) : 0;
  const octs = hasRange ? (semis / 12).toFixed(1) : "0";

  return (
    <div style={{
      minHeight: "100vh", background: "#0a0e1a", color: "#e2e8f0",
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "24px 16px 40px"
    }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1, color: "#f1f5f9", margin: 0 }}>
        Voice Range Analyzer
      </h1>
      <p style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>声域測定ツール</p>

      <div style={{
        position: "relative", width: 180, height: 180,
        display: "flex", alignItems: "center", justifyContent: "center",
        marginTop: 28
      }}>
        <PulseRing active={on} level={rms} />
        <div style={{ textAlign: "center", zIndex: 1 }}>
          {note ? (
            <>
              <div style={{ fontSize: 48, fontWeight: 800, lineHeight: 1, color: "#22d3ee" }}>
                {note.full}
              </div>
              <div style={{ fontSize: 16, fontFamily: "monospace", color: "#94a3b8", marginTop: 4 }}>
                {freq.toFixed(1)} Hz
              </div>
            </>
          ) : (
            <div style={{ fontSize: 14, color: on ? "#475569" : "#334155" }}>
              {on ? "声を出してください" : "待機中"}
            </div>
          )}
        </div>
      </div>

      <CentsMeter cents={note?.cents} />

      <div style={{ width: 180, marginTop: 12 }}>
        <div style={{ height: 3, borderRadius: 2, background: "#1e293b", overflow: "hidden" }}>
          <div style={{
            height: "100%", borderRadius: 2, width: `${rms * 100}%`,
            background: rms > 0.7 ? "#ef4444" : "#22d3ee",
            transition: "width 0.08s ease-out"
          }}/>
        </div>
        <div style={{ fontSize: 10, color: "#475569", textAlign: "center", marginTop: 2 }}>入力レベル</div>
      </div>

      <div style={{
        display: "flex", gap: 24, marginTop: 28, width: "100%", maxWidth: 400, justifyContent: "center"
      }}>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#f97316", letterSpacing: 1 }}>▼ LOWEST</div>
          {loN ? (
            <>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#f1f5f9", lineHeight: 1.2 }}>{loN.full}</div>
              <div style={{ fontSize: 13, fontFamily: "monospace", color: "#94a3b8" }}>{loF.toFixed(1)} Hz</div>
            </>
          ) : (
            <div style={{ fontSize: 14, color: "#334155", marginTop: 8 }}>—</div>
          )}
        </div>
        <div style={{ width: 1, background: "#1e293b", alignSelf: "stretch" }}/>
        <div style={{ textAlign: "center", flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#a855f7", letterSpacing: 1 }}>▲ HIGHEST</div>
          {hiN ? (
            <>
              <div style={{ fontSize: 32, fontWeight: 800, color: "#f1f5f9", lineHeight: 1.2 }}>{hiN.full}</div>
              <div style={{ fontSize: 13, fontFamily: "monospace", color: "#94a3b8" }}>{hiF.toFixed(1)} Hz</div>
            </>
          ) : (
            <div style={{ fontSize: 14, color: "#334155", marginTop: 8 }}>—</div>
          )}
        </div>
      </div>

      {hasRange && (
        <div style={{ fontSize: 14, color: "#22d3ee", fontWeight: 600, marginTop: 12 }}>
          {semis} semitones · {octs} octaves
        </div>
      )}

      <div style={{ width: "100%", maxWidth: 400, marginTop: 16 }}>
        <RangeBar lo={loF} hi={hiF} />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 28, flexWrap: "wrap", justifyContent: "center" }}>
        {!on ? (
          <button onClick={start} style={{
            background: "#22d3ee", color: "#0a0e1a", border: "none", borderRadius: 8,
            padding: "12px 28px", fontSize: 15, fontWeight: 700, cursor: "pointer",
            boxShadow: "0 0 20px #22d3ee30"
          }}>
            測定開始
          </button>
        ) : (
          <button onClick={stop} style={{
            background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155",
            borderRadius: 8, padding: "12px 28px", fontSize: 15, fontWeight: 700, cursor: "pointer"
          }}>
            測定停止
          </button>
        )}
        <button onClick={reset} disabled={!hasRange && !img} style={{
          background: "transparent", color: hasRange ? "#94a3b8" : "#334155",
          border: `1px solid ${hasRange ? "#334155" : "#1e293b"}`,
          borderRadius: 8, padding: "12px 20px", fontSize: 15, cursor: hasRange ? "pointer" : "default"
        }}>
          リセット
        </button>
        <button onClick={save} disabled={!hasRange} style={{
          background: hasRange ? "#141b2d" : "transparent",
          color: hasRange ? "#a855f7" : "#334155",
          border: `1px solid ${hasRange ? "#a855f740" : "#1e293b"}`,
          borderRadius: 8, padding: "12px 20px", fontSize: 15, cursor: hasRange ? "pointer" : "default",
          fontWeight: 600
        }}>
          結果を保存
        </button>
      </div>

      {err && (
        <div style={{
          marginTop: 20, padding: "12px 20px", borderRadius: 8,
          background: "#1e293b", border: "1px solid #ef444440", color: "#f87171",
          fontSize: 13, maxWidth: 400, textAlign: "center"
        }}>
          {err}
        </div>
      )}

      {img && (
        <div style={{ marginTop: 28, textAlign: "center", maxWidth: 420, width: "100%" }}>
          <p style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
            画像を長押し（モバイル）or 右クリック（PC）で保存できます
          </p>
          <img
            src={img} alt="Voice Range Result"
            style={{ width: "100%", borderRadius: 8, border: "1px solid #1e293b" }}
          />
        </div>
      )}

      {!on && !hasRange && (
        <div style={{
          marginTop: 32, padding: "16px 20px", borderRadius: 8,
          background: "#141b2d", border: "1px solid #1e293b",
          maxWidth: 400, width: "100%"
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", marginBottom: 8 }}>使い方</div>
          <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.7 }}>
            ①「測定開始」を押してマイクを許可<br/>
            ② 出せる一番低い声から一番高い声まで出す<br/>
            ③「測定停止」→「結果を保存」で画像生成<br/>
            ④ 画像を保存してSNSでシェア
          </div>
        </div>
      )}

      <div style={{ marginTop: 40, fontSize: 11, color: "#334155" }}>
        powered by 40HzP — すべての処理はブラウザ内で完結します
      </div>
    </div>
  );
}
