import { useEffect, useState } from 'react';

interface ToastProps {
    message: string;
    isVisible: boolean;
    onHide: () => void;
    duration?: number;
}

export function Toast({ message, isVisible, onHide, duration = 2000 }: ToastProps) {
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

    return (
        <div
            className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg 
                bg-[var(--bg-secondary)] border border-[var(--border-subtle)] 
                shadow-lg text-[var(--text-primary)] text-sm font-medium
                transition-all duration-200 ease-out
                ${isAnimating ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}
        >
            <div className="flex items-center gap-2">
                <svg 
                    className="w-4 h-4 text-green-500" 
                    fill="none" 
                    viewBox="0 0 24 24" 
                    stroke="currentColor"
                >
                    <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={2} 
                        d="M5 13l4 4L19 7" 
                    />
                </svg>
                {message}
            </div>
        </div>
    );
}
