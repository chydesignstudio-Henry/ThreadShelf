import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type {
  CatalogFit,
  CatalogModelDetail,
  CatalogModelSummary,
  CatalogSort,
  HardwareProfile,
} from '../types';
import { toast } from '../toast';
import { fmtBytes, fmtCount } from '../utils';

interface ModelCatalogModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onDownloaded?: (path: string) => void;
}

const SORTS: readonly { readonly value: CatalogSort; readonly label: string }[] = [
  { value: 'downloads', label: '下載最多' },
  { value: 'trending', label: '趨勢' },
  { value: 'likes', label: '最多喜歡' },
  { value: 'recent', label: '最近更新' },
];

const FIT_LABEL: Record<CatalogFit, string> = {
  fits: 'fits in VRAM',
  tight: 'partly on CPU',
  'too-large': 'too large',
};

const hardwareSummary = (hardware: HardwareProfile | null): string => {
  if (!hardware) return 'detecting hardware…';
  const device = hardware.devices[0];
  return device
    ? `${device.name} · ${fmtBytes(hardware.modelBudgetBytes)} usable`
    : `CPU only · ${fmtBytes(hardware.modelBudgetBytes)} usable RAM`;
};

export function ModelCatalogModal({ open, onClose, onDownloaded }: ModelCatalogModalProps) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CatalogSort>('downloads');
  const [models, setModels] = useState<readonly CatalogModelSummary[]>([]);
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [tokenConfigured, setTokenConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<CatalogModelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [includeProjector, setIncludeProjector] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, file: '' });
  const abortRef = useRef<AbortController | null>(null);

  // Typing should not fire a request per keystroke against a public API.
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        setError('');
        void api
          .catalogSearch({ q: query, sort }, controller.signal)
          .then((response) => {
            setModels(response.models);
            setHardware(response.hardware);
            setTokenConfigured(response.tokenConfigured);
          })
          .catch((cause: unknown) => {
            if (controller.signal.aborted) return;
            setError(cause instanceof Error ? cause.message : 'Could not reach the model catalog.');
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      query ? 350 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, sort]);

  const close = useCallback(() => {
    abortRef.current?.abort();
    setExpanded(null);
    setDetail(null);
    onClose();
  }, [onClose]);

  const toggle = useCallback(
    (id: string) => {
      if (expanded === id) {
        setExpanded(null);
        setDetail(null);
        return;
      }
      setExpanded(id);
      setDetail(null);
      setDetailLoading(true);
      void api
        .catalogModel(id)
        .then((response) => {
          setDetail(response.model);
          setHardware(response.hardware);
        })
        .catch((cause: unknown) =>
          toast.error(cause instanceof Error ? cause.message : 'Could not load model files.'),
        )
        .finally(() => setDetailLoading(false));
    },
    [expanded],
  );

  const download = useCallback(
    async (repoId: string, quant: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setDownloading(`${repoId}:${quant}`);
      setProgress({ done: 0, total: 0, file: '' });
      try {
        let saved = '';
        await api.catalogDownload(
          { repoId, quant, includeProjector },
          (event) => {
            if (event.type === 'progress' && event.phase === 'downloading') {
              setProgress({
                done: event.downloadedBytes ?? 0,
                total: event.totalBytes ?? 0,
                file: event.file ?? '',
              });
            }
            if (event.type === 'done') saved = event.primaryPath;
          },
          controller.signal,
        );
        toast.success(`Downloaded ${repoId} (${quant}).`);
        if (saved) onDownloaded?.(saved);
      } catch (cause) {
        if (!controller.signal.aborted) {
          toast.error(cause instanceof Error ? cause.message : 'Download failed.');
        }
      } finally {
        setDownloading(null);
        abortRef.current = null;
      }
    },
    [onDownloaded, includeProjector],
  );

  if (!open) return null;

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="scrim" onClick={close}>
      <div
        className="modal-card catalog-modal"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="下載模型"
      >
        <div className="modal-head catalog-head">
          <div>
            <h3>下載模型</h3>
            <p>
              GGUF models from the Hugging Face Hub, matched against your hardware. Only search
              terms leave this machine — no chat content is ever sent.
            </p>
          </div>
          <span className="catalog-origin" title="目錄資訊取自 huggingface.co">
            catalog · huggingface.co
          </span>
        </div>

        <div className="catalog-controls">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜尋模型，例如 qwen、coder…"
            aria-label="搜尋模型"
          />
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as CatalogSort)}
            aria-label="排序模型"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="catalog-hardware">
          <b>你的電腦：</b> {hardwareSummary(hardware)}
          {!tokenConfigured && (
            <span className="catalog-token-hint">
              未設定 HF_TOKEN：受限模型會被標示且無法下載。
            </span>
          )}
        </div>

        <div className="catalog-body">
          {error && <p className="catalog-error">{error}</p>}
          {loading && models.length === 0 && <p className="catalog-empty">正在載入目錄…</p>}
          {!loading && !error && models.length === 0 && (
            <p className="catalog-empty">沒有符合搜尋的 GGUF 模型。</p>
          )}

          {models.map((model) => {
            const isOpen = expanded === model.id;
            return (
              <div className="catalog-item" key={model.id} data-open={isOpen}>
                <button
                  type="button"
                  className="catalog-item-head"
                  onClick={() => toggle(model.id)}
                  aria-expanded={isOpen}
                >
                  <span className="catalog-item-title" title={model.id}>
                    <b>{model.name}</b>
                    <em>{model.author}</em>
                  </span>
                  <span className="catalog-item-meta">
                    <span title={`${model.downloads.toLocaleString()} downloads`}>
                      ↓ {fmtCount(model.downloads)}
                    </span>
                    <span title={`${model.likes.toLocaleString()} likes`}>
                      ♥ {fmtCount(model.likes)}
                    </span>
                    {model.trustedPublisher && (
                      <span className="catalog-badge trusted" title="可信的 GGUF 發布者">
                        trusted
                      </span>
                    )}
                    {model.gated !== false && (
                      <span
                        className="catalog-badge gated"
                        title="此儲存庫在 Hugging Face 受限。請先在那裡接受授權，並在伺服器 .env 設定 HF_TOKEN。"
                      >
                        needs HF login
                      </span>
                    )}
                  </span>
                </button>

                {isOpen && (
                  <div className="catalog-quants">
                    {detailLoading && <p className="catalog-empty">正在讀取檔案…</p>}
                    {detail && detail.gated !== false && (
                      <p className="catalog-gated-note">
                        {detail.id} is gated. Accept the licence on Hugging Face, then set{' '}
                        <code>HF_TOKEN</code> in the server <code>.env</code> to download it here.
                      </p>
                    )}
                    {Boolean(detail?.projectors.length) && (
                      <label>
                        <input
                          type="checkbox"
                          checked={includeProjector}
                          disabled={Boolean(downloading)}
                          onChange={(event) => setIncludeProjector(event.target.checked)}
                        />
                        Include vision projector (one file, F16 when available; extra download and
                        memory)
                      </label>
                    )}
                    {detail?.quants.map((quant) => {
                      const busy = downloading === `${detail.id}:${quant.label}`;
                      const blocked = detail.gated !== false && !tokenConfigured;
                      return (
                        <div className="catalog-quant" key={quant.label} data-fit={quant.fit}>
                          <span className="catalog-quant-name">
                            {quant.label}
                            {quant.recommended && <em title="平衡預設">recommended</em>}
                            {quant.shards > 1 && <i>{quant.shards} shards</i>}
                          </span>
                          <span className="catalog-quant-size">{fmtBytes(quant.totalBytes)}</span>
                          <span className="catalog-quant-fit" data-fit={quant.fit}>
                            {FIT_LABEL[quant.fit]}
                          </span>
                          <button
                            type="button"
                            className="btn"
                            disabled={busy || Boolean(downloading) || blocked}
                            onClick={() => void download(detail.id, quant.label)}
                            title={blocked ? 'Gated repository — HF_TOKEN required' : undefined}
                          >
                            {busy ? `${percent}%` : 'Download'}
                          </button>
                        </div>
                      );
                    })}
                    {busyBar(downloading, detail?.id, percent, progress.file)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="modal-foot">
          {downloading ? (
            <button className="btn ghost" onClick={() => abortRef.current?.abort()}>
              取消下載
            </button>
          ) : (
            <button className="btn ghost" onClick={close}>
              關閉
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const busyBar = (
  downloading: string | null,
  modelId: string | undefined,
  percent: number,
  file: string,
) => {
  if (!downloading || !modelId || !downloading.startsWith(`${modelId}:`)) return null;
  return (
    <div className="catalog-progress">
      <div className="catalog-progress-track">
        <div className="catalog-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <span title={file}>
        {percent}% · {file || 'starting…'}
      </span>
    </div>
  );
};
