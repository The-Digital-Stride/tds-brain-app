import type { ReactNode } from 'react';
import { LIBRARY_CLIENTS, type LibraryImage, type Scene, type Tone } from './data.ts';

/**
 * Stand-in pictures for the example library, drawn as SVG so the preview needs no image files and
 * nothing from the network. Each is drawn at the image's own proportions (100 units wide).
 */

interface Ctx {
  /** Height in units; the width is always 100. */
  H: number;
  b: { main: string; dark: string; accent: string };
  tone: Tone;
}

const FALLBACK = { main: '#0b5cb5', dark: '#021b43', accent: '#f59e0b' };
const SKIN = '#d9a97f';

const sky = (tone: Tone) => (tone === 'warm' ? '#f6dcbd' : tone === 'cool' ? '#bcd7f0' : '#dfe9f2');

function Person({ cx, top, r, colour }: { cx: number; top: number; r: number; colour: string }) {
  return (
    <>
      <circle cx={cx} cy={top + r} r={r} fill={SKIN} />
      <rect x={cx - r * 1.9} y={top + r * 2.3} width={r * 3.8} height={r * 9} rx={r * 1.1} fill={colour} />
    </>
  );
}

const SCENES: Record<Scene, (c: Ctx) => ReactNode> = {
  logo({ H, b, tone }) {
    const dark = tone === 'dark';
    const mark = tone === 'mono' ? '#111827' : b.main;
    const inner = tone === 'mono' ? '#ffffff' : b.accent;
    const word = dark ? '#ffffff' : tone === 'mono' ? '#111827' : b.dark;
    const cells: ReactNode[] = [];
    if (tone === 'clear') {
      const size = 12.5;
      for (let row = 0; row * size < H; row++) {
        for (let col = row % 2; col < 8; col += 2) {
          cells.push(
            <rect
              key={`${row}-${col}`}
              x={col * size}
              y={row * size}
              width={size}
              height={size}
              fill="#e6e7ec"
            />,
          );
        }
      }
    }
    const wide = H < 60;
    const r = wide ? H * 0.28 : H * 0.3;
    const cx = wide ? 26 : 50;
    const wx = cx + r + 6;
    return (
      <>
        <rect width="100" height={H} fill={dark ? b.dark : '#ffffff'} />
        {cells}
        <circle cx={cx} cy={H * 0.5} r={r} fill={mark} />
        <circle cx={cx} cy={H * 0.56} r={r * 0.44} fill={inner} />
        {wide ? (
          <>
            <rect x={wx} y={H * 0.33} width="42" height={H * 0.15} rx="1.5" fill={word} />
            <rect x={wx} y={H * 0.56} width="27" height={H * 0.09} rx="1.2" fill={word} opacity="0.65" />
          </>
        ) : null}
      </>
    );
  },

  van({ H, b, tone }) {
    return (
      <>
        <rect width="100" height={H} fill={sky(tone)} />
        <circle cx="82" cy={H * 0.18} r="5" fill="#fff6d2" />
        <rect y={H * 0.5} width="100" height={H * 0.14} fill="#5f8c5b" />
        <rect y={H * 0.62} width="100" height={H * 0.38} fill="#9aa3ad" />
        <rect x="20" y={H * 0.36} width="58" height={H * 0.32} rx="3" fill="#ffffff" />
        <rect x="20" y={H * 0.56} width="58" height={H * 0.05} fill={b.main} />
        <rect x="61" y={H * 0.4} width="14" height={H * 0.12} rx="1.5" fill="#9db7cf" />
        <circle cx="33" cy={H * 0.47} r="3" fill={b.main} />
        <rect x="38" y={H * 0.45} width="15" height={H * 0.04} rx="1" fill={b.dark} />
        <circle cx="33" cy={H * 0.69} r="4.6" fill="#2b2f36" />
        <circle cx="66" cy={H * 0.69} r="4.6" fill="#2b2f36" />
      </>
    );
  },

  engineer({ H, b, tone }) {
    return (
      <>
        <rect width="100" height={H} fill={tone === 'cool' ? '#dfe7ee' : '#ece6da'} />
        <rect y={H * 0.82} width="100" height={H * 0.18} fill="#c9bfae" />
        <rect x="13" y={H * 0.12} width="27" height={H * 0.5} rx="2" fill="#ffffff" stroke="#d5d0c6" />
        <rect x="19" y={H * 0.46} width="15" height={H * 0.08} rx="1" fill="#e2e6ec" />
        <circle cx="26.5" cy={H * 0.2} r="1.7" fill={b.main} />
        <rect x="19" y={H * 0.62} width="2" height={H * 0.2} fill="#b08d57" />
        <rect x="32" y={H * 0.62} width="2" height={H * 0.2} fill="#b08d57" />
        <rect x="40" y={H * 0.45} width="20" height={H * 0.06} rx="2" fill={b.dark} />
        <Person cx={67} top={H * 0.2} r={6.2} colour={b.dark} />
        <circle cx="72" cy={H * 0.5} r="2" fill={b.main} />
      </>
    );
  },

  boiler({ H, b }) {
    return (
      <>
        <rect width="100" height={H} fill="#f1eee8" />
        <rect x="31" y={H * 0.16} width="42" height={H * 0.62} rx="4" fill="#021b43" opacity="0.08" />
        <rect x="29" y={H * 0.13} width="42" height={H * 0.62} rx="4" fill="#ffffff" stroke="#dcd7cd" />
        <rect x="40" y={H * 0.52} width="20" height={H * 0.1} rx="1.5" fill={b.dark} />
        <circle cx="50" cy={H * 0.24} r="2.6" fill={b.main} />
        {[38, 49, 60].map((x) => (
          <rect key={x} x={x} y={H * 0.75} width="2.4" height={H * 0.25} fill="#b08d57" />
        ))}
      </>
    );
  },

  radiator({ H, b }) {
    return (
      <>
        <rect width="100" height={H} fill="#f3e6d6" />
        <rect
          x="60"
          y={H * 0.08}
          width="28"
          height={H * 0.26}
          fill="#cfe3f5"
          stroke="#ffffff"
          strokeWidth="1.5"
        />
        <rect y={H * 0.86} width="100" height={H * 0.14} fill="#e2d5c2" />
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <rect
            key={i}
            x={22 + i * 7}
            y={H * 0.42}
            width="5"
            height={H * 0.36}
            rx="2.5"
            fill="#ffffff"
            stroke="#d9d2c5"
          />
        ))}
        <circle cx="18.5" cy={H * 0.74} r="2.1" fill={b.main} />
      </>
    );
  },

  house({ H, b, tone }) {
    return (
      <>
        <rect width="100" height={H} fill={sky(tone)} />
        <circle cx="16" cy={H * 0.2} r="5" fill="#fff6d2" />
        <rect y={H * 0.78} width="100" height={H * 0.22} fill="#7fae6b" />
        <rect x="62" y={H * 0.2} width="5" height={H * 0.16} fill="#7a4b3a" />
        <rect x="26" y={H * 0.42} width="48" height={H * 0.38} fill="#d8b594" />
        <polygon points={`20,${H * 0.44} 50,${H * 0.15} 80,${H * 0.44}`} fill="#7a4b3a" />
        <rect x="46" y={H * 0.58} width="8" height={H * 0.22} fill={b.dark} />
        <rect x="31" y={H * 0.5} width="10" height={H * 0.13} fill="#e8f1f8" />
        <rect x="59" y={H * 0.5} width="10" height={H * 0.13} fill="#e8f1f8" />
      </>
    );
  },

  team({ H, b, tone }) {
    return (
      <>
        <rect width="100" height={H} fill={tone === 'warm' ? '#f2dfc8' : '#dbe5ee'} />
        <rect y={H * 0.84} width="100" height={H * 0.16} fill="#b9c2cb" />
        <Person cx={28} top={H * 0.24} r={5.2} colour={b.dark} />
        <Person cx={72} top={H * 0.26} r={5} colour={b.dark} />
        <Person cx={50} top={H * 0.18} r={5.8} colour={b.main} />
      </>
    );
  },

  ad({ H, b, tone }) {
    const light = tone === 'light';
    const bg = light ? '#ffffff' : tone === 'cool' ? b.dark : b.main;
    const fg = light ? b.dark : '#ffffff';
    const block = light ? '#f1eee8' : 'rgba(255, 255, 255, 0.18)';
    const cta = tone === 'warm' ? b.dark : b.accent;
    if (H < 80) {
      return (
        <>
          <rect width="100" height={H} fill={bg} />
          <rect x="54" y={H * 0.1} width="38" height={H * 0.8} rx="3" fill={block} />
          <circle cx="73" cy={H * 0.5} r={Math.min(12, H * 0.24)} fill={b.accent} />
          <rect x="8" y={H * 0.2} width="37" height={H * 0.11} rx="1.2" fill={fg} />
          <rect x="8" y={H * 0.36} width="28" height={H * 0.11} rx="1.2" fill={fg} />
          <rect x="8" y={H * 0.54} width="22" height={H * 0.045} rx="1" fill={fg} opacity="0.6" />
          <rect x="8" y={H * 0.68} width="22" height={H * 0.15} rx={H * 0.075} fill={cta} />
        </>
      );
    }
    return (
      <>
        <rect width="100" height={H} fill={bg} />
        <rect x="8" y={H * 0.06} width="84" height={H * 0.46} rx="3" fill={block} />
        <circle cx="50" cy={H * 0.29} r={Math.min(15, H * 0.15)} fill={b.accent} />
        <rect x="8" y={H * 0.58} width="62" height={H * 0.055} rx="1.4" fill={fg} />
        <rect x="8" y={H * 0.665} width="44" height={H * 0.055} rx="1.4" fill={fg} />
        <rect x="8" y={H * 0.8} width="34" height={H * 0.085} rx={H * 0.0425} fill={cta} />
      </>
    );
  },

  site({ H, b, tone }) {
    const dark = tone === 'dark';
    const hero = dark ? b.dark : '#f1eee8';
    const fg = dark ? '#ffffff' : b.dark;
    const mobile = H >= 100;
    const bar = mobile ? H * 0.045 : H * 0.09;
    return (
      <>
        <rect width="100" height={H} fill="#ffffff" />
        <rect width="100" height={bar} fill="#e6e3dd" />
        {mobile ? null : (
          <>
            {[4, 7.5, 11].map((x) => (
              <circle key={x} cx={x} cy={bar / 2} r="1" fill="#b9b4aa" />
            ))}
            <rect x="24" y={bar * 0.28} width="52" height={bar * 0.44} rx="1" fill="#ffffff" />
          </>
        )}
        <circle cx="8" cy={bar + H * 0.05} r={mobile ? 3 : 1.8} fill={b.main} />
        <rect
          x={mobile ? 78 : 70}
          y={bar + H * 0.04}
          width={mobile ? 14 : 22}
          height={H * 0.02}
          rx="0.8"
          fill="#c9cdd4"
        />
        <rect y={bar + H * 0.1} width="100" height={H * (mobile ? 0.34 : 0.4)} fill={hero} />
        <rect
          x="8"
          y={bar + H * 0.17}
          width={mobile ? 66 : 38}
          height={H * (mobile ? 0.035 : 0.06)}
          rx="1"
          fill={fg}
        />
        <rect
          x="8"
          y={bar + H * 0.24}
          width={mobile ? 48 : 28}
          height={H * (mobile ? 0.035 : 0.06)}
          rx="1"
          fill={fg}
        />
        <rect
          x="8"
          y={bar + H * 0.33}
          width={mobile ? 40 : 16}
          height={H * (mobile ? 0.05 : 0.07)}
          rx="1.5"
          fill={b.main}
        />
        {mobile ? (
          <>
            <rect x="8" y={H * 0.54} width="84" height={H * 0.17} rx="3" fill="#f3f0ea" />
            <rect x="8" y={H * 0.75} width="84" height={H * 0.17} rx="3" fill="#f3f0ea" />
          </>
        ) : (
          <>
            <rect
              x="60"
              y={bar + H * 0.15}
              width="32"
              height={H * 0.3}
              rx="2"
              fill={dark ? 'rgba(255, 255, 255, 0.16)' : '#ffffff'}
            />
            {[8, 38, 68].map((x) => (
              <rect key={x} x={x} y={H * 0.68} width="24" height={H * 0.22} rx="2" fill="#f3f0ea" />
            ))}
          </>
        )}
      </>
    );
  },
};

/** One library picture. With a `label` it is announced as an image; without one it is decoration. */
export function Art({ image, label }: { image: LibraryImage; label?: string }) {
  const H = Math.round((10000 * image.height) / image.width) / 100;
  const b = LIBRARY_CLIENTS.find((c) => c.slug === image.client)?.brand ?? FALLBACK;
  return (
    <svg
      className="art"
      viewBox={`0 0 100 ${H}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {SCENES[image.art.scene]({ H, b, tone: image.art.tone })}
      {/* A hairline edge, so a white picture still shows on a white card. */}
      <rect
        width="100"
        height={H}
        fill="none"
        stroke="rgba(2, 27, 67, 0.16)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
