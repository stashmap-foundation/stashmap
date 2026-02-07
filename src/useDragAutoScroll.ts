import { useEffect, useRef } from "react";

const SCROLL_BUFFER = 150;
const SCROLL_SPEED = 20;

function computeScale(
  pos: number,
  start: number,
  end: number,
  buffer: number
): number {
  if (pos < start + buffer && pos >= start) {
    return (pos - start - buffer) / buffer;
  }
  if (pos > end - buffer && pos <= end) {
    return -(end - pos - buffer) / buffer;
  }
  return 0;
}

export function useDragAutoScroll(
  scrollContainer: HTMLElement | undefined,
  axis: "vertical" | "horizontal" = "vertical"
): void {
  const frameRef = useRef<number | null>(null);
  const scaleRef = useRef(0);
  const lastDragOverRef = useRef(0);

  useEffect(() => {
    if (!scrollContainer) {
      return undefined;
    }

    const stopScrolling = (): void => {
      // eslint-disable-next-line functional/immutable-data
      scaleRef.current = 0;
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        // eslint-disable-next-line functional/immutable-data
        frameRef.current = null;
      }
    };

    const onDragOver = (e: DragEvent): void => {
      // eslint-disable-next-line functional/immutable-data
      lastDragOverRef.current = Date.now();
      const rect = scrollContainer.getBoundingClientRect();

      if (axis === "vertical") {
        const buffer = Math.min(rect.height / 2, SCROLL_BUFFER);
        // eslint-disable-next-line functional/immutable-data
        scaleRef.current = computeScale(
          e.clientY,
          rect.top,
          rect.bottom,
          buffer
        );
      } else {
        const buffer = Math.min(rect.width / 2, SCROLL_BUFFER);
        // eslint-disable-next-line functional/immutable-data
        scaleRef.current = computeScale(
          e.clientX,
          rect.left,
          rect.right,
          buffer
        );
      }

      if (scaleRef.current !== 0 && frameRef.current === null) {
        const tick = (): void => {
          if (
            scaleRef.current === 0 ||
            Date.now() - lastDragOverRef.current > 200
          ) {
            stopScrolling();
            return;
          }
          if (axis === "vertical") {
            // eslint-disable-next-line functional/immutable-data, no-param-reassign
            scrollContainer.scrollTop += scaleRef.current * SCROLL_SPEED;
          } else {
            // eslint-disable-next-line functional/immutable-data, no-param-reassign
            scrollContainer.scrollLeft += scaleRef.current * SCROLL_SPEED;
          }
          // eslint-disable-next-line functional/immutable-data
          frameRef.current = requestAnimationFrame(tick);
        };
        // eslint-disable-next-line functional/immutable-data
        frameRef.current = requestAnimationFrame(tick);
      }
    };

    scrollContainer.addEventListener("dragover", onDragOver);

    return () => {
      scrollContainer.removeEventListener("dragover", onDragOver);
      stopScrolling();
    };
  }, [scrollContainer, axis]);
}
