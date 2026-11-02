import { useState, useEffect, useRef } from 'react';
import type { CollectionStats } from '../types';
import { Icons } from '../icons';
import { collLabel } from '../utils';

type RoutePath = '/search' | '/chat' | '/insights' | '/notes' | '/indexing' | '/mcp' | '/settings';

interface PaletteItem {
  readonly id: string;
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly meta?: string;
  readonly action: () => void;
}

interface PaletteGroup {
  readonly label: string;
  readonly items: PaletteItem[];
}

interface CommandPaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly setView: (v: RoutePath) => void;
  readonly onNewChat: () => void;
  readonly setActiveColl: (c: string) => void;
  readonly collections: readonly string[];
  readonly stats: Readonly<Record<string, CollectionStats>>;
  readonly onNewColl: () => void;
  readonly onRefresh: () => void;
}

export function CommandPalette({
  open,
  onClose,
  setView,
  onNewChat,
  setActiveColl,
  collections,
  stats,
  onNewColl,
  onRefresh,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => {
        setQuery('');
        setActiveIdx(0);
        inputRef.current?.focus();
      }, 30);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  if (!open) return null;

  const groups: PaletteGroup[] = [
    {
      label: '前往',
      items: [
        {
          id: 'go-search',
          label: '搜尋封存',
          icon: Icons.search,
          action: () => setView('/search'),
        },
        {
          id: 'go-chat',
          label: '聊天記錄',
          icon: Icons.chat,
          action: () => setView('/chat'),
        },
        {
          id: 'go-insights',
          label: '洞察',
          icon: Icons.chart,
          action: () => setView('/insights'),
        },
        {
          id: 'go-notes',
          label: 'Markdown/Obsidian',
          icon: Icons.folder,
          action: () => setView('/notes'),
        },
        {
          id: 'go-indexing',
          label: '索引中',
          icon: Icons.download,
          action: () => setView('/indexing'),
        },
        { id: 'go-mcp', label: 'MCP', icon: Icons.plug, action: () => setView('/mcp') },
        {
          id: 'go-settings',
          label: '設定',
          icon: Icons.settings,
          action: () => setView('/settings'),
        },
      ],
    },
    {
      label: '收藏集',
      items: [
        {
          id: 'coll-all',
          label: '所有收藏集',
          icon: Icons.scope,
          action: () => setActiveColl('all'),
        },
        ...collections
          .filter((c) => c !== 'all')
          .map((c) => ({
            id: `coll-${c}`,
            label: collLabel(c),
            icon: Icons.database,
            meta: `${stats[c]?.files ?? 0} files`,
            action: () => setActiveColl(c),
          })),
      ],
    },
    {
      label: '動作',
      items: [
        { id: 'a-chat', label: '新聊天', icon: Icons.spark, action: onNewChat },
        { id: 'a-new', label: '新收藏集…', icon: Icons.plus, action: onNewColl },
        {
          id: 'a-index',
          label: '索引資料夾',
          icon: Icons.folder,
          action: () => setView('/indexing'),
        },
        { id: 'a-refresh', label: '重新整理統計', icon: Icons.refresh, action: onRefresh },
      ],
    },
  ];

  const filtered = groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => !query || it.label.toLowerCase().includes(query.toLowerCase())),
    }))
    .filter((g) => g.items.length > 0);

  const allItems = filtered.flatMap((g) => g.items);
  const clamped = Math.min(activeIdx, allItems.length - 1);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % Math.max(1, allItems.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + allItems.length) % Math.max(1, allItems.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      allItems[clamped]?.action();
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  let flatIndex = 0;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()}>
        <div className="cmdk-input">
          {Icons.searchLg}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIdx(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="搜尋指令、收藏集或動作…"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="cmdk-list">
          {filtered.map((g) => (
            <div key={g.label}>
              <div className="cmdk-group-h">{g.label}</div>
              {g.items.map((it) => {
                const idx = flatIndex++;
                return (
                  <button
                    key={it.id}
                    className="cmdk-item"
                    data-active={idx === clamped}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => {
                      it.action();
                      onClose();
                    }}
                  >
                    <span className="ico">{it.icon}</span>
                    <span>{it.label}</span>
                    {it.meta && <span className="meta">{it.meta}</span>}
                  </button>
                );
              })}
            </div>
          ))}
          {allItems.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>
              無符合項目
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
