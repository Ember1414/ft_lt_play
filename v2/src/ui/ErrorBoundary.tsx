import { Component } from 'preact';
import type { ComponentChildren } from 'preact';
import { recordDiag } from './diagnostics';
import { navigate } from '../router';

/**
 * ErrorBoundary — 应用级兜底（改进计划 A4）
 * Preact 10 原生支持（diff/catch-error.js 处理 getDerivedStateFromError + componentDidCatch）。
 * 任一页面渲染抛错不再白屏：显示「该工具出错」+ 重试 / 返回命令中心。
 */

interface Props {
  children: ComponentChildren;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }): void {
    recordDiag('boundary', error.message, [error.stack, info?.componentStack].filter(Boolean).join('\n\n—— 组件栈 ——\n'));
  }

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  private readonly goHome = (): void => {
    this.setState({ error: null });
    navigate({ page: 'home' });
  };

  render() {
    const err = this.state.error;
    if (!err) return this.props.children;
    return (
      <div class="stack">
        <section class="hero">
          <h1>该工具出错</h1>
          <p>界面渲染发生异常，已停止该视图以免错误扩大；本地保存的实验数据不受影响。</p>
        </section>
        <section class="card stack">
          <p>
            <strong>错误信息：</strong>
            <code>{err.message || '(无消息)'}</code>
          </p>
          <div class="row">
            <button class="btn primary" onClick={this.retry}>
              重试
            </button>
            <button class="btn" onClick={this.goHome}>
              返回命令中心
            </button>
          </div>
          <p class="muted">若反复出现，请到「设置中心 → 关于」导出诊断 JSON，再刷新页面重试。</p>
        </section>
      </div>
    );
  }
}
