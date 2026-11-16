import * as React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';
import { createId } from '../../lib/utils';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

interface ToastContextValue {
  notify: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const notify = React.useCallback((toast: Omit<ToastItem, 'id'>) => {
    const id = createId('tst');
    setToasts((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const dismiss = (id: string) => setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-[360px] max-w-[90vw]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-start gap-3 rounded-lg border border-[#d9dfe5] bg-white p-3.5 shadow-lg text-sm"
          >
            <div className="mt-0.5 shrink-0">
              {t.tone === 'success' && <CheckCircle2 className="h-4 w-4 text-[#007e46]" />}
              {t.tone === 'error' && <XCircle className="h-4 w-4 text-[#e60018]" />}
              {t.tone === 'warning' && <AlertTriangle className="h-4 w-4 text-[#d97706]" />}
              {t.tone === 'info' && <CheckCircle2 className="h-4 w-4 text-[#070e16]" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-[#070e16] text-xs">{t.title}</p>
              {t.description && <p className="text-xs text-[#555f69] mt-0.5 break-words">{t.description}</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="text-[#555f69] hover:text-[#070e16] p-0.5 cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
