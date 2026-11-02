import { useState } from 'react';
import type { CollectionStats } from '../types';
import { Icons } from '../icons';
import { useGenerationThreadsQuery } from '../queries';
import { collLabel, compactModel, fmtRelative } from '../utils';
import { ThemeToggle } from './ThemeToggle';
import { GenerationRuntimeBadge } from './GenerationRuntimeBadge';

type RoutePath = '/search' | '/chat' | '/insights' | '/notes' | '/indexing' | '/mcp' | '/settings';

interface NavItem {
  readonly id: RoutePath;
  readonly viewKey: string;
  readonly label: string;
  readonly icon: React.ReactNode;
}

const LIBRARY_ITEMS: readonly NavItem[] = [
  { id: '/search', viewKey: 'search', label: '搜尋封存', icon: Icons.search },
  { id: '/insights', viewKey: 'insights', label: '洞察', icon: Icons.chart },
  { id: '/notes', viewKey: 'notes', label: 'Markdown/Obsidian', icon: Icons.folder },
];

const MANAGE_ITEMS: readonly NavItem[] = [
  { id: '/indexing', viewKey: 'indexing', label: '新增資料', icon: Icons.download },
  { id: '/mcp', viewKey: 'mcp', label: 'MCP', icon: Icons.plug },
  { id: '/settings', viewKey: 'settings', label: '設定', icon: Icons.settings },
];

interface SidebarProps {
  readonly view: string;
  readonly setView: (v: RoutePath) => void;
  readonly activeColl: string;
  readonly setActiveColl: (c: string) => void;
  readonly onNewChat: () => void;
  readonly onNewPrivateChat: () => void;
  readonly onOpenChat: (id: string) => void;
  readonly activeChatId: string;
  readonly onCmdK: () => void;
  readonly onNewColl: () => void;
  readonly onDeleteCollection: (name: string) => void;
  readonly collections: readonly string[];
  readonly stats: Readonly<Record<string, CollectionStats>>;
  /** Closes the drawer on narrow screens and hides the docked sidebar on wide ones. */
  readonly onClose: () => void;
}

export function Sidebar({
  view,
  setView,
  activeColl,
  setActiveColl,
  onNewChat,
  onNewPrivateChat,
  onOpenChat,
  activeChatId,
  onCmdK,
  onNewColl,
  onDeleteCollection,
  collections,
  stats,
  onClose,
}: SidebarProps) {
  const [showEmpty, setShowEmpty] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(view === 'chat');
  const {
    data: generationThreads,
    isLoading: chatsLoading,
    refetch: refetchChats,
  } = useGenerationThreadsQuery();
  const chats = generationThreads?.threads ?? [];
  const realCollections = collections.filter((c) => c !== 'all');
  const totalFiles = realCollections.reduce((a, c) => a + (stats[c]?.files ?? 0), 0);
  const totalChunks = realCollections.reduce((a, c) => a + (stats[c]?.chunks ?? 0), 0);

  const isEmptyCollection = (c: string): boolean => {
    const s = stats[c];
    return (s?.chunks ?? 0) === 0 && (s?.files ?? 0) === 0 && (s?.conversations ?? 0) === 0;
  };
  // Keep the active collection visible even when empty so the selection never
  // vanishes from under the user.
  const emptyCollections = realCollections.filter((c) => isEmptyCollection(c) && c !== activeColl);
  const visibleCollections = realCollections.filter(
    (c) => showEmpty || !isEmptyCollection(c) || c === activeColl,
  );
  // Short by design: this line shares a ~150px sidebar row with the collection
  // name, and "conversations" spelled out wrapped it onto a second line.
  const collectionCountLabel = (s: CollectionStats | undefined): string => {
    const conversations = s?.conversations ?? 0;
    if (conversations > 0) {
      return `${conversations.toLocaleString()} 則對話`;
    }
    return `${(s?.files ?? 0).toLocaleString()} files`;
  };

  const collectionCountTitle = (s: CollectionStats | undefined): string => {
    const conversations = s?.conversations ?? 0;
    const left =
      conversations > 0
        ? `${conversations.toLocaleString()} 則對話`
        : `${(s?.files ?? 0).toLocaleString()} files`;
    return `${left} · ${(s?.chunks ?? 0).toLocaleString()} 個已索引區塊`;
  };

  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <div className="sb-logo" aria-hidden="true" />
        <div className="sb-name">
          <b>ThreadShelf</b>
          <span>v{__APP_VERSION__} · local</span>
        </div>
        <button
          className="icon-btn sb-close"
          onClick={onClose}
          aria-label="隱藏側邊欄"
          title="隱藏側邊欄"
        >
          {Icons.close}
        </button>
      </div>

      <section className="sb-chat-panel" aria-label="對話">
        <div className="sb-chat-create">
          <button id="sidebarNewChatButton" className="sb-new-chat" onClick={onNewChat}>
            {Icons.plus}
            <span>新聊天</span>
          </button>
          <button
            id="sidebarPrivateChatButton"
            className="sb-private-chat"
            aria-label="開始私密對話"
            title="開始私密聊天（關閉分頁即清除）"
            onClick={onNewPrivateChat}
          >
            {Icons.ghost}
          </button>
        </div>

        <div className="sb-chat-history">
          <button
            id="sidebarChatHistoryToggle"
            className="sb-chat-history-toggle"
            aria-expanded={chatsOpen}
            onClick={() => {
              const nextOpen = !chatsOpen;
              setChatsOpen(nextOpen);
              if (nextOpen) void refetchChats();
            }}
          >
            <span className="ico">{Icons.chat}</span>
            <span className="label">你的聊天</span>
            {chats.length > 0 && <em>{chats.length}</em>}
            <span className="sb-chat-chevron" aria-hidden="true">
              ▾
            </span>
          </button>
          {chatsOpen && (
            <div className="sb-chat-history-list">
              {chatsLoading && <span className="sb-chat-history-empty">正在載入聊天…</span>}
              {!chatsLoading && chats.length === 0 && (
                <span className="sb-chat-history-empty">尚無已儲存的聊天。</span>
              )}
              {chats.map((thread) => (
                <button
                  key={thread.id}
                  className="sb-chat-item"
                  data-active={thread.id === activeChatId}
                  title={thread.title}
                  onClick={() => onOpenChat(thread.id)}
                >
                  <strong>{thread.title}</strong>
                  <span
                    title={`${thread.model ? `${compactModel(thread.model)} · ` : ''}${thread.turnCount} messages`}
                  >
                    {fmtRelative(thread.updatedAt) || 'just now'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <button className="sb-cmdk" onClick={onCmdK}>
        {Icons.search}
        <span>快速跳轉…</span>
        <kbd>Ctrl+K</kbd>
      </button>

      <div className="sb-section">
        <span>資料庫</span>
      </div>

      <nav className="sb-list" style={{ flex: '0 0 auto' }}>
        {LIBRARY_ITEMS.map((n) => (
          <button
            key={n.id}
            id={n.viewKey === 'indexing' ? 'indexingNavBtn' : undefined}
            className="sb-item"
            data-active={view === n.viewKey}
            onClick={() => setView(n.id)}
          >
            <span className="ico">{n.icon}</span>
            <span className="label">{n.label}</span>
          </button>
        ))}
      </nav>

      <div className="sb-section">
        <span>封存收藏集</span>
        <button title="新收藏集" onClick={onNewColl}>
          {Icons.plus}
        </button>
      </div>

      <div className="sb-list sb-collections">
        <button
          id="collection-all"
          className="sb-coll"
          data-active={activeColl === 'all'}
          onClick={() => setActiveColl('all')}
        >
          <span className="sb-coll-dot" style={{ background: 'var(--accent)' }} />
          <span className="sb-coll-meta">
            <b>所有收藏集</b>
            <span>
              {totalFiles} 個檔案 · {totalChunks.toLocaleString()} 個區塊
            </span>
          </span>
        </button>

        {visibleCollections.map((c) => {
          const s = stats[c];
          return (
            <div key={c} className="sb-coll-row">
              <button
                id={`collection-${c}`}
                className="sb-coll"
                data-active={activeColl === c}
                onClick={() => setActiveColl(c)}
              >
                <span className="sb-coll-dot" />
                <span className="sb-coll-meta">
                  <b>{collLabel(c)}</b>
                  <span title={collectionCountTitle(s)}>
                    {collectionCountLabel(s)} · {(s?.chunks ?? 0).toLocaleString()} 區塊
                  </span>
                </span>
              </button>
              {c !== 'chunks' && c !== 'threadshelf_conversations' && (
                <button
                  id={`delete-collection-${c}`}
                  className="sb-coll-delete"
                  title={`Delete ${collLabel(c)}`}
                  aria-label={`Delete ${collLabel(c)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteCollection(c);
                  }}
                >
                  {Icons.trash}
                </button>
              )}
            </div>
          );
        })}

        {emptyCollections.length > 0 && (
          <button
            id="toggleEmptyCollections"
            className="sb-coll-empty-toggle"
            onClick={() => setShowEmpty((value) => !value)}
          >
            {showEmpty ? '隱藏空的收藏集' : `顯示 ${emptyCollections.length} 個空收藏集`}
          </button>
        )}
      </div>

      <div className="sb-section sb-manage-section">
        <span>管理</span>
      </div>
      <nav className="sb-list sb-manage-list">
        {MANAGE_ITEMS.map((n) => (
          <button
            key={n.id}
            id={n.viewKey === 'indexing' ? 'indexingNavBtn' : undefined}
            className="sb-item"
            data-active={view === n.viewKey}
            onClick={() => setView(n.id)}
          >
            <span className="ico">{n.icon}</span>
            <span className="label">{n.label}</span>
          </button>
        ))}
      </nav>

      <div className="sb-footer">
        <GenerationRuntimeBadge />
        <div className="sb-footer-row">
          <span
            className="sb-status"
            title="本機後端 · paraphrase-multilingual embedding · LanceDB 儲存。模型執行與卸載在聊天的模型選單中。"
          >
            local · :{window.location.port || '80'}
          </span>
          <ThemeToggle variant="icon" />
        </div>
      </div>
    </aside>
  );
}
