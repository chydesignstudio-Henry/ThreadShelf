import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type {
  DetectedNoteFolder,
  VaultApproval,
  VaultConfig,
  VaultNote,
  VaultSearch,
} from '../types';
import { DirectoryPicker } from './DirectoryPicker';
import { Markdown } from './Markdown';

export const useVaultConfig = () =>
  useQuery({ queryKey: ['obsidian-config'], queryFn: ({ signal }) => api.vaultConfig(signal) });
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : '筆記庫操作失敗';
export function VaultWriteToggle({ config }: { readonly config: VaultConfig }) {
  const queryClient = useQueryClient();
  const [pendingChoice, setPendingChoice] = useState<boolean | null>(null);
  const mutation = useMutation({
    mutationFn: (allowWrites: boolean) => api.setVaultWritePermission(allowWrites),
    onMutate: (allowWrites) => {
      void queryClient.cancelQueries({ queryKey: ['obsidian-config'] }, { revert: false });
      const previous = queryClient.getQueryData<VaultConfig>(['obsidian-config']);
      queryClient.setQueryData(['obsidian-config'], { ...config, allowWrites });
      return previous;
    },
    onError: (_error, _value, previous) => {
      if (previous) queryClient.setQueryData(['obsidian-config'], previous);
      setPendingChoice(null);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['obsidian-config'], next);
      setPendingChoice(null);
    },
  });
  return (
    <div>
      <label className="vault-check">
        <input
          id="vaultAllowWrites"
          type="checkbox"
          checked={pendingChoice ?? config.allowWrites}
          disabled={mutation.isPending}
          onChange={(event) => {
            setPendingChoice(event.target.checked);
            mutation.mutate(event.target.checked);
          }}
        />{' '}
        允許寫入筆記庫
      </label>
      {mutation.error && <p className="field-error">{errorText(mutation.error)}</p>}
    </div>
  );
}

export function ObsidianChatControls({
  enabled,
  onChange,
  sending,
  external,
  ephemeral,
}: {
  readonly enabled: boolean;
  readonly onChange: (value: boolean) => void;
  readonly sending: boolean;
  readonly external: boolean;
  readonly ephemeral: boolean;
}) {
  const { data, error } = useVaultConfig();
  return (
    <div className="vault-chat-controls">
      <label className="vault-check">
        <input
          id="chatUseObsidian"
          type="checkbox"
          checked={enabled}
          disabled={sending || !data?.vaultPath}
          onChange={(event) => onChange(event.target.checked)}
        />{' '}
        筆記工具
      </label>
      {data?.vaultPath ? <VaultWriteToggle config={data} /> : <a href="/notes">連接你的筆記</a>}
      {enabled && (
        <span className="vault-hint">
          {external ? '取得的筆記內容會傳送到 OpenRouter。' : '搜尋與筆記工具在本機執行。'}
          {ephemeral && '私密聊天不會阻止已啟用的筆記庫寫入。'}
          {data?.allowWrites ? '已啟用建立／編輯；刪除一律會詢問。' : '唯讀。'}
        </span>
      )}
      {error && <span className="field-error">{errorText(error)}</span>}
    </div>
  );
}

export function VaultDeleteApproval({
  approval,
  onDecision,
}: {
  readonly approval: VaultApproval;
  readonly onDecision: () => void;
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const decide = async (approve: boolean) => {
    setBusy(true);
    setError('');
    try {
      await api.decideVaultDeletion(approval, approve, approve && checked);
      onDecision();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="vault-approval" role="group" aria-label="確認刪除筆記">
      <header>
        <strong title={approval.model}>{approval.model} 要求刪除以下檔案</strong>
        <button
          className="btn sm ghost"
          aria-label="取消刪除筆記"
          disabled={busy}
          onClick={() => void decide(false)}
        >
          ×
        </button>
      </header>
      <ul>
        {approval.files.map((path) => (
          <li key={path} title={path}>
            {path}
          </li>
        ))}
      </ul>
      <p>檔案會移到筆記庫的 .trash 資料夾。核准 5 分鐘後失效。</p>
      <label className="vault-check">
        <input
          id="vaultDeleteAcknowledged"
          type="checkbox"
          checked={checked}
          disabled={busy}
          onChange={(event) => setChecked(event.target.checked)}
        />{' '}
        我確認刪除這些檔案
      </label>
      {error && <p className="field-error">{error}</p>}
      <footer>
        <button className="btn" disabled={busy} onClick={() => void decide(false)}>
          取消
        </button>
        <button
          id="vaultDeleteConfirm"
          className="btn danger"
          disabled={!checked || busy}
          onClick={() => void decide(true)}
        >
          確定，刪除檔案
        </button>
      </footer>
    </section>
  );
}

export function ObsidianPanel() {
  const { data: config, error: configError } = useVaultConfig();
  const { data: detected } = useQuery({
    queryKey: ['note-folders'],
    queryFn: ({ signal }) => api.detectNoteFolders(signal),
  });
  const queryClient = useQueryClient();
  const [draftPath, setDraftPath] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<VaultSearch | null>(null);
  const [note, setNote] = useState<VaultNote | null>(null);
  const [newPath, setNewPath] = useState('');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const path = draftPath ?? config?.vaultPath ?? '';
  const operation = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };
  const connect = (vaultPath: string) =>
    void operation(async () => {
      // The server keeps the write choice for the same vault; a new vault starts read-only.
      const next = await api.saveVaultConfig({ vaultPath });
      queryClient.setQueryData(['obsidian-config'], next);
      setDraftPath(null);
      setResults(null);
      setNote(null);
      setNotice(next.vaultPath ? '已連接筆記庫。' : '已中斷筆記庫連接。');
    });
  const suggestions = (detected?.folders ?? []).filter(
    (folder: DetectedNoteFolder) => folder.path !== config?.vaultPath,
  );
  return (
    <section className="panel vault-panel" id="obsidianPanel">
      <div className="panel-head">
        <h3>Markdown 筆記</h3>
        <span className="sub">Obsidian · Logseq · OpenClaw · 任何 .md 資料夾</span>
      </div>
      <div className="panel-body">
        <p>
          連接一個 Markdown 筆記資料夾（Obsidian 筆記庫、Logseq graph、OpenClaw 工作區或任何 .md
          資料夾），即可在此搜尋，並讓聊天模型使用筆記工具。筆記會留在原本的資料夾。
        </p>
        {suggestions.length > 0 && (
          <div className="vault-detected">
            <span className="vault-detected-title">在此電腦上找到</span>
            <ul>
              {suggestions.map((folder) => (
                <li key={folder.path}>
                  <span className="vault-detected-name">
                    <b>{folder.name}</b>
                    <span>
                      {folder.source} · {folder.path}
                    </span>
                  </span>
                  <button
                    className="btn"
                    disabled={busy || !config}
                    onClick={() => connect(folder.path)}
                  >
                    連接
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <label htmlFor="obsidianVaultPath">筆記資料夾</label>
        <input
          id="obsidianVaultPath"
          value={path}
          onChange={(event) => setDraftPath(event.target.value)}
          placeholder="筆記資料夾的絕對路徑"
        />
        <DirectoryPicker initialPath={path} onSelect={setDraftPath} label="瀏覽資料夾…" />
        <div className="vault-actions">
          <button className="btn" disabled={busy || !config} onClick={() => connect(path)}>
            儲存筆記庫
          </button>
          {config?.vaultPath && (
            <button className="btn ghost" disabled={busy} onClick={() => setDraftPath('')}>
              中斷連接（然後儲存）
            </button>
          )}
        </div>
        {config?.vaultPath && <VaultWriteToggle config={config} />}
        <p className="vault-hint">
          已連接的筆記庫預設為唯讀（MCP
          用戶端也一樣）。開啟寫入才能建立與編輯筆記；改連其他筆記庫時會再次關閉。隱藏資料夾、附件與符號連結都會排除。刪除一律需另外勾選並在聊天中確認。
        </p>
        {config?.vaultPath && (
          <>
            <form
              className="vault-search"
              onSubmit={(event) => {
                event.preventDefault();
                void operation(async () => {
                  setResults(await api.searchVault(query));
                  setNote(null);
                });
              }}
            >
              <input
                id="obsidianSearchInput"
                aria-label="搜尋 Obsidian 筆記"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="筆記內容或路徑中的字詞"
                maxLength={1000}
              />
              <button className="btn" disabled={busy || !query.trim()}>
                搜尋筆記庫
              </button>
            </form>
            {results && (
              <div className="vault-results">
                <p>
                  {results.hits.length} 筆結果 · 已掃描 {results.scanned} 則筆記
                  {results.skipped > 0 && ` · 已略過 ${results.skipped} 個不安全或無法讀取的檔案`}
                  {results.truncated && ' · 已達掃描上限，請使用較小的筆記庫'}
                </p>
                {results.hits.map((hit) => (
                  <button
                    type="button"
                    className="vault-result"
                    key={hit.path}
                    disabled={busy}
                    onClick={() =>
                      void operation(async () => setNote(await api.readVaultNote(hit.path)))
                    }
                  >
                    <strong title={hit.title}>{hit.title}</strong>
                    <span title={hit.path}>
                      {hit.path}:{hit.line}
                    </span>
                    <pre>{hit.snippet}</pre>
                  </button>
                ))}
              </div>
            )}
            {note && (
              <article className="vault-note">
                <header>
                  <strong title={note.path}>{note.path}</strong>
                  <a
                    className="btn sm"
                    href={`obsidian://open?path=${encodeURIComponent(`${config.vaultPath.replace(/\\/g, '/')}/${note.path}`)}`}
                  >
                    在 Obsidian 開啟
                  </a>
                </header>
                <Markdown text={note.content} />
              </article>
            )}
            <details>
              <summary>建立 Markdown 筆記</summary>
              <label htmlFor="obsidianNewPath">筆記相對路徑（.md）</label>
              <input
                id="obsidianNewPath"
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                placeholder="new-note.md"
              />
              <label htmlFor="obsidianNewContent">Markdown</label>
              <textarea
                id="obsidianNewContent"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                rows={6}
              />
              <button
                className="btn"
                disabled={busy || !config.allowWrites || !newPath.trim()}
                onClick={() =>
                  void operation(async () => {
                    setNote(await api.createVaultNote(newPath, content));
                    setNewPath('');
                    setContent('');
                    setNotice('已建立 Markdown 筆記。');
                  })
                }
              >
                建立筆記
              </button>
            </details>
          </>
        )}
        {(error || configError) && (
          <p className="field-error" role="alert">
            {error || errorText(configError)}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    </section>
  );
}
