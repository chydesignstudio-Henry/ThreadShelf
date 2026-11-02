import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { LOCAL_API_STATUS_KEY } from '../queries';
import type {
  GenerationConfigResponse,
  GenerationModel,
  LlamaAccelerationMode,
  LlamaFlashAttention,
  LlamaKvCacheProfile,
  LlamaReasoningEffort,
  LlamaSpeculativeMode,
  LlamaSplitMode,
} from '../types';
import { toast } from '../toast';
import { DirectoryPicker } from './DirectoryPicker';
import { GenerationRuntimeBadge } from './GenerationRuntimeBadge';
import {
  LocalApiPanel,
  isValidNetworkPort,
  localApiDraftFrom,
  type LocalApiDraft,
} from './LocalApiPanel';
import type { GuideTab } from './LocalApiGuide';
import { ModelCatalogModal } from './ModelCatalogModal';
import { NumberCombobox } from './NumberCombobox';
import { QuickSetupPanel } from './QuickSetupPanel';

const joinDirectories = (directories: readonly string[]): string => directories.join('\n');

// Presets are a convenience only — the field accepts any size the server allows.
const CONTEXT_SIZE_PRESETS = [4096, 8192, 16_384, 32_768, 65_536, 131_072, 262_144] as const;
const CONTEXT_SIZE_LABELS: Record<number, string> = {
  4096: '4k · 輕量',
  8192: '8k · 平衡',
  16_384: '16k',
  32_768: '32k · 24 GB GPU 建議',
  65_536: '64k · 長',
  131_072: '128k · 長、較慢',
  262_144: '262k · Qwen3.8 原生 · 24 GB 需 Q4 KV',
};
// Past 64K, generation slows noticeably as the context fills (RTX 3090 Ti, Gemma 4
// 26B-A4B: 110 tok/s at 32K, 69 at 128K, 46 at 256K; see docs/PERFORMANCE.md).
const LONG_CONTEXT_TOKENS = 65_536;

const KV_CACHE_HELP: Record<LlamaKvCacheProfile, string> = {
  default: 'F16 · llama.cpp 預設，KV 記憶體用量最大。',
  quality: 'Q8_0 鍵與值 · 幾乎無損，KV 記憶體約減半。會開啟 Flash Attention。',
  memory: 'Q4_0 鍵與值 · 每 GB 可容納最長上下文，品質略降。會開啟 Flash Attention。',
};

const SPECULATIVE_HELP: Record<LlamaSpeculativeMode, string> = {
  off: '不使用推測解碼。',
  auto: 'GGUF 有 MTP/NextN head 時以其草擬 2 個 token；否則保持關閉。',
  aggressive: '草擬 3 個 token · 可預測文字更快，VRAM 略增。需要 MTP/NextN head。',
};

const REASONING_HELP: Record<LlamaReasoningEffort, string> = {
  default: '沿用聊天範本預設。',
  off: '在聊天範本支援時關閉思考。',
  low: '短思考 · 回答最快。',
  medium: '建議：桌機速度與品質的平衡。',
  high: '較長思考。',
  xhigh: '最慢 · 最大推理，可能占用大量上下文。',
};

// Like Ollama's keep_alive: how long an unused model stays in memory.
const IDLE_UNLOAD_PRESETS: readonly { readonly minutes: number; readonly label: string }[] = [
  { minutes: 0, label: '永不（直到換模型或卸載）' },
  { minutes: 5, label: '閒置 5 分鐘後' },
  { minutes: 15, label: '閒置 15 分鐘後' },
  { minutes: 30, label: '閒置 30 分鐘後' },
  { minutes: 60, label: '閒置 1 小時後' },
  { minutes: 240, label: '閒置 4 小時後' },
  { minutes: 1440, label: '閒置 1 天後' },
];

const ACCELERATION_HELP: Record<LlamaAccelerationMode, string> = {
  auto: '建議。llama.cpp 會把盡量多的層放到可用加速器，其餘用 CPU。',
  cpu: '僅 CPU。相容性最高，但生成通常較慢。',
  gpu: '單 GPU 最大化。把所有可放的模型層載入選定 GPU。',
  hybrid: 'CPU + GPU。卸載指定層數到 GPU，其餘留在 CPU。',
  'multi-gpu': '載入所有可放的層，並分散到多張 GPU。',
};

export function GenerationSettings() {
  const [data, setData] = useState<GenerationConfigResponse | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [executablePath, setExecutablePath] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [directories, setDirectories] = useState('');
  const [contextSize, setContextSize] = useState('8192');
  const [acceleration, setAcceleration] = useState<LlamaAccelerationMode>('auto');
  const [gpuLayers, setGpuLayers] = useState(20);
  const [splitMode, setSplitMode] = useState<LlamaSplitMode>('layer');
  const [mainGpu, setMainGpu] = useState(0);
  const [tensorSplit, setTensorSplit] = useState('');
  const [threads, setThreads] = useState(-1);
  const [flashAttention, setFlashAttention] = useState<LlamaFlashAttention>('auto');
  const [kvCache, setKvCache] = useState<LlamaKvCacheProfile>('quality');
  const [speculative, setSpeculative] = useState<LlamaSpeculativeMode>('auto');
  const [reasoningEffort, setReasoningEffort] = useState<LlamaReasoningEffort>('medium');
  const [apiKey, setApiKey] = useState('');
  const [enforceZdr, setEnforceZdr] = useState(false);
  const [denyDataCollection, setDenyDataCollection] = useState(false);
  const [persistErrorLogs, setPersistErrorLogs] = useState(true);
  const [idleUnloadMinutes, setIdleUnloadMinutes] = useState(0);
  const [localApi, setLocalApi] = useState<LocalApiDraft>(() => localApiDraftFrom(undefined));
  const queryClient = useQueryClient();
  const [models, setModels] = useState<GenerationModel[] | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [guide, setGuide] = useState<GuideTab | null>(null);

  const applyData = (next: GenerationConfigResponse) => {
    setData(next);
    setExecutablePath(next.config.llamaCpp.executablePath ?? '');
    setBaseUrl(next.config.llamaCpp.baseUrl ?? '');
    // Only user-configured roots are editable. Conventional and env roots remain runtime-only.
    setDirectories(joinDirectories(next.config.llamaCpp.modelDirectories));
    setContextSize(String(next.config.llamaCpp.contextSize));
    setAcceleration(next.config.llamaCpp.acceleration);
    setGpuLayers(next.config.llamaCpp.gpuLayers);
    setSplitMode(next.config.llamaCpp.splitMode);
    setMainGpu(next.config.llamaCpp.mainGpu);
    setTensorSplit(next.config.llamaCpp.tensorSplit ?? '');
    setThreads(next.config.llamaCpp.threads);
    setFlashAttention(next.config.llamaCpp.flashAttention);
    setKvCache(next.config.llamaCpp.kvCache ?? 'quality');
    setSpeculative(next.config.llamaCpp.speculative ?? 'auto');
    setReasoningEffort(next.config.llamaCpp.reasoningEffort ?? 'medium');
    setEnforceZdr(next.config.openRouter.enforceZdr);
    setDenyDataCollection(next.config.openRouter.denyDataCollection);
    setPersistErrorLogs(next.config.diagnostics?.persistErrorLogs ?? true);
    setIdleUnloadMinutes(next.config.llamaCpp.idleUnloadMinutes ?? 0);
    setLocalApi(localApiDraftFrom(next.config.localApi));
  };

  useEffect(() => {
    const controller = new AbortController();
    void api
      .generationConfig(controller.signal)
      .then(applyData)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : '無法載入生成設定。');
      });
    return () => controller.abort();
  }, []);

  const parsedContextSize = Number(contextSize);
  const contextSizeValid =
    /^\d+$/.test(contextSize) && parsedContextSize >= 512 && parsedContextSize <= 1_048_576;

  const save = async () => {
    if (!contextSizeValid) {
      setError('上下文長度必須是 512 到 1,048,576 之間的整數 tokens。');
      return;
    }
    if (localApi.networkAccess && !isValidNetworkPort(localApi.networkPort)) {
      setError('網路埠必須是 1 到 65,535 之間的整數。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const llamaCpp = {
        executablePath,
        baseUrl,
        modelDirectories: directories
          .split(/\r?\n/)
          .map((path) => path.trim())
          .filter(Boolean),
        contextSize: parsedContextSize,
        acceleration,
        gpuLayers,
        splitMode,
        mainGpu,
        tensorSplit,
        threads,
        flashAttention,
        kvCache,
        speculative,
        reasoningEffort,
        idleUnloadMinutes,
      };
      const saved = data?.config.llamaCpp;
      const savedLlamaCpp = {
        ...saved,
        executablePath: saved?.executablePath ?? '',
        baseUrl: saved?.baseUrl ?? '',
        tensorSplit: saved?.tensorSplit ?? '',
        kvCache: saved?.kvCache ?? 'quality',
        speculative: saved?.speculative ?? 'auto',
        reasoningEffort: saved?.reasoningEffort ?? 'medium',
        idleUnloadMinutes: saved?.idleUnloadMinutes ?? 0,
      };
      const llamaCppChanged = Object.entries(llamaCpp).some(
        ([field, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(savedLlamaCpp[field as keyof typeof savedLlamaCpp]),
      );
      const next = await api.updateGenerationConfig({
        // Access settings must stay editable while a model is generating.
        llamaCpp: llamaCppChanged ? llamaCpp : undefined,
        openRouter: {
          apiKey: apiKey || undefined,
          enforceZdr,
          denyDataCollection,
        },
        localApi: {
          enabled: localApi.enabled,
          apiKey: localApi.apiKey || undefined,
          clearApiKey: localApi.clearApiKey || undefined,
          networkAccess: localApi.networkAccess,
          networkPort: isValidNetworkPort(localApi.networkPort)
            ? Number(localApi.networkPort)
            : undefined,
        },
        diagnostics: { persistErrorLogs },
      });
      applyData(next);
      void queryClient.invalidateQueries({ queryKey: LOCAL_API_STATUS_KEY });
      setApiKey('');
      setModels(null);
      window.dispatchEvent(new Event('threadshelf:generation-runtime-changed'));
      toast.success('Generation settings saved.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '無法儲存設定。';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const scanModels = async () => {
    setModels(null);
    setError('');
    try {
      const response = await api.generationModels('llama-cpp');
      setModels(response.models);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型掃描失敗。');
    }
  };

  const addDirectory = (path: string) => {
    const current = directories
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!current.includes(path)) setDirectories([...current, path].join('\n'));
  };

  // The form starts from placeholder defaults; editing or saving it before the stored
  // settings arrive would overwrite them, so it appears only once they are loaded.
  if (!data) {
    return (
      <section className="generation-settings" aria-labelledby="generation-settings-title">
        <div className="section-h">
          <h2 id="generation-settings-title">對話生成</h2>
        </div>
        {error ? <div className="banner err">{error}</div> : <p role="status">正在載入生成設定…</p>}
      </section>
    );
  }

  return (
    <section className="generation-settings" aria-labelledby="generation-settings-title">
      <div className="section-h">
        <h2 id="generation-settings-title">對話生成</h2>
      </div>

      <div className="banner warn">
        llama.cpp 完全在本機執行。OpenRouter 會把選取的封存對話與新提示詞傳送給 OpenRouter
        及其下游供應者。
      </div>

      {error && <div className="banner err">{error}</div>}

      <GenerationRuntimeBadge detailed />

      <QuickSetupPanel onCompleted={() => void scanModels()} />

      <div className="panel generation-panel">
        <div className="panel-head">
          <h3>llama.cpp 包裝器</h3>
          <span className="sub">local · primary engine</span>
          <button
            type="button"
            className="btn sm ghost panel-head-action"
            onClick={() => setGuide('settings')}
          >
            這些設定是什麼意思？
          </button>
        </div>
        <div className="panel-body generation-form">
          <label>
            <span>llama-server 執行檔</span>
            <input
              value={executablePath}
              onChange={(event) => setExecutablePath(event.target.value)}
              placeholder="從 PATH 或 .threadshelf/tools 自動偵測"
            />
          </label>
          <label>
            <span>既有本機伺服器 URL（選填）</span>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="http://127.0.0.1:8080"
            />
          </label>
          <label>
            <span>模型資料夾：每行一個絕對路徑</span>
            <textarea
              value={directories}
              onChange={(event) => setDirectories(event.target.value)}
              rows={6}
            />
            <DirectoryPicker
              initialPath={directories.split(/\r?\n/).find((path) => path.trim())}
              onSelect={addDirectory}
            />
            {data?.config.llamaCpp.defaultModelDirectories.length ? (
              <small>
                另外也會掃描 {data.config.llamaCpp.defaultModelDirectories.length}{' '}
                個預設或環境變數提供的模型根目錄，這些不會存入此欄位。
              </small>
            ) : null}
          </label>
          <div className="llama-runtime-config">
            <label>
              <span>加速設定檔</span>
              <select
                value={acceleration}
                onChange={(event) => setAcceleration(event.target.value as LlamaAccelerationMode)}
              >
                <option value="auto">自動調整（建議）</option>
                <option value="cpu">僅 CPU</option>
                <option value="gpu">單 GPU · 最大卸載</option>
                <option value="hybrid">CPU + GPU · 指定層</option>
                <option value="multi-gpu">多 GPU</option>
              </select>
              <small>{ACCELERATION_HELP[acceleration]}</small>
            </label>
            <label>
              <span>上下文長度</span>
              <NumberCombobox
                id="llamaContextSize"
                label="上下文長度（tokens）"
                value={contextSize}
                onChange={setContextSize}
                options={CONTEXT_SIZE_PRESETS}
                optionLabel={(value) => CONTEXT_SIZE_LABELS[value] ?? value.toLocaleString()}
                invalid={!contextSizeValid}
                title="選擇預設值，或輸入 512 到 1,048,576 之間的整數 tokens"
              />
              <small>
                {contextSizeValid
                  ? `${Number(contextSize).toLocaleString()} tokens${
                      parsedContextSize > LONG_CONTEXT_TOKENS
                        ? ' · 長上下文：上下文填滿時生成會變慢，KV 快取也需要更多 VRAM。24 GB GPU 請使用省記憶體 KV 快取。'
                        : ''
                    }`
                  : '請輸入 512 到 1,048,576 之間的整數。'}
              </small>
            </label>
            {acceleration === 'hybrid' && (
              <label>
                <span>GPU 層數</span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={gpuLayers}
                  onChange={(event) => setGpuLayers(Number(event.target.value))}
                />
              </label>
            )}
            {(acceleration === 'gpu' || (acceleration === 'multi-gpu' && splitMode === 'row')) && (
              <label>
                <span>主 GPU 編號</span>
                <input
                  type="number"
                  min={0}
                  max={31}
                  value={mainGpu}
                  onChange={(event) => setMainGpu(Number(event.target.value))}
                />
              </label>
            )}
            {acceleration === 'multi-gpu' && (
              <>
                <label>
                  <span>多 GPU 分配</span>
                  <select
                    value={splitMode}
                    onChange={(event) => setSplitMode(event.target.value as LlamaSplitMode)}
                  >
                    <option value="layer">依層 · 平衡預設</option>
                    <option value="row">依列 · 平行權重</option>
                  </select>
                </label>
                <label>
                  <span>GPU 分配比例（選填）</span>
                  <input
                    value={tensorSplit}
                    onChange={(event) => setTensorSplit(event.target.value)}
                    placeholder="1,1 或 3,1"
                  />
                </label>
              </>
            )}
            <label>
              <span>CPU 執行緒</span>
              <input
                type="number"
                min={-1}
                max={1024}
                value={threads}
                onChange={(event) => setThreads(Number(event.target.value))}
              />
              <small>-1 讓 llama.cpp 自動選擇。</small>
            </label>
            <label>
              <span>Flash Attention</span>
              <select
                value={flashAttention}
                onChange={(event) => setFlashAttention(event.target.value as LlamaFlashAttention)}
              >
                <option value="auto">自動（建議）</option>
                <option value="on">開啟</option>
                <option value="off">關閉</option>
              </select>
            </label>
            <label>
              <span>KV 快取</span>
              <select
                value={kvCache}
                onChange={(event) => setKvCache(event.target.value as LlamaKvCacheProfile)}
              >
                <option value="quality">品質 · Q8（建議）</option>
                <option value="memory">省記憶體 · Q4</option>
                <option value="default">預設 · F16</option>
              </select>
              <small>{KV_CACHE_HELP[kvCache]}</small>
            </label>
            <label>
              <span>推測解碼（MTP）</span>
              <select
                value={speculative}
                onChange={(event) => setSpeculative(event.target.value as LlamaSpeculativeMode)}
              >
                <option value="auto">自動 · draft 2（建議）</option>
                <option value="aggressive">積極 · draft 3</option>
                <option value="off">關閉</option>
              </select>
              <small>{SPECULATIVE_HELP[speculative]}</small>
            </label>
            <label>
              <span>推理強度</span>
              <select
                value={reasoningEffort}
                onChange={(event) => setReasoningEffort(event.target.value as LlamaReasoningEffort)}
              >
                <option value="medium">中（建議）</option>
                <option value="low">低</option>
                <option value="high">高</option>
                <option value="xhigh">極高 · 慢</option>
                <option value="off">關閉</option>
                <option value="default">範本預設</option>
              </select>
              <small>{REASONING_HELP[reasoningEffort]}</small>
            </label>
            <label>
              <span>從記憶體卸載模型</span>
              <select
                value={idleUnloadMinutes}
                onChange={(event) => setIdleUnloadMinutes(Number(event.target.value))}
              >
                {IDLE_UNLOAD_PRESETS.some(
                  (preset) => preset.minutes === idleUnloadMinutes,
                ) ? null : (
                  <option value={idleUnloadMinutes}>閒置 {idleUnloadMinutes} 分鐘後</option>
                )}
                {IDLE_UNLOAD_PRESETS.map((preset) => (
                  <option key={preset.minutes} value={preset.minutes}>
                    {preset.label}
                  </option>
                ))}
              </select>
              <small>
                模型一段時間沒有聊天或 API 請求時，釋放 VRAM 與 RAM；下一個請求會重新載入。
              </small>
            </label>
          </div>
          <div className="setup-note">
            安全探索： <code>npm run setup:llama</code>. 檢查最新版本：{' '}
            <code>npm run setup:llama -- -- --check</code>. 在明確使用 <code>--install</code> 或{' '}
            <code>--url</code> 核准前不會下載任何東西。
            <br />
            GPU 設定檔需要相容的版本。請明確以 <code>--variant cuda</code>、<code>vulkan</code>、
            <code>rocm</code> 或 <code>sycl</code> 安裝；支援的 Mac 會自動使用 Metal。
          </div>
          <div className="generation-actions">
            <button className="btn primary" onClick={() => setCatalogOpen(true)}>
              下載模型…
            </button>
            <button className="btn" onClick={() => void scanModels()}>
              掃描 GGUF 模型
            </button>
            {models && <span>{models.length.toLocaleString()} 個模型檔</span>}
          </div>
        </div>
      </div>

      <LocalApiPanel
        generationConfig={data?.config}
        guide={guide}
        onGuide={setGuide}
        draft={localApi}
        onChange={(patch) => setLocalApi((current) => ({ ...current, ...patch }))}
      />

      <div className="panel generation-panel">
        <div className="panel-head">
          <h3>OpenRouter API</h3>
          <span className="sub">external · opt-in</span>
        </div>
        <div className="panel-body generation-form">
          <label>
            <span>本次工作階段的 API 金鑰（或在伺服器 .env 設定 OPENROUTER_API_KEY）</span>
            <input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={data?.config.openRouter.apiKeyConfigured ? '已設定金鑰' : 'sk-or-v1-…'}
            />
          </label>
          <p className="sub">
            在此輸入的金鑰只保存在伺服器程序記憶體中；寫在已 gitignore 的 .env
            中的金鑰重啟後仍有效。API 不會回傳任何一者。
          </p>
          <label className="check-field">
            <input
              type="checkbox"
              checked={enforceZdr}
              onChange={(event) => setEnforceZdr(event.target.checked)}
            />
            預設只使用 ZDR 路由（可能排除許多端點）
          </label>
          <label className="check-field">
            <input
              type="checkbox"
              checked={denyDataCollection}
              onChange={(event) => setDenyDataCollection(event.target.checked)}
            />
            只使用不收集資料、不拿資料訓練的供應者
          </label>
        </div>
      </div>

      <div className="panel generation-panel">
        <div className="panel-head">
          <h3>診斷</h3>
          <span className="sub">本機錯誤記錄</span>
        </div>
        <div className="panel-body generation-form">
          <label className="check-field">
            <input
              type="checkbox"
              checked={persistErrorLogs}
              onChange={(event) => setPersistErrorLogs(event.target.checked)}
            />
            將生成錯誤存到 .threadshelf/generation-errors.log
          </label>
          <p className="sub">
            ThreadShelf
            只記錄供應者／模型錯誤，不含提示詞、回答或推理內容。無論此設定為何，分頁範圍的私密聊天都不會被記錄。
          </p>
        </div>
      </div>

      <div className="generation-actions">
        <button className="btn primary" disabled={saving} onClick={() => void save()}>
          {saving ? '儲存中…' : '儲存生成設定'}
        </button>
        {data?.providers.map((provider) => (
          <span key={provider.id} className="provider-status" data-ready={provider.available}>
            {provider.label}: {provider.available ? '就緒' : '未設定'}
          </span>
        ))}
      </div>
      <ModelCatalogModal
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onDownloaded={() => void scanModels()}
      />
    </section>
  );
}
