import { useCallback, useState } from 'react';
import { useLocalApiStatusQuery } from '../queries';
import type { GenerationConfig } from '../types';
import { LocalApiGuide, type GuideTab } from './LocalApiGuide';
import { copyText } from '../utils';

type ExampleId = 'curl' | 'openai' | 'anthropic';

const EXAMPLES: readonly { readonly id: ExampleId; readonly label: string }[] = [
  { id: 'curl', label: 'curl' },
  { id: 'openai', label: 'OpenAI SDK' },
  { id: 'anthropic', label: 'Anthropic SDK' },
];

const ENDPOINTS = [
  'GET /v1/models',
  'POST /v1/chat/completions',
  'POST /v1/completions',
  'POST /v1/responses',
  'POST /v1/messages',
  'POST /v1/models/unload',
];

/** Unsaved edits to the local API settings, owned by the settings form. */
export interface LocalApiDraft {
  readonly enabled: boolean;
  /** A new key to save; empty keeps the current one. */
  readonly apiKey: string;
  readonly clearApiKey: boolean;
  readonly networkAccess: boolean;
  readonly networkPort: string;
}

export const localApiDraftFrom = (config: GenerationConfig['localApi']): LocalApiDraft => ({
  enabled: config?.enabled ?? true,
  apiKey: '',
  clearApiKey: false,
  networkAccess: config?.networkAccess ?? false,
  networkPort: String(config?.networkPort ?? 3001),
});

export const isValidNetworkPort = (value: string): boolean =>
  /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65_535;

const generateKey = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return `ts-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

const example = (id: ExampleId, origin: string, model: string, key: string): string => {
  switch (id) {
    case 'curl':
      return `curl ${origin}/v1/chat/completions \\
  -H "Content-Type: application/json" \\${key ? `\n  -H "Authorization: Bearer ${key}" \\` : ''}
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
    case 'openai':
      return `from openai import OpenAI

client = OpenAI(base_url="${origin}/v1", api_key="${key || 'threadshelf'}")
reply = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(reply.choices[0].message.content)`;
    case 'anthropic':
      // Anthropic SDKs append /v1 themselves, so their base URL is the origin.
      return `from anthropic import Anthropic

client = Anthropic(base_url="${origin}", api_key="${key || 'threadshelf'}")
message = client.messages.create(
    model="${model}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(message.content[0].text)`;
  }
};

interface LocalApiPanelProps {
  readonly generationConfig: GenerationConfig | undefined;
  /** Open guide tab, owned by the settings page so other panels can open it. */
  readonly guide: GuideTab | null;
  readonly onGuide: (tab: GuideTab | null) => void;
  readonly draft: LocalApiDraft;
  readonly onChange: (patch: Partial<LocalApiDraft>) => void;
}

/** Connection details and access settings for the OpenAI/Anthropic-compatible API at /v1. */
export function LocalApiPanel({
  generationConfig,
  guide,
  onGuide,
  draft,
  onChange,
}: LocalApiPanelProps) {
  const config = generationConfig?.localApi;
  const { data: status, error, isLoading } = useLocalApiStatusQuery();
  const [selectedModel, setSelectedModel] = useState('');
  const [exampleId, setExampleId] = useState<ExampleId>('curl');
  const [copied, setCopied] = useState('');

  const models = status?.models ?? undefined;
  const origin = window.location.origin;
  const baseUrl = `${origin}/v1`;
  const model =
    models?.find((candidate) => candidate.id === selectedModel)?.id ??
    models?.[0]?.id ??
    'your-model-id';
  const keyRequired = draft.apiKey
    ? true
    : Boolean(config?.apiKeyConfigured) &&
      !(draft.clearApiKey && config?.apiKeySource === 'settings');
  const exampleKey = draft.apiKey || (keyRequired ? 'YOUR_API_KEY' : '');
  const code = example(exampleId, origin, model, exampleKey);
  const network = status?.network;
  const portValid = isValidNetworkPort(draft.networkPort);

  const copy = useCallback((key: string, text: string) => {
    void copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 1400);
  }, []);

  return (
    <div className="panel generation-panel">
      <div className="panel-head">
        <h3>本機模型 API</h3>
        <span className="sub">相容 OpenAI · Anthropic</span>
        <button
          type="button"
          className="btn sm panel-head-action"
          onClick={() => onGuide('status')}
        >
          指南：狀態與連接 App
        </button>
      </div>
      <LocalApiGuide
        tab={guide}
        onTab={onGuide}
        config={generationConfig}
        model={models?.some((candidate) => candidate.id === model) ? model : undefined}
      />
      <div className="panel-body local-api">
        <p className="setup-note">
          讓任何支援 OpenAI 或 Anthropic API 的 App 使用你的本機模型，就像使用 LM Studio 或
          Ollama。請求指定的模型會在首次使用時載入，並取代記憶體中的模型。這些請求不會存入你的封存資料，也不會加上主提示詞。
        </p>

        <label className="check-field">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          在 /v1 提供本機模型 API
        </label>

        <div className="local-api-row">
          <span className="local-api-label">Base URL</span>
          <code className="local-api-value">{baseUrl}</code>
          <button type="button" className="btn sm ghost" onClick={() => copy('url', baseUrl)}>
            {copied === 'url' ? '已複製' : '複製'}
          </button>
        </div>

        {network?.state === 'listening' &&
          network.urls.map((url) => (
            <div className="local-api-row" key={url}>
              <span className="local-api-label">網路 URL</span>
              <code className="local-api-value">{url}</code>
              <button type="button" className="btn sm ghost" onClick={() => copy(url, url)}>
                {copied === url ? '已複製' : '複製'}
              </button>
            </div>
          ))}

        <div className="local-api-row">
          <label className="local-api-label" htmlFor="local-api-model">
            模型 ID
          </label>
          {models && models.length > 0 ? (
            <select
              id="local-api-model"
              value={model}
              onChange={(event) => setSelectedModel(event.target.value)}
            >
              {models.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.id}
                  {candidate.loaded ? ' · 已載入' : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="local-api-value muted">
              {isLoading
                ? '正在載入模型…'
                : error
                  ? error.message
                  : (status?.modelsError ?? '尚未找到 GGUF 模型。請下載模型或新增模型資料夾。')}
            </span>
          )}
          <button
            type="button"
            className="btn sm ghost"
            disabled={!models?.length}
            onClick={() => copy('model', model)}
          >
            {copied === 'model' ? '已複製' : '複製'}
          </button>
        </div>

        <div className="generation-form local-api-access">
          <label>
            <span>API 金鑰（選填）</span>
            <div className="local-api-key">
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={draft.apiKey}
                disabled={config?.apiKeySource === 'env'}
                onChange={(event) => onChange({ apiKey: event.target.value, clearApiKey: false })}
                placeholder={
                  config?.apiKeySource === 'env'
                    ? '由 THREADSHELF_API_KEY 設定'
                    : config?.apiKeyConfigured
                      ? '已設定金鑰 · 輸入以取代'
                      : '空白 · 不需金鑰'
                }
              />
              {config?.apiKeySource !== 'env' && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => onChange({ apiKey: generateKey(), clearApiKey: false })}
                >
                  生成
                </button>
              )}
              {draft.apiKey && (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => copy('key', draft.apiKey)}
                >
                  {copied === 'key' ? '已複製' : '複製'}
                </button>
              )}
            </div>
            <small>
              {keyRequired
                ? '請求必須以「Authorization: Bearer <key>」或「x-api-key」送出金鑰。儲存前請先複製新金鑰：之後不會再顯示。'
                : '無金鑰：這台電腦上任何程式都能使用 API，與 LM Studio、Ollama 相同。若用戶端堅持要金鑰或有其他裝置連線，請設定一組。'}
            </small>
          </label>
          {config?.apiKeySource === 'settings' && !draft.apiKey && (
            <label className="check-field">
              <input
                type="checkbox"
                checked={draft.clearApiKey}
                onChange={(event) => onChange({ clearApiKey: event.target.checked })}
              />
              移除已儲存的金鑰
            </label>
          )}

          <label className="check-field">
            <input
              type="checkbox"
              checked={draft.networkAccess}
              onChange={(event) => onChange({ networkAccess: event.target.checked })}
            />
            在區域網路提供服務
          </label>
          {draft.networkAccess && (
            <label>
              <span>網路埠</span>
              <input
                type="number"
                min={1}
                max={65_535}
                value={draft.networkPort}
                aria-invalid={!portValid}
                onChange={(event) => onChange({ networkPort: event.target.value })}
              />
              <small>
                其他裝置透過此連接埠連線，僅提供 /v1。你的封存資料與設定只能從這台電腦存取。
                {!keyRequired && ' 沒有金鑰時，網路上任何人都能使用你的模型。'}
              </small>
            </label>
          )}
          {network?.state === 'error' && <div className="banner err">{network.error}</div>}
        </div>

        <div className="local-api-endpoints" aria-label="端點">
          {ENDPOINTS.map((endpoint) => (
            <code key={endpoint}>{endpoint}</code>
          ))}
        </div>

        <div className="local-api-example">
          <div className="local-api-tabs" role="tablist" aria-label="範例 client">
            {EXAMPLES.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={exampleId === option.id}
                data-active={exampleId === option.id}
                onClick={() => setExampleId(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <pre>
            <code>{code}</code>
            <button type="button" className="btn sm ghost" onClick={() => copy('code', code)}>
              {copied === 'code' ? '已複製' : '複製'}
            </button>
          </pre>
        </div>
      </div>
    </div>
  );
}
