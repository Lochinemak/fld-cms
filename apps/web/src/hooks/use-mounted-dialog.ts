import { useState } from 'react';

/**
 * For a dialog that opens when mounted and closes itself, say after saving. The parent unmounts
 * it on `onClosed`, once the close animation has run, so the content never empties while visible.
 */
export function useMountedDialog(onClosed: () => void) {
  const [open, setOpen] = useState(true);
  return {
    close: () => setOpen(false),
    /** Props for the dialog's root. While `busy`, say saving, it can't be dismissed. */
    rootProps: (busy = false) => ({
      open,
      onOpenChange: (next: boolean) => {
        if (!busy) {
          setOpen(next);
        }
      },
      onOpenChangeComplete: (next: boolean) => {
        if (!next) {
          onClosed();
        }
      },
    }),
  };
}
