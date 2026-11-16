import { useEffect, useId, useRef, type ReactNode } from "react";

interface RemovalDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  children?: ReactNode;
  pending: boolean;
  disabled?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function RemovalDialog({
  title, description, confirmLabel, children, pending, disabled = false, error, onCancel, onConfirm
}: RemovalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const submittedRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    cancelRef.current?.focus();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  useEffect(() => {
    if (!pending) submittedRef.current = false;
  }, [pending, error]);

  return (
    <dialog ref={dialogRef} className="modal removal-dialog"
      aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={pending}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}>
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close removal dialog"
          disabled={pending} onClick={onCancel}>×</button>
      </div>
      <p id={descriptionId}>{description}</p>
      {children}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button ref={cancelRef} type="button" className="button secondary" disabled={pending}
          autoFocus onClick={onCancel}>Cancel</button>
        <button type="button" className="button danger" disabled={pending || disabled}
          onClick={() => {
            if (submittedRef.current) return;
            submittedRef.current = true;
            onConfirm();
          }}>
          {pending ? "Removing…" : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
