# ThreadShelf（繁體中文說明｜Fork）

> 本儲存庫 fork 自上游 **[ChrystianSchutz/ThreadShelf](https://github.com/ChrystianSchutz/ThreadShelf)**。原英文說明保留在 [README.en.md](README.en.md)。

## 這是什麼
ThreadShelf 是 **local-first** 的 AI 對話封存與語意搜尋工具。它把 ChatGPT、Claude、Google AI Studio、OpenRouter、LM Studio、Grok 的匯出 JSON 正規化，用本機多語 embedding 存進 LanceDB。使用方式有四種：Web UI、CLI、HTTP API、MCP stdio server。也可以用本機 `llama.cpp` 或 OpenRouter 接續舊對話；選 OpenRouter 時，內容會送到外部。

## 與個人 multi-AI 知識庫（ai-kb）的關係
ai-kb 收錄 Grok、Claude、Gemini、NotebookLM 的對話與筆記，三者分工如下：
- **ai-kb 本體**：經過整理的條目（標題、標籤、摘要、結論），可用 `search.html` 搜尋。
- **Open WebUI**：日常聊天介面，Knowledge collections 依來源分組。
- **ThreadShelf（本 repo）**：**原始匯出**的封存，以及跨來源語意瀏覽。可以找回完整原始對話串。

| collection | 來源 | 備註 |
|---|---|---|
| grok | `sources/grok/exports/grok-export-*.json` | 原生支援 |
| claude | `sources/claude/exports/.../conversations.json` | 原生支援 |
| gemini | `kb2claude.py gemini` 轉換 | Gemini 我的活動（Takeout）不在原生支援之列，先轉成 Claude 匯出格式 |
| notebooklm | `kb2claude.py notebooklm` 轉換 | 同上 |

轉換器與腳本放在 ai-kb 的 `threadshelf/` 資料夾：`kb2claude.py`、`start.sh`、`stop.sh`、`reingest.sh`、`README.md`。

## 本機執行
需要 **Node.js 20.19+**。
```bash
npx threadshelf                 # 啟動並開啟 http://localhost:3000
npx threadshelf 3001            # 改用其他 port
npx threadshelf ingest ./exports grok      # 匯入資料夾到 collection
npx threadshelf search "LOD 深化紀錄"       # CLI 語意搜尋
npx threadshelf --where         # 顯示資料位置
```
資料目錄：Windows 是 `%LOCALAPPDATA%\ThreadShelf`，macOS 和 Linux 是 `~/.threadshelf`。可用 `--data-dir` 或 `THREADSHELF_DATA_DIR` 覆寫。

從本 fork 的原始碼執行：
```bash
git clone https://github.com/chydesignstudio-Henry/ThreadShelf
cd ThreadShelf && npm install && npm run build && npm start
```

## MCP（選用）
`npx threadshelf-mcp` 提供 `search` 和 `read_thread` 工具。在 Claude Desktop 或 Cursor 的 MCP 設定裡加入：
```json
{"command":"npx","args":["-y","threadshelf-mcp"],"env":{"THREADSHELF_DATA_DIR":"<索引路徑>"}}
```
注意：如果 MCP client 用的是外部模型，搜尋出的內容可能會被送出本機。

## 授權
MIT，依上游 [LICENSE](LICENSE)。
