import { useState, useRef, useMemo, useCallback } from 'react';
import type { FilePreview, IngestProgress, IngestStreamEvent, StatusMessage } from '../types';
import { Icons } from '../icons';
import { api } from '../api';
import { collLabel, fmtTime, isPotentialExport } from '../utils';
import { NewCollectionModal } from './NewCollectionModal';

function formatProgressStep(event: IngestStreamEvent): string {
  const total = event.totalFiles || 1;
  const done = event.processedFiles || 0;
  const phase = (event.phase || '').toLowerCase();

  if (phase === 'uploading') return `上傳中 ${done} / ${total} 個檔案`;
  if (phase === 'reading') return `讀取中 ${done} / ${total} 個檔案`;
  if (phase === 'embedding')
    return event.embeddingTotal !== undefined
      ? `嵌入中 ${event.embeddingDone ?? 0} / ${event.embeddingTotal} 個區塊`
      : `嵌入中 ${done} / ${total} 個檔案`;
  if (event.status === 'starting') return `開始 0 / ${total} 個檔案`;
  return `${done} / ${total} 個檔案`;
}

function progressFromEvent(event: IngestStreamEvent): IngestProgress {
  const total = event.totalFiles || 1;
  const done = event.processedFiles || 0;

  return {
    pct: Math.round(event.progressPercent ?? (done / total) * 100),
    step: formatProgressStep(event),
    chunks: event.totalChunks,
    time: event.elapsedMs,
    file: event.currentFile,
  };
}

function formatCompletedMessage(event: IngestStreamEvent): string {
  const result = event.result;
  if (result?.replacementSkipped)
    return '未儲存任何資料。由於資料夾內的匯出檔為空、無效或沒有對話，已保留現有收藏集。請修正匯出檔後重試。';
  const fileCount = result?.files?.length ?? 0;
  const conversations = result?.conversations ?? fileCount;
  const errorCount = result?.errors?.length ?? 0;

  const summary = `已在 ${fmtTime(result?.elapsedMs ?? 0)} 內從 ${fileCount} 個檔案索引 ${conversations} 段對話，共 ${result?.ingested ?? 0} 個區塊。`;
  return errorCount ? `${summary}${errorCount} 個檔案失敗。` : summary;
}

interface IndexingViewProps {
  readonly collections: readonly string[];
  readonly onRefresh: () => Promise<void>;
}

type RelativeFile = File & { readonly webkitRelativePath?: string };
type DragFileSystemEntry =
  | {
      readonly isFile: true;
      readonly isDirectory: false;
      readonly name: string;
      file: (success: (file: File) => void, failure: (error: DOMException) => void) => void;
    }
  | {
      readonly isFile: false;
      readonly isDirectory: true;
      readonly name: string;
      createReader: () => {
        readEntries: (
          success: (entries: DragFileSystemEntry[]) => void,
          failure: (error: DOMException) => void,
        ) => void;
      };
    };
type DataTransferItemWithEntry = DataTransferItem & {
  readonly webkitGetAsEntry?: () => unknown;
};

const relativePathOf = (file: RelativeFile): string => file.webkitRelativePath || file.name;

const withRelativePath = (file: File, relativePath: string): RelativeFile => {
  if ((file as RelativeFile).webkitRelativePath) return file as RelativeFile;
  try {
    Object.defineProperty(file, 'webkitRelativePath', {
      configurable: true,
      value: relativePath,
    });
  } catch {
    // Some browsers expose immutable File objects; the filename fallback still works.
  }
  return file as RelativeFile;
};

const readAllEntries = async (entry: Extract<DragFileSystemEntry, { isDirectory: true }>) => {
  const reader = entry.createReader();
  const all: DragFileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<DragFileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    if (!batch.length) break;
    all.push(...batch);
  }
  return all;
};

const filesFromEntry = async (entry: DragFileSystemEntry, prefix = ''): Promise<RelativeFile[]> => {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject));
    return [withRelativePath(file, `${prefix}${file.name}`)];
  }
  const children = await readAllEntries(entry);
  const nested = await Promise.all(
    children.map((child) => filesFromEntry(child, `${prefix}${entry.name}/`)),
  );
  return nested.flat();
};

export function IndexingView({ collections, onRefresh }: IndexingViewProps) {
  const [dragging, setDragging] = useState(false);
  const [path, setPath] = useState('');
  const [uploadFiles, setUploadFiles] = useState<RelativeFile[] | null>(null);
  const [pickedLabel, setPickedLabel] = useState('');
  const [clearFirst, setClearFirst] = useState(false);
  const [targetColl, setTargetColl] = useState(collections.find((c) => c !== 'all') ?? 'chunks');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<IngestProgress | null>(null);
  const [statusMsg, setStatusMsg] = useState<StatusMessage | null>(null);
  const [preview, setPreview] = useState<FilePreview[] | null>(null);
  const [newCollOpen, setNewCollOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const pickerRef = useRef<HTMLInputElement>(null);
  const indexingController = useRef<AbortController | null>(null);

  const copyScript = useCallback(async (file: string) => {
    try {
      const res = await fetch(`/scripts/${file}`);
      if (!res.ok) throw new Error('找不到');
      await navigator.clipboard.writeText(await res.text());
      setCopied(file);
      setTimeout(() => setCopied(''), 2500);
    } catch {
      setStatusMsg({ type: 'err', text: `無法複製腳本，請手動開啟 scripts/${file}。` });
    }
  }, []);

  const supported = useMemo(
    () => (uploadFiles ? uploadFiles.filter((f) => isPotentialExport(relativePathOf(f))) : []),
    [uploadFiles],
  );

  const applyPickedFiles = useCallback((files: readonly RelativeFile[]) => {
    if (!files.length) return;

    setUploadFiles([...files]);
    const first = relativePathOf(files[0]!).replace(/\\/g, '/');
    const folder = first.split('/')[0] ?? 'folder';
    const sup = files.filter((f) => isPotentialExport(relativePathOf(f)));
    setPickedLabel(`來自「${folder}」的 ${sup.length} 個檔案`);
    setPreview(
      files.map((f) => {
        const relPath = relativePathOf(f);
        return {
          name: relPath.replace(/\\/g, '/').split('/').pop() ?? '',
          ok: isPotentialExport(relPath),
        };
      }),
    );
  }, []);

  const onPickFolder = useCallback(() => {
    const files = pickerRef.current?.files;
    if (!files?.length) return;
    applyPickedFiles(Array.from(files) as RelativeFile[]);
  }, [applyPickedFiles]);

  const onDropFiles = useCallback(
    async (dataTransfer: DataTransfer) => {
      try {
        const entries = Array.from(dataTransfer.items)
          .map(
            (item) =>
              (item as DataTransferItemWithEntry).webkitGetAsEntry?.() as
                DragFileSystemEntry | null | undefined,
          )
          .filter((entry): entry is DragFileSystemEntry => !!entry);
        const files = entries.length
          ? (await Promise.all(entries.map((entry) => filesFromEntry(entry)))).flat()
          : (Array.from(dataTransfer.files) as RelativeFile[]);
        if (!files.length) {
          setPickedLabel('拖曳的內容沒有可讀檔案，請改用「選擇資料夾」。');
          return;
        }
        applyPickedFiles(files);
      } catch (e) {
        setPickedLabel(`Drop failed: ${e instanceof Error ? e.message : '未知錯誤'}`);
      }
    },
    [applyPickedFiles],
  );

  const onUsePath = useCallback(async () => {
    if (!path.trim()) return;
    setPickedLabel('Checking…');
    try {
      const d = await api.ingestPreview(path, targetColl);
      const duplicatePaths = new Set(d.duplicates.map((item) => item.sourceFile));
      setPickedLabel(
        `找到 ${d.files.length} 個匯出檔${
          duplicatePaths.size ? `，其中 ${duplicatePaths.size} 個將重新索引` : ''
        }`,
      );
      setPreview(
        d.files.map((f) => {
          const name = String(f).replace(/\\/g, '/').split('/').pop() ?? '';
          return {
            name,
            ok: true,
            note: duplicatePaths.has(f) ? 're-index' : '',
          };
        }),
      );
    } catch (e) {
      setPickedLabel(`錯誤：${e instanceof Error ? e.message : '未知'}`);
    }
  }, [path, targetColl]);

  const doIndex = useCallback(async () => {
    const useUpload = uploadFiles && supported.length > 0;
    let coll = targetColl;

    if (useUpload && coll === 'chunks') {
      const first = relativePathOf(uploadFiles[0]!).replace(/\\/g, '/');
      coll = first.split('/').filter(Boolean)[0] ?? coll;
    }

    if (!useUpload && !path.trim()) {
      setStatusMsg({ type: 'err', text: '選擇資料夾或輸入路徑。' });
      return;
    }

    setRunning(true);
    setProgress({ pct: 0, step: 'Starting…' });
    setStatusMsg(null);
    const controller = new AbortController();
    indexingController.current = controller;

    const onProgress = (event: IngestStreamEvent) => {
      if (event.status === 'completed') {
        setStatusMsg({
          type: event.result?.errors?.length || event.result?.replacementSkipped ? 'err' : 'info',
          text: formatCompletedMessage(event),
        });
        return;
      }
      if (event.status === 'error') {
        setStatusMsg({ type: 'err', text: `錯誤：${event.error ?? '未知'}` });
        return;
      }

      setProgress(progressFromEvent(event));
    };

    try {
      if (useUpload) {
        await api.ingestUploadProgress(supported, coll, clearFirst, onProgress, controller.signal);
      } else {
        await api.ingestPathProgress(path, coll, clearFirst, onProgress, controller.signal);
      }
    } catch (e) {
      if (controller.signal.aborted) {
        setStatusMsg({ type: 'info', text: '已停止索引。已完成的檔案仍保留索引。' });
      } else {
        setStatusMsg({ type: 'err', text: `錯誤：${e instanceof Error ? e.message : '未知'}` });
      }
    } finally {
      if (indexingController.current === controller) indexingController.current = null;
      setRunning(false);
      setProgress(null);
      void onRefresh();
    }
  }, [uploadFiles, supported, targetColl, path, clearFirst, onRefresh]);

  const realCollections = collections.filter((c) => c !== 'all');

  return (
    <div className="view">
      <div className="section-h">
        <h2>索引資料夾</h2>
        <span className="desc">
          本機解析 → 切塊 → embedding → 寫入 LanceDB。你的聊天資料不會離開這台電腦。
        </span>
      </div>

      <details className="panel" style={{ marginBottom: 16 }}>
        <summary
          style={{ cursor: 'pointer', padding: '12px 14px', fontWeight: 500, listStyle: 'revert' }}
        >
          {Icons.info} 如何取得資料（匯出指南）
        </summary>
        <div
          style={{
            padding: '4px 14px 16px',
            fontSize: 13,
            color: 'var(--text-2)',
            display: 'grid',
            gap: 16,
          }}
        >
          <div>
            <b style={{ color: 'var(--text-1)' }}>OpenRouter</b> —
            沒有內建匯出功能。請執行瀏覽器主控台腳本，再索引下載的資料夾：
            <ol style={{ margin: '6px 0', paddingLeft: 20, lineHeight: 1.7 }}>
              <li>在已登入的 openrouter.ai 開啟聊天清單。</li>
              <li>
                開啟 DevTools → Console（<kbd>F12</kbd>).
              </li>
              <li>複製下方腳本，貼到 Console 後按 Enter。</li>
              <li>若被詢問，請允許「多個下載」；然後在這裡索引該資料夾。</li>
            </ol>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                className="btn sm"
                onClick={() => void copyScript('openrouter-export-all.js')}
              >
                {Icons.copy}{' '}
                {copied === 'openrouter-export-all.js' ? '已複製！' : '複製「匯出全部聊天」腳本'}
              </button>
              <button
                className="btn sm"
                onClick={() => void copyScript('openrouter-export-browser.js')}
              >
                {Icons.copy}{' '}
                {copied === 'openrouter-export-browser.js' ? '已複製！' : '複製「單一聊天」腳本'}
              </button>
            </div>
          </div>

          <div>
            <b style={{ color: 'var(--text-1)' }}>LM Studio</b> —
            指向其本機對話資料夾（貼到下方「貼上路徑」）：
            <ul style={{ margin: '6px 0', paddingLeft: 20, lineHeight: 1.8 }}>
              <li>
                Windows： <code>%USERPROFILE%\.lmstudio\conversations\</code>
              </li>
              <li>
                macOS / Linux: <code>~/.lmstudio/conversations/</code>
              </li>
              <li>
                舊版： <code>~/.cache/lm-studio/conversations/</code>
              </li>
            </ul>
          </div>

          <div>
            <b style={{ color: 'var(--text-1)' }}>Google AI Studio</b> — 下載 Google Drive
            中的「Google AI
            Studio」資料夾，解壓縮後索引該資料夾（檔案可能沒有副檔名，這沒關係）。支援文字聊天與
            Imagen 提示紀錄。
          </div>

          <div>
            <b style={{ color: 'var(--text-1)' }}>ChatGPT / Claude</b> —
            使用該應用程式的官方資料匯出，再索引產生的 <code>conversations.json</code>。
          </div>
        </div>
      </details>

      <div
        className="drop-zone"
        data-dragging={dragging}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onDropFiles(e.dataTransfer);
        }}
      >
        <div className="ico-big">{Icons.folder}</div>
        <h3>把匯出資料夾拖曳到這裡</h3>
        <p>
          支援：Google AI Studio、OpenRouter、ChatGPT/OpenAI、Claude/Anthropic、LM Studio 與 Grok
          JSON 匯出。會遞迴掃描子資料夾，並自動略過帳號中繼資料檔。
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <input
            id="folderFileInput"
            ref={pickerRef}
            type="file"
            style={{ display: 'none' }}
            {...({
              webkitdirectory: '',
              directory: '',
            } as React.InputHTMLAttributes<HTMLInputElement>)}
            multiple
            onChange={onPickFolder}
          />
          <button className="btn primary" onClick={() => pickerRef.current?.click()}>
            {Icons.folder} 選擇資料夾
          </button>
          {pickedLabel && (
            <span
              id="folderChosenLabel"
              className="mono"
              style={{ fontSize: 12, color: 'var(--text-2)' }}
            >
              {pickedLabel}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0' }}>或貼上路徑</div>
        <div className="path-input">
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/匯出資料夾的絕對路徑"
          />
          <button className="btn" onClick={onUsePath} disabled={!path}>
            {Icons.arrowRight} 使用路徑
          </button>
        </div>
      </div>

      <div className="ingest-options">
        <label style={{ color: 'var(--text-3)' }}>目標收藏集</label>
        <select
          id="targetCollectionSelect"
          value={targetColl}
          onChange={(e) => setTargetColl(e.target.value)}
          className="btn sm"
          style={{ padding: '0 8px', background: 'var(--bg-2)' }}
        >
          {realCollections.map((c) => (
            <option key={c} value={c}>
              {collLabel(c)}
            </option>
          ))}
        </select>
        <button
          id="newCollectionBtnIndexing"
          className="btn sm"
          onClick={() => setNewCollOpen(true)}
          title="建立新收藏集"
        >
          {Icons.plus} 新增
        </button>
        <label>
          <input
            type="checkbox"
            checked={clearFirst}
            onChange={(e) => setClearFirst(e.target.checked)}
          />{' '}
          先清空收藏集
        </label>
        <button id="ingestBtn" className="btn primary" onClick={doIndex} disabled={running}>
          {Icons.zap} {running ? '索引中…' : '索引資料夾'}
        </button>
        {running && (
          <button
            id="stopIngestBtn"
            className="btn danger"
            onClick={() => indexingController.current?.abort()}
          >
            停止索引
          </button>
        )}
      </div>

      {preview && preview.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>匯入預覽</h3>
            <span className="sub">
              {preview.filter((f) => f.ok).length} 個可用 · {preview.filter((f) => !f.ok).length}{' '}
              個略過
            </span>
          </div>
          <div style={{ maxHeight: 260, overflow: 'auto' }}>
            {preview.slice(0, 60).map((f, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 1fr auto',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 14px',
                  borderBottom: '1px solid var(--border-0)',
                  fontSize: 12,
                }}
              >
                <span style={{ color: f.ok ? 'var(--success)' : 'var(--text-4)' }}>
                  {f.ok ? Icons.check : '·'}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    color: f.ok ? 'var(--text-1)' : 'var(--text-3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f.name}
                </span>
                <span
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-3)' }}
                >
                  {f.note || (f.ok ? '' : 'skipped')}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {progress && (
        <div className="progress-panel">
          <div className="progress-head">
            <span className="step">
              <b>{progress.step}</b>
            </span>
            <span className="pct">{progress.pct}%</span>
          </div>
          <div className="progress-bar-new">
            <i style={{ width: `${progress.pct}%` }} />
          </div>
          {progress.chunks != null && (
            <div className="progress-details-new">
              區塊： <strong>{progress.chunks.toLocaleString()}</strong>
              <span style={{ color: 'var(--text-4)' }}>·</span>
              時間： <strong>{fmtTime(progress.time ?? 0)}</strong>
            </div>
          )}
          {progress.file && (
            <div className="progress-file">{progress.file.replace(/^.*[\\/]/, '')}</div>
          )}
        </div>
      )}

      {statusMsg && (
        <div id="ingestStatus" className={`banner ${statusMsg.type}`}>
          <span className="ico">{statusMsg.type === 'err' ? Icons.warn : Icons.check}</span>
          <div className="grow">{statusMsg.text}</div>
        </div>
      )}

      {newCollOpen && (
        <NewCollectionModal
          open
          onClose={() => setNewCollOpen(false)}
          onCreated={(name) => {
            setTargetColl(name);
            void onRefresh();
          }}
        />
      )}
    </div>
  );
}
