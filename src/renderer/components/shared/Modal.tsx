import { type CSSProperties, type ReactElement, type ReactNode, useEffect } from "react";

export type ModalProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional footer actions (e.g. Cancel / Save). */
  footer?: ReactNode;
  /** Dialog panel width hint. */
  minWidth?: number | string;
};

/**
 * Fixed overlay + dialog shell matching BookDetail modal chrome.
 * Backdrop click and Escape dismiss via onClose.
 */
export function Modal({ open, title, onClose, children, footer, minWidth = 320 }: ModalProps): ReactElement | null {
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      style={overlayStyle}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="spire-modal-title"
        style={{ ...dialogStyle, minWidth }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="spire-modal-title" style={titleStyle}>
          {title}
        </h2>
        <div>{children}</div>
        {footer ? <div style={footerStyle}>{footer}</div> : null}
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--accent-soft)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
  padding: 24,
};

const dialogStyle: CSSProperties = {
  background: "var(--bg-surface)",
  borderRadius: "var(--radius-lg)",
  padding: 24,
  border: "1px solid var(--border-default)",
  width: "100%",
  maxWidth: 420,
};

const titleStyle: CSSProperties = {
  margin: "0 0 16px",
  fontSize: 16,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const footerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
};
