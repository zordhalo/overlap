import type { InputHTMLAttributes, ReactNode } from 'react';

/**
 * Labelled slit input: a mono `.meta` label above a `.slit-input` field.
 * Used for the iCal secret-URL paste, the circle name, member name/zone
 * entry — anywhere the reference language's plain-text field belongs.
 *
 * Deliberately just wraps <input>; a <select> or <textarea> variant would
 * need its own component since neither shares HTMLInputElement's props,
 * and the pages agent (who owns the actual forms) can apply `.slit-input`
 * directly to those elements without this wrapper.
 */
export function Field({
  label,
  id,
  className = '',
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; id: string }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="meta">
        {label}
      </label>
      <input id={id} className={`slit-input rounded-md px-3 py-2 text-(--ink) ${className}`} {...props} />
    </div>
  );
}
