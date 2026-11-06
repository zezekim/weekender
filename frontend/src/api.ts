import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public source?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(path, {
      ...init,
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest", ...init?.headers },
    });
  } catch {
    throw new ApiError("We couldn't reach the Weekender server. Check your connection and try again.", 0);
  }
  if (!resp.ok) {
    let message = `Something went wrong (HTTP ${resp.status}).`;
    let source: string | undefined;
    try {
      const body = await resp.json();
      message = body.message ?? (typeof body.detail === "string" ? body.detail : message);
      source = body.source;
    } catch {
      /* non-JSON error page, e.g. from the proxy */
    }
    throw new ApiError(message, resp.status, source);
  }
  return resp.json();
}

export interface Async<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

/** Fetch `path` whenever it changes; `null` means "nothing to load yet". */
export function useApi<T>(path: string | null): Async<T> {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({
    data: null,
    error: null,
    loading: !!path,
  });
  const [nonce, setNonce] = useState(0);
  const current = useRef(path);

  useEffect(() => {
    current.current = path;
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    setState({ data: null, error: null, loading: true });
    api<T>(path)
      .then((data) => current.current === path && setState({ data, error: null, loading: false }))
      .catch((error: ApiError) => current.current === path && setState({ data: null, error, loading: false }));
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}
