import { useState } from 'react';

const KEY = 'vibecomics.dismissedHelp';

function readDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeDismissed(all: Set<string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([...all]));
  } catch {
    // storage unavailable: the dismissal just lasts for this page view
  }
}

/** A help text, named by its title, closed once and never shown again anywhere in the app. */
export function useDismissedHelp(title: string) {
  const [dismissed, setDismissed] = useState(() => readDismissed().has(title));

  function dismiss() {
    setDismissed(true);
    const all = readDismissed();
    all.add(title);
    writeDismissed(all);
  }

  return [dismissed, dismiss] as const;
}

/** Shows every help text again. */
export function clearDismissedHelp(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear if storage never worked
  }
}
