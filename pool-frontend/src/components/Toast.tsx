import { useState, useCallback, useRef, useEffect } from 'react';

// ====================================================================
// Toast Notification System — Premium UI replacement for alert/confirm
// ====================================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
    id: number;
    type: ToastType;
    title: string;
    message?: string;
    duration?: number; // ms, 0 = no auto-dismiss
}

interface ConfirmOptions {
    title: string;
    message: string;
    icon?: string;
    confirmText?: string;
    cancelText?: string;
    type?: 'warning' | 'danger' | 'info';
    details?: { label: string; value: string }[];
}

// ===== TOAST CONTAINER =====
let globalAddToast: ((type: ToastType, title: string, message?: string, duration?: number) => void) | null = null;
let globalConfirm: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

export function showToast(type: ToastType, title: string, message?: string, duration?: number) {
    if (globalAddToast) globalAddToast(type, title, message, duration);
}

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
    if (globalConfirm) return globalConfirm(options);
    return Promise.resolve(false);
}

// ===== SHORTHAND HELPERS =====
export const toast = {
    success: (title: string, message?: string, duration?: number) => showToast('success', title, message, duration),
    error: (title: string, message?: string, duration?: number) => showToast('error', title, message, duration ?? 6000),
    warning: (title: string, message?: string, duration?: number) => showToast('warning', title, message, duration ?? 5000),
    info: (title: string, message?: string, duration?: number) => showToast('info', title, message, duration),
};

// ===== STYLES =====
const TOAST_COLORS: Record<ToastType, { bg: string; border: string; icon: string; iconBg: string; accent: string }> = {
    success: { bg: '#f0fdf4', border: '#86efac', icon: '✅', iconBg: '#dcfce7', accent: '#16a34a' },
    error: { bg: '#fef2f2', border: '#fca5a5', icon: '❌', iconBg: '#fee2e2', accent: '#dc2626' },
    warning: { bg: '#fffbeb', border: '#fcd34d', icon: '⚠️', iconBg: '#fef3c7', accent: '#d97706' },
    info: { bg: '#eff6ff', border: '#93c5fd', icon: 'ℹ️', iconBg: '#dbeafe', accent: '#2563eb' },
};

const CONFIRM_COLORS: Record<string, { btn: string; btnHover: string }> = {
    warning: { btn: '#f59e0b', btnHover: '#d97706' },
    danger: { btn: '#ef4444', btnHover: '#dc2626' },
    info: { btn: '#3b82f6', btnHover: '#2563eb' },
};

// ===== TOAST ITEM COMPONENT =====
function ToastItemComponent({ item, onClose }: { item: ToastItem; onClose: () => void }) {
    const [exiting, setExiting] = useState(false);
    const colors = TOAST_COLORS[item.type];

    useEffect(() => {
        if (item.duration && item.duration > 0) {
            const timer = setTimeout(() => {
                setExiting(true);
                setTimeout(onClose, 300);
            }, item.duration);
            return () => clearTimeout(timer);
        }
    }, [item.duration, onClose]);

    const handleClose = () => {
        setExiting(true);
        setTimeout(onClose, 300);
    };

    return (
        <div
            style={{
                display: 'flex', alignItems: 'flex-start', gap: '12px',
                padding: '16px 20px', borderRadius: '14px',
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                boxShadow: '0 8px 30px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)',
                minWidth: '320px', maxWidth: '440px',
                animation: exiting ? 'toastSlideOut 0.3s ease forwards' : 'toastSlideIn 0.35s ease',
                cursor: 'pointer',
                transition: 'transform 0.15s',
            }}
            onClick={handleClose}
            onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.01)'}
            onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
        >
            <div style={{
                width: '36px', height: '36px', borderRadius: '10px',
                background: colors.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '18px', flexShrink: 0
            }}>
                {colors.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', marginBottom: item.message ? '4px' : 0 }}>
                    {item.title}
                </div>
                {item.message && (
                    <div style={{ fontSize: '13px', color: '#475569', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
                        {item.message}
                    </div>
                )}
            </div>
            <button
                onClick={(e) => { e.stopPropagation(); handleClose(); }}
                style={{
                    background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer',
                    color: '#94a3b8', padding: '0 2px', lineHeight: 1, flexShrink: 0
                }}
            >×</button>
        </div>
    );
}

// ===== CONFIRM MODAL COMPONENT =====
function ConfirmModal({ options, onResolve }: { options: ConfirmOptions; onResolve: (result: boolean) => void }) {
    const [closing, setClosing] = useState(false);
    const confirmBtnRef = useRef<HTMLButtonElement>(null);
    const colorKey = options.type || 'info';
    const colors = CONFIRM_COLORS[colorKey];

    useEffect(() => {
        confirmBtnRef.current?.focus();
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') resolve(false);
            if (e.key === 'Enter') resolve(true);
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, []);

    const resolve = (value: boolean) => {
        setClosing(true);
        setTimeout(() => onResolve(value), 200);
    };

    return (
        <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 99999,
            animation: closing ? 'confirmFadeOut 0.2s ease forwards' : 'confirmFadeIn 0.25s ease',
        }} onClick={() => resolve(false)}>
            <div
                style={{
                    background: '#fff', borderRadius: '20px', padding: '0',
                    width: '420px', maxWidth: '92vw',
                    boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
                    animation: closing ? 'confirmScaleOut 0.2s ease forwards' : 'confirmScaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    overflow: 'hidden',
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    background: 'linear-gradient(135deg, #f8fafc, #e2e8f0)',
                    padding: '28px 28px 20px', textAlign: 'center',
                    borderBottom: '1px solid #e2e8f0',
                }}>
                    <div style={{ fontSize: '44px', marginBottom: '12px', lineHeight: 1 }}>
                        {options.icon || (colorKey === 'danger' ? '🛑' : colorKey === 'warning' ? '⚡' : '❓')}
                    </div>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
                        {options.title}
                    </h3>
                </div>

                {/* Body */}
                <div style={{ padding: '20px 28px' }}>
                    <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#475569', lineHeight: 1.6, whiteSpace: 'pre-line' }}>
                        {options.message}
                    </p>

                    {options.details && options.details.length > 0 && (
                        <div style={{
                            background: '#f8fafc', borderRadius: '12px', padding: '14px 16px',
                            border: '1px solid #e2e8f0',
                            display: 'flex', flexDirection: 'column', gap: '8px',
                        }}>
                            {options.details.map((d, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                                    <span style={{ color: '#64748b' }}>{d.label}</span>
                                    <strong style={{ color: '#0f172a' }}>{d.value}</strong>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer Buttons */}
                <div style={{
                    display: 'flex', gap: '10px', padding: '0 28px 24px',
                }}>
                    <button
                        onClick={() => resolve(false)}
                        style={{
                            flex: 1, padding: '13px', fontSize: '14px', fontWeight: 600,
                            background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0',
                            borderRadius: '12px', cursor: 'pointer', transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; }}
                    >
                        {options.cancelText || 'Hủy (ESC)'}
                    </button>
                    <button
                        ref={confirmBtnRef}
                        onClick={() => resolve(true)}
                        style={{
                            flex: 1, padding: '13px', fontSize: '14px', fontWeight: 700,
                            background: colors.btn, color: '#fff', border: 'none',
                            borderRadius: '12px', cursor: 'pointer', transition: 'all 0.15s',
                            boxShadow: `0 4px 14px ${colors.btn}40`,
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = colors.btnHover; }}
                        onMouseLeave={e => { e.currentTarget.style.background = colors.btn; }}
                    >
                        {options.confirmText || 'Xác nhận (Enter)'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ===== MAIN PROVIDER COMPONENT =====
export function ToastProvider() {
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    const [confirmState, setConfirmState] = useState<{ options: ConfirmOptions; resolve: (v: boolean) => void } | null>(null);
    const idCounter = useRef(0);

    const addToast = useCallback((type: ToastType, title: string, message?: string, duration?: number) => {
        const id = ++idCounter.current;
        const finalDuration = duration ?? (type === 'success' ? 3000 : type === 'error' ? 6000 : 4000);
        setToasts(prev => [...prev, { id, type, title, message, duration: finalDuration }]);
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    const doConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            setConfirmState({ options, resolve });
        });
    }, []);

    useEffect(() => {
        globalAddToast = addToast;
        globalConfirm = doConfirm;
        return () => {
            globalAddToast = null;
            globalConfirm = null;
        };
    }, [addToast, doConfirm]);

    return (
        <>
            {/* CSS Animations */}
            <style>{`
                @keyframes toastSlideIn {
                    from { opacity: 0; transform: translateX(100px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                @keyframes toastSlideOut {
                    from { opacity: 1; transform: translateX(0); }
                    to { opacity: 0; transform: translateX(100px) scale(0.95); }
                }
                @keyframes confirmFadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes confirmFadeOut {
                    from { opacity: 1; }
                    to { opacity: 0; }
                }
                @keyframes confirmScaleIn {
                    from { opacity: 0; transform: scale(0.9) translateY(20px); }
                    to { opacity: 1; transform: scale(1) translateY(0); }
                }
                @keyframes confirmScaleOut {
                    from { opacity: 1; transform: scale(1); }
                    to { opacity: 0; transform: scale(0.95); }
                }
            `}</style>

            {/* Toast Stack */}
            <div style={{
                position: 'fixed', top: '20px', right: '20px',
                display: 'flex', flexDirection: 'column', gap: '10px',
                zIndex: 100000, pointerEvents: 'none',
            }}>
                {toasts.map(t => (
                    <div key={t.id} style={{ pointerEvents: 'auto' }}>
                        <ToastItemComponent item={t} onClose={() => removeToast(t.id)} />
                    </div>
                ))}
            </div>

            {/* Confirm Modal */}
            {confirmState && (
                <ConfirmModal
                    options={confirmState.options}
                    onResolve={(result) => {
                        confirmState.resolve(result);
                        setConfirmState(null);
                    }}
                />
            )}
        </>
    );
}
