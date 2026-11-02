import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { DetectedNoteFolder, VaultApproval, VaultConfig, VaultNote, VaultSearch } from '../types';
import { DirectoryPicker } from './DirectoryPicker';
import { Markdown } from './Markdown';

export const useVaultConfig = () =>
  useQuery({ queryKey: ['obsidian-config'], queryFn: ({ signal }) => api.vaultConfig(signal) });
const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : 'Vault operation failed';
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
        Allow vault writes
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
        Notes tools
      </label>
      {data?.vaultPath ? (
        <VaultWriteToggle config={data} />
      ) : (
        <a href="/notes">連接你的筆記</a>
      )}
      {enabled && (
        <span className="vault-hint">
          {external
            ? 'Retrieved note text is sent to OpenRouter. '
            : 'Search and note tools run locally. '}
          {ephemeral && 'Private chat does not prevent enabled vault writes. '}
          {data?.allowWrites ? 'Create/edit enabled; deletion always asks.' : 'Read-only.'}
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
        <strong title={approval.model}>{approval.model} wants to delete the following files</strong>
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
        I confirm deletion of these files
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
      setNotice(next.vaultPath ? 'Vault connected.' : 'Vault disconnected.');
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
          Connect a folder of Markdown notes (an Obsidian vault, a Logseq graph, an OpenClaw
          workspace or any folder of .md files) to search it here and give chat models note tools.
          Notes stay in their original folder.
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
          A connected vault is read-only by default, including for MCP clients. Enable writes to
          allow creating and editing notes; connecting a different vault turns them off again.
          Hidden folders, attachments and symlinks are excluded. Deletion always requires a separate
          checkbox and confirmation in chat.
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
                  {results.hits.length} results · {results.scanned} notes scanned
                  {results.skipped > 0 &&
                    ` · ${results.skipped} unsafe or unreadable files skipped`}
                  {results.truncated && ' · scan limit reached; use a smaller vault'}
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
                    setNotice('Markdown note created.');
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
