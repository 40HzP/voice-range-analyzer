import { useState } from "react";
import { CURVE_F, BAND_HZ, MAX_HZ } from "./voiceSpectrum";

/* ════════════════════════════════════════════
   発声の変化（FFT解析）— 最低音と最高音の比較パネル
   ════════════════════════════════════════════ */

const LO_C = "#f97316";
const HI_C = "#a855f7";
const CARD = { background: "#141b2d", border: "1px solid #1e293b", borderRadius: 10, padding: "14px 16px" };

const sign = (v, d = 1) => (v > 0 ? "+" : "") + v.toFixed(d);

/* ─── 倍音の並び（倍音番号でそろえて比べる） ─── */

function HarmonicChart({ lo, hi }) {
  const W = 400, H = 210, L = 34, R = 8, T = 10, B = 40;
  const pw = W - L - R, ph = H - T - B;
  const K = 16, yMin = -50;
  const gw = pw / K, bw = Math.min(8, gw * 0.36);
  const y = (db) => T + (Math.max(yMin, Math.min(0, db)) / yMin) * ph;
  const bars = (a, color, dx) => a.harmonics.slice(0, K).map((h) => (
    <rect key={`${color}${h.k}`} x={L + gw * (h.k - 1) + gw / 2 + dx} y={y(h.rel)}
      width={bw} height={Math.max(1, T + ph - y(h.rel))} rx={1.5} fill={color} opacity={0.9} />
  ));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="倍音の強さの比較">
      {[0, -10, -20, -30, -40, -50].map((d) => (
        <g key={d}>
          <line x1={L} x2={W - R} y1={y(d)} y2={y(d)} stroke="#1e293b" strokeWidth={1} />
          <text x={L - 5} y={y(d) + 3} fontSize={9} fill="#475569" textAnchor="end">{d}</text>
        </g>
      ))}
      {bars(lo, LO_C, -bw - 1)}
      {bars(hi, HI_C, 1)}
      {Array.from({ length: K }, (_, i) => (
        <text key={i} x={L + gw * i + gw / 2} y={T + ph + 13} fontSize={9} fill="#64748b" textAnchor="middle">{i + 1}</text>
      ))}
      <text x={L + pw / 2} y={H - 6} fontSize={10} fill="#64748b" textAnchor="middle">倍音の番号（1 = 基音）</text>
      <text x={10} y={T + ph / 2} fontSize={9} fill="#475569" textAnchor="middle"
        transform={`rotate(-90 10 ${T + ph / 2})`}>dB（一番強い倍音 = 0）</text>
    </svg>
  );
}

/* ─── 周波数スペクトル（対数軸で重ねる） ─── */

function SpectrumChart({ lo, hi }) {
  const W = 400, H = 210, L = 34, R = 8, T = 10, B = 40;
  const pw = W - L - R, ph = H - T - B;
  const fMin = CURVE_F[0], fMax = MAX_HZ, yMin = -70;
  const x = (f) => L + (Math.log2(f / fMin) / Math.log2(fMax / fMin)) * pw;
  const y = (db) => T + (Math.max(yMin, Math.min(0, db)) / yMin) * ph;
  const line = (curve) => curve.map((db, i) => {
    const fc = Math.sqrt(CURVE_F[i] * CURVE_F[i + 1]);
    return `${x(fc).toFixed(1)},${y(db).toFixed(1)}`;
  }).join(" ");
  const ticks = [[50, "50"], [100, "100"], [200, "200"], [500, "500"], [1000, "1k"], [2000, "2k"], [5000, "5k"]];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="周波数スペクトルの比較">
      <rect x={x(BAND_HZ[0])} y={T} width={x(BAND_HZ[1]) - x(BAND_HZ[0])} height={ph} fill="#22d3ee" opacity={0.07} />
      <text x={(x(BAND_HZ[0]) + x(BAND_HZ[1])) / 2} y={T + 11} fontSize={9} fill="#22d3ee" textAnchor="middle" opacity={0.8}>響き帯域</text>
      {[0, -20, -40, -60].map((d) => (
        <g key={d}>
          <line x1={L} x2={W - R} y1={y(d)} y2={y(d)} stroke="#1e293b" strokeWidth={1} />
          <text x={L - 5} y={y(d) + 3} fontSize={9} fill="#475569" textAnchor="end">{d}</text>
        </g>
      ))}
      {ticks.map(([f, t]) => (
        <g key={f}>
          <line x1={x(f)} x2={x(f)} y1={T} y2={T + ph} stroke="#1e293b" strokeWidth={1} />
          <text x={x(f)} y={T + ph + 13} fontSize={9} fill="#64748b" textAnchor="middle">{t}</text>
        </g>
      ))}
      <polyline points={line(lo.curve)} fill="none" stroke={LO_C} strokeWidth={1.3} opacity={0.9} />
      <polyline points={line(hi.curve)} fill="none" stroke={HI_C} strokeWidth={1.3} opacity={0.9} />
      {[[lo.f0, LO_C], [hi.f0, HI_C]].map(([f, c]) => f >= fMin && (
        <path key={c} d={`M${x(f)},${T + ph} l-4,7 h8 z`} fill={c} />
      ))}
      <text x={L + pw / 2} y={H - 6} fontSize={10} fill="#64748b" textAnchor="middle">周波数（Hz）　▲ = 基音</text>
      <text x={10} y={T + ph / 2} fontSize={9} fill="#475569" textAnchor="middle"
        transform={`rotate(-90 10 ${T + ph / 2})`}>dB（各音の最大 = 0）</text>
    </svg>
  );
}

/* ─── 指標の表 ─── */

function MetricsTable({ cmp }) {
  const { m, d, h1h2Sure, bandFrom, bandTo, th } = cmp;
  const band = `${Math.round(bandFrom)}Hz〜${(bandTo / 1000).toFixed(1)}kHz`;
  const rows = [
    { key: "h1h2", label: "声帯の閉じ方", sub: "H1*−H2*｜大きいほど息っぽい・裏声寄り", unit: "dB" },
    { key: "tilt", label: "高い倍音の減り方", sub: `${band} の傾き｜0に近いほど明るく張った音`, unit: "dB/oct" },
    { key: "ring", label: "響きの山（2〜4kHz）", sub: "大きいほど声が前に抜ける", unit: "dB" },
    { key: "hnr", label: "声の澄み具合", sub: "HNR｜大きいほど息漏れ・ノイズが少ない", unit: "dB" },
  ];
  const cell = { padding: "8px 4px 8px 8px", borderTop: "1px solid #1e293b", fontFamily: "monospace", fontSize: 13, textAlign: "right", whiteSpace: "nowrap" };
  const val = (v, unsure) => v == null ? <span style={{ color: "#334155" }}>—</span>
    : <>{v.toFixed(1)}{unsure && <span style={{ color: "#64748b" }}>※</span>}</>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
      <thead>
        <tr style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
          <th style={{ textAlign: "left", fontWeight: 600, paddingBottom: 6 }}>指標</th>
          <th style={{ textAlign: "right", fontWeight: 600, color: LO_C, paddingLeft: 8 }}>▼最低音</th>
          <th style={{ textAlign: "right", fontWeight: 600, color: HI_C, paddingLeft: 8 }}>▲最高音</th>
          <th style={{ textAlign: "right", fontWeight: 600, paddingLeft: 8 }}>差</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const dv = d[r.key];
          const unsure = r.key === "h1h2" && !h1h2Sure;
          const big = dv != null && !unsure && Math.abs(dv) >= th[r.key];
          return (
            <tr key={r.key}>
              <td style={{ padding: "8px 4px 8px 0", borderTop: "1px solid #1e293b" }}>
                <div style={{ fontSize: 13, color: "#e2e8f0" }}>{r.label}</div>
                <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{r.sub}（{r.unit}）</div>
              </td>
              <td style={cell}>{val(m.lo[r.key], r.key === "h1h2" && !m.lo.h1h2Sure)}</td>
              <td style={cell}>{val(m.hi[r.key], r.key === "h1h2" && !m.hi.h1h2Sure)}</td>
              <td style={{ ...cell, color: big ? "#22d3ee" : "#64748b", fontWeight: big ? 700 : 400 }}>
                {dv == null ? "—" : sign(dv)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ─── 本体 ─── */

export default function VoiceComparison({ cmp, loN, hiN }) {
  const [view, setView] = useState("harm");

  if (!cmp.comparable) {
    return (
      <div style={{ ...CARD, fontSize: 13, color: "#94a3b8", lineHeight: 1.7 }}>
        最低音と最高音が近すぎて、発声の違いを比べられません。低い声から高い声まで、3半音以上の幅で測ってみてください。
      </div>
    );
  }

  const { lo, hi, notes, verdict, cautions, formants } = cmp;
  const tab = (key, label) => (
    <button onClick={() => setView(key)} style={{
      flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 600, cursor: "pointer",
      background: view === key ? "#1e293b" : "transparent",
      color: view === key ? "#e2e8f0" : "#64748b",
      border: "none", borderRadius: 6,
    }}>{label}</button>
  );

  return (
    <div style={CARD}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>🔬 発声の変化（FFT解析）</div>

      <div style={{ display: "flex", gap: 12, fontSize: 12, marginTop: 8, color: "#94a3b8", flexWrap: "wrap" }}>
        <span><span style={{ color: LO_C }}>■</span> 最低音 {loN?.full} {lo.f0.toFixed(1)}Hz</span>
        <span><span style={{ color: HI_C }}>■</span> 最高音 {hiN?.full} {hi.f0.toFixed(1)}Hz</span>
      </div>

      <div style={{
        marginTop: 12, padding: "10px 12px", borderRadius: 8,
        background: "#0f1626", border: "1px solid #22d3ee30",
        fontSize: 14, fontWeight: 700, color: "#e2e8f0", lineHeight: 1.6,
      }}>{verdict}</div>

      <div style={{ display: "flex", gap: 4, marginTop: 14, background: "#0f1626", borderRadius: 8, padding: 3 }}>
        {tab("harm", "倍音の並び")}
        {tab("spec", "周波数スペクトル")}
      </div>
      <div style={{ marginTop: 8 }}>
        {view === "harm" ? <HarmonicChart lo={lo} hi={hi} /> : <SpectrumChart lo={lo} hi={hi} />}
      </div>
      <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.6 }}>
        {view === "harm"
          ? "音の高さをそろえて、基音から何番目の倍音がどれだけ強いかを比べています。右の棒が早く低くなるほど、高い倍音が少ない柔らかい声です。"
          : "実際の周波数で重ねています。山の並びが倍音、うっすら色のついた帯が声の抜けに関わる 2〜4kHz です。"}
      </div>

      <MetricsTable cmp={cmp} />

      {notes.length > 0 && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          {notes.map((n, i) => (
            <div key={i} style={{
              fontSize: 13, color: "#cbd5e1", lineHeight: 1.7, paddingLeft: 10,
              borderLeft: `2px solid ${n.tone === "sub" ? "#22d3ee" : "#334155"}`,
            }}>{n.text}</div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11, color: "#64748b", lineHeight: 1.7 }}>
        {cautions.map((c, i) => <div key={i}>※ {c}</div>)}
        {formants && (
          <div>※ 最低音から推定した母音の共鳴：{formants.map((f, i) => `F${i + 1} ${f.f}Hz`).join(" / ")}</div>
        )}
      </div>

      <details style={{ marginTop: 10 }}>
        <summary style={{ fontSize: 12, color: "#94a3b8", cursor: "pointer" }}>指標の見方</summary>
        <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.8, marginTop: 6 }}>
          <p style={{ margin: "6px 0" }}><b style={{ color: "#e2e8f0" }}>声帯の閉じ方（H1*−H2*）</b>：基音（H1）と第2倍音（H2）の強さの差。声帯が開いている時間が長いほど基音が目立ち、値が大きくなります（しっかり閉じた地声で小さく、裏声・息っぽい声で大きくなる）。絶対値はマイクや人で変わるので、2つの音の差を見てください。母音の共鳴で持ち上がった分は、最低音から推定したフォルマントで差し引いています。※ は、倍音が共鳴の山に重なっていて補正が不確かな値です。</p>
          <p style={{ margin: "6px 0" }}><b style={{ color: "#e2e8f0" }}>高い倍音の減り方</b>：両方の音に倍音がある共通の帯域で、周波数が2倍になるごとに倍音が何dB弱くなるか。声帯がすばやく閉じるほど高い倍音が残り、0 に近づきます。最高音は倍音がまばらなので、最低音で測った母音の山谷を差し引いてから測っています。</p>
          <p style={{ margin: "6px 0" }}><b style={{ color: "#e2e8f0" }}>響きの山（2〜4kHz）</b>：2〜4kHz の倍音が、全体の傾きの線よりどれだけ上にあるか。伴奏の中でも声が埋もれずに届く「歌手のフォルマント」の目安です。</p>
          <p style={{ margin: "6px 0" }}><b style={{ color: "#e2e8f0" }}>声の澄み具合（HNR）</b>：声のうち、周期的にくり返す成分と、息やノイズの成分の比。ビブラートなど音程の揺れでも少し下がり、100Hz 未満の低い音ほど影響が出やすいので、最低音はまっすぐ伸ばすと正確になります。</p>
          <p style={{ margin: "6px 0" }}>色つきの「差」は、推定誤差より大きい変化（H1*−H2* {cmp.th.h1h2}dB、傾き {cmp.th.tilt}dB/oct、響き {cmp.th.ring}dB、HNR {cmp.th.hnr}dB 以上）です。</p>
        </div>
      </details>
    </div>
  );
}
