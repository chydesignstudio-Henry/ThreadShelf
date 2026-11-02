import { useState, useCallback } from 'react';
import { useCreateCollectionMutation } from '../queries';
import { toast } from '../toast';

interface NewCollectionModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (name: string) => void;
}

export function NewCollectionModal({ open, onClose, onCreated }: NewCollectionModalProps) {
  const [name, setName] = useState('');
  const mutation = useCreateCollectionMutation();

  const doCreate = useCallback(async () => {
    if (!name) return;
    try {
      const d = await mutation.mutateAsync(name);
      setName('');
      onClose();
      onCreated(d.collection ?? name);
      toast.success(`Created collection "${d.collection ?? name}".`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '未知錯誤');
    }
  }, [name, onClose, onCreated, mutation]);

  if (!open) return null;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>新收藏集</h3>
          <p>
            收藏集是本機 LanceDB 資料表。請使用小寫英數字、連字號、底線。
          </p>
        </div>
        <div className="modal-body">
          <label>名稱</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.replace(/[^a-z0-9_-]/g, '').toLowerCase())}
            onKeyDown={(e) => e.key === 'Enter' && name && void doCreate()}
            placeholder="my-archive"
          />
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={() => void doCreate()} disabled={!name}>
            建立
          </button>
        </div>
      </div>
    </div>
  );
}
