import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Minimal data-fetching hook. Stands in for react-query, which we chose not to
 * add: no cache, no dedupe, refetch is explicit. That is fine while every page
 * loads one or two endpoints. If a page ever needs to invalidate someone
 * else's data after a mutation, revisit this decision rather than working
 * around it here.
 */
export function useApi(path, { skip = false } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!skip);

  const refetch = useCallback(async () => {
    if (skip) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api.get(path));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [path, skip]);

  useEffect(() => { refetch(); }, [refetch]);

  return { data, error, loading, refetch, setData };
}
