import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

interface CardAction {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

export function CardActionsMenu({ label, actions }: { label: string; actions: CardAction[] }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  function show(focusLast = false) {
    if (!menu.current || !trigger.current) return;
    menu.current.showPopover();
    const anchor = trigger.current.getBoundingClientRect();
    const bounds = menu.current.getBoundingClientRect();
    menu.current.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12))}px`;
    const top = anchor.bottom + 5 + bounds.height <= window.innerHeight - 12
      ? anchor.bottom + 5 : anchor.top - bounds.height - 5;
    menu.current.style.top = `${Math.max(12, Math.min(top, window.innerHeight - bounds.height - 12))}px`;
    const items = menu.current.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
    items[focusLast ? items.length - 1 : 0]?.focus({ preventScroll: true });
  }

  function close(restoreFocus = false) {
    menu.current?.hidePopover();
    if (restoreFocus) trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      close();
    };
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = items.findIndex((item) => item === document.activeElement);
    let next: number;
    switch (event.key) {
      case "ArrowDown": next = (index + 1) % items.length; break;
      case "ArrowUp": next = (index - 1 + items.length) % items.length; break;
      case "Home": next = 0; break;
      case "End": next = items.length - 1; break;
      case "Escape":
        event.preventDefault();
        close(true);
        return;
      case "Tab":
        close(true);
        return;
      default: return;
    }
    event.preventDefault();
    items[next]?.focus();
  }

  return (
    <>
      <button ref={trigger} type="button" className="button secondary card-menu-trigger"
        aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={id}
        popoverTarget={id}
        onClick={(event) => {
          event.preventDefault();
          if (menu.current?.matches(":popover-open")) close();
          else show();
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          show(event.key === "ArrowUp");
        }}>
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" />
        </svg>
      </button>
      <div ref={menu} id={id} popover="auto" role="menu" aria-label={label}
        className="card-action-menu" onKeyDown={onKeyDown}
        onToggle={(event) => setOpen(event.newState === "open")}>
        {actions.map((action) => (
          <button key={action.label} type="button" role="menuitem" tabIndex={-1}
            className={action.danger ? "danger-text" : undefined} disabled={action.disabled}
            onClick={() => {
              close(true);
              action.onSelect();
            }}>
            {action.label}
          </button>
        ))}
      </div>
    </>
  );
}
