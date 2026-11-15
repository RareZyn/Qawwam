import { createContext, useContext } from 'react';

/** Opens the quick-spend sheet from anywhere; pass an item to pre-select its category. */
export const QuickCtx = createContext<(itemId?: string) => void>(() => {});
export const useQuickSpend = () => useContext(QuickCtx);
