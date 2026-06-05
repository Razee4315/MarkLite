import { useEffect, useRef, useState } from "react";
import mascotWave from "../assets/mascot/mascot-wave.png";
import blinkOpen from "../assets/mascot/mascot-blink-open.png";
import blinkClosed from "../assets/mascot/mascot-blink-closed.png";
import bounceUp from "../assets/mascot/mascot-bounce-up.png";
import bounceMid from "../assets/mascot/mascot-bounce-mid.png";
import bounceDown from "../assets/mascot/mascot-bounce-down.png";

interface MascotIdleProps {
    className?: string;
}

/** [frame, duration ms] pairs for the hover bounce. */
const BOUNCE: Array<[string, number]> = [
    [bounceDown, 110],
    [bounceUp, 150],
    [bounceMid, 110],
    [bounceDown, 90],
    [bounceMid, 110],
];

/**
 * The living welcome mascot: waves on mount, settles into an idle loop with
 * occasional blinks, and does a squash-and-stretch bounce on hover.
 * Pure frame swaps on a single <img>, no JS animation loop while idle.
 * Honors prefers-reduced-motion by staying on the static wave.
 */
export function MascotIdle({ className }: MascotIdleProps) {
    const [src, setSrc] = useState<string>(mascotWave);
    const timers = useRef<number[]>([]);
    const bouncing = useRef(false);
    const reducedMotion = useRef(
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    );

    const later = (fn: () => void, ms: number) => {
        timers.current.push(window.setTimeout(fn, ms));
    };

    useEffect(() => {
        if (reducedMotion.current) return;

        // Wave hello for a beat, then settle into the idle blink loop.
        const scheduleBlink = () => {
            later(() => {
                if (!bouncing.current) {
                    setSrc(blinkClosed);
                    later(() => {
                        if (!bouncing.current) setSrc(blinkOpen);
                    }, 140);
                }
                scheduleBlink();
            }, 3200 + Math.random() * 2600);
        };
        later(() => {
            setSrc(blinkOpen);
            scheduleBlink();
        }, 2000);

        const t = timers.current;
        return () => t.forEach(clearTimeout);
    }, []);

    const handleHover = () => {
        if (reducedMotion.current || bouncing.current) return;
        bouncing.current = true;
        let at = 0;
        for (const [frame, ms] of BOUNCE) {
            later(() => setSrc(frame), at);
            at += ms;
        }
        later(() => {
            setSrc(blinkOpen);
            bouncing.current = false;
        }, at);
    };

    return (
        <img
            src={src}
            alt="Paperling mascot"
            draggable={false}
            onMouseEnter={handleHover}
            className={`object-contain select-none ${className ?? ""}`}
        />
    );
}
