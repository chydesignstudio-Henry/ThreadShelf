import { useCallback } from 'react';
import type { CollectionStats } from '../types';
import { Icons } from '../icons';
import { collLabel } from '../utils';
import { confirmDialog, toast } from '../toast';
import { useFilesQuery, useClearCollectionMutation, useDeleteCollectionMutation } from '../queries';

interface DangerRowProps {
  readonly title: string;
  readonly desc: string;
  readonly btn: string;
  readonly onClick: () => void;
}

function DangerRow({ title, desc, btn, onClick }: DangerRowProps) {
  return (
    <div className="danger-row">
      <div>
        <div className="title">{title}</div>
        <div className="desc">{desc}</div>
      </div>
      <button className="btn danger" onClick={onClick}>
        {Icons.trash} {btn}
      </button>
    </div>
  );
}

interface SettingsViewProps {
  readonly activeColl: string;
  readonly stats: Readonly<Record<string, CollectionStats>>;
  readonly onRefresh: () => Promise<void>;
  readonly onDeleted: () => void;
}

export function SettingsView({ activeColl, stats, onRefresh, onDeleted }: SettingsViewProps) {
  const isAll = activeColl === 'all' || activeColl === '__all__';
  const { data: filesData } = useFilesQuery(activeColl, !isAll);
  const files = filesData ? [...new Set(filesData.files.map((f) => f.sourceFile))] : null;

  const clearMutation = useClearCollectionMutation();
  const deleteMutation = useDeleteCollectionMutation();

  const doClear = useCallback(async () => {
    if (activeColl === 'threadshelf_conversations') {
      toast.error('ThreadShelf conversations are managed from the Chat page.');
      return;
    }
    const ok = await confirmDialog({
      title: `Clear indexed data for "${collLabel(activeColl)}"?`,
      message: '會刪除所有向量，但保留收藏集本身。',
      confirmLabel: '清除資料',
      danger: true,
    });
    if (!ok) return;
    try {
      await clearMutation.mutateAsync(activeColl);
      void onRefresh();
      toast.success(`Cleared "${collLabel(activeColl)}".`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '未知錯誤');
    }
  }, [activeColl, onRefresh, clearMutation]);

  const doDelete = useCallback(async () => {
    if (activeColl === 'chunks' || activeColl === 'threadshelf_conversations') {
      toast.error('無法刪除預設收藏集。');
      return;
    }
    const ok = await confirmDialog({
      title: `Delete collection "${collLabel(activeColl)}"?`,
      message:
        '會刪除索引與先前透過 ThreadShelf 上傳的副本。你原本選擇的資料夾中的檔案不受影響。',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(activeColl);
      await onRefresh();
      toast.success(`Deleted "${collLabel(activeColl)}".`);
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '未知錯誤');
    }
  }, [activeColl, onRefresh, onDeleted, deleteMutation]);

  if (isAll) {
    return (
      <div className="view">
        <div className="section-h">
          <h2>收藏集設定</h2>
          <span className="desc">從側邊欄選擇要管理的收藏集。</span>
        </div>
        <div className="banner info">
          <span className="ico">{Icons.info}</span>
          <div className="grow">
            以下進行中時停用破壞性操作： <b>所有收藏集</b> 已選取。
          </div>
        </div>
      </div>
    );
  }

  const st = stats[activeColl];
  const roles = st?.roles ?? { user: 0, thinking: 0, ai: 0 };
  const totalRoles = roles.user + roles.thinking + roles.ai;

  return (
    <div className="view">
      <div className="section-h">
        <h2>
          <span className="mono" style={{ fontWeight: 500 }}>
            {collLabel(activeColl)}
          </span>
        </h2>
        <span className="desc">本機 LanceDB 資料表</span>
      </div>

      <div className="panel" style={{ padding: 0 }}>
        <div className="stat-grid">
          <div className="stat">
            <span className="k">檔案</span>
            <span className="v">{(st?.files ?? 0).toLocaleString()}</span>
            <span className="d">來源匯出</span>
          </div>
          <div className="stat">
            <span className="k">區塊</span>
            <span className="v">{(st?.chunks ?? 0).toLocaleString()}</span>
            <span className="d">已索引向量</span>
          </div>
          <div className="stat">
            <span className="k">user</span>
            <span className="v">{roles.user.toLocaleString()}</span>
            <span className="d">使用者輪次</span>
          </div>
          <div className="stat">
            <span className="k">response</span>
            <span className="v">{roles.ai.toLocaleString()}</span>
            <span className="d">AI 輪次</span>
          </div>
        </div>

        {totalRoles > 0 && (
          <div className="role-dist">
            <div className="role-bar">
              <i className="user" style={{ flex: roles.user }} />
              <i className="thinking" style={{ flex: roles.thinking }} />
              <i className="ai" style={{ flex: roles.ai }} />
            </div>
            <div className="role-legend">
              <span>
                <i className="user" />
                User {roles.user}
              </span>
              <span>
                <i className="thinking" />
                Thinking {roles.thinking}
              </span>
              <span>
                <i className="ai" />
                Response {roles.ai}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>已索引檔案</h3>
          <span className="sub">{st?.files ?? 0} files</span>
        </div>
        <div className="file-list">
          {files === null && <div className="file-list-empty">載入中…</div>}
          {files && files.length === 0 && <div className="file-list-empty">沒有已索引的檔案。</div>}
          {files?.map((f, i) => {
            const short = String(f).replace(/\\/g, '/').split('/').pop();
            return (
              <div key={i} className="file-row">
                <i />
                <span className="name" title={String(f)}>
                  {short}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>危險區域</h3>
          <span className="sub">破壞性、無法復原</span>
        </div>
        <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {activeColl === 'threadshelf_conversations' ? (
            <p className="muted">
              This protected collection is maintained automatically from chats created or continued
              in ThreadShelf.
            </p>
          ) : (
            <>
              <DangerRow
                title="清除索引資料"
                desc="Drop all vectors but keep the collection itself."
                btn="清除資料"
                onClick={doClear}
              />
              <DangerRow
                title="刪除收藏集"
                desc="Delete the index and ThreadShelf upload copies. Files in your original folder stay untouched."
                btn="Delete"
                onClick={doDelete}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
