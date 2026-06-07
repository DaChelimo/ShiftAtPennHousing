import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';

import { Icon, type IconName } from './Icon';

// Field wrapper: label + control + helper text (Carbon field anatomy).
export function Field({
  label,
  helper,
  htmlFor,
  children,
}: {
  label?: ReactNode;
  helper?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <label className="field" htmlFor={htmlFor}>
      {label && <span className="t-label">{label}</span>}
      {children}
      {helper && <span className="t-helper">{helper}</span>}
    </label>
  );
}

type TextInputProps = { icon?: IconName } & InputHTMLAttributes<HTMLInputElement>;

// Carbon text field: filled, bottom-border, square; focus = 2px brand underline.
export function TextInput({ icon, className = '', ...rest }: TextInputProps) {
  return (
    <div className="input-wrap">
      {icon && <Icon name={icon} size={16} className="input-icon" />}
      <input className={`input ${icon ? 'has-icon' : ''} ${className}`.trim()} {...rest} />
    </div>
  );
}

// Date field — Carbon keeps the simple case as a native date input (YYYY-MM-DD).
// The richer week-picker popover ships with the calendar screen.
export function DateInput({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="input-wrap">
      <input type="date" className={`input ${className}`.trim()} {...rest} />
    </div>
  );
}

// Carbon text area: filled, bottom-border, square; vertically resizable.
export function TextArea({
  className = '',
  rows = 3,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`.trim()} rows={rows} {...rest} />;
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

// Native select styled as a Carbon dropdown (caret overlay). For a searchable
// dropdown use <ComboBox>.
export function Select({ children, className = '', ...rest }: SelectProps) {
  return (
    <div className="select-wrap">
      <select className={`input select ${className}`.trim()} {...rest}>
        {children}
      </select>
      <Icon name="chevDown" size={16} className="select-caret" />
    </div>
  );
}
