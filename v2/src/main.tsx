import { render } from 'preact';
import { App } from './app';
import { initTheme } from './ui/theme';
import { initPrefs } from './ui/prefs';
import { restoreLastSession } from './state/experiments';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';

// 公式层（M3 代码分割）：KaTeX（MIT，离线可用）改为按需动态加载 —— 首个 <TeX> 渲染时才拉取其
// JS + CSS 分片，主包不再包含 KaTeX；加载期间 TeX 组件自动纯文本降级（见 ui/TeX.tsx）。

initTheme();
initPrefs();
// 渲染前恢复最近一次实验：子组件 effect 先于父组件执行，
// 若放在 App 的 useEffect 中，工作区的 ensureExperiment 会抢先创建空实验。
restoreLastSession();

const mount = document.getElementById('app');
if (mount) render(<App />, mount);