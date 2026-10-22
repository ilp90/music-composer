import { useId, type InputHTMLAttributes } from 'react';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  name: string;
  error?: string | undefined;
  hint?: string;
}

export function TextField({ label, error, hint, ...input }: TextFieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-200">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`rounded-lg border bg-slate-900 px-3 py-2 text-slate-100 outline-none transition focus:ring-2 focus:ring-indigo-500 ${
          error ? 'border-rose-500' : 'border-slate-700'
        }`}
        {...input}
      />
      {error ? (
        <p id={`${id}-error`} className="text-sm text-rose-400">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
