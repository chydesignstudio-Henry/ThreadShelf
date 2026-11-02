import type { Provider } from './types';

export const PROVIDERS: Readonly<Record<string, Provider>> = {
  'google-ai-studio': { label: 'Google AI Studio', short: 'AI Studio', color: 'var(--p-google)' },
  google: { label: 'Google AI Studio', short: 'AI Studio', color: 'var(--p-google)' },
  openrouter: { label: 'OpenRouter', short: 'OpenRouter', color: 'var(--p-openrouter)' },
  openai: { label: 'ChatGPT', short: 'ChatGPT', color: 'var(--p-openai)' },
  anthropic: { label: 'Claude', short: 'Claude', color: 'var(--p-claude)' },
  claude: { label: 'Claude', short: 'Claude', color: 'var(--p-claude)' },
  'lm-studio': { label: 'LM Studio', short: 'LM Studio', color: 'var(--p-lmstudio)' },
  grok: { label: 'Grok', short: 'Grok', color: 'var(--p-grok)' },
  threadshelf: {
    label: 'ThreadShelf',
    short: 'ThreadShelf',
    color: 'oklch(0.74 0.16 165)',
  },
};

const UNKNOWN_PROVIDER: Provider = { label: 'Unknown', short: '—', color: 'var(--border-2)' };

export const getProvider = (key: string | undefined): Provider => {
  if (!key) return UNKNOWN_PROVIDER;
  return PROVIDERS[key] ?? UNKNOWN_PROVIDER;
};

export const EXAMPLE_QUERIES = [
  'BIM 衝突檢核流程',
  'AI 輔助設計提案',
  'LOD 深化紀錄',
  'NotebookLM 來源整理',
  '室內材料色彩計畫',
  'Gemini 匯出備份',
] as const;

export const STORAGE_KEYS = {
  COLLECTION: 'threadshelf:selected-collection',
} as const;
