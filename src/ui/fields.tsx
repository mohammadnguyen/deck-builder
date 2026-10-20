import { useRef, useState, type ReactNode } from 'react';

export function Num({ label, value, onChange, step = 1, min, max, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; hint?: string }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={text ?? String(value)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== null) {
            const v = parseFloat(text);
            if (Number.isFinite(v)) onChange(v);
            setText(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Sel({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Chk({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="field chk">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

/** Segmented control: one of a few big, labelled choices. */
export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A small number box that commits on Enter or blur, so a value can be typed in full. */
export function NumInline({ value, onCommit, step = 1, min, className }: { value: number; onCommit: (v: number) => void; step?: number; min?: number; className?: string }) {
  const [text, setText] = useState<string | null>(null);
  const cancel = useRef(false);
  const commit = () => {
    if (cancel.current) {
      // Escape: the blur it triggers must not commit the typed text
      cancel.current = false;
      setText(null);
      return;
    }
    if (text === null) return;
    const v = parseFloat(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    setText(null);
  };
  return (
    <input
      type="number"
      className={className}
      step={step}
      min={min}
      value={text ?? String(value)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          cancel.current = true;
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
    />
  );
}
