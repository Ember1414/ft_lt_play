import { useEffect, useRef, useState } from 'preact/hooks';
import { voiceToExpr } from '../core';

/**
 * VoiceInput — 语音输入入口（M3；v1「交互求解 · 语音页签」的等价能力）
 * 使用 Web Speech API（Chrome / Edge 可用）；识别结果经 core.voiceToExpr 归一为表达式文本后交回。
 * 契约：必须由用户手势触发（麦克风权限与 CSP 已就绪）；不支持/被拒/无语音均给出**具体原因**而非静默失败。
 */

interface SRResultItem {
  isFinal: boolean;
  0: { transcript: string };
}
interface SRResultEvent {
  resultIndex: number;
  results: ArrayLike<SRResultItem>;
}
interface SRErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SRResultEvent) => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SRCtor = new () => SpeechRecognitionLike;

function getCtor(): SRCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 错误码 → 人话（必须给出原因而非静默失败） */
const ERR_TEXT: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝：请在浏览器地址栏允许本站使用麦克风',
  'service-not-allowed': '系统禁止语音服务：请检查浏览器/系统隐私设置',
  'audio-capture': '未检测到可用麦克风',
  'no-speech': '没有听到语音，请靠近麦克风再试',
  network: '语音识别服务网络异常',
  aborted: '语音识别已中止',
};

export interface VoiceInputProps {
  /** 识别结果（已归一为表达式文本） */
  onResult: (expr: string) => void;
  label?: string;
  lang?: string;
  /** 追加到输入框而不是覆盖（默认覆盖） */
  appendTo?: string;
}

export function VoiceInput(props: VoiceInputProps) {
  const { onResult, label = '语音输入', lang = 'zh-CN' } = props;
  const [listening, setListening] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [kind, setKind] = useState<'ok' | 'err' | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const bufRef = useRef('');

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* 已结束 */
      }
      recRef.current = null;
    },
    [],
  );

  const start = (): void => {
    const Ctor = getCtor();
    if (!Ctor) {
      setKind('err');
      setMsg('当前浏览器不支持语音识别，请改用 Chrome / Edge（或直接键入表达式）');
      return;
    }
    if (listening) {
      try {
        recRef.current?.stop();
      } catch {
        /* 忽略 */
      }
      setListening(false);
      return;
    }
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = lang;
    rec.continuous = false;
    rec.interimResults = true;
    bufRef.current = '';
    setMsg(null);
    setKind(null);
    rec.onresult = (e) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r && r[0] && typeof r[0].transcript === 'string') text += r[0].transcript;
      }
      if (text.trim()) bufRef.current = text;
    };
    rec.onerror = (e) => {
      setKind('err');
      setMsg(ERR_TEXT[e.error] || `语音识别失败（${e.error || '未知错误'}）`);
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      const raw = bufRef.current.trim();
      if (!raw) return;
      const expr = voiceToExpr(raw);
      setKind('ok');
      setMsg(`识别到「${raw}」→ ${expr}`);
      try {
        onResult(expr);
      } catch {
        setKind('err');
        setMsg('已识别，但写入表达式失败');
      }
    };
    try {
      rec.start();
      setListening(true);
      setMsg('正在聆听…（说完稍等片刻自动结束）');
      setKind(null);
    } catch (e) {
      setKind('err');
      setMsg((e as Error).message || '语音识别无法启动');
      setListening(false);
    }
  };

  return (
    <span class="voice-wrap">
      <button
        type="button"
        class={'btn' + (listening ? ' is-on' : '')}
        aria-pressed={listening}
        onClick={start}
        title={listening ? '点击结束识别' : '点击开始语音输入（需麦克风权限）'}
      >
        {listening ? '● 停止聆听' : '🎙 ' + label}
      </button>
      {msg ? (
        <span class={'voice-msg' + (kind === 'err' ? ' is-err' : kind === 'ok' ? ' is-ok' : '')} role="status">
          {msg}
        </span>
      ) : null}
    </span>
  );
}
