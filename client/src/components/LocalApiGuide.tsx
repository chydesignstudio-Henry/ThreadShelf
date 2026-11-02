import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useLocalApiStatusQuery } from '../queries';
import type { GenerationConfig } from '../types';
import { copyText } from '../utils';

export type GuideTab = 'status' | 'connect' | 'settings';
type ClientId = 'claude-code' | 'codex' | 'deepseek' | 'other';
type Shell = 'powershell' | 'bash';

const TABS: readonly { readonly id: GuideTab; readonly label: string }[] = [
  { id: 'status', label: '目前可用功能' },
  { id: 'connect', label: '連接 App' },
  { id: 'settings', label: '設定說明' },
];

const CLIENTS: readonly { readonly id: ClientId; readonly label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex CLI' },
  { id: 'deepseek', label: 'DeepSeek Harness' },
  { id: 'other', label: '其他任何 App' },
];

interface GuideProps {
  /** The tab to show, or null when the guide is closed. */
  readonly tab: GuideTab | null;
  readonly onTab: (tab: GuideTab | null) => void;
  readonly config: GenerationConfig | undefined;
  /** Model id the examples use; defaults to the loaded or first model. */
  readonly model?: string;
}

/** Copyable code block. */
function Snippet({ code }: { readonly code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <pre className="guide-snippet">
      <code>{code}</code>
      <button
        type="button"
        className="btn sm ghost"
        onClick={() => {
          void copyText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? '已複製' : '複製'}
      </button>
    </pre>
  );
}

function StatusRow({
  label,
  ok,
  children,
}: {
  readonly label: string;
  readonly ok: boolean | null;
  readonly children: ReactNode;
}) {
  return (
    <div className="guide-status-row" data-ok={ok === null ? 'neutral' : ok}>
      <span className="guide-status-dot" aria-hidden="true" />
      <span className="guide-status-label">{label}</span>
      <span className="guide-status-value">{children}</span>
    </div>
  );
}

const idleText = (minutes: number | undefined): string => {
  if (!minutes) return '永不。已載入的模型會留在記憶體，直到換模型或按「退出」。';
  if (minutes % 1440 === 0) return `${minutes / 1440} 天無請求後。`;
  if (minutes % 60 === 0) return `${minutes / 60} 小時無請求後。`;
  return `${minutes} 分鐘無請求後。`;
};

/** Environment variables differ only in syntax between shells. */
const envLines = (shell: Shell, vars: readonly (readonly [string, string])[]): string =>
  vars
    .map(([name, value]) =>
      shell === 'powershell' ? `$env:${name} = "${value}"` : `export ${name}="${value}"`,
    )
    .join('\n');

function ConnectInstructions({
  client,
  shell,
  origin,
  model,
  apiKey,
  keyRequired,
}: {
  readonly client: ClientId;
  readonly shell: Shell;
  readonly origin: string;
  readonly model: string;
  readonly apiKey: string;
  readonly keyRequired: boolean;
}) {
  switch (client) {
    case 'claude-code':
      return (
        <>
          <ol className="guide-steps">
            <li>請載入長上下文模型：至少 32K，agent 用 64K 更好。</li>
            <li>在啟動 Claude Code 的終端機執行以下指令；關閉終端機後即失效。</li>
          </ol>
          <Snippet
            code={`${envLines(shell, [
              ['ANTHROPIC_BASE_URL', origin],
              ['ANTHROPIC_AUTH_TOKEN', apiKey],
              ['ANTHROPIC_MODEL', model],
              ['ANTHROPIC_DEFAULT_HAIKU_MODEL', model],
            ])}\nclaude`}
          />
          <ul className="guide-notes">
            <li>
              Base URL <b>不要</b>包含 <code>/v1</code>：Claude Code 會自動加上並呼叫{' '}
              <code>/v1/messages</code>。
            </li>
            <li>
              兩個模型變數都使用<b>相同</b>的 id。ThreadShelf
              一次只在記憶體保留一個模型，若背景任務用第二個模型，會一直重新載入。
            </li>
            <li>
              {keyRequired
                ? '請用你的 ThreadShelf API 金鑰當作 token。'
                : 'ThreadShelf 未設定金鑰，任何 token 都可以。'}
            </li>
          </ul>
        </>
      );
    case 'codex':
      return (
        <>
          <ol className="guide-steps">
            <li>
              開啟 <code>~/.codex/config.toml</code> （Windows 為{' '}
              <code>%USERPROFILE%\.codex\config.toml</code>），並加入：
            </li>
          </ol>
          <Snippet
            code={`model = "${model}"
model_provider = "threadshelf"

[model_providers.threadshelf]
name = "ThreadShelf"
base_url = "${origin}/v1"
wire_api = "responses"${keyRequired ? '\nenv_key = "THREADSHELF_API_KEY"' : ''}`}
          />
          {keyRequired && (
            <>
              <ol className="guide-steps" start={2}>
                <li>把金鑰放在 Codex 讀得到的位置，然後啟動 Codex：</li>
              </ol>
              <Snippet code={`${envLines(shell, [['THREADSHELF_API_KEY', apiKey]])}\ncodex`} />
            </>
          )}
          <ul className="guide-notes">
            <li>
              <code>wire_api = "responses"</code> 為必填：目前的 Codex 版本使用 <code>"chat"</code>{' '}
              會拒絕啟動。ThreadShelf 提供 <code>/v1/responses</code>。
            </li>
            <li>Codex 是 agent：請給模型 32K 以上的上下文。</li>
          </ul>
        </>
      );
    case 'deepseek':
      return (
        <>
          <ol className="guide-steps">
            <li>
              在 DeepSeek Harness 開啟 <b>設定 → 模型 → 新增自訂供應者</b>
              ，填入以下值；或把同樣的區塊加到 <code>$DSH_HOME/settings.yaml</code>：
            </li>
          </ol>
          <Snippet
            code={`llm-pi-ai:
  providers:
    threadshelf:
      displayName: ThreadShelf
      apiKeyEnv: THREADSHELF_API_KEY
      api: openai-completions
      baseURL: ${origin}/v1
      models:
        - id: ${model}`}
          />
          <ol className="guide-steps" start={2}>
            <li>
              Harness 從環境變數讀取金鑰，即使 ThreadShelf 沒設金鑰也要設定，然後在該終端機啟動
              harness：
            </li>
          </ol>
          <Snippet
            code={`${envLines(shell, [['THREADSHELF_API_KEY', apiKey]])}\nnpx @deepseek-ai/dsh web`}
          />
          <ul className="guide-notes">
            <li>
              選擇 <b>ThreadShelf</b>，並在工作階段的模型選單選擇模型。
            </li>
            <li>
              若你的 harness 版本欄位名稱不同，對應值為：base URL <code>{origin}/v1</code>、協定
              OpenAI 相容（chat completions）、模型 id <code>{model}</code>。
            </li>
          </ul>
        </>
      );
    case 'other':
      return (
        <>
          <p className="guide-text">
            選擇 App 的 <b>相容 OpenAI</b> （或「自訂 OpenAI」）供應者，不要選 Ollama 預設，並填入：
          </p>
          <div className="guide-fields">
            <span>Base URL</span>
            <code>{origin}/v1</code>
            <span>API 金鑰</span>
            <code>{keyRequired ? '你的 ThreadShelf 金鑰' : '任意值，例如 threadshelf'}</code>
            <span>模型</span>
            <code>{model}</code>
          </div>
          <p className="guide-text">
            以 Anthropic SDK 開發的 App 使用 base URL <code>{origin}</code>，不含 <code>/v1</code>。
          </p>
          <ul className="guide-notes">
            <li>
              Docker、虛擬機或其他裝置上的 App 無法連到此位址。請開啟 <b>在區域網路提供服務</b>
              ，改用網路 URL。
            </li>
            <li>
              「connection refused」表示 ThreadShelf 未執行；401 表示金鑰錯誤；403 表示 App
              不在這台電腦上（或 API 已關閉）。
            </li>
          </ul>
        </>
      );
  }
}

const SETTINGS_HELP: readonly {
  readonly group: string;
  readonly items: readonly {
    readonly name: string;
    readonly what: string;
    readonly pick: string;
  }[];
}[] = [
  {
    group: '本機模型 API',
    items: [
      {
        name: '提供本機模型 API',
        what: '讓這台電腦上的其他程式透過 /v1 位址使用你的模型，就像 LM Studio 或 Ollama。',
        pick: '保持開啟。若從不讓其他 App 使用 ThreadShelf 模型再關閉。',
      },
      {
        name: 'API 金鑰',
        what: '其他 App 必須送出的密碼。留空表示不需密碼：這台電腦上任何程式都能使用模型。',
        pick: '只在本機使用就留空。App 堅持要金鑰或有其他裝置連線時，再設定一組（產生）。',
      },
      {
        name: '在區域網路提供服務',
        what: '開啟第二個連接埠，讓手機、筆電或 Docker 容器使用你的模型。只分享模型 API，絕不分享你的封存資料。',
        pick: '除非其他裝置需要，否則關閉。開啟時也請設定 API 金鑰。',
      },
      {
        name: '網路埠',
        what: '其他裝置連線的連接埠，例如 http://192.168.1.50:3001/v1。',
        pick: '3001，除非已被其他程式使用。',
      },
    ],
  },
  {
    group: '記憶體',
    items: [
      {
        name: '從記憶體卸載模型',
        what: '模型閒置達此時間後釋放 GPU 記憶體（VRAM）。下一則訊息會重新載入，約需數秒到一分鐘。',
        pick: '電腦只跑 AI 就選「永不」。同一張 GPU 也用來玩遊戲或剪片，選 15–30 分鐘。',
      },
      {
        name: '退出',
        what: '立即卸載模型，等同 POST /v1/models/unload。',
        pick: '在啟動遊戲或其他吃 GPU 的程式前使用。',
      },
    ],
  },
  {
    group: 'llama.cpp 模型設定',
    items: [
      {
        name: '上下文長度',
        what: '模型一次能記住的文字量：對話、agent 讀取的檔案與回答。越大需要越多 VRAM，填滿時也越慢。',
        pick: '24 GB GPU 用 32K；coding agent 用 64K（搭配省記憶體 KV 快取）；較小的 GPU 用 8–16K。',
      },
      {
        name: 'KV 快取',
        what: '上下文儲存的精度。Q8 幾乎無損；Q4 記憶體減半，可容納更長上下文。',
        pick: '品質 · Q8；64K 以上用省記憶體 · Q4。',
      },
      {
        name: '加速設定檔',
        what: '模型在哪裡執行。放不進 GPU 的層會在慢很多的 CPU 上執行。',
        pick: '自動配置。只有執行記錄顯示問題時才更改。',
      },
      {
        name: 'Flash Attention',
        what: '更快且省記憶體的 attention 計算方式。Q8/Q4 KV 快取需要它。',
        pick: '自動。',
      },
      {
        name: '推測解碼（MTP）',
        what: '讓模型用內建輔助頭先猜幾個字，再一次驗證。答案相同但更快。只有具 MTP head 的模型（如 Qwen 3.8）會使用。',
        pick: '自動 · 草稿 2。測試中 Qwen 3.8 從每秒 44 提升到 72–76 tokens；沒有 MTP head 的模型會自動關閉。',
      },
      {
        name: '推理強度',
        what: '思考型模型回答前思考多久。思考也是產生文字，因此需要時間。',
        pick: '中。快速問題用低或關閉。',
      },
      {
        name: 'CPU 執行緒',
        what: '在 CPU 上執行的部分所使用的核心數。',
        pick: '-1（自動）。',
      },
      {
        name: '既有本機伺服器 URL',
        what: '使用你自行啟動的 llama-server，而非 ThreadShelf 管理的那個，例如用於草稿模型或視覺。',
        pick: '留空，除非你確定需要。',
      },
    ],
  },
];

/** Plain-language help for the local model API: status, client setup, settings. */
export function LocalApiGuide({ tab, onTab, config, model: chosenModel }: GuideProps) {
  const { data: status } = useLocalApiStatusQuery();
  const open = tab !== null;
  const onClose = useCallback(() => onTab(null), [onTab]);
  const [client, setClient] = useState<ClientId>('claude-code');
  const [shell, setShell] = useState<Shell>(() =>
    /windows/i.test(navigator.userAgent) ? 'powershell' : 'bash',
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    },
    [onClose],
  );
  useEffect(() => {
    if (!open) return;
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onKeyDown]);

  if (!open) return null;

  const api = config?.localApi;
  const enabled = api?.enabled ?? true;
  const keyRequired = Boolean(api?.apiKeyConfigured);
  const origin = window.location.origin;
  const models = status?.models ?? [];
  const loaded = models.find((model) => model.loaded);
  const model = chosenModel ?? loaded?.id ?? models[0]?.id ?? 'your-model-id';
  const key = keyRequired ? 'YOUR_THREADSHELF_KEY' : 'threadshelf';
  const network = status?.network;
  const external = config?.llamaCpp.baseUrl;

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal-card guide-modal"
        role="dialog"
        aria-label="本機模型 API 指南"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head guide-head">
          <div>
            <h3>本機模型 API 指南</h3>
            <p>讓 coding agent 和其他 App 使用 ThreadShelf 的模型。</p>
          </div>
          <button type="button" className="btn sm ghost" onClick={onClose} aria-label="關閉">
            關閉
          </button>
        </div>

        <div className="local-api-tabs guide-tabs" role="tablist">
          {TABS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={tab === option.id}
              data-active={tab === option.id}
              onClick={() => onTab(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="guide-body">
          {tab === 'status' && (
            <>
              <div className="guide-status">
                <StatusRow label="API" ok={enabled}>
                  {enabled
                    ? `已開啟：${origin}/v1`
                    : '已關閉。App 會收到「403 api_disabled」。請在「本機模型 API」開啟。'}
                </StatusRow>
                <StatusRow label="誰可以使用" ok={null}>
                  {network?.state === 'listening'
                    ? `這台電腦，以及透過 ${network.urls.join(', ') || `連接埠 ${network.port}`} 連線的其他裝置`
                    : '只有這台電腦上的程式。'}
                </StatusRow>
                <StatusRow label="API 金鑰" ok={null}>
                  {api?.apiKeySource === 'env'
                    ? '必填，由 THREADSHELF_API_KEY 設定。'
                    : keyRequired
                      ? '必填，App 必須送出你儲存的金鑰。'
                      : '非必填，App 可送任意金鑰或不送。'}
                </StatusRow>
                {network?.state === 'error' && (
                  <StatusRow label="網路埠" ok={false}>
                    {network.error}
                  </StatusRow>
                )}
                <StatusRow label="記憶體中的模型" ok={null}>
                  {loaded
                    ? `${loaded.id}，對它的請求會立即回應。`
                    : '無。第一個請求會載入它指定的模型。'}
                </StatusRow>
                <StatusRow label="閒置時卸載" ok={null}>
                  {idleText(config?.llamaCpp.idleUnloadMinutes)}
                </StatusRow>
                <StatusRow label="引擎" ok={null}>
                  {external
                    ? `你自己的 llama-server：${external}。`
                    : '由 ThreadShelf 管理的 llama.cpp，一次一個模型。'}
                </StatusRow>
                <StatusRow label="可用模型" ok={models.length > 0}>
                  {models.length > 0
                    ? `${models.length}: ${models
                        .slice(0, 4)
                        .map((entry) => entry.id)
                        .join(', ')}${models.length > 4 ? ', …' : ''}`
                    : (status?.modelsError ?? '尚無，請到設定下載。')}
                </StatusRow>
              </div>

              <h4 className="guide-subhead">API 能做什麼</h4>
              <table className="guide-table">
                <tbody>
                  <tr>
                    <td>
                      <code>GET /v1/models</code>
                    </td>
                    <td>列出模型；已載入的會標示 "loaded": true。</td>
                  </tr>
                  <tr>
                    <td>
                      <code>POST /v1/chat/completions</code>
                    </td>
                    <td>聊天（OpenAI 格式），多數 App 使用。</td>
                  </tr>
                  <tr>
                    <td>
                      <code>POST /v1/responses</code>
                    </td>
                    <td>OpenAI Responses API，Codex 使用。</td>
                  </tr>
                  <tr>
                    <td>
                      <code>POST /v1/messages</code>
                    </td>
                    <td>聊天（Anthropic 格式），Claude Code 使用。</td>
                  </tr>
                  <tr>
                    <td>
                      <code>POST /v1/completions</code>
                    </td>
                    <td>純文字補全（舊版 App）。</td>
                  </tr>
                  <tr>
                    <td>
                      <code>POST /v1/models/unload</code>
                    </td>
                    <td>立即釋放 GPU 記憶體。</td>
                  </tr>
                </tbody>
              </table>
              <p className="guide-text">
                串流、工具呼叫與 JSON 輸出依 llama.cpp
                支援程度運作。不支援：embeddings、圖片、音訊，以及 Ollama 自有的 <code>/api</code>{' '}
                路由。 App 的請求絕不會存入你的封存資料。
              </p>
              <p className="guide-text">
                <b>一次一個模型。</b>{' '}
                要求其他模型時會先釋放舊模型的記憶體再換上。某模型回答期間，請求不同模型會收到「503
                model_busy」，App 會重試。
              </p>
            </>
          )}

          {tab === 'connect' && (
            <>
              <div className="guide-pickers">
                <div className="local-api-tabs" role="tablist" aria-label="App">
                  {CLIENTS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="tab"
                      aria-selected={client === option.id}
                      data-active={client === option.id}
                      onClick={() => setClient(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {client !== 'other' && (
                  <div className="local-api-tabs" role="tablist" aria-label="Shell">
                    {(['powershell', 'bash'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        role="tab"
                        aria-selected={shell === option}
                        data-active={shell === option}
                        onClick={() => setShell(option)}
                      >
                        {option === 'powershell' ? 'Windows PowerShell' : 'macOS / Linux'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {!enabled && <div className="banner warn">API 已關閉，請先開啟再連接。</div>}
              <p className="guide-text">
                填入 <code>{model}</code>
                {loaded?.id === model ? '（目前已載入）' : ''}。在「本機模型 API」面板選擇其他模型
                id 可更換範例。
              </p>
              <ConnectInstructions
                client={client}
                shell={shell}
                origin={origin}
                model={model}
                apiKey={key}
                keyRequired={keyRequired}
              />
            </>
          )}

          {tab === 'settings' &&
            SETTINGS_HELP.map((section) => (
              <section key={section.group} className="guide-settings">
                <h4 className="guide-subhead">{section.group}</h4>
                <dl>
                  {section.items.map((item) => (
                    <div key={item.name} className="guide-setting">
                      <dt>{item.name}</dt>
                      <dd>
                        {item.what}
                        <span className="guide-pick">不確定時：{item.pick}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
        </div>
      </div>
    </div>
  );
}
