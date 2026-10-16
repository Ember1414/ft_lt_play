import { useEffect, useState } from 'preact/hooks';
import { SegmentedChips, Metric, StatusBadge, StatePanel } from '../ui/components';
import { CHOICE_LABEL, getThemeChoice, setThemeChoice, type ThemeChoice } from '../ui/theme';
import { MOTION_LABEL, getMotionPref, setMotionPref, type MotionPref } from '../ui/prefs';
import {
  MAX_EXPERIMENTS,
  MAX_STATE_BYTES,
  SCHEMA_VERSION,
  importJSON,
  load,
  save,
  type Experiment,
} from '../core';
import {
  getCurrent,
  listExperiments,
  removeExperiment,
  setCurrent,
  storageAvailable,
  subscribe,
} from '../state/experiments';
import { clearUserScripts, getUserScripts, isUserScript, saveUserScript } from '../state/theater';
import { TOOLS } from '../tools/registry';
import { downloadText } from '../report/report';
import { buildBackup, readBackup } from '../report/backup';

/**
 * Settings — 设置中心（FR-08 / §12.5）
 * 外观（主题 · 动效）· 存储（用量 · 清理）· 备份与恢复（全部实验 + 自建剧场剧本 JSON 导出/导入）·
 * 快捷键总览 · 关于（版本 / 内核 / 隐私）。所有写入均带确认，失败给出原因。
 */

const APP_VERSION = '2.15.0 (M20)';
const PATHS_KEY = 'v2:paths:progress';
const THEME_KEY = 'flt2:theme';
const MOTION_KEY = 'flt2:motion';

const THEME_OPTS: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: 'light', label: CHOICE_LABEL.light },
  { value: 'dark', label: CHOICE_LABEL.dark },
  { value: 'auto', label: CHOICE_LABEL.auto },
];

const MOTION_OPTS: ReadonlyArray<{ value: MotionPref; label: string }> = [
  { value: 'auto', label: MOTION_LABEL.auto },
  { value: 'reduce', label: MOTION_LABEL.reduce },
  { value: 'full', label: MOTION_LABEL.full },
];

const SHORTCUTS: ReadonlyArray<{ keys: string; desc: string }> = [
  { keys: '⌘K / Ctrl+K', desc: '打开命令面板（任意页面可用）' },
  { keys: 'Esc', desc: '逐层关闭：命令面板 → 抽屉 → 弹层' },
  { keys: '⌘Z / Ctrl+Z', desc: '撤销（工作区内参数改动）' },
  { keys: '⌘⇧Z / Ctrl+Shift+Z', desc: '重做' },
  { keys: '双击图表', desc: '复位缩放/平移（图表层统一行为）' },
  { keys: '滚轮 / 拖动', desc: '图表缩放 / 平移；按住 Shift 精调数值' },
];

function storageBytes(): { total: number; byKey: Array<{ k: string; bytes: number }> } {
  let total = 0;
  const byKey: Array<{ k: string; bytes: number }> = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) ?? '';
      const bytes = (k.length + v.length) * 2; // UTF-16 近似
      total += bytes;
      byKey.push({ k, bytes });
    }
  } catch {
    /* 存储不可用 */
  }
  byKey.sort((a, b) => b.bytes - a.bytes);
  return { total, byKey };
}

const fmtBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB`);

export interface SettingsProps {
  onToast: (msg: string) => void;
}

export function Settings(props: SettingsProps) {
  const { onToast } = props;
  const [theme, setTheme] = useState<ThemeChoice>(() => getThemeChoice());
  const [motion, setMotion] = useState<MotionPref>(() => getMotionPref());
  const [rev, setRev] = useState(0);
  useEffect(() => subscribe(() => setRev((x) => x + 1)), []);

  const exps = listExperiments();
  const bytes = storageBytes();
  void rev;

  const pickTheme = (c: ThemeChoice): void => {
    setTheme(c);
    setThemeChoice(c);
  };
  const pickMotion = (m: MotionPref): void => {
    setMotion(m);
    setMotionPref(m);
  };

  const clearPaths = (): void => {
    if (!confirm('清除全部学习路径进度？')) return;
    try {
      localStorage.removeItem(PATHS_KEY);
      onToast('已清除学习路径进度');
      setRev((x) => x + 1);
    } catch {
      onToast('清除失败：存储不可用');
    }
  };

  const deleteAll = (): void => {
    if (!exps.length) {
      onToast('没有可删除的实验');
      return;
    }
    if (!confirm(`删除全部 ${exps.length} 个实验？此操作不可撤销。`)) return;
    let n = 0;
    for (const m of exps.slice()) {
      try {
        removeExperiment(m.id);
        n++;
      } catch {
        /* 跳过失败项 */
      }
    }
    onToast(`已删除 ${n} 个实验`);
    setRev((x) => x + 1);
  };

  const factoryReset = (): void => {
    if (!confirm('恢复出厂设置：清除全部实验、自建剧场剧本、路径进度与外观偏好？此操作不可撤销。')) return;
    for (const m of exps.slice()) {
      try {
        removeExperiment(m.id);
      } catch {
        /* 跳过 */
      }
    }
    clearUserScripts();
    try {
      localStorage.removeItem(PATHS_KEY);
      localStorage.removeItem(THEME_KEY);
      localStorage.removeItem(MOTION_KEY);
    } catch {
      /* 忽略 */
    }
    setTheme('auto');
    setMotion('auto');
    setThemeChoice('auto');
    setMotionPref('auto');
    onToast('已恢复出厂设置');
    setRev((x) => x + 1);
  };

  const exportBackup = (): void => {
    const items: Experiment[] = [];
    for (const m of exps) {
      const raw = load(m.id);
      if (!raw) continue;
      // 经 importJSON 归一化+校验（等价于"导出前自检"），保证备份包内每项合法
      const r = importJSON(JSON.stringify({ experiment: raw }));
      if (r.ok) items.push(r.value);
    }
    // M10：自建剧场剧本库一并入包（内置剧本属代码内置，无需备份）
    const scripts = getUserScripts();
    const bundle = buildBackup(items, scripts, APP_VERSION);
    downloadText(`fltp-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(bundle, null, 2), 'application/json');
    onToast(`已导出备份（${items.length} 个实验 + ${scripts.length} 部自建剧本）`);
  };

  const importBackup = async (file: File): Promise<void> => {
    let text = '';
    try {
      text = await file.text();
    } catch {
      onToast('读取文件失败');
      return;
    }
    const parsed = readBackup(text);
    if (!parsed.ok) {
      onToast(parsed.error);
      return;
    }
    let ok = 0;
    let bad = 0;
    for (const item of parsed.experiments) {
      const r = importJSON(JSON.stringify(item));
      if (!r.ok) {
        bad++;
        continue;
      }
      try {
        save(r.value);
        ok++;
      } catch {
        bad++;
      }
    }
    // M10：自建剧场剧本（旧版备份无此字段 → null，只恢复实验；非法项由 sanitizeScript 拒绝并计数）
    let sok = 0;
    let sbad = 0;
    let sovr = 0;
    if (parsed.theaterScripts) {
      for (const sc of parsed.theaterScripts) {
        const existed = isUserScript((sc as { id?: string } | null)?.id ?? '');
        const r = saveUserScript(sc);
        if (r.ok) {
          sok++;
          if (existed) sovr++;
        } else {
          sbad++;
        }
      }
    }
    setCurrent(getCurrent()); // 触发订阅刷新
    const scriptPart = parsed.theaterScripts
      ? `；自建剧本 成功 ${sok}${sovr ? `（覆盖 ${sovr}）` : ''}${sbad ? ` / 失败 ${sbad}` : ''}`
      : '';
    onToast(`导入完成：实验 成功 ${ok}${bad ? ` / 失败 ${bad}` : ''}${scriptPart}`);
    setRev((x) => x + 1);
  };

  if (!storageAvailable()) {
    return (
      <div class="stack">
        <section class="hero">
          <h1>设置中心</h1>
        </section>
        <StatePanel
          kind="empty"
          title="本地存储不可用"
          desc="当前为临时会话（隐私模式或配额受限）：外观偏好本次有效，实验与进度不会保存。"
        />
      </div>
    );
  }

  return (
    <div class="stack">
      <section class="hero">
        <h1>设置中心</h1>
        <p>外观 · 存储 · 备份与恢复 · 快捷键。所有数据本地优先（不出浏览器）；偏好改动即时生效并保存。</p>
      </section>

      <section class="card stack">
        <h3>外观</h3>
        <div class="row">
          <span class="muted" style="min-width:64px">主题</span>
          <SegmentedChips options={THEME_OPTS} value={theme} onChange={pickTheme} ariaLabel="主题" />
        </div>
        <div class="row">
          <span class="muted" style="min-width:64px">动效</span>
          <SegmentedChips options={MOTION_OPTS} value={motion} onChange={pickMotion} ariaLabel="动效偏好" />
        </div>
        <p class="muted">
          动效「跟随系统」= 尊重 <code>prefers-reduced-motion</code>；「强制减弱」关闭全部动画与过渡；「强制完整」忽略系统偏好。
        </p>
      </section>

      <section class="card stack">
        <h3>存储</h3>
        <div class="row">
          <Metric label="实验数" value={exps.length} precision={0} />
          <Metric label="自建剧场剧本" value={getUserScripts().length} precision={0} />
          <Metric label="上限" value={MAX_EXPERIMENTS} precision={0} />
          <Metric label="单实验状态上限" value={Math.round(MAX_STATE_BYTES / 1024)} precision={0} unit="KB" />
          <Metric label="本地占用（近似）" value={fmtBytes(bytes.total)} />
          <Metric label="工具数" value={TOOLS.length} precision={0} />
        </div>
        <details>
          <summary class="muted">按存储键查看占用（{bytes.byKey.length} 项）</summary>
          <table class="tbl scroll">
            <thead>
              <tr>
                <th>键</th>
                <th style="width:110px">近似字节</th>
              </tr>
            </thead>
            <tbody>
              {bytes.byKey.map((b) => (
                <tr key={b.k}>
                  <td class="mono">{b.k}</td>
                  <td class="mono">{fmtBytes(b.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
        <div class="row">
          <button class="btn" onClick={clearPaths}>
            清除学习路径进度
          </button>
          <button class="btn danger" onClick={deleteAll}>
            删除全部实验
          </button>
          <button class="btn danger" onClick={factoryReset}>
            恢复出厂设置
          </button>
        </div>
        <p class="muted">删除操作均需二次确认；失败会给出原因，不静默忽略（存储不可用时顶部已有常驻提示）。</p>
      </section>

      <section class="card stack">
        <h3>备份与恢复</h3>
        <p class="muted">
          导出一个 JSON 备份包（含<strong>全部实验</strong>的完整状态与快照，以及<strong>自建剧场剧本</strong>）；
          导入时逐个校验并迁移，损坏项跳过并计数（旧版备份无剧本字段时只恢复实验）。
        </p>
        <div class="row">
          <button class="btn primary" onClick={exportBackup}>
            导出全部数据（JSON）
          </button>
          <label class="btn" style="cursor:pointer">
            导入备份文件…
            <input
              type="file"
              accept=".json,application/json"
              style="display:none"
              onChange={(e) => {
                const f = (e.currentTarget as HTMLInputElement).files?.[0];
                if (f) void importBackup(f);
                (e.currentTarget as HTMLInputElement).value = '';
              }}
            />
          </label>
          <span class="muted">也可用实验管理页的分享码（单实验）。</span>
        </div>
        <p class="muted">
          分享码上限 {MAX_STATE_BYTES / 1024} KB/实验；备份包不受分享码长度限制（本地文件）。
          自建剧本另有「演示剧场」页的 `TS1.…` 分享码 / 剧本 `.json` 文件两种单剧本通道。
        </p>
      </section>

      <section class="card stack">
        <h3>快捷键总览</h3>
        <table class="tbl">
          <thead>
            <tr>
              <th style="width:220px">按键</th>
              <th>作用</th>
            </tr>
          </thead>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.keys}>
                <td class="mono">{s.keys}</td>
                <td>{s.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section class="card stack">
        <h3>关于</h3>
        <div class="row">
          <Metric label="版本" value={APP_VERSION} />
          <Metric label="数据格式版本" value={SCHEMA_VERSION} precision={0} />
          <StatusBadge kind="ok">本地优先 · 数据不出浏览器</StatusBadge>
          <StatusBadge kind="info">公式层 KaTeX 按需加载（离线可用）</StatusBadge>
        </div>
        <p class="muted">
          内核（变换 / 滤波器 / 控制器 / 随机信号 / 通信 + 状态空间）为纯函数层，受 v1↔v2 数值对拍网与闭式真值校验双重保障；
          本页不含任何远程请求。
        </p>
      </section>
    </div>
  );
}
