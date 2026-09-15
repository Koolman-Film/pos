'use client';

import { useState } from 'react';

/**
 * A list's search box, seeded from `?q=`.
 *
 * The header's search sends the words to the page on screen as `?q=`. Typing
 * there again while already on that page re-renders it with a new `q` but keeps
 * the component mounted, so plain `useState(q)` would ignore the second search.
 * This takes the new words whenever `q` changes, and otherwise leaves the box
 * to whoever is typing in it.
 */
export function useSearchFromUrl(q: string | undefined): [string, (value: string) => void] {
  const [search, setSearch] = useState(q ?? '');
  const [seenQ, setSeenQ] = useState(q);
  if (q !== seenQ) {
    setSeenQ(q);
    setSearch(q ?? '');
  }
  return [search, setSearch];
}
