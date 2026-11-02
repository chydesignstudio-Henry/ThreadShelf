import { Icons } from '../icons';
import { EXAMPLE_QUERIES } from '../constants';

interface EmptyProps {
  readonly onPick: (query: string) => void;
}

export function Empty({ onPick }: EmptyProps) {
  return (
    <div className="empty">
      <h3>用自然語言詢問你的封存。</h3>
      <p>
        ThreadShelf 在本機執行：查詢在這台電腦上做 embedding，並搜尋本機 LanceDB。
        試試一個主題、一段記不清的草稿，或你想找的答案的樣子。
      </p>
      <div className="examples">
        {EXAMPLE_QUERIES.map((q) => (
          <button key={q} className="example-chip" onClick={() => onPick(q)}>
            {Icons.spark}
            <span>{q}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
