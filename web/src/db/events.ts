type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to user-made card changes (not sync writes). Returns an unsubscribe function. */
export function onLocalChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called by the card repository after a user change commits; sync uses it to push soon. */
export function localChanged(): void {
  for (const listener of listeners) listener();
}
