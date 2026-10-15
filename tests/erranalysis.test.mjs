/* ============================================================
 * erranalysis.test.mjs — 误差分析内核测试（v1.1.0 Phase 4）
 *   closedLoopMetrics：闭环谐振峰 Mr/ωr 与闭环带宽 ωb（对照解析值）
 *   errSeries：动态误差系数（Φe 幂级数长除展开，对照 Kp/Kv/Ka 与级数定义）
 *   pidLoopSim dSeq：对象输入端扰动的时域仿真（积分作用 → 阶跃扰动残差为 0）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['assets/js/lib/util.js', 'assets/js/lib/mathdsp.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
}
const { DSP } = sandbox;

let pass = 0;
const fails = [];
const ok = (n, c, extra) => { if (c) { pass++; return; } fails.push(n + (extra ? '  → ' + extra : '')); };
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol;

/* ---------- closedLoopMetrics：闭环 T = 1/(s²+s+1)（取 L = 1/(s²+s)，ωn=1, ζ=0.5） ---------- */
{
  const r = DSP.closedLoopMetrics([1], [1, 1, 0]);
  ok('二阶闭环 stable=true', r.ok && r.stable === true);
  // Mr = 1/(2ζ√(1−ζ²)) = 1/√0.75 ≈ 1.1547
  ok('Mr ≈ 1.1547（谐振峰值解析值）', near(r.Mr, 1.154701, 0.005), String(r.Mr));
  // ωr = ωn√(1−2ζ²) = √0.5
  ok('ωr ≈ 0.7071（峰值频率解析值）', near(r.wr, Math.SQRT1_2, 0.005), String(r.wr));
  // ωb：|T|²=1/((1−ω²)²+ω²)=1/2 → ω⁴−ω²−1=0 → ωb=√((1+√5)/2)
  ok('ωb ≈ 1.2720（−3dB 带宽解析值）', near(r.wb, Math.sqrt((1 + Math.sqrt(5)) / 2), 0.005), String(r.wb));

  // 一阶闭环 T=1/(s+2)（L=1/(s+1)）：无谐振峰，Mr=DC=0.5，ωb=2
  const r1 = DSP.closedLoopMetrics([1], [1, 1]);
  ok('一阶闭环 Mr=0.5（DC 增益，无谐振）', near(r1.Mr, 0.5, 0.005), String(r1.Mr));
  ok('一阶闭环 ωb=2', near(r1.wb, 2, 0.02), String(r1.wb));

  // 闭环不稳定：L=1/(s²−0.3s+1) → 闭环 s²−0.3s+2 有右半平面极点 → 指标无意义
  const ru = DSP.closedLoopMetrics([1], [1, -0.3, 1]);
  ok('闭环不稳定 → stable=false 且指标为 null', ru.ok && ru.stable === false && ru.Mr == null && ru.wr == null && ru.wb == null);

  // |T(j0)|=0：L=s/(s+1) → T=s/(2s+1)，DC=0 → ωb 无定义（null），不崩溃
  const rz = DSP.closedLoopMetrics([1, 0], [1, 1]);
  ok('T(j0)=0 → ωb=null 优雅退化', rz.ok && rz.stable === true && rz.wb == null, JSON.stringify({ wb: rz.wb, Mr: rz.Mr }));
}

/* ---------- errSeries：动态误差系数（Φe(s)=den/(den+num) 幂级数） ---------- */
{
  // 型别 0：L=6/(s+2) → k0 = 1/(1+Kp) = 1/4
  let r = DSP.errSeries([6], [1, 2], 3);
  ok('type0 k0 = 1/(1+Kp) = 0.25', r.ok && near(r.ks[0], 0.25), JSON.stringify(r.ks));

  // 型别 1：L=10/(s(s+1)) → k0=0、k1=1/Kv=0.1、k2=0.09（手算级数验证）
  r = DSP.errSeries([10], [1, 1, 0], 3);
  ok('type1 k0=0', r.ok && r.ks[0] === 0, JSON.stringify(r.ks));
  ok('type1 k1=1/Kv=0.1', near(r.ks[1], 0.1), JSON.stringify(r.ks));
  ok('type1 k2=0.09', near(r.ks[2], 0.09), JSON.stringify(r.ks));

  // 型别 1 带零点：L=4(s+1)/(s(s+2)) → k0=0、k1=1/Kv=0.5
  r = DSP.errSeries([4, 4], [1, 2, 0], 2);
  ok('type1 带零点 k0=0、k1=1/Kv=0.5', r.ok && r.ks[0] === 0 && near(r.ks[1], 0.5), JSON.stringify(r.ks));

  // 与 steadyState 交叉验证：k0 = ess.step = 1/(1+Kp)
  const sse = DSP.steadyState([6], [1, 2]);
  const k0 = DSP.errSeries([6], [1, 2], 1).ks[0];
  ok('k0 与 steadyState.ess.step 一致', near(k0, sse.ess.step));

  // 级数定义验证：前 6 项部分和在低频逼近 Φe(jω)=1/(1+L(jω))
  {
    const numL = [10], denL = [1, 1, 0];
    const ks = DSP.errSeries(numL, denL, 6).ks;
    const wv = 0.02;
    const hOpen = DSP.evalH(numL, denL, wv);
    const phi = DSP.cdiv({ re: 1, im: 0 }, { re: 1 + hOpen.re, im: hOpen.im });
    let acc = { re: 0, im: 0 }, pw = { re: 1, im: 0 };
    for (const k of ks) {
      acc.re += k * pw.re; acc.im += k * pw.im;
      const nr = pw.re * 0 - pw.im * wv, ni = pw.re * wv + pw.im * 0;
      pw = { re: nr, im: ni };
    }
    const err = Math.abs(acc.re - phi.re) + Math.abs(acc.im - phi.im);
    ok('级数前 6 项低频逼近 Φe(jω)（Δ=' + err.toExponential(2) + '）', err < 1e-6, `Δ=${err}`);
  }

  // 边界：相对阶 0 拒绝；闭环原点极点（D(0)=0）拒绝
  ok('相对阶 0（L=(s+2)/(s+0.5)）拒绝', !DSP.errSeries([1, 2], [1, 0.5], 3).ok);
  ok('D(0)=0（L=s/(s²+2s) 未约简）拒绝', !DSP.errSeries([1, 0], [1, 2, 0], 3).ok);
}

/* ---------- pidLoopSim dSeq：对象输入端扰动 ---------- */
{
  const P = { num: [1], den: [1, 1] };   // G = 1/(s+1)
  const OPTS = { tmax: 40, steps: 8000 };
  const tailAvg = (yd) => {
    const nT = Math.max(1, Math.floor(yd.length * 0.02));
    let acc = 0;
    for (let i = yd.length - nT; i < yd.length; i++) acc += yd[i];
    return acc / nT;
  };

  // ① PI（含积分作用）：单位阶跃扰动 → 稳态输出偏差 → 0
  const base = DSP.pidLoopSim(P.num, P.den, { kp: 2, ki: 3 }, OPTS);
  const wd = DSP.pidLoopSim(P.num, P.den, { kp: 2, ki: 3 }, { ...OPTS, dSeq: base.t.map(() => 1) });
  ok('带 dSeq 仿真正常（长度一致）', wd.ok && wd.y.length === base.y.length);
  ok('无扰动基线稳态跟踪 r=1', Math.abs(base.y[base.y.length - 1] - 1) < 0.01);
  const essdI = tailAvg(wd.y.map((v, i) => v - base.y[i]));
  ok('积分作用：阶跃扰动稳态偏差 → 0', Math.abs(essdI) < 0.01, `essd=${essdI.toFixed(5)}`);

  // ② 纯 P：阶跃扰动残差 = G(0)/(1+C(0)G(0)) = 1/3（无积分无法消除）
  const baseP = DSP.pidLoopSim(P.num, P.den, { kp: 2 }, OPTS);
  const wdP = DSP.pidLoopSim(P.num, P.den, { kp: 2 }, { ...OPTS, dSeq: baseP.t.map(() => 1) });
  const essdP = tailAvg(wdP.y.map((v, i) => v - baseP.y[i]));
  ok('纯 P：阶跃扰动残差 ≈ 1/3', Math.abs(essdP - 1 / 3) < 0.01, `essd=${essdP.toFixed(5)}`);

  // ③ 线性叠加：偏差 = d→y 通道阶跃响应 Y_d/D = G/(1+CG) = 1/(s+3)
  const ref = DSP.ltiResponse([1], [1, 3], (t) => (t >= 0 ? 1 : 0), 0, 40, 8000);
  let dv = 0;
  for (let i = 0; i < ref.y.length; i++) dv = Math.max(dv, Math.abs(ref.y[i] - (wdP.y[i] - baseP.y[i])));
  ok('扰动偏差与 Y_d/D=1/(s+3) 阶跃响应一致（maxDiff=' + dv.toFixed(5) + '）', dv < 2e-3, `maxDiff=${dv}`);

  // ④ 斜坡扰动 + 积分作用（型别 1 回路）：Y_d/D = s/(s²+3s+3) → 稳态偏差 1/3（有界但非零）
  const O4 = { tmax: 60, steps: 12000 };           // 基线必须与扰动仿真同参数，长度一致才能逐点相减
  const base4 = DSP.pidLoopSim(P.num, P.den, { kp: 2, ki: 3 }, O4);
  const wr = DSP.pidLoopSim(P.num, P.den, { kp: 2, ki: 3 }, { ...O4, dSeq: base4.t.map((t) => t) });
  const essdR = tailAvg(wr.y.map((v, i) => v - base4.y[i]));
  ok('斜坡扰动（型别 1 回路）稳态偏差 ≈ 1/3（型别不足）', wr.ok && Math.abs(essdR - 1 / 3) < 0.02, `essd=${essdR.toFixed(5)}`);

  // ⑤ 幅值线性缩放：A=2 的偏差 = 2×A=1 的偏差
  const O2 = { tmax: 20, steps: 4000 };
  const b0 = DSP.pidLoopSim(P.num, P.den, { kp: 2 }, O2);
  const w1 = DSP.pidLoopSim(P.num, P.den, { kp: 2 }, { ...O2, dSeq: b0.t.map(() => 1) });
  const w2 = DSP.pidLoopSim(P.num, P.den, { kp: 2 }, { ...O2, dSeq: b0.t.map(() => 2) });
  ok('扰动响应幅值线性缩放', w2.y.every((v, i) => Math.abs((v - b0.y[i]) - 2 * (w1.y[i] - b0.y[i])) < 1e-6));

  // ⑥ 向后兼容：缺省 dSeq 与 dSeq=null 逐点一致
  const n1 = DSP.pidLoopSim(P.num, P.den, { kp: 1 }, { tmax: 4, steps: 500 });
  const n2 = DSP.pidLoopSim(P.num, P.den, { kp: 1 }, { tmax: 4, steps: 500, dSeq: null });
  ok('dSeq=null 与缺省行为一致', n1.y.every((v, i) => v === n2.y[i]) && n1.u.every((v, i) => v === n2.u[i]));
}

console.log(fails.length
  ? `✗ erranalysis ${pass} 通过，${fails.length} 失败:\n  ` + fails.join('\n  ')
  : `✓ erranalysis ${pass} 项全部通过`);
process.exit(fails.length ? 1 : 0);
