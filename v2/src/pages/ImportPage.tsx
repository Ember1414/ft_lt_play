import { useState } from 'preact/hooks';
import { navigate } from '../router';
import { StatePanel, StatusBadge, Metric } from '../ui/components';
import { decodeShare, decodePackage, save } from '../core';
import { flushSave, setCurrent } from '../state/experiments';
import { toolById } from '../tools/registry';

/**
 * ImportPage — 分享码导入入口（#exp=… / #pkg=…）
 * `PX1.…` = 单个实验（校验后创建副本并打开）；`PK1.…` = 内容包（多个实验，逐个落库并可打开首个）。
 */
export interface ImportPageProps {
  code: string;
}

export function ImportPage(props: ImportPageProps) {
  const code = props.code;
  const isPkg = code.startsWith('PK1.');
  if (isPkg) return <PkgImport code={code} />;
  const r = decodeShare(code);
  if (!r.ok) {
    return (
      <div class="stack">
        <section class="hero">
          <h1>导入分享码</h1>
        </section>
        <StatePanel
          kind="error"
          title="分享码无法导入"
          desc={r.error.message + '（错误码：' + r.error.code + '）'}
          action={{ label: '返回命令中心', onClick: () => navigate({ page: 'home' }) }}
        />
      </div>
    );
  }
  const exp = r.value;
  return (
    <div class="stack">
      <section class="hero">
        <h1>导入分享码</h1>
        <p>
          分享码校验通过：<strong>{exp.name}</strong>（{toolById(exp.module)?.name ?? exp.module} · {exp.tags.join('、') || '无标签'}）。 确认后将在本机创建一份独立副本。
        </p>
      </section>
      <div class="row">
        <button
          class="btn primary"
          onClick={() => {
            setCurrent(exp);
            flushSave();
            navigate({ page: 'tool', toolId: exp.module });
          }}
        >
          导入并打开
        </button>
        <button class="btn" onClick={() => navigate({ page: 'home' })}>
          放弃
        </button>
      </div>
    </div>
  );
}

/** 内容包导入（#pkg=）：展示清单与逐项状态，导入后落库并可选打开首个 */
function PkgImport(props: { code: string }) {
  const [done, setDone] = useState(false);
  const r = decodePackage(props.code);
  if (!r.ok) {
    return (
      <div class="stack">
        <section class="hero">
          <h1>导入内容包</h1>
        </section>
        <StatePanel
          kind="error"
          title="内容包无法导入"
          desc={r.error.message + '（错误码：' + r.error.code + '）'}
          action={{ label: '返回命令中心', onClick: () => navigate({ page: 'home' }) }}
        />
      </div>
    );
  }
  const { meta, items, failed } = r.value;
  const first = items[0];

  const doImport = (openFirst: boolean): void => {
    for (const e of items) {
      try {
        save(e);
      } catch {
        /* 跳过失败项（数量上限等） */
      }
    }
    setDone(true);
    if (openFirst && first) {
      setCurrent(first);
      flushSave();
      navigate({ page: 'tool', toolId: first.module });
    }
  };

  return (
    <div class="stack">
      <section class="hero">
        <h1>
          导入内容包 <StatusBadge kind="info">PK1</StatusBadge>
        </h1>
        <p>
          内容包校验通过：<strong>{meta.name}</strong>
          {meta.author ? `（${meta.author}）` : ''} · 共 <strong>{items.length}</strong> 个实验
          {failed.length ? ` · 跳过 ${failed.length} 个无法解析项` : ''}。
        </p>
      </section>

      <section class="card stack">
        <div class="row">
          <Metric label="实验数" value={items.length} precision={0} />
          {failed.length ? <Metric label="跳过" value={failed.length} precision={0} /> : null}
          <Metric label="创建时间" value={meta.createdAt.slice(0, 19).replace('T', ' ')} />
        </div>
        {meta.desc ? <p class="muted">{meta.desc}</p> : null}
        <table class="tbl">
          <thead>
            <tr>
              <th>实验名称</th>
              <th style="width:150px">工具</th>
              <th style="width:90px">快照</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{toolById(e.module)?.name ?? e.module}</td>
                <td class="mono">{e.snapshots.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div class="row">
        {done ? (
          <StatusBadge kind="ok">已导入到本机</StatusBadge>
        ) : (
          <>
            <button class="btn primary" onClick={() => doImport(true)}>
              导入全部并打开首个
            </button>
            <button class="btn" onClick={() => doImport(false)}>
              仅导入不打开
            </button>
          </>
        )}
        <button class="btn" onClick={() => navigate({ page: 'experiments' })}>
          去实验管理
        </button>
        <button class="btn" onClick={() => navigate({ page: 'home' })}>
          返回命令中心
        </button>
      </div>
    </div>
  );
}
