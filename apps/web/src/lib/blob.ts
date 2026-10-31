import { useEffect, useState } from 'react';
import { tokenStore } from './api';

const BASE = import.meta.env.VITE_API_URL ?? '/api';

/** Authenticated binary (screenshots) as an object URL; images cannot send bearer tokens themselves. */
export function useBlobUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let revoked = false;
    let u: string | null = null;
    fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.statusText))))
      .then((b) => { if (!revoked) { u = URL.createObjectURL(b); setUrl(u); } })
      .catch(() => setUrl(null));
    return () => { revoked = true; if (u) URL.revokeObjectURL(u); };
  }, [path]);
  return url;
}
