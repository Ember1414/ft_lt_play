import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { TOOLS, toolById } from '../tools/registry';
import { navigate } from '../router';
import { CHOICE_LABEL, nextChoice, setThemeChoice, getThemeChoice } from './theme';
import { flushSave, latestExperiment, openExperiment, storageAvailable } from '../state/experiments';

/**
 * CommandPalette — 命令面板 2.0（FR-08）
 * ⌘K/Ctrl+K 任何页面可用；动作化（跳转 / 新建 / 主题 / 导入 / 帮助），带最近动作；
 * ↑↓ 选择、Enter 执行、Esc 关闭（与 §4.1 全局 Esc 逐层关闭一致）。
 */

export interface CmdAction {
  id: string;
  title: string;
  hint: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onToast: (msg: string) => void;
  onHelp: () => void;
}

const RECENT_KEY = 'v2:recent-actions';
const RECENT_MAX = 5;

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? (arr as string[]).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecent(id: string): void {
  try {
    const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 存储不可用则忽略 */
  }
}

export function CommandPalette(props: CommandPaletteProps) {
  const { open, onClose, onToast, onHelp } = props;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [recent, setRecent] = useState<string[]>(readRecent);
  const inputRef = useRef<HTMLInputElement>(null);

  const actions = useMemo<CmdAction[]>(() => {
    const list: CmdAction[] = [];
    // 工具跳转（14 个，按注册表顺序）
    for (const t of TOOLS) {
      list.push({
        id: 'tool:' + t.id,
        title: t.name + (t.status === 'wip' ? '（建设中）' : ''),
        hint: '工具 · ' + t.blurb,
        run: () => navigate({ page: 'tool', toolId: t.id }),
      });
    }
    // 页面跳转
    list.push({ id: 'page:home', title: '命令中心', hint: '页面 · 返回首页', run: () => navigate({ page: 'home' }) });
    list.push({ id: 'page:paths', title: '学习路径与自测', hint: '页面 · 3 条路径 + 进度', run: () => navigate({ page: 'paths' }) });
    list.push({ id: 'page:compare', title: '对比实验 A/B', hint: '页面 · A/B 并排 + 参数指标差异', run: () => navigate({ page: 'compare' }) });
    list.push({ id: 'page:theater', title: '演示剧场', hint: '页面 · 一键播放叙事演示（可暂停/变速）', run: () => navigate({ page: 'theater' }) });
    list.push({ id: 'page:experiments', title: '实验管理', hint: '页面 · 列表 / 快照 / 分享', run: () => navigate({ page: 'experiments' }) });
    list.push({ id: 'page:settings', title: '设置中心', hint: '页面 · 外观 / 存储 / 备份', run: () => navigate({ page: 'settings' }) });
    list.push({ id: 'page:baseline', title: '基线与符号表', hint: '页面 · 设计令牌 + 符号登记表', run: () => navigate({ page: 'baseline' }) });
    list.push({ id: 'page:gallery', title: '控件画廊', hint: '页面 · 统一输入显示契约', run: () => navigate({ page: 'gallery' }) });
    // 动作
    list.push({
      id: 'act:continue',
      title: '继续上次实验',
      hint: '动作 · 回到最近一次工作区状态',
      run: () => {
        const latest = latestExperiment();
        if (!latest) {
          onToast('暂无历史实验，可从模板快速开始');
          navigate({ page: 'home' });
          return;
        }
        if (openExperiment(latest.id)) onToast('已恢复实验「' + latest.name + '」');
        else onToast('实验打开失败');
      },
    });
    list.push({
      id: 'act:save',
      title: '立即保存当前实验',
      hint: '动作 · 写入本地存储',
      run: () => {
        flushSave();
        onToast(storageAvailable() ? '已保存' : '存储不可用，当前为临时会话');
      },
    });
    list.push({
      id: 'act:theme',
      title: '切换主题（' + CHOICE_LABEL[getThemeChoice()] + '）',
      hint: '动作 · 浅色 / 深色 / 跟随系统',
      run: () => {
        const nx = nextChoice(getThemeChoice());
        setThemeChoice(nx);
        onToast('主题：' + CHOICE_LABEL[nx]);
      },
    });
    list.push({ id: 'act:help', title: '键盘与快捷键', hint: '动作 · 帮助', run: onHelp });
    return list;
  }, [onToast, onHelp]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const base = kw
      ? actions.filter((a) => (a.title + ' ' + a.hint).toLowerCase().includes(kw))
      : actions;
    if (kw) return base.slice(0, 16);
    // 无输入：最近动作置顶 + 其余（去重）；列表可滚动，不截断
    const rec = recent.map((id) => base.find((a) => a.id === id)).filter((a): a is CmdAction => !!a);
    const rest = base.filter((a) => !recent.includes(a.id));
    return [...rec, ...rest];
  }, [actions, q, recent]);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
      setRecent(readRecent());
      // 打开后聚焦输入（含移动端软键盘友好）
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setSel(0), [q]);

  if (!open) return null;

  const exec = (a: CmdAction | undefined): void => {
    if (!a) return;
    writeRecent(a.id);
    a.run();
    onClose();
  };

  return (
    <div class="cmdk-mask" onClick={onClose}>
      <div class="cmdk" role="dialog" aria-modal="true" aria-label="命令面板" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          class="cmdk-input"
          placeholder="搜索工具 / 动作 / 页面…（Esc 关闭）"
          value={q}
          onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              exec(filtered[sel]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div class="cmdk-list" role="listbox">
          {filtered.length === 0 ? <div class="cmdk-empty">没有匹配的命令</div> : null}
          {filtered.map((a, i) => (
            <button
              key={a.id}
              type="button"
              role="option"
              aria-selected={i === sel}
              class={'cmdk-item' + (i === sel ? ' is-on' : '')}
              onMouseEnter={() => setSel(i)}
              onClick={() => exec(a)}
            >
              <span class="cmdk-title">{a.title}</span>
              <span class="cmdk-hint">{a.hint}</span>
            </button>
          ))}
        </div>
        <div class="cmdk-foot">
          <span>↑↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
          <span class="spacer" />
          <span>{toolById('sys') ? '工具 ' + TOOLS.length + ' 个' : ''}</span>
        </div>
      </div>
    </div>
  );
}