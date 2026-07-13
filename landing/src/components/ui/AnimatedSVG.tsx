import { useEffect, useRef } from 'react';

interface AnimatedSVGProps {
  src: string;
  delay?: number;         // ms between each group (ignored if totalDuration set)
  totalDuration?: number; // ms for the whole animation; computes delay automatically
  duration?: number;      // ms for each individual fade
  startDelay?: number;    // ms before first group appears
  colorMap?: Record<string, string>;
  idPrefix?: string;      // prefix all SVG IDs to avoid collisions when multiple SVGs are on the same page
  invert?: boolean;       // apply CSS filter: invert(1) to the SVG
  naturalSize?: boolean;  // render SVG at its natural size (no width/height: 100%)
  onComplete?: () => void;
  paused?: boolean;
}

const TRANSITION = 'opacity 0.4s cubic-bezier(0.4, 0, 0.2, 1)';

function animate(
  groups: HTMLElement[],
  delay: number,
  duration: number,
  startDelay: number,
  onComplete?: () => void,
): ReturnType<typeof setTimeout>[] {
  const timers: ReturnType<typeof setTimeout>[] = [];
  groups.forEach((el, i) => {
    const t = setTimeout(() => {
      el.style.opacity = '1';
      if (i === groups.length - 1 && onComplete) {
        setTimeout(onComplete, duration);
      }
    }, startDelay + i * delay);
    timers.push(t);
  });
  return timers;
}

export function AnimatedSVG({
  src,
  delay,
  totalDuration,
  duration = 400,
  startDelay = 0,
  colorMap,
  idPrefix,
  invert = false,
  naturalSize = false,
  onComplete,
  paused = false,
}: AnimatedSVGProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const groupsRef = useRef<HTMLElement[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Phase 1: fetch, parse, inject — always on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    fetch(src)
      .then((r) => r.text())
      .then((rawText) => {
        if (cancelled) return;

        let svgText = rawText;
        if (colorMap) {
          for (const [from, to] of Object.entries(colorMap)) {
            svgText = svgText.split(from).join(to);
          }
        }
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgEl = doc.querySelector('svg');
        if (!svgEl) return;

        if (idPrefix) {
          // Collect all IDs defined in this SVG
          const allIds = Array.from(svgEl.querySelectorAll('[id]')).map((el) => el.id);

          // Rename id attributes
          svgEl.querySelectorAll('[id]').forEach((el) => {
            el.id = `${idPrefix}-${el.id}`;
          });

          // Update all href="#..." references
          svgEl.querySelectorAll('[href]').forEach((el) => {
            const href = el.getAttribute('href')!;
            if (href.startsWith('#')) {
              const bare = href.slice(1);
              if (allIds.includes(bare)) el.setAttribute('href', `#${idPrefix}-${bare}`);
            }
          });

          // Update all xlink:href="#..." references
          const xlinkNS = 'http://www.w3.org/1999/xlink';
          svgEl.querySelectorAll('[*|href]').forEach((el) => {
            const href = el.getAttributeNS(xlinkNS, 'href');
            if (href && href.startsWith('#')) {
              const bare = href.slice(1);
              if (allIds.includes(bare)) el.setAttributeNS(xlinkNS, 'href', `#${idPrefix}-${bare}`);
            }
          });

          // Update url(#...) in style attributes and presentation attributes
          svgEl.querySelectorAll('[clip-path],[fill],[stroke],[mask],[filter]').forEach((el) => {
            for (const attr of ['clip-path', 'fill', 'stroke', 'mask', 'filter']) {
              const val = el.getAttribute(attr);
              if (val) {
                el.setAttribute(attr, val.replace(/url\(#([^)]+)\)/g, (_, id) =>
                  allIds.includes(id) ? `url(#${idPrefix}-${id})` : `url(#${id})`
                ));
              }
            }
          });
        }

        svgEl.querySelectorAll('animate').forEach((a) => a.remove());

        const contentChildren = Array.from(svgEl.children).filter(
          (el) => el.tagName.toLowerCase() !== 'defs'
        );

        const wrapper = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
        for (const child of contentChildren) {
          let group: Element;
          if (child.tagName.toLowerCase() === 'g') {
            child.removeAttribute('opacity');
            group = child;
          } else {
            const g = doc.createElementNS('http://www.w3.org/2000/svg', 'g');
            child.parentNode?.insertBefore(g, child);
            g.appendChild(child);
            group = g;
          }
          wrapper.appendChild(group);
        }
        svgEl.appendChild(wrapper);

        const serializer = new XMLSerializer();
        container.innerHTML = serializer.serializeToString(svgEl);

        const liveWrapper = container.querySelector('svg > g:last-child');
        if (!liveWrapper) return;
        const groups = Array.from(liveWrapper.children) as HTMLElement[];

        groups.forEach((el) => {
          el.style.transition = 'none';
          el.style.opacity = '0';
        });
        void container.getBoundingClientRect();
        groups.forEach((el) => { el.style.transition = TRANSITION; });

        groupsRef.current = groups;

        // If already unpaused by the time fetch completes, animate immediately
        if (!pausedRef.current) {
          const d = totalDuration != null && groups.length > 1
            ? totalDuration / (groups.length - 1)
            : (delay ?? 120);
          animate(groups, d, duration, startDelay, onComplete);
        }
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  // Phase 2: when paused flips to false, animate if groups are ready
  useEffect(() => {
    if (paused) return;
    const groups = groupsRef.current;
    if (groups.length === 0) return; // fetch not done yet — handled above

    const d = totalDuration != null && groups.length > 1
      ? totalDuration / (groups.length - 1)
      : (delay ?? 120);
    const timers = animate(groups, d, duration, startDelay, onComplete);
    return () => { timers.forEach(clearTimeout); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  return (
    <div
      ref={containerRef}
      style={naturalSize ? {
        display: 'block',
        lineHeight: 0,
        ...(invert && { filter: 'invert(1)' }),
      } : {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...(invert && { filter: 'invert(1)' }),
      }}
    />
  );
}
