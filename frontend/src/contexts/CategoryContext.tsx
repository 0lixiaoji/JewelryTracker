import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { fetchCategories } from '../api/client';
import type { CategoryWithStats } from '../api/types';

interface CategoryContextValue {
  categories: CategoryWithStats[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const CategoryContext = createContext<CategoryContextValue | null>(null);

export function CategoryProvider({ children }: { children: ReactNode }) {
  const [categories, setCategories] = useState<CategoryWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCategories();
      setCategories(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载分类失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <CategoryContext.Provider
      value={{ categories, loading, error, refresh: load }}
    >
      {children}
    </CategoryContext.Provider>
  );
}

export function useCategories(): CategoryContextValue {
  const ctx = useContext(CategoryContext);
  if (!ctx) throw new Error('useCategories must be inside CategoryProvider');
  return ctx;
}
