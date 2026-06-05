import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ViewMode } from "./ModeToggle";
import mascotWave from "../assets/mascot/mascot-wave.png";
import mascotWrite from "../assets/mascot/mascot-write.png";
import mascotPointRight from "../assets/mascot/mascot-point-right.png";
import mascotThink from "../assets/mascot/mascot-think.png";
import mascotCelebrate from "../assets/mascot/mascot-celebrate.png";
import iconPalette from "../assets/mascot/icon-command-palette.png";

interface TourProps {
    /** Called when the tour finishes or is skipped. Caller persists the done flag. */
    onClose: () => void;
    /** Lets the editor step switch to split view so both panes are visible. */
    onSetMode: (mode: ViewMode) => void;
}

interface Step {
    id: string;
    /** CSS selector of the element to spotlight. Omit for a centered card over a full dim. */
    target?: string;
    /** Where the card sits relative to the (padded) target rect. */
    placement: "center" | "left-of" | "below";
    image: string;
    imageAlt: string;
    /** Tailwind height class for the mascot image. */
    imageClass: string;
    title: string;
    body: string;
}

const STEPS: Step[] = [
    {
        id: "welcome",
        placement: "center",
        image: mascotWave,
        imageAlt: "Paperling mascot waving hello",
        imageClass: "h-32",
        title: "Hey, welcome to Paperling!",
        body: "I'm the paperling this app is named after. Want a quick look around? It takes about 30 seconds.",
    },
    {
        id: "editor",
        target: "[data-tour='editor']",
        placement: "center",
        image: mascotWrite,
        imageAlt: "Paperling mascot writing with a pencil",
        imageClass: "h-28",
        title: "Your editor",
        body: "Write markdown on the left and watch it render live on the right. Just start typing.",
    },
    {
        id: "modes",
        target: "[data-tour='mode-toggle']",
        placement: "left-of",
        image: mascotPointRight,
        imageAlt: "Paperling mascot pointing at the view toggle",
        imageClass: "h-24",
        title: "Pick your view",
        body: "Reader for reading, Split for writing, Code for raw markdown. Ctrl+E flips between them.",
    },
    {
        id: "palette",
        placement: "center",
        image: iconPalette,
        imageAlt: "Command palette illustration",
        imageClass: "h-24",
        title: "One box for everything",
        body: "Press Ctrl+P after the tour to open the command palette. Files, views, themes, AI: it's all in there.",
    },
    {
        id: "themes",
        target: "[data-tour='settings']",
        placement: "below",
        image: mascotThink,
        imageAlt: "Paperling mascot thinking about themes",
        imageClass: "h-24",
        title: "Make it yours",
        body: "Five themes live under this gear: Dark, Light, Paper, GitHub and Dracula.",
    },
    {
        id: "done",
        placement: "center",
        image: mascotCelebrate,
        imageAlt: "Paperling mascot celebrating with confetti",
        imageClass: "h-32",
        title: "That's it, you're ready!",
        body: "Replay this tour anytime from the command palette. Happy writing!",
    },
];

const SPOT_PAD = 8;   // breathing room around the spotlit element
const CARD_GAP = 16;  // gap between card and spotlight
const MARGIN = 16;    // minimum distance from the viewport edge

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

interface SpotRect { left: number; top: number; width: number; height: number }

export function Tour({ onClose, onSetMode }: TourProps) {
    const [stepIndex, setStepIndex] = useState(0);
    const [rect, setRect] = useState<SpotRect | null>(null);
    const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
    const cardRef = useRef<HTMLDivElement>(null);
    const nextRef = useRef<HTMLButtonElement>(null);

    const step = STEPS[stepIndex];
    const isFirst = stepIndex === 0;
    const isLast = stepIndex === STEPS.length - 1;

    // The editor step shows off split view so both panes are on screen.
    useEffect(() => {
        if (step.id === "editor") onSetMode("split");
    }, [step.id, onSetMode]);

    const measure = useCallback(() => {
        if (!step.target) {
            setRect(null);
            return;
        }
        const el = document.querySelector(step.target);
        if (!el) {
            setRect(null);
            return;
        }
        const r = el.getBoundingClientRect();
        setRect({
            left: r.left - SPOT_PAD,
            top: r.top - SPOT_PAD,
            width: r.width + SPOT_PAD * 2,
            height: r.height + SPOT_PAD * 2,
        });
    }, [step.target]);

    // Measure after a frame so layout changes from onSetMode have settled.
    useLayoutEffect(() => {
        const raf = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(raf);
    }, [measure]);

    useEffect(() => {
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [measure]);

    // Position the card relative to the spotlight once both are measurable.
    useLayoutEffect(() => {
        const card = cardRef.current;
        if (!card || step.placement === "center" || !rect) {
            setCardPos(null);
            return;
        }
        const cw = card.offsetWidth;
        const ch = card.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let left: number;
        let top: number;
        if (step.placement === "left-of") {
            left = rect.left - cw - CARD_GAP;
            top = rect.top + rect.height / 2 - ch / 2;
        } else {
            // below, right-aligned to the target (used for the titlebar gear)
            left = rect.left + rect.width - cw;
            top = rect.top + rect.height + CARD_GAP;
        }
        setCardPos({
            left: clamp(left, MARGIN, vw - cw - MARGIN),
            top: clamp(top, MARGIN, vh - ch - MARGIN),
        });
    }, [rect, step.placement, stepIndex]);

    const advance = useCallback(() => {
        if (isLast) onClose();
        else setStepIndex((i) => i + 1);
    }, [isLast, onClose]);

    const back = useCallback(() => {
        setStepIndex((i) => Math.max(0, i - 1));
    }, []);

    // Modal keyboard handling: capture phase so app shortcuts (Ctrl+P, Ctrl+E…)
    // don't fire underneath the overlay while the tour is up.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            } else if (e.key === "Enter" || e.key === "ArrowRight") {
                e.preventDefault();
                advance();
            } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                back();
            }
        };
        window.addEventListener("keydown", handler, true);
        return () => window.removeEventListener("keydown", handler, true);
    }, [advance, back, onClose]);

    // Keep focus on the primary action so Enter/Space always work.
    useEffect(() => {
        nextRef.current?.focus();
    }, [stepIndex]);

    const centered = step.placement === "center" || !rect;

    return (
        <div
            className="fixed inset-0 z-[300] no-select"
            role="dialog"
            aria-modal="true"
            aria-label="Welcome tour"
        >
            {/* Dim layer. With a target, a spotlight hole punched via box-shadow;
                without one, a plain full dim. */}
            {rect ? (
                <div
                    className="absolute rounded-xl border border-[var(--accent)] pointer-events-none"
                    style={{
                        left: rect.left,
                        top: rect.top,
                        width: rect.width,
                        height: rect.height,
                        boxShadow: "0 0 0 100vmax rgba(0, 0, 0, 0.55)",
                        transition: "all 0.25s ease",
                    }}
                />
            ) : (
                <div className="absolute inset-0 bg-black/55" />
            )}

            {/* Card */}
            <div
                className={centered ? "absolute inset-0 flex items-center justify-center p-6" : undefined}
                style={centered ? undefined : { position: "absolute", left: cardPos?.left ?? -9999, top: cardPos?.top ?? -9999 }}
            >
                <div
                    ref={cardRef}
                    className="w-[340px] max-w-[calc(100vw-2rem)] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl shadow-2xl p-6 flex flex-col items-center gap-4 text-center animate-fade-in"
                >
                    <img
                        src={step.image}
                        alt={step.imageAlt}
                        draggable={false}
                        className={`${step.imageClass} w-auto object-contain`}
                    />
                    <div className="flex flex-col gap-1.5">
                        <h2 className="text-lg font-bold tracking-tight text-[var(--text-primary)]">{step.title}</h2>
                        <p className="text-sm leading-relaxed text-[var(--text-secondary)]">{step.body}</p>
                    </div>

                    {/* Progress dots */}
                    <div className="flex items-center gap-1.5" aria-label={`Step ${stepIndex + 1} of ${STEPS.length}`}>
                        {STEPS.map((s, i) => (
                            <span
                                key={s.id}
                                className={`rounded-full transition-all duration-200 ${i === stepIndex ? "w-4 h-1.5 bg-[var(--accent)]" : "w-1.5 h-1.5 bg-[var(--border)]"}`}
                            />
                        ))}
                    </div>

                    <div className="w-full flex items-center justify-between gap-2">
                        {isLast ? (
                            <span aria-hidden="true" />
                        ) : (
                            <button
                                onClick={onClose}
                                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors px-2 py-1.5 rounded"
                            >
                                Skip tour
                            </button>
                        )}
                        <div className="flex items-center gap-2">
                            {!isFirst && (
                                <button
                                    onClick={back}
                                    className="btn-press text-sm font-medium px-4 py-2 rounded-[var(--radius-md)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] border border-[var(--border)] transition-all duration-200"
                                >
                                    Back
                                </button>
                            )}
                            <button
                                ref={nextRef}
                                onClick={advance}
                                className="btn-press text-sm font-medium px-4 py-2 rounded-[var(--radius-md)] bg-[var(--accent)] hover:opacity-90 text-[var(--accent-text)] transition-all duration-200"
                            >
                                {isLast ? "Start writing" : isFirst ? "Show me around" : "Next"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
