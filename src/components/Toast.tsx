import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
    message: string;
    isVisible: boolean;
    onHide: () => void;
    duration?: number;
    type?: ToastType;
}

export function Toast({ message, isVisible, onHide, duration = 2000, type = 'success' }: ToastProps) {
    const [isAnimating, setIsAnimating] = useState(false);

    useEffect(() => {
        if (isVisible) {
            setIsAnimating(true);
            const fadeTimer = setTimeout(() => {
                setIsAnimating(false);
            }, duration);
            const hideTimer = setTimeout(onHide, duration + 200);
            return () => {
                clearTimeout(fadeTimer);
                clearTimeout(hideTimer);
            };
        }
    }, [isVisible, duration, onHide]);

    if (!isVisible && !isAnimating) return null;

    const iconMap = {
        success: (
            <svg className="w-4 h-4 text-[var(--status-saved)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
        ),
        error: (
            <svg className="w-4 h-4 text-[var(--danger)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
        ),
        info: (
            <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
    };

    return (
        <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg
                bg-[var(--bg-secondary)] border border-[var(--border-subtle)]
                shadow-lg text-[var(--text-primary)] text-sm font-medium
                transition-all duration-200 ease-out
                ${isAnimating ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
        >
            <div className="flex items-center gap-2">
                {iconMap[type]}
                {message}
            </div>
        </div>
    );
}
