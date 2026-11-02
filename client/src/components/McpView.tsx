import { useState, useCallback } from 'react';
import { Icons } from '../icons';
import { copyText } from '../utils';

const MCP_COMMAND = 'npm run mcp';

const MCP_CONFIG = `{
  "mcpServers": {
    "threadshelf": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/path/to/threadshelf"
    }
  }
}`;

export function McpView() {
  const [copied, setCopied] = useState('');

  const copy = useCallback((key: string, text: string) => {
    void copyText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 1400);
  }, []);

  return (
    <div className="view">
      <div className="section-h">
        <h2>MCP 伺服器</h2>
        <span className="desc">
          透過 stdio 把本機封存提供給 Claude Desktop、Cursor 等 MCP client。
        </span>
      </div>

      <div className="banner info">
        <span className="ico">{Icons.info}</span>
        <div className="grow">
          已連接的 Obsidian 筆記庫也提供 <code>obsidian_search</code>、 <code>obsidian_read</code>、
          <code>obsidian_create</code> 與 <code>obsidian_edit</code>。 在設定中開啟
          <b>允許寫入筆記庫</b>之前，筆記庫為唯讀。刪除需在 ThreadShelf 聊天中明確確認。
        </div>
      </div>

      <div className="banner info">
        <span className="ico">{Icons.info}</span>
        <div className="grow">
          MCP 透過 stdio 存取你本機的 LanceDB，不開連接埠、沒有驗證介面。停止該程序即可撤銷存取。
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>啟動伺服器</h3>
          <span className="sub">在專案根目錄執行</span>
        </div>
        <div className="panel-body">
          <pre
            style={{
              position: 'relative',
              fontFamily: 'var(--font-mono)',
              fontSize: 12.5,
              background: 'var(--bg-2)',
              padding: '12px 14px',
              borderRadius: 'var(--r-sm)',
              color: 'var(--text-0)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {MCP_COMMAND}
            <button
              className="btn sm ghost"
              style={{ position: 'absolute', top: 6, right: 6 }}
              onClick={() => copy('cmd', MCP_COMMAND)}
            >
              {copied === 'cmd' ? '已複製' : '複製'}
            </button>
          </pre>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Claude Desktop 設定</h3>
          <span className="sub">設定 → MCP → 編輯設定</span>
        </div>
        <div className="panel-body">
          <pre
            style={{
              position: 'relative',
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              background: 'var(--bg-2)',
              padding: '12px 14px',
              borderRadius: 'var(--r-sm)',
              color: 'var(--text-0)',
              whiteSpace: 'pre-wrap',
            }}
          >
            {MCP_CONFIG}
            <button
              className="btn sm ghost"
              style={{ position: 'absolute', top: 6, right: 6 }}
              onClick={() => copy('cfg', MCP_CONFIG)}
            >
              {copied === 'cfg' ? '已複製' : '複製'}
            </button>
          </pre>
        </div>
      </div>
    </div>
  );
}
