import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useUIStore } from '../store';
import { api } from '../api';
import type {
  ContinuationMessage,
  ThreadShelfChat,
  ThreadShelfChatSummary,
  ThreadTurn,
} from '../types';
import { Icons } from '../icons';
import { fmtRelative } from '../utils';
import { confirmDialog, toast } from '../toast';
import { Topbar } from '../components/Topbar';
import { ThreadContinuation } from '../components/ThreadContinuation';
import { usePrivateChatStore } from '../private-chat-memory';
import { clearLegacyPrivateStorage } from '../safe-storage';

const PRIVATE_SESSION_ID = 'private-session';
const DRAFT_SAVED_ID = 'draft-saved';

const newDraftScope = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

const continuationFromTurns = (turns: readonly ThreadTurn[]): ContinuationMessage[] => {
  const messages: ContinuationMessage[] = [];
  let reasoning: string | undefined;
  for (const turn of turns) {
    if (turn.user !== undefined) {
      messages.push({ role: 'user', content: turn.user, model: turn.model });
      reasoning = undefined;
    } else if (turn.thinking !== undefined) {
      reasoning = turn.thinking;
    } else if (turn.ai !== undefined) {
      messages.push({
        role: 'assistant',
        content: turn.ai,
        model: turn.model,
        reasoning,
      });
      reasoning = undefined;
    }
  }
  return messages;
};

// Display-only label for the unsaved private session (chat header + rail entry),
// never persisted — so a short cut is correct here, unlike the stored titles
// derived in `src/generation/threads.ts`.
const titleFromMessages = (messages: readonly ContinuationMessage[]): string => {
  const prompt = messages.find((message) => message.role === 'user')?.content.trim();
  if (!prompt) return '新聊天';
  const compact = prompt.replace(/\s+/g, ' ');
  return compact.length > 52 ? `${compact.slice(0, 49)}…` : compact;
};

export function ChatPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const chatSearch = useSearch({ from: '/chat' });
  const activeColl = useUIStore((state) => state.activeColl);
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);
  const [threads, setThreads] = useState<ThreadShelfChatSummary[]>([]);
  const privateSession = usePrivateChatStore((state) => state.session);
  const setPrivateMessages = usePrivateChatStore((state) => state.setMessages);
  const clearPrivateSession = usePrivateChatStore((state) => state.clear);
  const [activeId, setActiveId] = useState(() =>
    chatSearch.draft
      ? DRAFT_SAVED_ID
      : chatSearch.private
        ? PRIVATE_SESSION_ID
        : chatSearch.thread
          ? chatSearch.thread
          : privateSession.messages.length || privateSession.interruptedGenerations.length
            ? PRIVATE_SESSION_ID
            : '',
  );
  const [chat, setChat] = useState<ThreadShelfChat>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Only the setter is read directly; the id is consumed via the functional
  // updater in handleDraftCompleted to avoid a stale-closure race.
  const [, setDraftRealId] = useState('');
  const [draftAttemptScope, setDraftAttemptScope] = useState(
    () => chatSearch.draft ?? newDraftScope(),
  );
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const loadList = useCallback(
    async (signal?: AbortSignal) => {
      const result = await api.generationThreads(signal);
      setThreads(result.threads);
      queryClient.setQueryData(['generation-threads'], result);
      return result.threads;
    },
    [queryClient],
  );

  useEffect(() => clearLegacyPrivateStorage(), []);

  useEffect(() => {
    const controller = new AbortController();
    void api
      .generationThreads(controller.signal)
      .then((result) => {
        setThreads(result.threads);
        queryClient.setQueryData(['generation-threads'], result);
        setActiveId((current) => current || result.threads[0]?.id || '');
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : '無法載入本機聊天。');
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [queryClient]);

  useEffect(() => {
    if (activeId === PRIVATE_SESSION_ID || activeId === DRAFT_SAVED_ID || !activeId) {
      return undefined;
    }
    const controller = new AbortController();
    void api
      .generationThread(activeId, controller.signal)
      .then(setChat)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : '無法開啟此聊天。');
      });
    return () => controller.abort();
  }, [activeId]);

  const openPrivateChat = useCallback(() => {
    setChat(undefined);
    setActiveId(PRIVATE_SESSION_ID);
    setError('');
  }, []);

  // Lazy create: "New chat" is a UI-only draft. The database row is created
  // on the first message (handleCreateDraftThread), so abandoned chats leave no
  // ghost rows in the list or the collection.
  const startSavedChat = useCallback((scope?: string) => {
    setChat(undefined);
    setDraftRealId('');
    setDraftAttemptScope(scope ?? newDraftScope());
    setEditingTitle(false);
    setActiveId(DRAFT_SAVED_ID);
    setError('');
  }, []);

  useEffect(() => {
    if (!chatSearch.draft) return undefined;
    const timeout = window.setTimeout(() => startSavedChat(chatSearch.draft), 0);
    return () => window.clearTimeout(timeout);
  }, [chatSearch.draft, startSavedChat]);

  useEffect(() => {
    if (!chatSearch.private) return undefined;
    const timeout = window.setTimeout(openPrivateChat, 0);
    return () => window.clearTimeout(timeout);
  }, [chatSearch.private, openPrivateChat]);

  useEffect(() => {
    if (!chatSearch.thread) return undefined;
    // Reopening the chat that is already shown keeps it: resetting would clear
    // it without a refetch, because activeId does not change.
    if (chatSearch.thread === activeId) return undefined;
    const timeout = window.setTimeout(() => {
      setChat(undefined);
      setEditingTitle(false);
      setError('');
      setActiveId(chatSearch.thread ?? '');
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [chatSearch.thread, activeId]);

  useEffect(() => {
    document.querySelector<HTMLElement>('.main-scroll')?.scrollTo({ top: 0 });
  }, [activeId]);

  const handleCreateDraftThread = useCallback(async (): Promise<string> => {
    const created = await api.createGenerationThread('新聊天');
    setThreads((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    queryClient.setQueryData<{ threads: ThreadShelfChatSummary[] }>(
      ['generation-threads'],
      (current) => ({
        threads: [created, ...(current?.threads ?? []).filter((item) => item.id !== created.id)],
      }),
    );
    setDraftRealId(created.id);
    await queryClient.invalidateQueries({ queryKey: ['collections'] });
    return created.id;
  }, [queryClient]);

  const handleDraftCompleted = useCallback(async () => {
    try {
      await loadList();
    } catch {
      // A refresh failure is non-fatal; the draft view keeps the live messages.
    }
    // Hand the finished draft over to the normal saved-chat path (idle remount).
    setDraftRealId((id) => {
      if (id) {
        setActiveId(id);
        void navigate({ to: '/chat', search: { thread: id } });
      }
      return '';
    });
  }, [loadList, navigate]);

  const startRename = () => {
    if (!chat) return;
    setTitleDraft(chat.title);
    setEditingTitle(true);
  };

  const saveRename = async () => {
    const next = titleDraft.replace(/\s+/g, ' ').trim();
    setEditingTitle(false);
    if (!chat || !next || next === chat.title) return;
    try {
      const updated = await api.renameGenerationThread(chat.id, next);
      setChat(updated);
      setThreads((current) =>
        current.map((item) => (item.id === updated.id ? { ...item, title: updated.title } : item)),
      );
      await queryClient.invalidateQueries({ queryKey: ['generation-threads'] });
      toast.success('已重新命名聊天。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法重新命名此聊天。');
    }
  };

  const clearPrivateChat = async () => {
    if (
      privateSession.messages.length ||
      privateSession.interruptedGenerations.length ||
      privateSession.draft
    ) {
      const confirmed = await confirmDialog({
        title: '要刪除這個私密聊天嗎？',
        message: '此未儲存的工作階段及其復原紀錄會從此分頁移除。',
        confirmLabel: '刪除聊天',
        danger: true,
      });
      if (!confirmed) return;
    }
    clearPrivateSession();
    setChat(undefined);
    setActiveId(threads[0]?.id ?? '');
    toast.success('已刪除私密聊天。');
  };

  const deleteChat = async (thread: ThreadShelfChatSummary) => {
    const confirmed = await confirmDialog({
      title: `Delete “${thread.title}”?`,
      message: '此對話及其搜尋索引會被永久刪除。',
      confirmLabel: '刪除聊天',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.deleteGenerationThread(thread.id);
      const remaining = threads.filter((item) => item.id !== thread.id);
      setThreads(remaining);
      if (activeId === thread.id) {
        setChat(undefined);
        const nextId = remaining[0]?.id ?? '';
        setActiveId(nextId);
        void navigate({ to: '/chat', search: nextId ? { thread: nextId } : {} });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['collections'] }),
        queryClient.invalidateQueries({ queryKey: ['generation-threads'] }),
      ]);
      toast.success('已刪除對話。');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法刪除此聊天。');
    }
  };

  const refreshActive = useCallback(async () => {
    if (activeId === PRIVATE_SESSION_ID) return;
    try {
      const [updated] = await Promise.all([api.generationThread(activeId), loadList()]);
      setChat(updated);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '聊天已儲存，但無法重新整理。');
    }
  }, [activeId, loadList]);

  const isPrivate = activeId === PRIVATE_SESSION_ID;
  const isDraft = activeId === DRAFT_SAVED_ID;
  const messages = useMemo(
    () =>
      isPrivate
        ? [...privateSession.messages]
        : isDraft
          ? []
          : continuationFromTurns(chat?.turns ?? []),
    [chat?.turns, isDraft, isPrivate, privateSession.messages],
  );
  const title = isPrivate
    ? titleFromMessages(privateSession.messages)
    : isDraft
      ? '新聊天'
      : (chat?.title ?? 'Chat');

  return (
    <>
      <Topbar view="chat" activeColl={activeColl} onMenu={() => setSidebarOpen(true)} />
      <div className="main-scroll">
        <div className="chat-page">
          <main className="chat-workspace">
            {error && <div className="banner err">{error}</div>}
            {!activeId && !loading && (
              <div className="chat-empty">
                <span className="chat-empty-icon">{Icons.plus}</span>
                <h1>開始新對話</h1>
                <p>
                  在這裡建立的聊天與匯入的封存分開保存，只存在本機，並會在每次完整回應後變得可搜尋。
                </p>
                <button className="btn primary" onClick={() => startSavedChat()}>
                  {Icons.plus} 新聊天
                </button>
              </div>
            )}
            {(isPrivate || isDraft || chat) && (
              <>
                <header className="chat-hero">
                  <div className="chat-title-row">
                    {editingTitle && chat ? (
                      <input
                        id="chatTitleInput"
                        className="chat-title-input"
                        aria-label="聊天標題"
                        autoFocus
                        value={titleDraft}
                        onChange={(event) => setTitleDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void saveRename();
                          } else if (event.key === 'Escape') {
                            setEditingTitle(false);
                          }
                        }}
                        onBlur={() => void saveRename()}
                      />
                    ) : (
                      <h1
                        title={chat ? 'Double-click to rename' : title}
                        onDoubleClick={chat ? startRename : undefined}
                      >
                        {title}
                      </h1>
                    )}
                    {isPrivate ? (
                      <span className="chat-storage-badge private">{Icons.ghost} 私密</span>
                    ) : (
                      <span className="chat-storage-badge saved" title="存在本機並已索引供搜尋">
                        已存在本機
                      </span>
                    )}
                  </div>
                  <div className="chat-hero-actions">
                    <span className="chat-storage-status">
                      {isPrivate
                        ? 'Not saved or indexed · removed on reload or when this tab closes'
                        : isDraft
                          ? 'Not saved yet · a chat is created on your first message'
                          : chat?.updatedAt
                            ? `Updated ${fmtRelative(chat.updatedAt) || 'just now'}`
                            : 'Saved locally by default'}
                    </span>
                    {isPrivate ? (
                      <div className="saved-chat-actions">
                        <button className="btn sm ghost" onClick={() => void clearPrivateChat()}>
                          {Icons.trash} 刪除
                        </button>
                      </div>
                    ) : (
                      chat && (
                        <div className="saved-chat-actions">
                          <button
                            id="renameChatButton"
                            className="btn sm ghost"
                            onClick={startRename}
                          >
                            重新命名
                          </button>
                          <button className="btn sm ghost" onClick={() => void deleteChat(chat)}>
                            {Icons.trash} 刪除
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </header>
                <div className="chat-conversation">
                  <ThreadContinuation
                    key={
                      isPrivate
                        ? privateSession.id
                        : isDraft
                          ? `draft:${draftAttemptScope}`
                          : chat!.id
                    }
                    threadId={isPrivate || isDraft ? undefined : chat!.id}
                    attemptScope={
                      isPrivate
                        ? privateSession.id
                        : isDraft
                          ? `draft:${draftAttemptScope}`
                          : chat!.id
                    }
                    ephemeral={isPrivate}
                    draftSaved={isDraft}
                    onCreateThread={isDraft ? handleCreateDraftThread : undefined}
                    initialMessages={messages}
                    onMessagesChanged={isPrivate ? setPrivateMessages : undefined}
                    onCompleted={
                      isPrivate
                        ? undefined
                        : isDraft
                          ? () => void handleDraftCompleted()
                          : () => void refreshActive()
                    }
                  />
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
