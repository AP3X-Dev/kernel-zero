"use client";

import { useId, useRef } from "react";

export function ConfirmAction({ description, label }: Readonly<{ description: string; label: string }>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button className="button-danger" onClick={() => dialog.current?.showModal()} type="button">{label}</button>
      <dialog aria-labelledby={titleId} ref={dialog}>
        <h2 id={titleId}>Confirm destructive action</h2>
        <p>{description}</p>
        <div className="dialog-actions">
          <button className="button-secondary" onClick={() => dialog.current?.close()} type="button">Cancel</button>
          <button className="button-danger" onClick={() => dialog.current?.close()} type="button">Confirm {label.toLowerCase()}</button>
        </div>
      </dialog>
    </>
  );
}
