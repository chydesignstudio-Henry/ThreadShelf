import { useState } from 'react';
import { api } from '../api';
import type { DirectoryBrowserResponse } from '../types';

interface DirectoryPickerProps {
  readonly label?: string;
  readonly initialPath?: string;
  readonly onSelect: (path: string) => void;
}

export function DirectoryPicker({
  initialPath,
  onSelect,
  label = '瀏覽系統資料夾…',
}: DirectoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DirectoryBrowserResponse | null>(null);
  const [path, setPath] = useState(initialPath || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const browse = async (nextPath?: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await api.generationDirectories(nextPath);
      setData(response);
      setPath(response.path);
      setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '無法瀏覽系統資料夾。');
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <div className="directory-picker-launch">
        <button
          className="btn sm"
          type="button"
          disabled={loading}
          onClick={() => void browse(path)}
        >
          {loading ? 'Opening…' : label}
        </button>
        {error && <span className="field-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className="directory-picker">
      <div className="directory-picker-bar">
        <button
          className="btn sm"
          type="button"
          disabled={!data?.parent || loading}
          onClick={() => void browse(data?.parent)}
        >
          上一層
        </button>
        <input
          aria-label="系統資料夾路徑"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void browse(path);
          }}
        />
        <button
          className="btn sm"
          type="button"
          disabled={loading}
          onClick={() => void browse(path)}
        >
          前往
        </button>
        <button className="btn sm" type="button" onClick={() => setOpen(false)}>
          關閉
        </button>
      </div>
      <div className="directory-picker-roots">
        {data?.roots.map((root) => (
          <button type="button" key={root.path} onClick={() => void browse(root.path)}>
            {root.name}
          </button>
        ))}
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="directory-picker-list" role="listbox" aria-label="系統資料夾">
        {data?.directories.map((directory) => (
          <button
            type="button"
            role="option"
            aria-selected="false"
            key={directory.path}
            onClick={() => void browse(directory.path)}
          >
            <span aria-hidden="true">▸</span>
            {directory.name}
          </button>
        ))}
        {data?.directories.length === 0 && <span>沒有子資料夾</span>}
      </div>
      {data?.truncated && <span className="sub">僅顯示前 500 個資料夾。</span>}
      <div className="directory-picker-foot">
        <span title={data?.path}>{data?.path}</span>
        <button
          className="btn primary sm"
          type="button"
          onClick={() => {
            if (data?.path) onSelect(data.path);
            setOpen(false);
          }}
        >
          加入此資料夾
        </button>
      </div>
    </div>
  );
}
