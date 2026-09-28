"use client";
import {
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { X, Plus, ArrowUpRight, SearchX } from "lucide-react";
import type { Company } from "@/lib/types";
export const FormErrorContext = createContext("");
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function CompanyMark({
  company,
  large = false,
}: {
  company: Company;
  large?: boolean;
}) {
  return (
    <span
      className={`company-mark mark-${company.color} ${large ? "mark-large" : ""}`}
    >
      {company.initials}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty-state">
      <SearchX size={28} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  if (
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "textarea", "select"].includes(children.type)
  ) {
    const control = cloneElement(
      children as ReactElement<{ id: string; "aria-describedby"?: string }>,
      { id, "aria-describedby": hint ? `${id}-hint` : undefined },
    );
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        {control}
        {hint && <small id={`${id}-hint`}>{hint}</small>}
      </div>
    );
  }
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span id={id}>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </div>
  );
}

export function Tags({
  values,
  onChange,
  label,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  label: string;
}) {
  const [input, setInput] = useState("");
  function add() {
    const value = input.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setInput("");
  }
  return (
    <div className="tag-editor">
      <div className="tags">
        {values.map((value) => (
          <span className="tag" key={value}>
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`Remove ${value}`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="tag-input">
        <input
          aria-label={`Add ${label}`}
          placeholder={`Add ${label}…`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button
          type="button"
          className="icon-button"
          onClick={add}
          aria-label={`Add ${label}`}
        >
          <Plus size={15} />
        </button>
      </div>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const error = useContext(FormErrorContext);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-label={title}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {error && (
        <div className="modal-error" role="alert">
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}
export function SourceLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className="source-link">
      {children}
      <ArrowUpRight size={14} />
    </a>
  ) : (
    <span className="source-link">
      {children}
      <Badge>Sample</Badge>
    </span>
  );
}
export function niceDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
