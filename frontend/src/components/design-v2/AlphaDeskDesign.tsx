// @ts-nocheck
'use client';

/* eslint-disable */
// Generated from the Claude AlphaDesk v2 design bundle in /tmp/alphadesk_design.
// Keep this as the visual source of truth for the route-level redesign.
import React from "react";
import { usePathname, useRouter } from "next/navigation";

const TWEAK_DEFAULTS = {
  page: "dashboard",
  theme: "dark",
  density: "dense",
  dashboardLayout: "market",
  tickerLayout: "split",
  showAI: true,
  showRail: true,
  tradeLayout: "right-rail",
  accent: "#c9a66b",
};


// tweaks-panel.jsx
// Reusable Tweaks shell + form-control helpers.
//
// Owns the host protocol (listens for __activate_edit_mode / __deactivate_edit_mode,
// posts __edit_mode_available / __edit_mode_set_keys / __edit_mode_dismissed) so
// individual prototypes don't re-roll it. Ships a consistent set of controls so you
// don't hand-draw <input type="range">, segmented radios, steppers, etc.
//
// Usage (in an HTML file that loads React + Babel):
//
//   const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
//     "primaryColor": "#D97757",
//     "palette": ["#D97757", "#29261b", "#f6f4ef"],
//     "fontSize": 16,
//     "density": "regular",
//     "dark": false
//   }/*EDITMODE-END*/;
//
//   function App() {
//     const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
//     return (
//       <div style={{ fontSize: t.fontSize, color: t.primaryColor }}>
//         Hello
//         <TweaksPanel>
//           <TweakSection label="Typography" />
//           <TweakSlider label="Font size" value={t.fontSize} min={10} max={32} unit="px"
//                        onChange={(v) => setTweak('fontSize', v)} />
//           <TweakRadio  label="Density" value={t.density}
//                        options={['compact', 'regular', 'comfy']}
//                        onChange={(v) => setTweak('density', v)} />
//           <TweakSection label="Theme" />
//           <TweakColor  label="Primary" value={t.primaryColor}
//                        options={['#D97757', '#2A6FDB', '#1F8A5B', '#7A5AE0']}
//                        onChange={(v) => setTweak('primaryColor', v)} />
//           <TweakColor  label="Palette" value={t.palette}
//                        options={[['#D97757', '#29261b', '#f6f4ef'],
//                                  ['#475569', '#0f172a', '#f1f5f9']]}
//                        onChange={(v) => setTweak('palette', v)} />
//           <TweakToggle label="Dark mode" value={t.dark}
//                        onChange={(v) => setTweak('dark', v)} />
//         </TweaksPanel>
//       </div>
//     );
//   }
//
// ─────────────────────────────────────────────────────────────────────────────

const __TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom right;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:default;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  .twk-field{appearance:none;width:100%;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-num{display:flex;align-items:center;height:26px;padding:0 0 0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;background:rgba(255,255,255,.6)}
  .twk-num-lbl{font-weight:500;color:rgba(41,38,27,.6);cursor:ew-resize;
    user-select:none;padding-right:8px}
  .twk-num input{flex:1;min-width:0;height:100%;border:0;background:transparent;
    font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:0 8px 0 0;
    outline:none;color:inherit;-moz-appearance:textfield}
  .twk-num input::-webkit-inner-spin-button,.twk-num input::-webkit-outer-spin-button{
    -webkit-appearance:none;margin:0}
  .twk-num-unit{padding-right:8px;color:rgba(41,38,27,.45)}

  .twk-btn{appearance:none;height:26px;padding:0 12px;border:0;border-radius:7px;
    background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:default}
  .twk-btn:hover{background:rgba(0,0,0,.88)}
  .twk-btn.secondary{background:rgba(0,0,0,.06);color:inherit}
  .twk-btn.secondary:hover{background:rgba(0,0,0,.1)}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:default;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
`;

// ── useTweaks ───────────────────────────────────────────────────────────────
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys → host rewrites the EDITMODE block on disk).
function useTweaks(defaults) {
  const [values, setValues] = React.useState(defaults);
  // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
  // useState-style call doesn't write a "[object Object]" key into the persisted
  // JSON block.
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null
      ? keyOrEdits : { [keyOrEdits]: val };
    setValues((prev) => ({ ...prev, ...edits }));
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits }, '*');
    // Same-window signal so in-page listeners (deck-stage rail thumbnails)
    // can react — the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent('tweakchange', { detail: edits }));
  }, []);
  return [values, setTweak];
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
// Floating shell. Registers the protocol listener BEFORE announcing
// availability — if the announce ran first, the host's activate could land
// before our handler exists and the toolbar toggle would silently no-op.
// The close button posts __edit_mode_dismissed so the host's toolbar toggle
// flips off in lockstep; the host echoes __deactivate_edit_mode back which
// is what actually hides the panel.
function TweaksPanel({ title = 'Tweaks', noDeckControls = false, children }) {
  const [open, setOpen] = React.useState(false);
  const dragRef = React.useRef(null);
  // Auto-inject a rail toggle when a <deck-stage> is on the page. The
  // toggle drives the deck's per-viewer _railVisible via window message;
  // state is mirrored from the same localStorage key the deck reads so
  // the control reflects reality across reloads. The mechanism is the
  // message — authors who want custom placement can post it directly
  // and pass noDeckControls to suppress this one.
  const hasDeckStage = React.useMemo(
    () => typeof document !== 'undefined' && !!document.querySelector('deck-stage'),
    [],
  );
  // Hide the toggle until the host has actually enabled the rail (the
  // __omelette_rail_enabled window message, posted only when the
  // omelette_deck_rail_enabled flag is on for this user). The initial read
  // covers TweaksPanel mounting after the message already arrived; the
  // listener covers the common case of mounting first.
  const [railEnabled, setRailEnabled] = React.useState(
    () => hasDeckStage && !!document.querySelector('deck-stage')?._railEnabled,
  );
  React.useEffect(() => {
    if (!hasDeckStage || railEnabled) return undefined;
    const onMsg = (e) => {
      if (e.data && e.data.type === '__omelette_rail_enabled') setRailEnabled(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [hasDeckStage, railEnabled]);
  const [railVisible, setRailVisible] = React.useState(() => {
    try { return localStorage.getItem('deck-stage.railVisible') !== '0'; } catch (e) { return true; }
  });
  const toggleRail = (on) => {
    setRailVisible(on);
    window.postMessage({ type: '__deck_rail_visible', on }, '*');
  };
  const offsetRef = React.useRef({ x: 16, y: 16 });
  const PAD = 16;

  const clampToViewport = React.useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth, h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y)),
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);

  React.useEffect(() => {
    if (!open) return;
    clampToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport);
      return () => window.removeEventListener('resize', clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);

  React.useEffect(() => {
    const onMsg = (e) => {
      const t = e?.data?.type;
      if (t === '__activate_edit_mode') setOpen(true);
      else if (t === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);

  const dismiss = () => {
    setOpen(false);
    window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*');
  };

  const onDragStart = (e) => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = (ev) => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy),
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!open) return null;
  return (
    <>
      <style>{__TWEAKS_STYLE}</style>
      <div ref={dragRef} className="twk-panel" data-noncommentable=""
           style={{ right: offsetRef.current.x, bottom: offsetRef.current.y }}>
        <div className="twk-hd" onMouseDown={onDragStart}>
          <b>{title}</b>
          <button className="twk-x" aria-label="Close tweaks"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={dismiss}>✕</button>
        </div>
        <div className="twk-body">
          {children}
          {hasDeckStage && railEnabled && !noDeckControls && (
            <TweakSection label="Deck">
              <TweakToggle label="Thumbnail rail" value={railVisible} onChange={toggleRail} />
            </TweakSection>
          )}
        </div>
      </div>
    </>
  );
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function TweakSection({ label, children }) {
  return (
    <>
      <div className="twk-sect">{label}</div>
      {children}
    </>
  );
}

function TweakRow({ label, value, children, inline = false }) {
  return (
    <div className={inline ? 'twk-row twk-row-h' : 'twk-row'}>
      <div className="twk-lbl">
        <span>{label}</span>
        {value != null && <span className="twk-val">{value}</span>}
      </div>
      {children}
    </div>
  );
}

// ── Controls ────────────────────────────────────────────────────────────────

function TweakSlider({ label, value, min = 0, max = 100, step = 1, unit = '', onChange }) {
  return (
    <TweakRow label={label} value={`${value}${unit}`}>
      <input type="range" className="twk-slider" min={min} max={max} step={step}
             value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </TweakRow>
  );
}

function TweakToggle({ label, value, onChange }) {
  return (
    <div className="twk-row twk-row-h">
      <div className="twk-lbl"><span>{label}</span></div>
      <button type="button" className="twk-toggle" data-on={value ? '1' : '0'}
              role="switch" aria-checked={!!value}
              onClick={() => onChange(!value)}><i /></button>
    </div>
  );
}

function TweakRadio({ label, value, options, onChange }) {
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);
  // The active value is read by pointer-move handlers attached for the lifetime
  // of a drag — ref it so a stale closure doesn't fire onChange for every move.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Segments wrap mid-word once per-segment width runs out. The track is
  // ~248px (280 panel − 28 body pad − 4 seg pad), each button loses 12px
  // to its own padding, and 11.5px system-ui averages ~6.3px/char — so 2
  // options fit ~16 chars each, 3 fit ~10. Past that (or >3 options), fall
  // back to a dropdown rather than wrap.
  const labelLen = (o) => String(typeof o === 'object' ? o.label : o).length;
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
  const fitsAsSegments = maxLen <= ({ 2: 16, 3: 10 }[options.length] ?? 0);
  if (!fitsAsSegments) {
    // <select> emits strings — map back to the original option value so the
    // fallback stays type-preserving (numbers, booleans) like the segment path.
    const resolve = (s) => {
      const m = options.find((o) => String(typeof o === 'object' ? o.value : o) === s);
      return m === undefined ? s : typeof m === 'object' ? m.value : m;
    };
    return <TweakSelect label={label} value={value} options={options}
                        onChange={(s) => onChange(resolve(s))} />;
  }
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  const idx = Math.max(0, opts.findIndex((o) => o.value === value));
  const n = opts.length;

  const segAt = (clientX) => {
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor(((clientX - r.left - 2) / inner) * n);
    return opts[Math.max(0, Math.min(n - 1, i))].value;
  };

  const onPointerDown = (e) => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = (ev) => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <TweakRow label={label}>
      <div ref={trackRef} role="radiogroup" onPointerDown={onPointerDown}
           className={dragging ? 'twk-seg dragging' : 'twk-seg'}>
        <div className="twk-seg-thumb"
             style={{ left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
                      width: `calc((100% - 4px) / ${n})` }} />
        {opts.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value}>
            {o.label}
          </button>
        ))}
      </div>
    </TweakRow>
  );
}

function TweakSelect({ label, value, options, onChange }) {
  return (
    <TweakRow label={label}>
      <select className="twk-field" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </TweakRow>
  );
}

function TweakText({ label, value, placeholder, onChange }) {
  return (
    <TweakRow label={label}>
      <input className="twk-field" type="text" value={value} placeholder={placeholder}
             onChange={(e) => onChange(e.target.value)} />
    </TweakRow>
  );
}

function TweakNumber({ label, value, min, max, step = 1, unit = '', onChange }) {
  const clamp = (n) => {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };
  const startRef = React.useRef({ x: 0, val: 0 });
  const onScrubStart = (e) => {
    e.preventDefault();
    startRef.current = { x: e.clientX, val: value };
    const decimals = (String(step).split('.')[1] || '').length;
    const move = (ev) => {
      const dx = ev.clientX - startRef.current.x;
      const raw = startRef.current.val + dx * step;
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(Number(snapped.toFixed(decimals))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className="twk-num">
      <span className="twk-num-lbl" onPointerDown={onScrubStart}>{label}</span>
      <input type="number" value={value} min={min} max={max} step={step}
             onChange={(e) => onChange(clamp(Number(e.target.value)))} />
      {unit && <span className="twk-num-unit">{unit}</span>}
    </div>
  );
}

// Relative-luminance contrast pick — checkmarks drawn over a swatch need to
// read on both #111 and #fafafa without per-option configuration. Hex input
// only (#rgb / #rrggbb); named or rgb()/hsl() colors fall through to "light".
function __twkIsLight(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, (c) => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}

const __TwkCheck = ({ light }) => (
  <svg viewBox="0 0 14 14" aria-hidden="true">
    <path d="M3 7.2 5.8 10 11 4.2" fill="none" strokeWidth="2.2"
          strokeLinecap="round" strokeLinejoin="round"
          stroke={light ? 'rgba(0,0,0,.78)' : '#fff'} />
  </svg>
);

// TweakColor — curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts — a lone color
// renders solid, a palette renders colors[0] as the hero (left ~2/3) with the
// rest stacked in a sharp column on the right. onChange emits the
// option in the shape it was passed (string stays string, array stays array).
// Without options it falls back to the native color input for back-compat.
function TweakColor({ label, value, options, onChange }) {
  if (!options || !options.length) {
    return (
      <div className="twk-row twk-row-h">
        <div className="twk-lbl"><span>{label}</span></div>
        <input type="color" className="twk-swatch" value={value}
               onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  // Native <input type=color> emits lowercase hex per the HTML spec, so
  // compare case-insensitively. String() guards JSON.stringify(undefined),
  // which returns the primitive undefined (no .toLowerCase).
  const key = (o) => String(JSON.stringify(o)).toLowerCase();
  const cur = key(value);
  return (
    <TweakRow label={label}>
      <div className="twk-chips" role="radiogroup">
        {options.map((o, i) => {
          const colors = Array.isArray(o) ? o : [o];
          const [hero, ...rest] = colors;
          const sup = rest.slice(0, 4);
          const on = key(o) === cur;
          return (
            <button key={i} type="button" className="twk-chip" role="radio"
                    aria-checked={on} data-on={on ? '1' : '0'}
                    aria-label={colors.join(', ')} title={colors.join(' · ')}
                    style={{ background: hero }}
                    onClick={() => onChange(o)}>
              {sup.length > 0 && (
                <span>
                  {sup.map((c, j) => <i key={j} style={{ background: c }} />)}
                </span>
              )}
              {on && <__TwkCheck light={__twkIsLight(hero)} />}
            </button>
          );
        })}
      </div>
    </TweakRow>
  );
}

function TweakButton({ label, onClick, secondary = false }) {
  return (
    <button type="button" className={secondary ? 'twk-btn secondary' : 'twk-btn'}
            onClick={onClick}>{label}</button>
  );
}

if (typeof window !== "undefined") Object.assign(window, {
  useTweaks, TweaksPanel, TweakSection, TweakRow,
  TweakSlider, TweakToggle, TweakRadio, TweakSelect,
  TweakText, TweakNumber, TweakColor, TweakButton,
});


// Mock data for the AlphaDesk redesign prototype.

const MOCK_USER = { name: "Alex Chen", initial: "α" };

const MOCK_PORTFOLIO = {
  equity: 284193.42,
  equityDelta: 2341.18,
  equityDeltaPct: 0.82,
  cash: 47812.10,
  buyingPower: 95624.20,
  exposureLong: 0.62,
  exposureShort: 0.14,
  beta: 0.62,
  sharpe30: 1.08,
  positions: 12,
  orders: 2,
  ytdPct: 14.7,
  weekPct: 2.3,
  monthPct: 4.1,
};

const MOCK_REGIME = {
  state: "bull · low-volatility",
  confidence: 0.72,
  vix: 14.2,
  vixDelta: -0.41,
  spy: 581.12,
  spyDelta: 0.34,
  qqq: 502.40,
  qqqDelta: 0.61,
  iwm: 218.07,
  iwmDelta: -0.22,
  dxy: 104.18,
  dxyDelta: -0.08,
  tnx: 4.21,
  tnxDelta: 0.03,
  oil: 78.40,
  oilDelta: 1.12,
  gold: 2347.10,
  goldDelta: -0.18,
  btc: 67421,
  btcDelta: 1.78,
  breadth: 0.61,                // up/total
  newHighsLows: { highs: 142, lows: 38 },
  fearGreed: 64,
  history: [54, 56, 58, 55, 53, 57, 60, 62, 60, 58, 56, 59, 62, 64, 66, 65, 63, 61, 64, 68, 70, 69, 67, 68, 70, 72, 71, 70, 72, 74],
};

const MOCK_BRIEFING = [
  { tone: "up",  text: "MOMENTUM & QUALITY captured another +1.4% overnight as NVDA gapped through its 3-week pivot.", time: "07:42" },
  { tone: "neutral", text: "PEAD opened a XOM long at 116.40 on its earnings drift signal — your scaled size, not max.", time: "08:14" },
  { tone: "down", text: "AI ALPHA's UNH thesis is hitting its 5-day stop tomorrow if it doesn't reclaim 590.", time: "08:32" },
  { tone: "neutral", text: "Two of your watchlist names — META, AMD — printed pre-market gaps > 1%. Filtered to candidates.", time: "08:55" },
];

const MOCK_WATCHLIST = [
  { sym: "NVDA", name: "Nvidia",     px: 134.82, chg: 1.74, pct: 1.31, vol: "28.4M", mark: "long", spark: [120,121,122,121,123,124,125,127,128,129,131,132,133,134,134.8] },
  { sym: "META", name: "Meta",       px: 612.40, chg: 8.30, pct: 1.37, vol: "11.2M", mark: "watch", spark: [580,585,590,592,595,598,601,602,605,604,608,610,611,612,612.4] },
  { sym: "AMD",  name: "AMD",        px: 168.20, chg: 2.81, pct: 1.70, vol: "32.1M", mark: "watch", spark: [155,156,158,160,159,161,163,164,165,166,167,167,168,168,168.2] },
  { sym: "TSLA", name: "Tesla",      px: 248.10, chg: -3.20, pct: -1.27, vol: "82.6M", mark: "candidate", spark: [262,260,258,257,255,253,252,251,250,249,250,249,248,248,248.1] },
  { sym: "AAPL", name: "Apple",      px: 226.84, chg: 0.42, pct: 0.18, vol: "44.1M", mark: "long", spark: [224,225,225,226,225,226,226,226,227,226,226,227,226,226,226.8] },
  { sym: "MSFT", name: "Microsoft",  px: 422.30, chg: 1.10, pct: 0.26, vol: "19.3M", mark: "long", spark: [418,419,420,421,420,421,422,422,422,422,423,422,422,422,422.3] },
  { sym: "SPY",  name: "S&P 500 ETF", px: 581.12, chg: 1.96, pct: 0.34, vol: "62.0M", mark: "core", spark: [575,576,577,578,578,579,579,580,580,580,581,581,581,581,581.1] },
  { sym: "XOM",  name: "Exxon Mobil", px: 117.04, chg: 0.64, pct: 0.55, vol: "12.4M", mark: "long", spark: [115,115,115,116,116,116,116,116,116,117,117,117,117,117,117.0] },
  { sym: "INTC", name: "Intel",      px: 32.18, chg: -0.22, pct: -0.68, vol: "55.7M", mark: "short", spark: [33,33,33,33,32,32,32,32,32,32,32,32,32,32,32.2] },
  { sym: "UNH",  name: "UnitedHealth", px: 588.20, chg: -6.40, pct: -1.08, vol: "3.1M", mark: "long", spark: [602,600,598,596,595,594,593,592,591,590,589,588,588,588,588.2] },
];

const MOCK_POSITIONS = [
  { sym: "NVDA", strategy: "Momentum & Quality", side: "long",  qty: 250, avg: 128.41, last: 134.82, pl: 1602.50, plPct: 5.0, opened: "Oct 28", stop: 122.31 },
  { sym: "SPY",  strategy: "Regime Adaptive",   side: "long",  qty: 50,  avg: 478.22, last: 581.12, pl: 5145.00, plPct: 21.5, opened: "Aug 14", stop: 540.00 },
  { sym: "XOM",  strategy: "PEAD",              side: "long",  qty: 180, avg: 116.40, last: 117.04, pl: 115.20,  plPct: 0.55, opened: "Today", stop: 112.00 },
  { sym: "UNH",  strategy: "AI Alpha",           side: "long",  qty: 40,  avg: 595.00, last: 588.20, pl: -272.00, plPct: -1.14, opened: "Nov 1", stop: 580.00 },
  { sym: "JPM",  strategy: "Pairs · Sector",    side: "long",  qty: 120, avg: 186.50, last: 189.94, pl: 412.80,  plPct: 1.85, opened: "Oct 22", stop: 178.00 },
  { sym: "INTC", strategy: "Pairs · Sector",    side: "short", qty: 120, avg: 32.40,  last: 32.18, pl: 26.40,   plPct: 0.68, opened: "Oct 22", stop: 35.00 },
  { sym: "AAPL", strategy: "Momentum & Quality", side: "long", qty: 100, avg: 218.40, last: 226.84, pl: 844.00,  plPct: 3.86, opened: "Oct 12", stop: 210.00 },
  { sym: "MSFT", strategy: "Momentum & Quality", side: "long", qty: 60,  avg: 412.30, last: 422.30, pl: 600.00,  plPct: 2.43, opened: "Sep 30", stop: 398.00 },
];

const MOCK_STRATEGIES = [
  { num: "01", name: "Momentum & Quality", style: "Swing · 5–20 day hold",  active: true,  pct: 3.42, sharpe: 1.42, dd: -4.1, positions: 4, allocPct: 32 },
  { num: "02", name: "Regime Adaptive",    style: "Long/short macro",        active: true,  pct: 1.84, sharpe: 1.18, dd: -3.2, positions: 1, allocPct: 18 },
  { num: "03", name: "PEAD",               style: "Post-earnings drift",     active: true,  pct: 0.62, sharpe: 0.94, dd: -2.8, positions: 1, allocPct: 12 },
  { num: "04", name: "Mean Reversion",     style: "Short-horizon · 1–3 day", active: false, pct: 0.0,  sharpe: 0.71, dd: -5.1, positions: 0, allocPct: 0  },
  { num: "05", name: "Pairs · Sector",     style: "Market-neutral",          active: true,  pct: 0.41, sharpe: 0.86, dd: -1.4, positions: 2, allocPct: 14 },
  { num: "06", name: "AI Alpha",           style: "AI opportunistic",              active: true,  pct: -1.18, sharpe: 0.42, dd: -3.7, positions: 1, allocPct: 8  },
];

const MOCK_TICKER = {
  sym: "NVDA",
  name: "Nvidia Corporation",
  exch: "NASDAQ",
  sector: "Semiconductors",
  px: 134.82, chg: 1.74, pct: 1.31,
  bid: 134.81, ask: 134.83, spread: 0.02,
  vol: 28_400_000, avgVol: 42_100_000,
  mcap: "3.31T",
  pe: 64.2,
  range1d: [132.10, 135.44],
  range52: [85.10, 144.42],
  beta: 1.71,
  iv: 41.2,
  divYield: 0.03,
  earningsIn: 14,
  shortInterest: 1.2,
  floatPct: 0.95,
  insiderPct: 4.2,
  // long-form chart data
  chart: Array.from({length: 80}, (_, i) => {
    const base = 96 + i * 0.45;
    const wob = Math.sin(i / 4) * 1.2 + Math.sin(i / 11) * 2.4;
    return +(base + wob + (i > 60 ? (i - 60) * 0.6 : 0)).toFixed(2);
  }),
};

const MOCK_SIGNALS = [
  { name: "Trend (50/200)",       state: "long",     score: 0.84, note: "50-DMA above 200-DMA · widening" },
  { name: "Momentum (RSI 14)",    state: "long",     score: 0.68, note: "RSI 64 · last cross 19 days ago"  },
  { name: "Pivot break",          state: "long",     score: 0.92, note: "Through 3-week pivot at 132.40" },
  { name: "Volume profile",       state: "neutral",  score: 0.51, note: "Below 20-day avg · 67% relative" },
  { name: "Regime fit",           state: "long",     score: 0.82, note: "Bull/low-vol favours megacap-tech" },
  { name: "Earnings drift",       state: "neutral",  score: 0.40, note: "14 days to print · drift not active" },
  { name: "Mean-reversion",       state: "short",    score: 0.62, note: "z-score 1.8 above 20-day mean" },
  { name: "Options skew",         state: "long",     score: 0.71, note: "Calls bid · 25Δ skew flattened" },
];

const MOCK_AI_TICKER = {
  thesis: "NVDA is sitting in the **fattest part** of your Momentum & Quality screen — 3-week pivot break, regime fit 0.82, earnings 14 days out. Dataset says this setup wins 64% of the time when held into earnings drift; loses ~3.2% when it doesn't.",
  bullets: [
    { tone: "up",   t: "Setup fits Momentum & Quality entry rules" },
    { tone: "up",   t: "Regime tail-wind: bull / low-vol since Oct 22" },
    { tone: "down", t: "Beta 1.7 — sizing should use scaled units, not nominal" },
    { tone: "neutral", t: "Earnings catalyst inside hold horizon" },
  ],
  size: { qty: 250, notional: 33705, riskDollars: 1348, riskPct: 0.47, stop: -4.0 },
  conf: 0.72,
};

const MOCK_TICKER_EXPOSURE = {
  net: 51480,                 // total net dollar exposure to NVDA
  netPctEquity: 18.3,         // % of portfolio
  direct: { shares: 250, costBasis: 32103, mkt: 33705, plDollars: 1602, plPct: 4.99 },
  options: [
    { contract: "NVDA $140C 14d", qty: 10, costBasis: 2840, mkt: 2840, deltaShares: 420 },
  ],
  etfs: [
    { sym: "QQQ",  name: "Invesco QQQ",            held: 80,   weight: 8.32, dollars: 3850 },
    { sym: "SOXX", name: "iShares Semiconductor",  held: 40,   weight: 10.14, dollars: 2210 },
    { sym: "MGK",  name: "Vanguard Mega Cap Growth", held: 60, weight: 5.81, dollars: 1740 },
    { sym: "VOO",  name: "Vanguard S&P 500",        held: 30,  weight: 1.44, dollars: 7935 },
  ],
};

const MOCK_TICKER_HISTORY = [
  { date: "Oct 28, 2025", action: "Bought 250 NVDA at 128.41", note: "Momentum & Quality entry on 3-week pivot. Stop at 122.31. Sized to 0.5% account risk.", strategy: "Momentum & Quality" },
  { date: "Sep 04, 2025", action: "Sold 200 NVDA at 119.40",   note: "Closed swing. Held 9d; +6.2%. Took into resistance at 120 round-figure.", strategy: "Momentum & Quality" },
  { date: "Aug 26, 2025", action: "Bought 200 NVDA at 112.30", note: "Regime flipped to bull/low-vol; semis showed leadership.", strategy: "Momentum & Quality" },
  { date: "Aug 12, 2025", action: "Note",                       note: "Watching for earnings drift entry — last quarter signal worked, +4.1% in 9 days.", strategy: "Research" },
];

const MOCK_NEWS = [
  { src: "Bloomberg",  ts: "12 min ago", title: "Nvidia accelerates Blackwell shipments; supply normalizing into Q1",  tag: "supply" },
  { src: "Reuters",    ts: "1 h ago",    title: "Hyperscaler capex revisions trickle higher — META, MSFT lead",       tag: "macro" },
  { src: "Bloomberg",  ts: "3 h ago",    title: "EU draft AI rules carve narrower exception for inference compute",   tag: "policy" },
  { src: "Tape",       ts: "yesterday",  title: "Unusual call sweep — Dec $145 strike, 3,200 contracts, ~$2.1m",      tag: "flow" },
];

const MOCK_PIPELINE = [
  { stage: "Universe",  count: 4823, narrow: "S&P 1500 + ADRs · liquidity > $20m" },
  { stage: "Filtered",  count: 412,  narrow: "Regime fit > 0.6 · sector momentum +1σ" },
  { stage: "Ranked",    count: 38,   narrow: "Strategy scores · top quintile" },
  { stage: "Candidates", count: 12,  narrow: "Risk-budget approved · earnings clear" },
  { stage: "Staged",    count: 3,    narrow: "Awaiting your review" },
  { stage: "Live",      count: 2,    narrow: "Submitted today" },
];

const MOCK_ALERTS = [
  { tone: "up",   ts: "14:31", text: "NVDA crossed your tracked 134.50 trigger." },
  { tone: "down", ts: "13:08", text: "UNH risk budget at 90% — review or reduce." },
  { tone: "neutral", ts: "11:47", text: "Pipeline produced 3 new candidates: AMD, META, ASML." },
  { tone: "up",   ts: "10:22", text: "Regime confidence rose to 0.72 (from 0.65 yesterday)." },
  { tone: "neutral", ts: "09:33", text: "Open: SPY +0.34%. Watchlist gainers: NVDA, AMD." },
];

// ─── v2 mocks ─────────────────────────────────────────────────────────────

const MOCK_AGENTS = [
  { id: "research-1", archetype: "research", name: "Research", status: "running", lastOutput: "12 candidates surfaced from 4,823 in universe — top: NVDA, META, ASML", ownerStrategy: "Momentum & Quality", costToday: 4.18, runs24h: 142, model: "Sonnet 4.5", lastRun: "2 min ago", health: "ok" },
  { id: "research-2", archetype: "research", name: "Research", status: "idle", lastOutput: "Earnings drift screen complete. 3 names qualify for PEAD.", ownerStrategy: "PEAD", costToday: 2.04, runs24h: 26, model: "Haiku 4.5", lastRun: "14 min ago", health: "ok" },
  { id: "signal-1", archetype: "signal", name: "Signal", status: "running", lastOutput: "NVDA pivot break confirmed at 132.40 · score 0.92", ownerStrategy: "Momentum & Quality", costToday: 1.86, runs24h: 614, model: "Haiku 4.5", lastRun: "12s ago", health: "ok" },
  { id: "signal-2", archetype: "signal", name: "Signal", status: "queued", lastOutput: "Awaiting candidate: AMD breakout watch", ownerStrategy: "Momentum & Quality", costToday: 0.42, runs24h: 88, model: "Haiku 4.5", lastRun: "—", health: "ok" },
  { id: "risk-1", archetype: "risk", name: "Risk", status: "running", lastOutput: "Sector concentration in Tech: 38% — within 40% cap, monitoring", ownerStrategy: null, costToday: 0.84, runs24h: 1442, model: "Haiku 4.5", lastRun: "5s ago", health: "ok" },
  { id: "risk-2", archetype: "risk", name: "Risk", status: "failed", lastOutput: "Polygon rate limit hit while computing UNH downside scenarios", ownerStrategy: "AI Alpha", costToday: 0.18, runs24h: 6, model: "Haiku 4.5", lastRun: "8 min ago", health: "degraded" },
  { id: "exec-1", archetype: "exec", name: "Exec", status: "idle", lastOutput: "Routed XOM 180sh @ 116.40 to Alpaca · filled in 1.2s", ownerStrategy: "PEAD", costToday: 0.06, runs24h: 14, model: "Haiku 4.5", lastRun: "1h ago", health: "ok" },
];

const MOCK_NOTIFICATIONS = [
  { id: "n-9", type: "fill", ts: "14:31", read: false, title: "Order filled · NVDA 250 sh @ 128.41", body: "Momentum & Quality · Slippage 0.02 · Stop set at 122.31" },
  { id: "n-8", type: "agent", ts: "14:18", read: false, title: "Research · 12 new candidates", body: "From 4,823 in universe. Top: NVDA, META, ASML." },
  { id: "n-7", type: "risk", ts: "13:08", read: false, title: "UNH risk budget at 90%", body: "AI Alpha exposure · review or reduce." },
  { id: "n-6", type: "system", ts: "12:42", read: true, title: "Pipeline stage 'enrich' resumed", body: "Was paused 4m for Polygon backfill." },
  { id: "n-5", type: "agent", ts: "11:47", read: true, title: "Signal · pivot break confirmed", body: "NVDA · 132.40 · score 0.92" },
  { id: "n-4", type: "billing", ts: "10:11", read: true, title: "Anthropic spend at 64% of daily cap", body: "$11.84 of $18.50 used." },
  { id: "n-3", type: "support", ts: "yesterday", read: true, title: "Reply from support · #4218", body: "Got it — paper/live toggle preserved across sessions." },
];

const MOCK_SYSTEM_STATE = {
  banner: null, // or: { tone: "warn"|"crit"|"info", text: "...", action: { label, onClick } }
  paperLive: "paper", // "paper" | "live"
  marketSession: "regular", // "pre" | "regular" | "post" | "closed"
  marketCountdown: "1h 28m to close",
  pipelinePaused: false,
  aiResearchPaused: false,
  agentsHealthy: 6,
  agentsTotal: 7,
};

const MOCK_CONTROLS = [
  // ── Trade ──────────────────────────────────────────────────────────
  { id: "halt-trades", category: "Trade", name: "Trade halt", desc: "Stop all order routing globally — paper or live.", control: "switch", value: false, scope: "global", lastBy: "—", lastAt: "—", critical: true, dangerous: true },
  { id: "halt-strategy-mq", category: "Trade", name: "Halt · Momentum & Quality", desc: "Pause order routing for this strategy only.", control: "switch", value: false, scope: "strategy" },
  { id: "halt-strategy-pead", category: "Trade", name: "Halt · PEAD", desc: "Pause order routing for this strategy only.", control: "switch", value: false, scope: "strategy" },
  { id: "rate-limit-broker", category: "Trade", name: "Order rate · broker", desc: "Max orders / minute to Alpaca.", control: "number", value: 30, unit: "/min", scope: "broker", lastBy: "operator", lastAt: "1w ago" },
  { id: "rate-limit-symbol", category: "Trade", name: "Order rate · per symbol", desc: "Max orders / minute on any one symbol.", control: "number", value: 6, unit: "/min", scope: "symbol", lastBy: "operator", lastAt: "1w ago" },

  // ── Pipeline (per stage) ───────────────────────────────────────────
  { id: "pipeline-ingest", category: "Pipeline", name: "Stage · ingest", desc: "Universe ingestion. Queue: 0 · last run 14s ago.", control: "switch", value: true, scope: "stage", lastBy: "operator", lastAt: "2h ago" },
  { id: "pipeline-enrich", category: "Pipeline", name: "Stage · enrich", desc: "Fundamentals + price enrichment. Queue: 142 · last run 8s ago.", control: "switch", value: true, scope: "stage", lastBy: "operator", lastAt: "2h ago" },
  { id: "pipeline-score", category: "Pipeline", name: "Stage · score", desc: "Strategy scoring. Queue: 12 · last run 3s ago.", control: "switch", value: true, scope: "stage" },
  { id: "pipeline-risk", category: "Pipeline", name: "Stage · risk", desc: "Risk gate evaluation. Queue: 4 · last run 2s ago.", control: "switch", value: true, scope: "stage" },
  { id: "pipeline-execute", category: "Pipeline", name: "Stage · execute", desc: "Order routing. Queue: 0 · last run 31s ago.", control: "switch", value: true, scope: "stage" },

  // ── AI (per agent) ─────────────────────────────────────────────────
  { id: "ai-research", category: "AI", name: "Research archetype", desc: "Pause all research agents.", control: "switch", value: true, scope: "agent-archetype", lastBy: "operator", lastAt: "yesterday" },
  { id: "ai-signal", category: "AI", name: "Signal archetype", desc: "Pause all signal agents.", control: "switch", value: true, scope: "agent-archetype" },
  { id: "ai-risk", category: "AI", name: "Risk archetype", desc: "Pause all risk agents (NOT recommended).", control: "switch", value: true, scope: "agent-archetype", dangerous: true },
  { id: "ai-exec", category: "AI", name: "Exec archetype", desc: "Pause exec agents — orders queue but don't route.", control: "switch", value: true, scope: "agent-archetype" },
  { id: "ai-spend-cap", category: "AI", name: "AI spend cap · daily", desc: "Hard ceiling across all providers.", control: "number", value: 250, unit: "$", scope: "global" },
  { id: "ai-research-cap", category: "AI", name: "Research spend · daily", desc: "Per-archetype daily cap.", control: "number", value: 60, unit: "$", scope: "agent-archetype" },

  // ── Keys ───────────────────────────────────────────────────────────
  { id: "key-anthropic", category: "Keys", name: "Anthropic", desc: "ANTHROPIC_API_KEY · last rotated 12d ago", control: "secret", value: "••••••••••", scope: "global", lastBy: "operator", lastAt: "12d ago" },
  { id: "key-openai", category: "Keys", name: "OpenAI", desc: "OPENAI_API_KEY · last rotated 4d ago", control: "secret", value: "••••••••••", scope: "global", lastBy: "operator", lastAt: "4d ago" },
  { id: "key-polygon", category: "Keys", name: "Polygon", desc: "POLYGON_KEY · not set", control: "secret", value: "", scope: "global", lastBy: "—", lastAt: "—", critical: true },
  { id: "key-fmp", category: "Keys", name: "FMP", desc: "FMP_API_KEY · last rotated 21d ago", control: "secret", value: "••••••••••", scope: "global", lastBy: "operator", lastAt: "21d ago" },
  { id: "key-alpaca", category: "Keys", name: "Alpaca", desc: "ALPACA_KEY · last rotated 30d ago", control: "secret", value: "••••••••••", scope: "global", lastBy: "operator", lastAt: "30d ago" },
  { id: "key-alpaca-secret", category: "Keys", name: "Alpaca secret", desc: "ALPACA_SECRET · last rotated 30d ago", control: "secret", value: "••••••••••", scope: "global", lastBy: "operator", lastAt: "30d ago" },

  // ── Risk ───────────────────────────────────────────────────────────
  { id: "risk-max-pos", category: "Risk", name: "Max position", desc: "Cap on single-name notional.", control: "number", value: 12, unit: "% equity", scope: "risk-gate", lastBy: "operator", lastAt: "1w ago" },
  { id: "risk-sector-cap", category: "Risk", name: "Sector cap", desc: "Max exposure to any single GICS sector.", control: "number", value: 40, unit: "% equity", scope: "risk-gate" },
  { id: "risk-dd-stop", category: "Risk", name: "Drawdown stop", desc: "Halt strategy on intraday DD breach.", control: "number", value: 3.0, unit: "% intra", scope: "risk-gate", critical: true },
  { id: "risk-var-limit", category: "Risk", name: "VaR 95 1d", desc: "Hard ceiling on 1d 95% VaR.", control: "number", value: 22000, unit: "$", scope: "risk-gate" },
  { id: "risk-beta-cap", category: "Risk", name: "Beta cap", desc: "Portfolio beta upper bound (book vs SPX).", control: "number", value: 1.4, unit: "β", scope: "risk-gate" },
  { id: "risk-conc-cap", category: "Risk", name: "Concentration cap", desc: "Max % equity in top-3 names.", control: "number", value: 28, unit: "% equity", scope: "risk-gate" },

  // ── Features ───────────────────────────────────────────────────────
  { id: "feature-options", category: "Features", name: "trade.options_chain", desc: "Show options sub-tab on Trade.", control: "switch", value: true, scope: "flag" },
  { id: "feature-thesis", category: "Features", name: "symbol.ai_thesis", desc: "Show AI thesis card on Symbol page.", control: "switch", value: true, scope: "flag" },
  { id: "feature-tape", category: "Features", name: "dashboard.live_ticker", desc: "Scrolling tape across dashboard top.", control: "switch", value: false, scope: "flag" },
  { id: "feature-impersonate", category: "Features", name: "admin.impersonate", desc: "Allow operator-impersonate flow.", control: "switch", value: true, scope: "flag" },
  { id: "feature-backtest", category: "Features", name: "strategy.backtest_workbench", desc: "Expose backtest workbench.", control: "switch", value: true, scope: "flag" },

  // ── Providers ──────────────────────────────────────────────────────
  { id: "prov-alpaca", category: "Providers", name: "Alpaca · broker", desc: "Order routing + fills.", control: "switch", value: true, scope: "provider" },
  { id: "prov-polygon", category: "Providers", name: "Polygon · market data", desc: "Quotes, bars, trades.", control: "switch", value: false, scope: "provider", critical: true },
  { id: "prov-fmp", category: "Providers", name: "FMP · fundamentals", desc: "Financials, ownership, calendars.", control: "switch", value: true, scope: "provider" },
  { id: "prov-anthropic", category: "Providers", name: "Anthropic · LLM", desc: "Reasoning + research agents.", control: "switch", value: true, scope: "provider" },
  { id: "prov-openai", category: "Providers", name: "OpenAI · embed", desc: "Embeddings only.", control: "switch", value: true, scope: "provider" },

  // ── Deploy ─────────────────────────────────────────────────────────
  { id: "deploy-fe-stg", category: "Deploy", name: "Frontend · staging", desc: "Dispatch deploy to staging from main.", control: "dispatch", value: "main", scope: "env" },
  { id: "deploy-fe-prod", category: "Deploy", name: "Frontend · prod", desc: "Dispatch deploy to prod (tag required).", control: "dispatch", value: "v2.4.1", scope: "env", dangerous: true },
  { id: "deploy-be-stg", category: "Deploy", name: "Backend · staging", desc: "Dispatch deploy to staging from main.", control: "dispatch", value: "main", scope: "env" },
  { id: "deploy-be-prod", category: "Deploy", name: "Backend · prod", desc: "Dispatch deploy to prod (tag required).", control: "dispatch", value: "v2.4.0", scope: "env", dangerous: true },
  { id: "deploy-pipeline", category: "Deploy", name: "Pipeline workers", desc: "Restart pipeline worker fleet.", control: "dispatch", value: "main", scope: "env" },
];

const MOCK_HEALTH_TILES = [
  { id: "probes", name: "Live probes", value: "63 / 63", caption: "All architecture nodes responding", tone: "ok" },
  { id: "keys", name: "Provider keys", value: "5 / 6", caption: "Polygon key not set", tone: "crit" },
  { id: "trade", name: "Trading safety", value: "Armed", caption: "Halt off · paper mode · 30/min cap", tone: "ok" },
  { id: "risk", name: "Risk gates", value: "6 / 6 active", caption: "DD stop at 3.0% · VaR ceiling $22k", tone: "ok" },
  { id: "pipeline", name: "Pipeline", value: "5 / 5 stages", caption: "enrich queue 142 · catching up", tone: "watch" },
  { id: "rails", name: "Broker rails", value: "Alpaca live", caption: "Last fill 1.2s · paper account", tone: "ok" },
  { id: "ai", name: "AI research", value: "6 / 7 agents", caption: "risk-2 failed · Polygon rate limit", tone: "watch" },
  { id: "strategies", name: "Strategies", value: "19 / 22", caption: "3 disabled by operator", tone: "ok" },
  { id: "deploy", name: "Deploy rail", value: "v2.4.1", caption: "Last prod deploy 6h ago · clean", tone: "ok" },
];

const MOCK_ARCH_NODES = [
  { id: "ui", name: "Web UI", group: "Frontend", status: "ok", caption: "Next.js · 14 routes" },
  { id: "api", name: "API gateway", group: "Backend", status: "ok", caption: "FastAPI · 88 routes" },
  { id: "auth", name: "Auth", group: "Backend", status: "ok", caption: "Supabase · 124 sessions" },
  { id: "pipe", name: "Pipeline", group: "Backend", status: "watch", caption: "5 stages · 1 catching up" },
  { id: "agents", name: "Agents", group: "AI", status: "watch", caption: "6/7 healthy" },
  { id: "broker", name: "Broker", group: "External", status: "ok", caption: "Alpaca paper" },
  { id: "mkt", name: "Market data", group: "External", status: "crit", caption: "Polygon key missing" },
  { id: "fund", name: "Fundamentals", group: "External", status: "ok", caption: "FMP" },
  { id: "anth", name: "Anthropic", group: "External", status: "ok", caption: "Sonnet + Haiku" },
  { id: "db", name: "Postgres", group: "Data", status: "ok", caption: "Primary · 142 conns" },
  { id: "cache", name: "Redis", group: "Data", status: "ok", caption: "Cache + queues" },
  { id: "audit", name: "Audit log", group: "Data", status: "ok", caption: "Append-only · 142,883 rows" },
];

const MOCK_AUDIT_LOG = [
  { ts: "14:42:08", actor: "operator", action: "halt-trades · OFF", scope: "global", note: "morning warm-up complete" },
  { ts: "14:18:42", actor: "operator", action: "ai-research · ON", scope: "agent-archetype", note: "Polygon backfill stable" },
  { ts: "13:51:11", actor: "operator", action: "key-openai · rotated", scope: "global", note: "scheduled rotation" },
  { ts: "12:42:03", actor: "system", action: "pipeline-enrich · resumed", scope: "stage", note: "Polygon recovered" },
  { ts: "12:38:22", actor: "system", action: "pipeline-enrich · paused", scope: "stage", note: "Polygon 429 storm" },
  { ts: "11:02:14", actor: "operator", action: "risk-dd-stop · 2.5 → 3.0", scope: "risk-gate", note: "post-CPI volatility" },
  { ts: "10:14:09", actor: "operator", action: "feature-tape · OFF", scope: "flag", note: "user feedback" },
  { ts: "09:31:00", actor: "system", action: "deploy-fe-prod · v2.4.1", scope: "env", note: "GitHub Actions · clean" },
  { ts: "08:12:55", actor: "operator", action: "halt-strategy-pead · OFF", scope: "strategy", note: "earnings drift OK" },
  { ts: "yesterday", actor: "operator", action: "key-anthropic · rotated", scope: "global", note: "scheduled" },
];

const MOCK_APPLICANTS = [
  { id: "ap-001", name: "Aria Mehta", email: "aria.mehta@gmail.com", appliedAt: "2h ago", country: "IN", invited: "Public form", reason: "Active retail trader · 4 yrs · interested in options & systematic strategies", risk: "low", flags: [], questionnaire: { years: 4, capital: "$50k–$100k", focus: "Options + equities", goals: "Systematize discretionary process" } },
  { id: "ap-002", name: "Henry Ng", email: "henry@quantfund.io", appliedAt: "5h ago", country: "US", invited: "Referral · @luca", reason: "Quant PM at small fund evaluating tooling", risk: "med", flags: ["VPN detected"], questionnaire: { years: 12, capital: "$1M+", focus: "Multi-asset systematic", goals: "Replace internal dashboard" } },
  { id: "ap-003", name: "Mia Roy", email: "mia.r99@protonmail.com", appliedAt: "yesterday", country: "??", invited: "Public form", reason: "—", risk: "high", flags: ["Disposable email", "Country masked", "No referral"], questionnaire: { years: "—", capital: "—", focus: "—", goals: "—" } },
  { id: "ap-004", name: "Ben Cole", email: "ben@cole.partners", appliedAt: "yesterday", country: "UK", invited: "Referral · @sara", reason: "Discretionary trader, wants to add risk overlay", risk: "low", flags: [], questionnaire: { years: 18, capital: "$250k–$500k", focus: "Equities", goals: "Tighter risk discipline" } },
  { id: "ap-005", name: "Jana Kim", email: "jana.kim@stanford.edu", appliedAt: "2d ago", country: "US", invited: "Public form", reason: "Grad student studying market microstructure", risk: "low", flags: [], questionnaire: { years: 2, capital: "<$10k", focus: "Research / paper-only", goals: "Academic study" } },
  { id: "ap-006", name: "Octavio Ríos", email: "rios.o@gmail.com", appliedAt: "3d ago", country: "MX", invited: "Public form", reason: "Day trader transitioning to swing", risk: "med", flags: ["Multiple applications detected (3)"], questionnaire: { years: 3, capital: "$10k–$50k", focus: "Equities", goals: "Swing trading" } },
];

const MOCK_ACTIVE_USERS = [
  { id: "u-001", name: "Sara Lin", email: "sara@alphadesk.io", role: "operator", joined: "2024-01-12", lastActive: "5m ago", paper: false, equity: 412300, openPos: 14, agentsOn: 6, dailyAi: 8.42, status: "ok" },
  { id: "u-002", name: "Luca Bianchi", email: "luca@alphadesk.io", role: "operator", joined: "2024-02-04", lastActive: "12m ago", paper: false, equity: 220100, openPos: 8, agentsOn: 4, dailyAi: 4.10, status: "ok" },
  { id: "u-003", name: "Mei Tanaka", email: "mei@alphadesk.io", role: "user", joined: "2024-04-22", lastActive: "31m ago", paper: false, equity: 88400, openPos: 6, agentsOn: 3, dailyAi: 2.18, status: "ok" },
  { id: "u-004", name: "Robin Hass", email: "robin.hass@gmail.com", role: "user", joined: "2024-06-08", lastActive: "1h ago", paper: true, equity: 100000, openPos: 4, agentsOn: 2, dailyAi: 1.04, status: "ok" },
  { id: "u-005", name: "Kira Volkov", email: "kira.v@protonmail.com", role: "user", joined: "2024-07-19", lastActive: "yesterday", paper: false, equity: 142800, openPos: 11, agentsOn: 5, dailyAi: 5.92, status: "watch" },
  { id: "u-006", name: "Tom Reyes", email: "tom@reyes.cap", role: "user", joined: "2024-08-30", lastActive: "3d ago", paper: false, equity: 0, openPos: 0, agentsOn: 0, dailyAi: 0.00, status: "dormant" },
  { id: "u-007", name: "Ada Park", email: "ada@gmail.com", role: "user", joined: "2024-09-14", lastActive: "8m ago", paper: true, equity: 100000, openPos: 2, agentsOn: 1, dailyAi: 0.40, status: "ok" },
  { id: "u-008", name: "Felix Roth", email: "felix.roth@hedge.de", role: "user", joined: "2024-10-02", lastActive: "22m ago", paper: false, equity: 615200, openPos: 18, agentsOn: 7, dailyAi: 11.83, status: "watch" },
  { id: "u-009", name: "Yusuf Kaya", email: "yusuf@kaya.tr", role: "user", joined: "2024-11-18", lastActive: "2d ago", paper: false, equity: 32000, openPos: 3, agentsOn: 1, dailyAi: 0.18, status: "ok" },
  { id: "u-010", name: "Helena Ström", email: "helena@strom.se", role: "user", joined: "2024-12-04", lastActive: "55m ago", paper: false, equity: 187300, openPos: 9, agentsOn: 4, dailyAi: 3.65, status: "ok" },
];

const MOCK_DASHBOARD_SECTIONS = [
  { id: "decision-queue", name: "decision_queue", title: "Decision queue", visible: true },
  { id: "risk-escalation", name: "risk_escalation", title: "Risk escalation", visible: true },
  { id: "portfolio-canvas", name: "portfolio_canvas", title: "Portfolio canvas", visible: true },
  { id: "risk-panel", name: "risk_panel", title: "Risk panel", visible: true },
  { id: "audit-trail", name: "audit_trail", title: "Audit trail", visible: false },
  { id: "session-snapshot", name: "session_snapshot", title: "Session snapshot", visible: true },
  { id: "watchlist-movers", name: "watchlist_movers", title: "Watchlist movers", visible: true },
  { id: "agent-feed", name: "agent_feed", title: "Agent activity feed", visible: false },
];

if (typeof window !== "undefined") Object.assign(window, {
  MOCK_USER, MOCK_PORTFOLIO, MOCK_REGIME, MOCK_BRIEFING, MOCK_WATCHLIST,
  MOCK_POSITIONS, MOCK_STRATEGIES, MOCK_TICKER, MOCK_SIGNALS, MOCK_AI_TICKER,
  MOCK_TICKER_HISTORY, MOCK_TICKER_EXPOSURE, MOCK_NEWS, MOCK_PIPELINE, MOCK_ALERTS,
  MOCK_AGENTS, MOCK_NOTIFICATIONS, MOCK_SYSTEM_STATE, MOCK_CONTROLS,
  MOCK_HEALTH_TILES, MOCK_ARCH_NODES, MOCK_AUDIT_LOG, MOCK_DASHBOARD_SECTIONS,
});


// Shared chrome — top bar, sidebar, command bar, status bar, primitive components.

const { useState, useEffect, useMemo, useRef } = React;

// ─── tiny primitives ─────────────────────────────────────────────────────────

const fmtMoney = (n, opts = {}) => {
  const sign = opts.sign && n > 0 ? "+" : "";
  return sign + n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: opts.dec ?? 2, maximumFractionDigits: opts.dec ?? 2 });
};
const fmtPct = (n, dec = 2) => (n > 0 ? "+" : "") + n.toFixed(dec) + "%";
const fmtNum = (n, dec = 2) => n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });

function Sparkline({ data, color, width = 96, height = 24, fill = false }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = "M " + pts.join(" L ");
  const fillPath = path + ` L ${width},${height} L 0,${height} Z`;
  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      {fill && <path d={fillPath} fill={color} opacity="0.15" />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// PnL chip (up = chartreuse, down = coral)
function Delta({ value, dec = 2, suffix = "%", className = "", style = {} }) {
  const cls = value > 0 ? "u-profit" : value < 0 ? "u-loss" : "u-dim";
  return <span className={cls + " t-mono " + className} style={style}>{fmtPct(value, dec).replace("%", suffix)}</span>;
}

// Status dot
function StatusDot({ tone = "up", size = 6, glow = true }) {
  const colors = { up: "var(--up-500)", down: "var(--down-500)", neutral: "var(--ice-500)", brand: "var(--gold-500)", off: "var(--fg-hint)" };
  const c = colors[tone] || colors.neutral;
  return <span style={{ width: size, height: size, borderRadius: "50%", background: c, boxShadow: glow && tone !== "off" ? `0 0 ${size}px ${c}` : "none", display: "inline-block", flexShrink: 0 }} />;
}

// Section header with editorial rule
function Section({ eyebrow, title, right, children, style = {} }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", ...style }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 0 14px 0", borderBottom: "1px solid var(--border-hair)", marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
          {eyebrow && <span className="t-eyebrow-italic" style={{ color: "var(--brand)" }}>{eyebrow}</span>}
          {title && <h2 className="t-h2" style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", letterSpacing: "-0.02em", fontWeight: 400 }}>{title}</h2>}
        </div>
        {right && <div style={{ marginLeft: "auto" }}>{right}</div>}
      </header>
      {children}
    </section>
  );
}

// ─── top bar ─────────────────────────────────────────────────────────────────

function TopBar({ page, onNav, onSearch, regime, theme = "dark", onTheme }) {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem("alpha-mode") || "paper"; } catch { return "paper"; } });
  const setModeP = (v) => { setMode(v); try { localStorage.setItem("alpha-mode", v); } catch {} };
  const navs = [
    { id: "dashboard",  label: "Dashboard" },
    { id: "watchlists", label: "Watchlists" },
    { id: "trade",      label: "Trade" },
    { id: "strategies", label: "Strategies", children: [
      { id: "strategies", label: "Strategies",      hint: "Book of strategies" },
      { id: "pipeline",   label: "Pipeline",        hint: "Live agent activity" },
      { id: "backtest",   label: "Backtest workbench", hint: "Run · compare · publish" },
    ]},
    { id: "analytics",  label: "Analytics", children: [
      { id: "analytics",  label: "Performance", hint: "P&L · attribution · drawdowns" },
      { id: "risk",       label: "Risk",        hint: "Concentration · exposure · stress" },
    ]},
  ];
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      setClock(`${hh}:${mm}:${ss} ET`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto auto 1fr auto auto auto auto", alignItems: "center", padding: "0 18px", height: 52, background: "var(--ink-050)", borderBottom: "1px solid var(--border)", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", letterSpacing: "-0.02em", cursor: "default" }}>
        <span style={{ color: "var(--brand)" }}>α</span>AlphaDesk
      </div>

      <nav style={{ display: "flex", gap: 2, marginLeft: 18 }}>
        {navs.map(n => <NavItem key={n.id} n={n} page={page} onNav={onNav} />)}
      </nav>

      <SearchBar onPick={onSearch} />

      <PaperLiveToggle value={mode} onChange={setModeP} />

      <NotificationBell />

      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", letterSpacing: "0.02em" }}>{clock}</div>

      <UserMenu onNav={onNav} theme={theme} onTheme={onTheme} />
    </div>
  );
}

function NavItem({ n, page, onNav }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const childIds = (n.children || []).map(c => c.id).concat(n.id === "strategies" ? ["playbook"] : []);
  const isActive = page === n.id || childIds.includes(page);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onClick); window.removeEventListener("keydown", onKey); };
  }, [open]);
  if (!n.children) {
    return (
      <a onClick={() => onNav(n.id)} style={{
        fontFamily: "var(--font-ui)", fontSize: 12.5, color: isActive ? "var(--ink-1000)" : "var(--fg-muted)",
        background: isActive ? "var(--bg-elev-1)" : "transparent",
        padding: "6px 12px", borderRadius: 3, cursor: "default", letterSpacing: "0.01em", fontWeight: isActive ? 500 : 400,
        transition: "color 120ms, background 120ms"
      }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "var(--fg)"; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "var(--fg-muted)"; }}
      >{n.label}</a>
    );
  }
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <a onClick={() => setOpen(o => !o)} style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontFamily: "var(--font-ui)", fontSize: 12.5, color: isActive ? "var(--ink-1000)" : "var(--fg-muted)",
        background: isActive ? "var(--bg-elev-1)" : "transparent",
        padding: "6px 12px", borderRadius: 3, cursor: "default", letterSpacing: "0.01em", fontWeight: isActive ? 500 : 400,
        transition: "color 120ms, background 120ms"
      }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "var(--fg)"; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "var(--fg-muted)"; }}
      >
        {n.label}
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, opacity: 0.7, transform: open ? "rotate(180deg)" : "none", transition: "transform 120ms" }}>▾</span>
      </a>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, minWidth: 240,
          background: "var(--bg-elev-2)", border: "1px solid var(--border-strong)", borderRadius: 4,
          boxShadow: "0 8px 28px rgba(0,0,0,0.35)", padding: 4, zIndex: 50,
        }}>
          {n.children.map(c => {
            const active = page === c.id;
            return (
              <div key={c.id} onClick={() => { setOpen(false); onNav(c.id); }} style={{
                display: "block", padding: "8px 12px", borderRadius: 3,
                background: active ? "var(--bg-elev-1)" : "transparent",
                borderLeft: active ? "2px solid var(--brand)" : "2px solid transparent",
                cursor: "default",
              }}
                onMouseEnter={e => { if (!active) e.currentTarget.style.background = "var(--bg-elev-1)"; }}
                onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}
              >
                <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: active ? "var(--ink-1000)" : "var(--fg)", fontWeight: active ? 500 : 400 }}>{c.label}</div>
                <div style={{ marginTop: 2, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, color: "var(--fg-muted)" }}>{c.hint}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function UserMenu({ onNav, theme = "dark", onTheme }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onClick); window.removeEventListener("keydown", onKey); };
  }, []);
  const go = (id) => { setOpen(false); onNav(id); };
  const itemStyle = { display: "flex", alignItems: "baseline", gap: 10, padding: "8px 12px", cursor: "default", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--ink-1000)" };
  const labelStyle = { fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.06em", padding: "10px 12px 4px" };
  const sep = { borderTop: "1px solid var(--border-hair)", margin: "4px 0" };
  const onEnter = (e) => e.currentTarget.style.background = "var(--bg-elev-2)";
  const onLeave = (e) => e.currentTarget.style.background = "transparent";
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: 28, height: 28, padding: 0, borderRadius: "50%", background: "linear-gradient(135deg,var(--gold-600),var(--gold-300))", border: "1px solid var(--border-strong)", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--brand-on)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "default" }}>α</button>
      {open && (
        <div style={{ position: "absolute", top: 36, right: 0, width: 240, background: "var(--ink-150)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "var(--shadow-2)", zIndex: 60, padding: "4px 0" }}>
          <div style={{ padding: "10px 12px 8px" }}>
            <div className="t-body-sm" style={{ color: "var(--ink-1000)", fontWeight: 500 }}>Alex Park</div>
            <div className="t-body-sm" style={{ color: "var(--fg-muted)", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12 }}>alex@alphadesk.io · Operator</div>
          </div>
          <div style={sep} />
          <div style={labelStyle}>Account</div>
          <div style={itemStyle} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={() => go("settings")}>Settings</div>
          <div style={itemStyle} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={() => go("reports")}>Reports & tax</div>
          <div style={sep} />
          <div style={labelStyle}>Administration</div>
          <div style={itemStyle} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={() => go("admin")}>Control center</div>
          <div style={itemStyle} onMouseEnter={onEnter} onMouseLeave={onLeave} onClick={() => go("admin-users")}>Users & access</div>
          <div style={sep} />
          <div style={labelStyle}>Theme</div>
          <div style={{ padding: "4px 12px 10px" }}>
            <ThemeToggle value={theme} onChange={onTheme} />
          </div>
          <div style={sep} />
          <div style={{ ...itemStyle, color: "var(--fg-muted)" }} onMouseEnter={onEnter} onMouseLeave={onLeave}>Sign out</div>
        </div>
      )}
    </div>
  );
}

// ─── command-K-ish search ───────────────────────────────────────────────────

function SearchBar({ onPick }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); ref.current?.focus(); setOpen(true); }
      if (e.key === "Escape") { setOpen(false); ref.current?.blur(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const results = useMemo(() => {
    if (!q) return MOCK_WATCHLIST.slice(0, 6);
    const ql = q.toUpperCase();
    return MOCK_WATCHLIST.filter(w => w.sym.includes(ql) || w.name.toUpperCase().includes(ql)).slice(0, 8);
  }, [q]);

  return (
    <div style={{ position: "relative", maxWidth: 380, justifySelf: "stretch" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, height: 32, padding: "0 12px", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 4 }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--fg-hint)" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
        <input
          ref={ref}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Search ticker, strategy, or command…"
          style={{ flex: 1, background: "transparent", border: 0, color: "var(--ink-1000)", fontFamily: "var(--font-ui)", fontSize: 12.5, outline: "none" }}
        />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.04em", border: "1px solid var(--border)", padding: "1px 5px", borderRadius: 3 }}>⌘K</span>
      </div>
      {open && (
        <div style={{ position: "absolute", top: 38, left: 0, right: 0, background: "var(--ink-150)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "var(--shadow-2)", zIndex: 50, padding: 6, maxHeight: 360, overflow: "auto" }}>
          <div className="t-label" style={{ padding: "6px 10px 4px" }}>Tickers</div>
          {results.map(r => (
            <div key={r.sym}
              onMouseDown={() => { onPick(r.sym); setOpen(false); setQ(""); }}
              style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12, alignItems: "center", padding: "8px 10px", borderRadius: 4, cursor: "default" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-elev-2)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
            >
              <span className="t-mono" style={{ fontSize: 12, color: "var(--ink-1000)", fontWeight: 500 }}>{r.sym}</span>
              <span className="t-body-sm" style={{ fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-dim)" }}>{r.name}</span>
              <span className="t-mono" style={{ fontSize: 11, color: "var(--fg)" }}>{fmtNum(r.px)}</span>
              <Delta value={r.pct} dec={2} />
            </div>
          ))}
          <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border-hair)", marginTop: 6, display: "flex", gap: 12, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>
            <span>↵ open · → trade · / search news · ⌘D dashboard</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── status bar (bottom) ────────────────────────────────────────────────────

function StatusBar() {
  const [tick, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick(x => x + 1), 1100); return () => clearInterval(id); }, []);
  // Risk budget — fake but stable
  const riskUsed = 0.42; // 42% of daily risk budget
  const positions = MOCK_POSITIONS?.length ?? 8;
  const lastTick = (0.03 + (tick % 7) * 0.005).toFixed(2);
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "0 18px", height: 26, background: "var(--ink-050)", borderTop: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)", gap: 16, letterSpacing: "0.02em" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><StatusDot tone="up" size={5} />Alpaca paper · connected</span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--fg)" }}><StatusDot tone="up" size={5} />Market open <span style={{ color: "var(--fg-hint)" }}>· 1h 28m to close</span></span>
      <span style={{ color: "var(--fg-hint)" }}>|</span>
      <span><span style={{ color: "var(--fg-hint)" }}>Pos </span><span style={{ color: "var(--fg)" }}>{positions}</span></span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--fg-hint)" }}>Risk</span>
        <span style={{ display: "inline-block", width: 60, height: 4, background: "var(--ink-150)", borderRadius: 2, overflow: "hidden", position: "relative" }}>
          <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${riskUsed * 100}%`, background: riskUsed > 0.7 ? "var(--down-500)" : riskUsed > 0.5 ? "var(--gold-500)" : "var(--up-500)" }} />
        </span>
        <span style={{ color: "var(--fg)" }}>{Math.round(riskUsed * 100)}%</span>
        <span style={{ color: "var(--fg-hint)" }}>· daily</span>
      </span>
      <span style={{ color: "var(--fg-hint)" }}>|</span>
      <span><span style={{ color: "var(--fg-hint)" }}>AI </span><span style={{ color: "var(--fg)" }}>healthy</span><span style={{ color: "var(--fg-hint)" }}> · p50 180ms</span></span>
      <span><span style={{ color: "var(--fg-hint)" }}>Tick </span>{lastTick}s</span>
      <span style={{ marginLeft: "auto", color: "var(--fg-hint)" }}>Build 2.6.0-edge</span>
      <span style={{ color: "var(--fg)", display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ border: "1px solid var(--border)", padding: "0 4px", borderRadius: 3 }}>⌘K</span> Commands
      </span>
    </div>
  );
}

// ─── editorial AI strip ─────────────────────────────────────────────────────

function AIStrip({ heading = "AI · Pre-trade memo", time = "14:32", children, conf = 0.72 }) {
  return (
    <div style={{ padding: 18, background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--gold-500)", boxShadow: "0 0 10px var(--gold-500)", animation: "pulse 2s infinite" }} />
        <span className="t-label" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>{heading}</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.06em" }}>{time}</span>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: "var(--ink-900)", lineHeight: 1.45, letterSpacing: "-0.005em" }}>{children}</div>
      <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)" }}>
        <span>Confidence {conf.toFixed(2)}</span>
        <span>Haiku 4.5 · 180 ms</span>
      </div>
    </div>
  );
}

// ─── chip / tag ──────────────────────────────────────────────────────────────

function Chip({ tone = "neutral", children, style = {} }) {
  const tones = {
    up:      { bg: "rgba(168,208,77,0.08)", border: "rgba(168,208,77,0.25)", color: "var(--up-500)" },
    down:    { bg: "rgba(224,120,86,0.08)", border: "rgba(224,120,86,0.25)", color: "var(--down-500)" },
    neutral: { bg: "rgba(141,179,196,0.06)", border: "rgba(141,179,196,0.25)", color: "var(--ice-500)" },
    brand:   { bg: "var(--brand-tint)", border: "rgba(201,166,107,0.35)", color: "var(--brand)" },
    muted:   { bg: "var(--bg-elev-1)", border: "var(--border)", color: "var(--fg-muted)" },
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span style={{ fontFamily: "var(--font-ui)", fontSize: 9, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: t.color, padding: "3px 7px", background: t.bg, border: `1px solid ${t.border}`, borderRadius: 2, ...style }}>{children}</span>
  );
}

// ─── keyframes (one-off) ────────────────────────────────────────────────────

(function injectKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById("__alphadesk_keyframes")) return;
  const s = document.createElement("style");
  s.id = "__alphadesk_keyframes";
  s.textContent = `
    @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
    @keyframes flash { 0% { background: rgba(168,208,77,0.18); } 100% { background: transparent; } }
  `;
  document.head.appendChild(s);
})();

// ─── v2 primitives ──────────────────────────────────────────────────────────

// TabBar — sub-IA on Symbol / Settings / Strategy / Position
function TabBar({ tabs, active, onChange, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 14 }}>
      {tabs.map(t => {
        const isActive = active === t.id;
        return (
          <a key={t.id} onClick={() => onChange(t.id)}
            style={{
              fontFamily: "var(--font-ui)", fontSize: 12.5,
              color: isActive ? "var(--ink-1000)" : "var(--fg-muted)",
              padding: "10px 14px",
              borderBottom: isActive ? "2px solid var(--brand)" : "2px solid transparent",
              marginBottom: -1,
              cursor: "default",
              fontWeight: isActive ? 500 : 400,
              letterSpacing: "0.01em",
              transition: "color 120ms",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}
            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.color = "var(--fg)"; }}
            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.color = "var(--fg-muted)"; }}
          >
            {t.label}
            {t.count != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: isActive ? "var(--brand)" : "var(--fg-hint)", letterSpacing: "0.04em" }}>{t.count}</span>}
          </a>
        );
      })}
      {right && <div style={{ marginLeft: "auto", paddingBottom: 6 }}>{right}</div>}
    </div>
  );
}

// AgentChip — small archetype pill (Research / Signal / Risk / Exec)
function AgentChip({ archetype, status = "idle", size = "sm" }) {
  const archeColor = {
    research: "var(--ice-500)",
    signal:   "var(--gold-500)",
    risk:     "var(--down-500)",
    exec:     "var(--up-500)",
  }[archetype] || "var(--fg-muted)";
  const dot = { running: "up", queued: "brand", failed: "down", idle: "off" }[status] || "off";
  const py = size === "lg" ? 4 : 2;
  const fs = size === "lg" ? 10 : 9;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      fontFamily: "var(--font-ui)", fontSize: fs, fontWeight: 600, letterSpacing: "0.14em",
      textTransform: "uppercase", color: archeColor,
      padding: `${py}px 7px`,
      background: "rgba(141,179,196,0.04)",
      border: `1px solid ${archeColor}33`, borderRadius: 2,
    }}>
      <StatusDot tone={dot} size={5} glow={status === "running"} />
      {archetype}
    </span>
  );
}

// AgentRow — line item with archetype + last output + status
function AgentRow({ agent, onOpen }) {
  const a = agent;
  return (
    <div onClick={() => onOpen?.(a.id)} style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto auto",
      gap: 14, alignItems: "center",
      padding: "10px 12px",
      borderBottom: "1px solid var(--border-hair)",
      cursor: onOpen ? "default" : "auto",
    }}
      onMouseEnter={(e) => { if (onOpen) e.currentTarget.style.background = "var(--bg-elev-1)"; }}
      onMouseLeave={(e) => { if (onOpen) e.currentTarget.style.background = "transparent"; }}
    >
      <AgentChip archetype={a.archetype} status={a.status} />
      <div style={{ minWidth: 0 }}>
        <div className="t-body-sm" style={{ color: "var(--ink-900)", fontFamily: "var(--font-display)", fontStyle: "italic", letterSpacing: "-0.005em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.lastOutput}</div>
        <div style={{ display: "flex", gap: 10, marginTop: 2, fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.04em" }}>
          {a.ownerStrategy && <span>↳ {a.ownerStrategy}</span>}
          <span>{a.lastRun}</span>
          <span>{a.runs24h}/24h</span>
          <span>${a.costToday.toFixed(2)}</span>
        </div>
      </div>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)" }}>{a.model}</span>
      <StatusDot tone={a.health === "ok" ? "up" : a.health === "degraded" ? "brand" : "down"} size={5} />
    </div>
  );
}

// AgentActivityFeed — global feed (used in dashboard hero, status drawer, etc)
function AgentActivityFeed({ agents = MOCK_AGENTS, limit = 6, onOpen }) {
  const list = agents.slice(0, limit);
  return (
    <div style={{ background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
      {list.map(a => <AgentRow key={a.id} agent={a} onOpen={onOpen} />)}
    </div>
  );
}

// ControlModule — the atomic unit of Admin + Settings
function ControlModule({ name, desc, control, value, onChange, lastBy, lastAt, critical, scope, audit, children, footer }) {
  return (
    <div style={{
      background: "var(--bg-elev-1)",
      border: critical ? "1px solid rgba(224,120,86,0.45)" : "1px solid var(--border)",
      borderRadius: 5, padding: 14,
      display: "flex", flexDirection: "column", gap: 8,
      position: "relative",
    }}>
      {critical && <div style={{ position: "absolute", inset: 0, background: "rgba(224,120,86,0.04)", pointerEvents: "none", borderRadius: 5 }} />}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, position: "relative" }}>
        <div style={{ minWidth: 0 }}>
          <div className="t-body-sm" style={{ color: "var(--ink-1000)", fontWeight: 500, fontFamily: "var(--font-ui)", letterSpacing: "0.005em" }}>{name}</div>
          {desc && <div className="t-body-sm" style={{ color: "var(--fg-muted)", marginTop: 2, fontFamily: "var(--font-display)", fontStyle: "italic", lineHeight: 1.35 }}>{desc}</div>}
        </div>
        {scope && <span className="t-mono" style={{ fontSize: 9, color: "var(--fg-hint)", letterSpacing: "0.06em", textTransform: "uppercase", flexShrink: 0 }}>{scope}</span>}
      </div>
      <div style={{ position: "relative", paddingTop: 4 }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.04em", paddingTop: 6, borderTop: "1px solid var(--border-hair)", position: "relative" }}>
        <span>{lastBy ? `by ${lastBy}` : ""}</span>
        <span>{lastAt || ""}</span>
      </div>
      {footer && <div style={{ position: "relative" }}>{footer}</div>}
    </div>
  );
}

// DangerConfirm — typed-confirm modal for destructive actions
function DangerConfirm({ open, title, body, confirmWord = "CONFIRM", onConfirm, onCancel, reasonRequired = true }) {
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  if (!open) return null;
  const canGo = typed === confirmWord && (!reasonRequired || reason.trim().length > 3);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,17,18,0.72)", backdropFilter: "blur(4px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, background: "var(--ink-100)", border: "1px solid rgba(224,120,86,0.45)", borderRadius: 6, padding: 22, boxShadow: "var(--shadow-2)" }}>
        <div className="t-eyebrow-italic" style={{ color: "var(--down-500)", letterSpacing: "0.2em", marginBottom: 8 }}>DESTRUCTIVE ACTION</div>
        <h3 className="t-h3" style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", letterSpacing: "-0.02em", fontWeight: 400 }}>{title}</h3>
        <p style={{ margin: "10px 0 14px", color: "var(--fg)", fontFamily: "var(--font-display)", fontStyle: "italic", lineHeight: 1.5, fontSize: 14 }}>{body}</p>
        {reasonRequired && (
          <div style={{ marginBottom: 10 }}>
            <div className="t-label" style={{ marginBottom: 4 }}>Reason (audit-logged)</div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. preventive halt during volatile open"
              style={{ width: "100%", height: 32, padding: "0 10px", background: "var(--bg)", border: "1px solid var(--border)", color: "var(--ink-1000)", fontFamily: "var(--font-ui)", fontSize: 12.5, borderRadius: 3 }} />
          </div>
        )}
        <div className="t-label" style={{ marginBottom: 4 }}>Type <span style={{ fontFamily: "var(--font-mono)", color: "var(--down-500)" }}>{confirmWord}</span> to proceed</div>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={confirmWord}
          style={{ width: "100%", height: 32, padding: "0 10px", background: "var(--bg)", border: "1px solid var(--border)", color: "var(--ink-1000)", fontFamily: "var(--font-mono)", fontSize: 12, borderRadius: 3, letterSpacing: "0.04em" }} />
        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ height: 32, padding: "0 14px", background: "transparent", border: "1px solid var(--border)", color: "var(--fg)", fontFamily: "var(--font-ui)", fontSize: 12, borderRadius: 3, cursor: "default" }}>Cancel</button>
          <button onClick={() => canGo && onConfirm({ reason })} disabled={!canGo} style={{ height: 32, padding: "0 14px", background: canGo ? "var(--down-500)" : "var(--ink-150)", border: "1px solid " + (canGo ? "var(--down-500)" : "var(--border)"), color: canGo ? "#1a0d09" : "var(--fg-hint)", fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 500, borderRadius: 3, cursor: canGo ? "default" : "not-allowed" }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// Skeleton — loading state, never spinners
function Skeleton({ w = "100%", h = 14, radius = 3, style = {} }) {
  return <span style={{ display: "inline-block", width: w, height: h, borderRadius: radius, background: "linear-gradient(90deg, var(--ink-150) 0%, var(--ink-200) 50%, var(--ink-150) 100%)", backgroundSize: "200% 100%", animation: "skeleton 1.4s ease-in-out infinite", ...style }} />;
}

// EmptyState — editorial, never "no data"
function EmptyState({ eyebrow = "EMPTY", title, body, cta, onCta, icon }) {
  return (
    <div style={{ padding: "56px 24px", textAlign: "center", background: "var(--bg-elev-1)", border: "1px dashed var(--border)", borderRadius: 6 }}>
      {icon && <div style={{ marginBottom: 12, color: "var(--fg-hint)" }}>{icon}</div>}
      <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>{eyebrow}</div>
      <h3 style={{ margin: "8px 0 8px", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, fontWeight: 400, letterSpacing: "-0.02em" }}>{title}</h3>
      {body && <p style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 14, lineHeight: 1.5, maxWidth: 460, marginInline: "auto" }}>{body}</p>}
      {cta && <button onClick={onCta} style={{ marginTop: 18, height: 32, padding: "0 16px", background: "var(--brand-tint)", border: "1px solid var(--brand)", color: "var(--brand)", fontFamily: "var(--font-ui)", fontSize: 12, borderRadius: 3, cursor: "default", letterSpacing: "0.02em" }}>{cta}</button>}
    </div>
  );
}

// ErrorState — inline degraded message
function ErrorState({ title = "Something failed", body, onRetry }) {
  return (
    <div style={{ padding: 14, background: "rgba(224,120,86,0.06)", border: "1px solid rgba(224,120,86,0.35)", borderRadius: 5, display: "flex", alignItems: "center", gap: 12 }}>
      <StatusDot tone="down" size={6} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="t-body-sm" style={{ color: "var(--down-500)", fontWeight: 500 }}>{title}</div>
        {body && <div className="t-body-sm" style={{ color: "var(--fg-muted)", marginTop: 2 }}>{body}</div>}
      </div>
      {onRetry && <button onClick={onRetry} style={{ height: 26, padding: "0 10px", background: "transparent", border: "1px solid rgba(224,120,86,0.45)", color: "var(--down-500)", fontFamily: "var(--font-ui)", fontSize: 11, borderRadius: 3, cursor: "default" }}>Retry</button>}
    </div>
  );
}

// StatusBanner — sticky top-of-page system-wide notice
function StatusBanner({ tone = "info", text, action }) {
  if (!text) return null;
  const palette = {
    info: { bg: "rgba(141,179,196,0.08)", border: "rgba(141,179,196,0.35)", color: "var(--ice-500)" },
    warn: { bg: "rgba(212,165,73,0.08)", border: "rgba(212,165,73,0.45)", color: "var(--gold-500)" },
    crit: { bg: "rgba(224,120,86,0.10)", border: "rgba(224,120,86,0.50)", color: "var(--down-500)" },
  }[tone] || {};
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 18px", background: palette.bg, borderBottom: `1px solid ${palette.border}`, fontFamily: "var(--font-ui)", fontSize: 12, color: palette.color }}>
      <StatusDot tone={tone === "crit" ? "down" : tone === "warn" ? "brand" : "neutral"} size={6} />
      <span style={{ flex: 1 }}>{text}</span>
      {action && <button onClick={action.onClick} style={{ height: 22, padding: "0 10px", background: "transparent", border: `1px solid ${palette.border}`, color: palette.color, fontFamily: "var(--font-ui)", fontSize: 11, borderRadius: 3, cursor: "default" }}>{action.label}</button>}
    </div>
  );
}

// PaperLiveToggle — top-bar persistent toggle
function PaperLiveToggle({ value, onChange }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border-strong)", borderRadius: 4, overflow: "hidden", height: 26 }}>
      {["paper", "live"].map(v => (
        <button key={v} onClick={() => onChange(v)} style={{
          padding: "0 10px", height: 24, background: value === v ? (v === "live" ? "var(--down-500)" : "var(--bg-elev-2)") : "transparent",
          color: value === v ? (v === "live" ? "#1a0d09" : "var(--ink-1000)") : "var(--fg-muted)",
          border: 0, fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", cursor: "default",
        }}>{v}</button>
      ))}
    </div>
  );
}

// NotificationBell + Drawer
function NotificationBell({ items = MOCK_NOTIFICATIONS, onRead, onOpenAll }) {
  const [open, setOpen] = useState(false);
  const unread = items.filter(i => !i.read).length;
  const ref = useRef(null);
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{ position: "relative", width: 28, height: 28, background: "transparent", border: "1px solid var(--border)", borderRadius: 4, color: "var(--fg)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "default" }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>
        {unread > 0 && <span style={{ position: "absolute", top: -4, right: -4, minWidth: 14, height: 14, padding: "0 3px", borderRadius: 7, background: "var(--down-500)", color: "var(--down-on)", fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{unread}</span>}
      </button>
      {open && <NotificationDrawer items={items} onRead={onRead} onOpenAll={onOpenAll} onClose={() => setOpen(false)} />}
    </div>
  );
}

function NotificationDrawer({ items, onRead, onOpenAll, onClose }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? items : items.filter(i => i.type === filter);
  const types = ["all", "fill", "agent", "risk", "system", "billing", "support"];
  const typeColor = { fill: "var(--up-500)", agent: "var(--ice-500)", risk: "var(--down-500)", system: "var(--gold-500)", billing: "var(--brand)", support: "var(--fg-muted)" };
  return (
    <div style={{ position: "absolute", top: 36, right: 0, width: 380, maxHeight: 520, background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "var(--shadow-2)", zIndex: 60, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border-hair)", display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>NOTIFICATIONS</div>
        <a onClick={() => items.forEach(i => onRead?.(i.id))} className="t-body-sm" style={{ color: "var(--fg-muted)", cursor: "default", fontSize: 11 }}>Mark all read</a>
      </div>
      <div style={{ display: "flex", gap: 4, padding: "8px 10px", borderBottom: "1px solid var(--border-hair)", flexWrap: "wrap" }}>
        {types.map(t => (
          <a key={t} onClick={() => setFilter(t)} style={{
            padding: "3px 8px", borderRadius: 2, fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase",
            color: filter === t ? "var(--ink-1000)" : "var(--fg-muted)",
            background: filter === t ? "var(--bg-elev-2)" : "transparent",
            border: "1px solid " + (filter === t ? "var(--border-strong)" : "transparent"),
            cursor: "default",
          }}>{t}</a>
        ))}
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-hint)", fontSize: 13 }}>No notifications</div>
        ) : filtered.map(n => (
          <div key={n.id} onClick={() => onRead?.(n.id)} style={{
            padding: "10px 12px", borderBottom: "1px solid var(--border-hair)",
            display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "start",
            background: n.read ? "transparent" : "rgba(201,166,107,0.04)",
            cursor: "default",
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: n.read ? "transparent" : typeColor[n.type] || "var(--fg-muted)", marginTop: 6 }} />
            <div style={{ minWidth: 0 }}>
              <div className="t-body-sm" style={{ color: "var(--ink-1000)", fontWeight: n.read ? 400 : 500, fontFamily: "var(--font-ui)" }}>{n.title}</div>
              <div className="t-body-sm" style={{ color: "var(--fg-muted)", marginTop: 2, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, lineHeight: 1.35 }}>{n.body}</div>
            </div>
            <span className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.04em", flexShrink: 0 }}>{n.ts}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// inject extra keyframes
(function injectV2Keyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById("__alphadesk_v2_keyframes")) return;
  const s = document.createElement("style");
  s.id = "__alphadesk_v2_keyframes";
  s.textContent = `
    @keyframes skeleton { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  `;
  document.head.appendChild(s);
})();

if (typeof window !== "undefined") Object.assign(window, {
  TabBar, AgentChip, AgentRow, AgentActivityFeed,
  ControlModule, DangerConfirm,
  Skeleton, EmptyState, ErrorState, StatusBanner,
  PaperLiveToggle, NotificationBell, NotificationDrawer,
});

function ThemeToggle({ value = "dark", onChange }) {
  const opts = [{ v: "dark", label: "Dark" }, { v: "light", label: "Light" }];
  return (
    <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 999, padding: 2, background: "var(--bg-elev-1)" }}>
      {opts.map(o => {
        const active = value === o.v;
        return (
          <button key={o.v} onClick={() => onChange && onChange(o.v)} style={{
            background: active ? "var(--brand)" : "transparent",
            color: active ? "var(--ink-050)" : "var(--fg-muted)",
            border: "none",
            padding: "3px 10px",
            borderRadius: 999,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "0.05em",
            cursor: "default",
            fontWeight: active ? 600 : 400,
            transition: "background 120ms, color 120ms",
          }}>{o.label}</button>
        );
      })}
    </div>
  );
}

if (typeof window !== "undefined") Object.assign(window, {
  fmtMoney, fmtPct, fmtNum, Sparkline, Delta, StatusDot, Section, TopBar, SearchBar,
  StatusBar, AIStrip, ClaudeStrip: AIStrip, Chip, ThemeToggle,
});


// Dashboard — the "window into the market"
// Hero strip = portfolio P&L · Market regime · Briefing
// Followed by: watchlist top movers, positions snapshot, strategy mini-list

const Dashboard = ({ tweaks, onNav, onPickTicker }) => {
  const layout = tweaks.dashboardLayout; // "briefing" | "market" | "portfolio"

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      {/* ═══ Hero band — three big numbers, editorial ═══ */}
      <div style={{ padding: "28px 32px 28px", background: "var(--ink-100)", borderBottom: "1px solid var(--border)", boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.025)", position: "relative", overflow: "hidden" }}>
        <HeroPulse />
        <DashHero layout={layout} />
      </div>

      {/* ═══ Briefing strip ═══ */}
      <div style={{ padding: "0 32px" }}>
        <BriefingStrip onPickTicker={onPickTicker} />
      </div>

      {/* ═══ 3-column body: regime · movers · positions ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1.2fr 1fr", gap: 1, background: "var(--border)", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ background: "var(--bg)", padding: "24px 28px 28px" }}>
          <RegimePanel />
        </div>
        <div style={{ background: "var(--bg)", padding: "24px 28px 28px" }}>
          <MoversPanel onPickTicker={onPickTicker} />
        </div>
        <div style={{ background: "var(--bg)", padding: "24px 28px 28px" }}>
          <BookSnapshot onNav={onNav} />
        </div>
      </div>

      {/* ═══ Strategies + alerts row ═══ */}
      <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 1, background: "var(--border)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ background: "var(--bg)", padding: "24px 28px 28px" }}>
          <StrategiesMini onNav={onNav} />
        </div>
        <div style={{ background: "var(--bg)", padding: "24px 28px 28px" }}>
          <AlertsMini />
        </div>
      </div>

      <DashFooter />
    </div>
  );
};

// ─── hero band ───────────────────────────────────────────────────────────────

function DashHero({ layout }) {
  const p = MOCK_PORTFOLIO;
  const r = MOCK_REGIME;

  // Live-tick equity for life
  const [equity, setEquity] = useState(p.equity);
  const [equityDelta, setEquityDelta] = useState(p.equityDelta);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      const drift = (Math.random() - 0.45) * 240;
      setEquity(e => e + drift);
      setEquityDelta(d => d + drift);
      setFlashKey(k => k + 1);
    }, 2400);
    return () => clearInterval(id);
  }, []);
  const up = equityDelta >= 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr", gap: 36, alignItems: "end", position: "relative" }}>
      {/* Portfolio */}
      <div>
        <div className="t-label" style={{ marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--up-500)", boxShadow: "0 0 6px var(--up-500)", animation: "pulse 1.6s infinite" }} />
          Portfolio · today
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
          <div key={flashKey} style={{ fontFamily: "var(--font-mono)", fontWeight: 300, fontSize: 56, color: "var(--ink-1000)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em", lineHeight: 1, animation: "tick-flash 600ms ease-out" }}>
            {fmtMoney(equity).replace("$", "")}
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 16, color: "var(--gold-300)" }}>USD</div>
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 12, alignItems: "baseline" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: up ? "var(--up-500)" : "var(--down-500)" }}>{up ? "+" : "−"}${fmtNum(Math.abs(equityDelta))}</span>
          <Delta value={(equityDelta / (equity - equityDelta)) * 100} dec={2} style={{ fontSize: 13 }} />
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-hint)" }}>vs yesterday close</span>
        </div>
        <div style={{ display: "flex", gap: 28, marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-hair)" }}>
          <Stat label="Week"  value={fmtPct(p.weekPct)} tone="up" />
          <Stat label="Month" value={fmtPct(p.monthPct)} tone="up" />
          <Stat label="YTD"   value={fmtPct(p.ytdPct)}  tone="up" big />
          <Stat label="Sharpe · 30d" value={p.sharpe30.toFixed(2)} />
          <Stat label="Beta" value={p.beta.toFixed(2)} />
        </div>
      </div>

      {/* Market regime */}
      <div>
        <div className="t-label" style={{ marginBottom: 8 }}>Market regime</div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 36, color: "var(--ink-1000)", lineHeight: 1.05, letterSpacing: "-0.02em" }}>
          bull, low-volatility
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
          <RegimeBar value={r.confidence} />
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>conf {r.confidence.toFixed(2)} · stable 12d</span>
        </div>
        <div style={{ display: "flex", gap: 22, marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border-hair)" }}>
          <Stat label="VIX" value={r.vix.toFixed(1)} sub={fmtPct(-2.8, 1)} subTone="up" />
          <Stat label="Breadth" value={Math.round(r.breadth * 100) + "%"} sub="up/total" />
          <Stat label="Hi/Lo" value={`${r.newHighsLows.highs}·${r.newHighsLows.lows}`} />
          <Stat label="Fear/Greed" value={r.fearGreed} sub="greed" />
        </div>
      </div>

      {/* Today's brief stat: positions & cash */}
      <div>
        <div className="t-label" style={{ marginBottom: 8 }}>Book</div>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 4, columnGap: 18, alignItems: "baseline" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 28, color: "var(--ink-1000)", fontWeight: 300 }}>{p.positions}</span>
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg-dim)" }}>open positions</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 28, color: "var(--ink-1000)", fontWeight: 300 }}>{p.orders}</span>
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg-dim)" }}>working orders</span>
        </div>
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--border-hair)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <Stat label="Cash" value={fmtMoney(p.cash, { dec: 0 })} />
          <Stat label="Buy pwr" value={fmtMoney(p.buyingPower, { dec: 0 })} />
        </div>
        <ExposureBar long={p.exposureLong} short={p.exposureShort} />
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone, subTone, big }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span className="t-label">{label}</span>
      <span className={tone === "up" ? "u-profit" : tone === "down" ? "u-loss" : ""}
        style={{ fontFamily: "var(--font-mono)", fontSize: big ? 16 : 14, color: tone ? undefined : "var(--ink-1000)", fontVariantNumeric: "tabular-nums", letterSpacing: "-0.005em" }}>
        {value}
      </span>
      {sub && <span className={"t-mono " + (subTone === "up" ? "u-profit" : "")} style={{ fontSize: 10, color: subTone ? undefined : "var(--fg-hint)" }}>{sub}</span>}
    </div>
  );
}

function RegimeBar({ value }) {
  return (
    <div style={{ width: 130, height: 4, background: "var(--ink-300)", borderRadius: 2, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${value * 100}%`, background: "linear-gradient(90deg, var(--ice-500), var(--up-500))" }} />
    </div>
  );
}

function ExposureBar({ long, short }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div className="t-label" style={{ marginBottom: 6, fontSize: 9.5 }}>Net exposure · long {Math.round(long * 100)}% / short {Math.round(short * 100)}%</div>
      <div style={{ display: "flex", height: 6, borderRadius: 1, overflow: "hidden", background: "var(--ink-200)" }}>
        <div style={{ width: `${long * 100}%`, background: "var(--up-500)", opacity: 0.8 }} />
        <div style={{ width: `${(1 - long - short) * 100}%`, background: "var(--ink-300)" }} />
        <div style={{ width: `${short * 100}%`, background: "var(--down-500)", opacity: 0.8 }} />
      </div>
    </div>
  );
}

// ─── briefing strip ──────────────────────────────────────────────────────────

function BriefingStrip({ onPickTicker }) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", padding: "20px 0", display: "grid", gridTemplateColumns: "200px 1fr", gap: 32, alignItems: "start" }}>
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 24, color: "var(--brand)", lineHeight: 1.05, letterSpacing: "-0.02em" }}>
          Since you<br/>last logged in
        </div>
        <div className="t-label" style={{ marginTop: 10 }}>Briefing · 11h ago</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        {MOCK_BRIEFING.map((b, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 14, padding: "10px 0", borderBottom: i < MOCK_BRIEFING.length - 1 ? "1px solid var(--border-hair)" : "none", alignItems: "baseline" }}>
            <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.04em" }}>{b.time}</span>
            <StatusDot tone={b.tone === "up" ? "up" : b.tone === "down" ? "down" : "neutral"} size={6} />
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15.5, color: "var(--ink-900)", lineHeight: 1.45, letterSpacing: "-0.005em" }}>{b.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── regime panel ────────────────────────────────────────────────────────────

function RegimePanel() {
  const r = MOCK_REGIME;
  const indices = [
    { sym: "SPY", v: r.spy, d: r.spyDelta },
    { sym: "QQQ", v: r.qqq, d: r.qqqDelta },
    { sym: "IWM", v: r.iwm, d: r.iwmDelta },
    { sym: "DXY", v: r.dxy, d: r.dxyDelta },
    { sym: "10Y", v: r.tnx, d: r.tnxDelta, suffix: "%" },
    { sym: "OIL", v: r.oil, d: r.oilDelta },
    { sym: "GOLD", v: r.gold, d: r.goldDelta },
    { sym: "BTC",  v: r.btc, d: r.btcDelta },
  ];

  return (
    <Section eyebrow="01" title="Market" right={<span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>Live · 0.04s</span>}>
      {/* Sparkline of regime score */}
      <div style={{ marginBottom: 18, position: "relative" }}>
        <div className="t-label" style={{ marginBottom: 6 }}>Regime confidence · 30d</div>
        <Sparkline data={r.history} color="var(--gold-300)" width={420} height={50} fill={true} />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-hint)" }}>
          <span>30d ago</span><span>now · 0.72</span>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "1px", background: "var(--border-hair)" }}>
        {indices.map(ix => (
          <div key={ix.sym} style={{ background: "var(--bg)", padding: "9px 12px", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "baseline" }}>
            <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 11, color: "var(--fg-dim)", letterSpacing: "0.08em" }}>{ix.sym}</span>
            <span className="t-mono" style={{ fontSize: 13, color: "var(--ink-1000)", textAlign: "right" }}>
              {ix.v >= 1000 ? ix.v.toLocaleString() : ix.v.toFixed(2)}
            </span>
            <Delta value={ix.d} dec={2} suffix={ix.suffix || "%"} />
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── movers panel (watchlist) ────────────────────────────────────────────────

function MoversPanel({ onPickTicker }) {
  const [filter, setFilter] = useState("all"); // all | gainers | losers | candidates
  const list = useMemo(() => {
    const sorted = [...MOCK_WATCHLIST];
    if (filter === "gainers") return sorted.filter(x => x.pct > 0).sort((a, b) => b.pct - a.pct);
    if (filter === "losers")  return sorted.filter(x => x.pct < 0).sort((a, b) => a.pct - b.pct);
    if (filter === "candidates") return sorted.filter(x => x.mark === "candidate" || x.mark === "watch");
    return sorted.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  }, [filter]);

  const tabs = [
    { id: "all", label: "Movers" },
    { id: "gainers", label: "Gainers" },
    { id: "losers", label: "Losers" },
    { id: "candidates", label: "Candidates" },
  ];

  return (
    <Section eyebrow="02" title="Watchlist"
      right={
        <div style={{ display: "flex", gap: 2 }}>
          {tabs.map(t => (
            <a key={t.id} onClick={() => setFilter(t.id)} style={{
              fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase",
              color: filter === t.id ? "var(--ink-1000)" : "var(--fg-muted)",
              background: filter === t.id ? "var(--bg-elev-1)" : "transparent",
              padding: "4px 9px", borderRadius: 2, cursor: "default"
            }}>{t.label}</a>
          ))}
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column" }}>
        {list.map((w, i) => (
          <div key={w.sym}
            onClick={() => onPickTicker(w.sym)}
            style={{ display: "grid", gridTemplateColumns: "60px 1fr 100px 90px 80px", gap: 14, padding: "9px 4px", borderBottom: i < list.length - 1 ? "1px solid var(--border-hair)" : "none", alignItems: "center", cursor: "default", borderLeft: "2px solid transparent", transition: "border-color 120ms, background 120ms" }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-elev-1)"; e.currentTarget.style.borderLeftColor = "var(--brand)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderLeftColor = "transparent"; }}
          >
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--ink-1000)", fontWeight: 500, letterSpacing: "0.02em" }}>{w.sym}</span>
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.name}</span>
            <Sparkline data={w.spark} color={w.pct >= 0 ? "var(--up-500)" : "var(--down-500)"} width={100} height={20} />
            <span className="t-mono" style={{ fontSize: 12, color: "var(--fg)", textAlign: "right" }}>{fmtNum(w.px)}</span>
            <Delta value={w.pct} dec={2} style={{ textAlign: "right", fontSize: 12 }} />
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── book snapshot ────────────────────────────────────────────────────────

function BookSnapshot({ onNav }) {
  const top = [...MOCK_POSITIONS].sort((a, b) => Math.abs(b.pl) - Math.abs(a.pl)).slice(0, 6);
  return (
    <Section eyebrow="03" title="Positions"
      right={<a onClick={() => onNav("trade")} style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--brand)", cursor: "default" }}>Open desk →</a>}>
      <div>
        {top.map((p, i) => (
          <div key={p.sym} style={{ display: "grid", gridTemplateColumns: "55px 1fr auto", gap: 10, padding: "10px 0", borderBottom: i < top.length - 1 ? "1px solid var(--border-hair)" : "none", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: "var(--font-ui)", fontWeight: 500, fontSize: 12.5, color: "var(--ink-1000)" }}>{p.sym}</div>
              <div className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)", marginTop: 2 }}>{p.side === "short" ? "−" : ""}{p.qty}</div>
            </div>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, color: "var(--fg-dim)" }}>{p.strategy}</div>
              <div style={{ height: 3, background: "var(--ink-300)", borderRadius: 2, marginTop: 5, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(100, Math.abs(p.plPct) * 6)}%`, background: p.pl >= 0 ? "var(--up-500)" : "var(--down-500)" }} />
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className={p.pl >= 0 ? "u-profit t-mono" : "u-loss t-mono"} style={{ fontSize: 13, fontWeight: 500 }}>
                {p.pl > 0 ? "+" : ""}{fmtMoney(p.pl, { dec: 0 }).replace("$", "$")}
              </div>
              <div className={p.pl >= 0 ? "u-profit t-mono" : "u-loss t-mono"} style={{ fontSize: 10, opacity: 0.8 }}>
                {fmtPct(p.plPct, 1)}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>
        <span>{MOCK_POSITIONS.length} positions</span>
        <span className="u-profit">+${fmtNum(MOCK_POSITIONS.reduce((s, p) => s + p.pl, 0), 0)}</span>
      </div>
    </Section>
  );
}

// ─── strategies mini ──────────────────────────────────────────────────────

function StrategiesMini({ onNav }) {
  return (
    <Section eyebrow="04" title="Strategies"
      right={<a onClick={() => onNav("strategies")} style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--brand)", cursor: "default" }}>All →</a>}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "var(--border-hair)" }}>
        {MOCK_STRATEGIES.map((s) => (
          <div key={s.num} style={{ background: "var(--bg)", padding: "14px 16px 16px", borderLeft: s.active ? "2px solid var(--brand)" : "2px solid var(--ink-300)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-1000)", letterSpacing: "-0.01em" }}>{s.name}</span>
              <span className="t-mono" style={{ fontSize: 9, color: "var(--fg-hint)" }}>{s.num}</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11, color: "var(--fg-muted)", marginTop: 1 }}>{s.style}</div>
            <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "baseline" }}>
              <Delta value={s.pct} dec={2} style={{ fontSize: 14, fontWeight: 500 }} />
              <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>30d</span>
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)" }}>
              <span>SR {s.sharpe.toFixed(2)}</span>
              <span>DD {s.dd.toFixed(1)}%</span>
              <span>{s.positions}p · {s.allocPct}%</span>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── alerts mini ─────────────────────────────────────────────────────────────

function AlertsMini() {
  return (
    <Section eyebrow="05" title="Alerts" right={<span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>{MOCK_ALERTS.length} today</span>}>
      <div>
        {MOCK_ALERTS.map((a, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 12, padding: "10px 0", borderBottom: i < MOCK_ALERTS.length - 1 ? "1px solid var(--border-hair)" : "none", alignItems: "baseline" }}>
            <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.04em" }}>{a.ts}</span>
            <StatusDot tone={a.tone === "up" ? "up" : a.tone === "down" ? "down" : "neutral"} size={6} />
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--fg)", lineHeight: 1.4 }}>{a.text}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── footer / hours ──────────────────────────────────────────────────────────

function DashFooter() {
  const now = new Date();
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "20px 0 0", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.04em" }}>
      <span>Briefing generated 07:00 ET · refreshes at close</span>
      <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)" }}>Quiet money, loud math.</span>
    </div>
  );
}

if (typeof window !== "undefined") window.Dashboard = Dashboard;

// ─── live ticker tape (scrolling) ──────────────────────────────────────────

function TickerTape() {
  const items = [...MOCK_WATCHLIST, ...MOCK_WATCHLIST]; // duplicate for seamless loop
  return (
    <div style={{ display: "flex", alignItems: "center", height: 30, background: "var(--ink-050)", borderBottom: "1px solid var(--border)", overflow: "hidden", position: "relative" }}>
      <div style={{ flexShrink: 0, padding: "0 14px", height: "100%", display: "flex", alignItems: "center", gap: 8, borderRight: "1px solid var(--border)", background: "var(--ink-100)" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--up-500)", boxShadow: "0 0 8px var(--up-500)", animation: "pulse 1.6s infinite" }} />
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 9, fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--fg-muted)" }}>Live</span>
      </div>
      <div style={{ display: "flex", animation: "tape-scroll 60s linear infinite", whiteSpace: "nowrap" }}>
        {items.map((w, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "baseline", gap: 8, padding: "0 22px", borderRight: "1px solid var(--border-hair)", height: 30, lineHeight: "30px" }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 500, color: "var(--ink-1000)" }}>{w.sym}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-muted)" }}>{fmtNum(w.px)}</span>
            <Delta value={w.pct} dec={2} style={{ fontSize: 10 }} />
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── soft animated pulse behind the hero ──────────────────────────────────

function HeroPulse() {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", background: "radial-gradient(620px 220px at 18% 50%, rgba(168,208,77,0.08), transparent 70%), radial-gradient(520px 200px at 85% 60%, rgba(201,166,107,0.07), transparent 70%)", animation: "hero-breathe 9s ease-in-out infinite" }} />
  );
}

// inject ticker keyframes
(function injectTickerAnim() {
  if (typeof document === "undefined") return;
  if (document.getElementById("__alphadesk_tape")) return;
  const s = document.createElement("style");
  s.id = "__alphadesk_tape";
  s.textContent = `
    @keyframes tape-scroll { 0% { transform: translateX(0) } 100% { transform: translateX(-50%) } }
    @keyframes hero-breathe { 0%,100% { opacity: 0.6 } 50% { opacity: 1 } }
    @keyframes tick-flash { 0% { color: var(--up-500); } 100% { color: var(--ink-1000); } }
  `;
  document.head.appendChild(s);
})();


// Ticker / Research page — the deep view of a single symbol
// Spine: header band → big chart → signals · AI thesis · history (3 col)
// Bottom: news · peers · options skew

const TickerPage = ({ tweaks, sym, onTrade, onPickTicker, onBack }) => {
  const t = MOCK_TICKER; // for prototype, only NVDA
  const layout = tweaks.tickerLayout; // "split" | "chart-first" | "ai-first"
  const [tab, setTab] = useState("overview");

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "fundamentals", label: "Fundamentals" },
    { id: "news", label: "News & filings" },
    { id: "options", label: "Options" },
    { id: "history", label: "History & AI" },
  ];

  return (
    <div style={{ overflow: "auto", height: "100%" }}>
      <TickerHeader t={t} onTrade={onTrade} onBack={onBack} />

      {/* Tab strip */}
      <div style={{ background: "var(--bg-elev-1)", borderBottom: "1px solid var(--border)", padding: "0 32px", display: "flex" }}>
        {tabs.map(x => (
          <button key={x.id} onClick={() => setTab(x.id)}
            style={{ background: "transparent", border: 0, padding: "12px 16px", cursor: "default",
              color: tab === x.id ? "var(--ink-1000)" : "var(--fg-muted)",
              fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: tab === x.id ? 500 : 400,
              borderBottom: tab === x.id ? "2px solid var(--brand)" : "2px solid transparent" }}>{x.label}</button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: layout === "ai-first" ? "1fr 1.4fr" : "1.6fr 1fr", borderBottom: "1px solid var(--border)", background: "var(--border)", gap: 1 }}>
            <div style={{ background: "var(--bg)", padding: "20px 28px 24px" }}>
              <ChartPanel t={t} large />
            </div>
            <div style={{ background: "var(--bg)", padding: "20px 28px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
              <AIStrip heading="AI · Thesis" time="08:14">
                {MOCK_AI_TICKER.thesis.split("**").map((part, i) => i % 2 === 1 ? <span key={i} style={{ color: "var(--gold-300)" }}>{part}</span> : <span key={i}>{part}</span>)}
              </AIStrip>
              <SignalsPanel />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--border)", gap: 1 }}>
            <div style={{ background: "var(--bg)", padding: "24px 28px 28px" }}>
              <PeersPanel onPickTicker={onPickTicker} />
            </div>
            <div style={{ background: "var(--bg)", padding: "24px 28px 28px" }}>
              <NewsPanel />
            </div>
          </div>
        </>
      )}

      {tab === "fundamentals" && (
        <div style={{ padding: "24px 28px 28px" }}>
          <FundamentalsPanel t={t} />
        </div>
      )}

      {tab === "news" && (
        <div style={{ padding: "24px 28px 28px" }}>
          <NewsPanel />
        </div>
      )}

      {tab === "options" && (
        <div style={{ padding: "24px 28px 28px" }}>
          <OptionsSkew />
        </div>
      )}

      {tab === "history" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "var(--border)", gap: 1 }}>
          <div style={{ background: "var(--bg)", padding: "24px 28px 28px" }}>
            <HistoryPanel onTrade={onTrade} />
          </div>
          <div style={{ background: "var(--bg)", padding: "24px 28px 28px" }}>
            <ExposureBlock />
          </div>
        </div>
      )}
    </div>
  );
};

// ─── header ────────────────────────────────────────────────────────────────

function TickerHeader({ t, onTrade, onBack }) {
  return (
    <div style={{ padding: "14px 32px 22px", borderBottom: "1px solid var(--border)" }}>
      <a onClick={onBack} title="Back" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-muted)", cursor: "default", padding: "4px 8px 4px 0", marginBottom: 6 }}
        onMouseEnter={(e) => e.currentTarget.style.color = "var(--ink-1000)"}
        onMouseLeave={(e) => e.currentTarget.style.color = "var(--fg-muted)"}>
        <span style={{ fontFamily: "var(--font-mono)" }}>←</span>
        <span>Back</span>
      </a>
      <div style={{ display: "grid", gridTemplateColumns: "auto auto 1fr auto", gap: 32, alignItems: "end" }}>
        <div>
          <div className="t-label">{t.exch} · {t.sector}</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 56, color: "var(--ink-1000)", lineHeight: 0.95, letterSpacing: "-0.025em", marginTop: 6 }}>{t.name.split(" ")[0]}</div>
          <div style={{ fontFamily: "var(--font-ui)", fontWeight: 600, letterSpacing: "0.16em", color: "var(--fg-muted)", marginTop: 6 }}>{t.sym}</div>
        </div>
        <div>
          <div className="t-label">Last</div>
          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 300, fontSize: 56, color: "var(--ink-1000)", lineHeight: 0.95, letterSpacing: "-0.03em", marginTop: 6 }}>{t.px.toFixed(2)}</div>
          <div className="t-mono" style={{ marginTop: 6, color: "var(--up-500)", fontSize: 13 }}>+{t.chg.toFixed(2)} · {fmtPct(t.pct, 2)}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 14, alignSelf: "stretch" }}>
          <Cell label="Bid" v={t.bid.toFixed(2)} />
          <Cell label="Ask" v={t.ask.toFixed(2)} sub={"× spread " + t.spread.toFixed(2)} />
          <Cell label="Volume" v={(t.vol / 1e6).toFixed(1) + "M"} sub={"avg " + (t.avgVol / 1e6).toFixed(1) + "M"} />
          <Cell label="Mkt cap" v={t.mcap} />
          <Cell label="P/E" v={t.pe.toFixed(1)} />
          <Cell label="IV · 30d" v={t.iv.toFixed(1) + "%"} />
          <Cell label="52w range" v={`${t.range52[0].toFixed(0)} – ${t.range52[1].toFixed(0)}`} sub="day · 132.10–135.44" />
          <Cell label="Beta" v={t.beta.toFixed(2)} />
          <Cell label="Earnings" v={`in ${t.earningsIn}d`} sub="post-mkt · est" />
          <Cell label="Short int" v={t.shortInterest.toFixed(1) + "%"} />
          <Cell label="Float" v={Math.round(t.floatPct * 100) + "%"} />
          <Cell label="Insider" v={t.insiderPct.toFixed(1) + "%"} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
          <button onClick={onTrade} style={{ background: "var(--brand)", color: "var(--brand-on)", border: 0, padding: "10px 20px", borderRadius: 4, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, letterSpacing: "0.04em", cursor: "default" }}>Trade {t.sym} →</button>
          <div style={{ display: "flex", gap: 6 }}>
            <Chip tone="up">In book</Chip>
            <Chip tone="brand">Watching</Chip>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>250 sh @ 128.41 avg</div>
        </div>
      </div>
    </div>
  );
}

function Cell({ label, v, sub }) {
  return (
    <div>
      <div className="t-label" style={{ fontSize: 9 }}>{label}</div>
      <div className="t-mono" style={{ fontSize: 13, color: "var(--ink-1000)", marginTop: 3 }}>{v}</div>
      {sub && <div className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// ─── chart ────────────────────────────────────────────────────────────────

function ChartPanel({ t, large }) {
  const [range, setRange] = useState("3M");
  const [chartMode, setChartMode] = useState("line");
  const [overlays, setOverlays] = useState({
    sma20: true, sma50: true, sma200: false,
    ema9: false, ema21: false,
    vwap: false, anchoredVwap: false,
    bollinger: false, keltner: false, donchian: false,
    rsi: false, macd: false,
    volProfile: false,
    regime: true, signals: true, levels: true,
    earnings: false, exDiv: false,
    avgPrice: false,
  });
  return (
    <div>
      <div style={{ paddingBottom: 14, marginBottom: 14, borderBottom: "1px solid var(--border-hair)" }}>
        <ChartToolbar range={range} setRange={setRange} chartMode={chartMode} setChartMode={setChartMode} overlays={overlays} setOverlays={setOverlays} />
      </div>
      <div style={{ position: "relative", width: "100%", height: 360, display: "flex" }}>
        <HeroChart t={t} range={range} chartMode={chartMode} overlays={overlays} limitPx={t.px + 0.5} stopPx={t.px - 5} side="buy" />
      </div>
    </div>
  );
}

// ─── DEPRECATED — old chart code below kept only for reference, not rendered

function _OldChartPanel({ t, large }) {
  const [range, setRange] = useState("3M");
  const ranges = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "ALL"];
  const [overlays, setOverlays] = useState({ sma20: true, sma50: true, regime: true, signals: true });

  // Build SVG path
  const data = t.chart;
  const w = 900, h = 320;
  const min = Math.min(...data) - 2;
  const max = Math.max(...data) + 2;
  const span = max - min;
  const xs = data.map((_, i) => (i / (data.length - 1)) * w);
  const ys = data.map(v => h - ((v - min) / span) * h);
  const linePath = "M " + xs.map((x, i) => `${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" L ");
  const fillPath = linePath + ` L ${w} ${h} L 0 ${h} Z`;

  // sma 20, 50 (simple lagging avg)
  const sma = (n) => data.map((_, i) => {
    if (i < n) return null;
    const slice = data.slice(i - n, i);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const sma20 = sma(8); // shorter for prototype data (80 pts)
  const sma50 = sma(20);
  const smaPath = (arr) => "M " + arr.map((v, i) => v == null ? null : `${xs[i].toFixed(1)} ${(h - ((v - min) / span) * h).toFixed(1)}`).filter(Boolean).join(" L ");

  // signal markers
  const markers = [
    { x: 12, y: ys[12], type: "buy", note: "M&Q entry signal" },
    { x: 38, y: ys[38], type: "exit", note: "Mean-rev exit" },
    { x: 56, y: ys[56], type: "buy", note: "Pivot break" },
    { x: 74, y: ys[74], type: "now", note: "current bar" },
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 28, alignItems: "flex-end", paddingBottom: 14, marginBottom: 16, borderBottom: "1px solid var(--border-hair)" }}>
        <div>
          <div className="t-label" style={{ marginBottom: 8 }}>Timeframe</div>
          <div style={{ display: "flex", gap: 1, background: "var(--ink-100)", border: "1px solid var(--border-hair)", borderRadius: 3, padding: 2 }}>
            {ranges.map(r => (
              <a key={r} onClick={() => setRange(r)} style={{
                fontFamily: "var(--font-mono)", fontSize: 10.5,
                color: range === r ? "var(--ink-1000)" : "var(--fg-muted)",
                background: range === r ? "var(--bg)" : "transparent",
                boxShadow: range === r ? "0 1px 0 rgba(0,0,0,0.08)" : "none",
                padding: "5px 11px", borderRadius: 2, cursor: "default", letterSpacing: "0.04em",
                minWidth: 30, textAlign: "center"
              }}>{r}</a>
            ))}
          </div>
        </div>

        <div />

        <div>
          <div className="t-label" style={{ marginBottom: 8, textAlign: "right" }}>Overlays</div>
          <div style={{ display: "flex", gap: 6 }}>
            <Toggle label="20 SMA"       tone="ice"   on={overlays.sma20}   onClick={() => setOverlays(o => ({ ...o, sma20: !o.sma20 }))} />
            <Toggle label="50 SMA"       tone="brand" on={overlays.sma50}   onClick={() => setOverlays(o => ({ ...o, sma50: !o.sma50 }))} />
            <Toggle label="Regime"       tone="ice"   on={overlays.regime}  onClick={() => setOverlays(o => ({ ...o, regime: !o.regime }))} />
            <Toggle label="Signals"      tone="brand" on={overlays.signals} onClick={() => setOverlays(o => ({ ...o, signals: !o.signals }))} />
          </div>
        </div>
      </div>

      <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 6", background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4 }}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
          <defs>
            <linearGradient id="goldFill2" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#c9a66b" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#c9a66b" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* regime bands */}
          {overlays.regime && (
            <>
              <rect x="0" y="0" width="200" height={h} fill="rgba(199,106,61,0.05)" />
              <rect x="200" y="0" width="500" height={h} fill="rgba(141,179,196,0.04)" />
              <rect x="700" y="0" width="200" height={h} fill="rgba(168,208,77,0.05)" />
            </>
          )}

          {/* grid */}
          <g stroke="var(--border-hair)" strokeWidth="1">
            <line x1="0" y1={h * 0.25} x2={w} y2={h * 0.25} />
            <line x1="0" y1={h * 0.5} x2={w} y2={h * 0.5} />
            <line x1="0" y1={h * 0.75} x2={w} y2={h * 0.75} />
          </g>

          {/* y labels */}
          {[0.05, 0.5, 0.95].map((p, i) => (
            <text key={i} x={w - 8} y={h * p + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-hint)">
              {(max - p * span).toFixed(1)}
            </text>
          ))}

          {/* SMAs */}
          {overlays.sma50 && <path d={smaPath(sma50)} fill="none" stroke="var(--gold-700)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />}
          {overlays.sma20 && <path d={smaPath(sma20)} fill="none" stroke="var(--ice-500)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />}

          {/* support / resistance levels — subtle */}
          {[
            { tag: "R2", px: 138.50, kind: "r" },
            { tag: "R1", px: 136.20, kind: "r" },
            { tag: "S1", px: 132.10, kind: "s" },
            { tag: "S2", px: 128.40, kind: "s" },
          ].map((lv, i) => {
            if (lv.px < min || lv.px > max) return null;
            const y = h - ((lv.px - min) / span) * h;
            const stroke = lv.kind === "r" ? "rgba(224,120,86,0.30)" : "rgba(168,208,77,0.28)";
            const text   = lv.kind === "r" ? "rgba(224,120,86,0.65)" : "rgba(168,208,77,0.65)";
            const xEnd = w - 50;
            return (
              <g key={i}>
                <line x1="0" y1={y} x2={xEnd} y2={y} stroke={stroke} strokeWidth="0.6" strokeDasharray="1 4" />
                <rect x="6" y={y - 7} width="22" height="11" rx="1.5" fill="rgba(20,17,12,0.65)" stroke={stroke} strokeWidth="0.5" />
                <text x="17" y={y + 1.5} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing="0.08em" fill={text}>{lv.tag}</text>
                <text x={xEnd - 4} y={y - 3} textAnchor="end" fontFamily="var(--font-mono)" fontSize="9" fill={text}>{lv.px.toFixed(2)}</text>
              </g>
            );
          })}

          {/* order-book HEATMAP overlay — Bookmap-style — only on 1D */}
          {range === "1D" && (() => {
            const last = data[data.length - 1];
            const tick = 0.10;
            const priceLevels = 28; // rows above + below current
            const timeSlots = 60;   // historical columns

            // Static "walls" — persistent liquidity at certain price levels (S/R)
            const wallPrices = [128.40, 132.10, 134.10, 136.20, 138.50];

            // For each (time, priceOffset), compute liquidity intensity 0..1
            const cellW = w / timeSlots;
            const cellH = h / priceLevels;
            const cells = [];
            for (let ti = 0; ti < timeSlots; ti++) {
              for (let pi = 0; pi < priceLevels; pi++) {
                const offset = pi - priceLevels / 2;
                const px = +(last + offset * tick).toFixed(2);
                if (px < min || px > max) continue;

                // base liquidity: thicker near current price, thinner far away
                const distFromMid = Math.abs(offset);
                let v = Math.max(0, 0.18 - distFromMid / priceLevels);

                // wall contribution — strongest, decays slightly over time
                wallPrices.forEach(wp => {
                  const d = Math.abs(px - wp);
                  if (d < 0.25) {
                    const wallStrength = (1 - d / 0.25) * 0.95;
                    // some walls fade or build through time
                    const timeFactor = wp === 134.10
                      ? 0.4 + (ti / timeSlots) * 0.6        // building through session
                      : wp === 136.20
                      ? 1 - (ti / timeSlots) * 0.5         // fading
                      : 0.7 + Math.sin((ti / timeSlots) * 6 + wp) * 0.2;
                    v = Math.max(v, wallStrength * timeFactor);
                  }
                });

                // transient noise: occasional spikes
                const noise = Math.sin(ti * 0.7 + pi * 1.3) * 0.5 + Math.cos(ti * 0.31 + pi * 0.41) * 0.3;
                if (noise > 0.55) v = Math.max(v, (noise - 0.55) * 1.4);

                if (v < 0.05) continue;
                cells.push({ ti, pi, px, v: Math.min(1, v), isBid: offset < 0 });
              }
            }

            // best bid / ask lines per time slot — sit just below/above current price, walk slightly
            const bbo = Array.from({ length: timeSlots }, (_, ti) => {
              const drift = Math.sin(ti / 7) * 0.15 + (ti / timeSlots - 0.5) * 0.4;
              return { mid: last - 0.08 + drift, spread: 0.04 + Math.abs(Math.sin(ti / 4)) * 0.03 };
            });

            const priceToY = (px) => h - ((px - min) / span) * h;

            return (
              <g>
                {/* heatmap cells */}
                {cells.map((c, i) => {
                  const x = c.ti * cellW;
                  const y = priceToY(c.px) - cellH / 2;
                  // gradient from dark blue → magenta → orange → white at peak (Bookmap-ish)
                  let fill;
                  const v = c.v;
                  if (v < 0.30) {
                    fill = `rgba(60, 80, 130, ${0.12 + v * 0.6})`;
                  } else if (v < 0.55) {
                    const t = (v - 0.30) / 0.25;
                    fill = `rgba(${60 + t * 130}, ${80 - t * 30}, ${130 + t * 40}, ${0.45 + t * 0.2})`;
                  } else if (v < 0.80) {
                    const t = (v - 0.55) / 0.25;
                    fill = `rgba(${190 + t * 40}, ${50 + t * 100}, ${170 - t * 130}, ${0.65 + t * 0.15})`;
                  } else {
                    const t = (v - 0.80) / 0.20;
                    fill = `rgba(${230 + t * 25}, ${150 + t * 90}, ${40 + t * 100}, ${0.80 + t * 0.18})`;
                  }
                  return <rect key={i} x={x} y={y} width={cellW + 0.5} height={cellH + 0.5} fill={fill} />;
                })}

                {/* best bid / ask trails */}
                <path
                  d={"M " + bbo.map((b, ti) => `${ti * cellW + cellW / 2} ${priceToY(b.mid - b.spread / 2)}`).join(" L ")}
                  fill="none" stroke="rgba(168,208,77,0.7)" strokeWidth="0.9" strokeDasharray="2 2"
                />
                <path
                  d={"M " + bbo.map((b, ti) => `${ti * cellW + cellW / 2} ${priceToY(b.mid + b.spread / 2)}`).join(" L ")}
                  fill="none" stroke="rgba(224,120,86,0.7)" strokeWidth="0.9" strokeDasharray="2 2"
                />

                {/* legend chip top-right */}
                <g>
                  <rect x={w - 152} y="8" width="144" height="16" rx="2" fill="rgba(11,10,9,0.7)" stroke="var(--border-hair)" strokeWidth="0.5" />
                  <text x={w - 145} y="19" fontFamily="var(--font-ui)" fontSize="7" letterSpacing="0.18em" fill="var(--fg-hint)">LIQUIDITY HEATMAP · L2</text>
                  <rect x={w - 56} y="12" width="44" height="8" fill="url(#heatLegend)" />
                </g>
                <defs>
                  <linearGradient id="heatLegend" x1="0" x2="1">
                    <stop offset="0%" stopColor="rgba(60,80,130,0.4)" />
                    <stop offset="40%" stopColor="rgba(190,50,170,0.7)" />
                    <stop offset="75%" stopColor="rgba(230,150,40,0.85)" />
                    <stop offset="100%" stopColor="rgba(255,240,180,0.95)" />
                  </linearGradient>
                </defs>
              </g>
            );
          })()}

          {/* price */}
          <path d={fillPath} fill="url(#goldFill2)" />
          <path d={linePath} fill="none" stroke="var(--gold-300)" strokeWidth="1.4" strokeLinejoin="round" />

          {/* signals */}
          {overlays.signals && markers.map((m, i) => (
            <g key={i}>
              {m.type === "buy" && <circle cx={m.x * (w / data.length / 1)} cy={m.y} r="5" fill="none" stroke="var(--up-500)" strokeWidth="1.5" />}
              {m.type === "exit" && <rect x={m.x * (w / data.length / 1) - 4} y={m.y - 4} width="8" height="8" fill="none" stroke="var(--down-500)" strokeWidth="1.5" />}
              {m.type === "now" && (
                <>
                  <line x1={m.x * (w / data.length / 1)} y1="0" x2={m.x * (w / data.length / 1)} y2={h} stroke="var(--gold-300)" strokeDasharray="2 3" strokeWidth="0.8" />
                  <circle cx={m.x * (w / data.length / 1)} cy={m.y} r="4" fill="var(--gold-300)" stroke="var(--ink-050)" strokeWidth="2" />
                </>
              )}
            </g>
          ))}
        </svg>

        {/* current pip readout */}
        <div style={{ position: "absolute", top: 12, left: 16, display: "flex", gap: 14, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>
          <span>O <span style={{ color: "var(--ink-1000)" }}>132.86</span></span>
          <span>H <span style={{ color: "var(--ink-1000)" }}>135.44</span></span>
          <span>L <span style={{ color: "var(--ink-1000)" }}>132.10</span></span>
          <span>C <span style={{ color: "var(--up-500)" }}>134.82</span></span>
          <span>V <span style={{ color: "var(--ink-1000)" }}>28.4M</span></span>
        </div>
      </div>

      {/* Volume rail */}
      <div style={{ marginTop: 8, height: 48, position: "relative" }}>
        <svg viewBox="0 0 900 48" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
          {data.map((_, i) => {
            const vol = 28 + Math.sin(i / 5) * 14 + (Math.random() - 0.5) * 8;
            const bh = Math.abs(vol) / 50 * 48;
            return <rect key={i} x={i * (900 / data.length)} y={48 - bh} width={900 / data.length - 1} height={bh} fill={i % 7 === 0 ? "var(--up-500)" : "var(--ink-300)"} opacity={0.5} />;
          })}
        </svg>
      </div>

      {/* ── Session readout · key levels · sentiment ───────────────── */}
      <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1.1fr 1fr 1fr", gap: 14 }}>
        {/* Intraday stats */}
        <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "12px 14px" }}>
          <div className="t-label" style={{ marginBottom: 10 }}>Session · intraday</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 8, columnGap: 14, fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
            <SessRow k="VWAP" v="134.21" tone="ink" sub="+0.45 above" />
            <SessRow k="RVOL" v="1.42×" tone="up" sub="vs 30d avg" />
            <SessRow k="ATR · 14d" v="3.84" tone="ink" sub="2.85% range" />
            <SessRow k="Gap %" v="+0.71%" tone="up" sub="filled 09:42" />
            <SessRow k="Range" v="2.51" tone="ink" sub="hi-lo intraday" />
            <SessRow k="Beta · SPY" v="1.62" tone="ink" sub="6m rolling" />
          </div>
        </div>

        {/* Key levels */}
        <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "12px 14px" }}>
          <div className="t-label" style={{ marginBottom: 10 }}>Key levels</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { tag: "R2", px: 138.50, dist: "+2.7%", tone: "down", note: "prior swing high" },
              { tag: "R1", px: 136.20, dist: "+1.0%", tone: "down", note: "5d high" },
              { tag: "—",  px: 134.82, dist: "now",   tone: "brand", note: "last" },
              { tag: "S1", px: 132.10, dist: "−2.0%", tone: "up",   note: "intraday low" },
              { tag: "S2", px: 128.40, dist: "−4.8%", tone: "up",   note: "20D pivot · stop" },
            ].map((l, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "26px 1fr auto", gap: 8, alignItems: "center", padding: "3px 0", borderLeft: l.tone === "brand" ? "2px solid var(--brand)" : "2px solid transparent", paddingLeft: 8, marginLeft: -10, background: l.tone === "brand" ? "rgba(201,166,107,0.06)" : "transparent" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: l.tone === "down" ? "var(--down-500)" : l.tone === "up" ? "var(--up-500)" : "var(--brand)", fontWeight: 600, letterSpacing: "0.04em" }}>{l.tag}</span>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="t-mono" style={{ fontSize: 12, color: "var(--ink-1000)" }}>{l.px.toFixed(2)}</span>
                  <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 10.5, color: "var(--fg-hint)" }}>{l.note}</span>
                </div>
                <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)", textAlign: "right", minWidth: 42 }}>{l.dist}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Order flow / sentiment */}
        <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "12px 14px", display: "flex", flexDirection: "column" }}>
          <div className="t-label" style={{ marginBottom: 10 }}>Flow · sentiment</div>

          {/* Buy / sell pressure bar */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)", marginBottom: 4 }}>
              <span>Buy · 64%</span><span>Sell · 36%</span>
            </div>
            <div style={{ position: "relative", height: 5, background: "var(--ink-300)", borderRadius: 1, overflow: "hidden" }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "64%", background: "var(--up-500)" }} />
              <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: "36%", background: "var(--down-500)" }} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", rowGap: 7, columnGap: 12, fontFamily: "var(--font-mono)", fontSize: 11.5 }}>
            <SessRow k="Short int." v="2.4%" tone="ink" sub="−0.3 wk" />
            <SessRow k="IV · 30d" v="42%" tone="ink" sub="rank 64" />
            <SessRow k="Put/Call" v="0.71" tone="up" sub="bullish skew" />
            <SessRow k="Dark pool" v="38%" tone="ink" sub="of volume" />
          </div>

          <div style={{ marginTop: "auto", paddingTop: 10, borderTop: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-dim)" }}>Sentiment · AI</span>
            <span className="t-mono" style={{ fontSize: 11, color: "var(--up-500)" }}>+0.62 · constructive</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SessRow({ k, v, tone, sub }) {
  const color = tone === "up" ? "var(--up-500)" : tone === "down" ? "var(--down-500)" : "var(--ink-1000)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontFamily: "var(--font-ui)", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-hint)" }}>{k}</span>
        <span style={{ color, fontSize: 12 }}>{v}</span>
      </div>
      {sub && <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 10, color: "var(--fg-hint)" }}>{sub}</span>}
    </div>
  );
}

function Toggle({ label, tone, on, onClick }) {
  return (
    <span onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "default", opacity: on ? 1 : 0.45, transition: "opacity 120ms" }}>
      <span style={{ width: 10, height: 2, background: tone === "ice" ? "var(--ice-500)" : tone === "brand" ? "var(--gold-300)" : "var(--up-500)" }} />
      {label}
    </span>
  );
}

// ─── signals panel ──────────────────────────────────────────────────────────

function SignalsPanel() {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingBottom: 12, borderBottom: "1px solid var(--border-hair)", marginBottom: 6 }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)", letterSpacing: "-0.015em", fontWeight: 400 }}>Signals</h3>
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>8 active models</span>
      </div>
      {MOCK_SIGNALS.map((s, i) => (
        <div key={s.name} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 12, padding: "9px 0", borderBottom: i < MOCK_SIGNALS.length - 1 ? "1px solid var(--border-hair)" : "none", alignItems: "center" }}>
          <Chip tone={s.state === "long" ? "up" : s.state === "short" ? "down" : "muted"} style={{ minWidth: 56, textAlign: "center" }}>{s.state}</Chip>
          <div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--ink-1000)", fontWeight: 500 }}>{s.name}</div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, color: "var(--fg-muted)", marginTop: 1 }}>{s.note}</div>
          </div>
          <div style={{ width: 80, height: 4, background: "var(--ink-300)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${s.score * 100}%`, background: s.state === "long" ? "var(--up-500)" : s.state === "short" ? "var(--down-500)" : "var(--ice-500)" }} />
          </div>
          <span className="t-mono" style={{ fontSize: 11.5, color: "var(--ink-1000)", minWidth: 30, textAlign: "right" }}>{s.score.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── exposure to this ticker (stock + options + ETF passthrough) ────────────

function ExposureBlock() {
  const e = MOCK_TICKER_EXPOSURE;
  const etfTotal = e.etfs.reduce((a, b) => a + b.dollars, 0);
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "16px 16px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <span className="t-label">Your exposure to NVDA</span>
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>Stock + Options + ETF passthrough</span>
      </div>

      {/* hero net */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 22, alignItems: "baseline", paddingBottom: 14, borderBottom: "1px solid var(--border-hair)" }}>
        <div>
          <div className="t-mono" style={{ fontSize: 32, color: "var(--ink-1000)", fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1 }}>{fmtMoney(e.net, { dec: 0 })}</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-dim)", marginTop: 4 }}>Net dollar exposure · {e.netPctEquity}% of equity</div>
        </div>

        {/* stacked bar */}
        <div>
          <div style={{ display: "flex", height: 8, borderRadius: 1, overflow: "hidden", border: "1px solid var(--border)" }}>
            <div style={{ flex: e.direct.mkt,    background: "var(--gold-500)" }} />
            <div style={{ flex: e.options[0].mkt + e.options[0].deltaShares * 134.82 / 100, background: "var(--ice-500)" }} />
            <div style={{ flex: etfTotal,        background: "var(--ink-500)" }} />
          </div>
          <div style={{ display: "flex", gap: 16, marginTop: 6, fontFamily: "var(--font-ui)", fontSize: 10, color: "var(--fg-muted)" }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--gold-500)", marginRight: 5 }} />Direct {fmtMoney(e.direct.mkt, { dec: 0 })}</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--ice-500)", marginRight: 5 }} />Options {fmtMoney(e.options[0].mkt, { dec: 0 })} <span style={{ color: "var(--fg-hint)" }}>· δ{e.options[0].deltaShares} sh</span></span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, background: "var(--ink-500)", marginRight: 5 }} />ETF {fmtMoney(etfTotal, { dec: 0 })}</span>
          </div>
        </div>
      </div>

      {/* Direct */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--border-hair)", alignItems: "baseline" }}>
        <span className="t-label" style={{ minWidth: 64 }}>Direct</span>
        <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--ink-900)" }}>
          {e.direct.shares} shares <span style={{ color: "var(--fg-hint)" }}>· avg ${(e.direct.costBasis / e.direct.shares).toFixed(2)} · cost {fmtMoney(e.direct.costBasis, { dec: 0 })}</span>
        </span>
        <span className="t-mono u-profit" style={{ fontSize: 12 }}>+{fmtMoney(e.direct.plDollars, { dec: 0 })} · {fmtPct(e.direct.plPct, 2)}</span>
      </div>

      {/* Options */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--border-hair)", alignItems: "baseline" }}>
        <span className="t-label" style={{ minWidth: 64 }}>Options</span>
        <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--ink-900)" }}>
          {e.options[0].qty}× <span style={{ color: "var(--gold-300)" }}>{e.options[0].contract}</span> <span style={{ color: "var(--fg-hint)" }}>· δ {e.options[0].deltaShares} share-equiv</span>
        </span>
        <span className="t-mono" style={{ fontSize: 12, color: "var(--ink-1000)" }}>{fmtMoney(e.options[0].mkt, { dec: 0 })}</span>
      </div>

      {/* ETF passthrough */}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14, padding: "10px 0 4px", alignItems: "start" }}>
        <span className="t-label" style={{ minWidth: 64, marginTop: 2 }}>ETFs</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {e.etfs.map(f => (
            <div key={f.sym} style={{ display: "grid", gridTemplateColumns: "44px 1fr 60px 80px", gap: 10, alignItems: "baseline" }}>
              <span className="t-mono" style={{ fontSize: 11.5, color: "var(--ink-1000)" }}>{f.sym}</span>
              <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-dim)" }}>{f.name} <span style={{ color: "var(--fg-hint)" }}>· {f.held} sh</span></span>
              <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", textAlign: "right" }}>{f.weight}% wt</span>
              <span className="t-mono" style={{ fontSize: 11.5, color: "var(--ink-900)", textAlign: "right" }}>{fmtMoney(f.dollars, { dec: 0 })}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── history panel ──────────────────────────────────────────────────────────

function HistoryPanel({ onTrade }) {
  return (
    <Section eyebrow="My history" title="With this ticker"
      right={<a onClick={() => alert("Add note (mock)")} style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--brand)", cursor: "default" }}>+ Note</a>}
    >
      <ExposureBlock />

      <div style={{ marginTop: 18, marginBottom: 10, display: "flex", alignItems: "baseline", justifyContent: "space-between", paddingBottom: 8, borderBottom: "1px solid var(--border-hair)" }}>
        <span className="t-label">Activity timeline</span>
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>Most recent first</span>
      </div>

      <div style={{ position: "relative", paddingLeft: 20 }}>
        {/* timeline rail */}
        <div style={{ position: "absolute", left: 6, top: 0, bottom: 0, width: 1, background: "var(--border)" }} />
        {MOCK_TICKER_HISTORY.map((h, i) => (
          <div key={i} style={{ position: "relative", paddingBottom: 18 }}>
            <div style={{ position: "absolute", left: -16, top: 5, width: 7, height: 7, borderRadius: "50%", background: i === 0 ? "var(--brand)" : "var(--ink-400)", boxShadow: i === 0 ? "0 0 6px var(--gold-500)" : "none" }} />
            <div className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.04em" }}>{h.date}</div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)", fontWeight: 500, marginTop: 3 }}>{h.action}</div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-dim)", lineHeight: 1.45, marginTop: 4 }}>{h.note}</div>
            <div style={{ marginTop: 6 }}>
              <Chip tone="muted">{h.strategy}</Chip>
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>
        <span>Lifetime · 4 entries · 2 exits</span>
        <span className="u-profit">P&L total +$3,184</span>
      </div>
    </Section>
  );
}

// ─── news panel ─────────────────────────────────────────────────────────────

function NewsPanel() {
  return (
    <Section eyebrow="News & flow" title="Around NVDA">
      <div>
        {MOCK_NEWS.map((n, i) => (
          <div key={i} style={{ padding: "12px 0", borderBottom: i < MOCK_NEWS.length - 1 ? "1px solid var(--border-hair)" : "none" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <span className="t-label" style={{ fontSize: 9 }}>{n.src}</span>
              <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>{n.ts}</span>
              <Chip tone={n.tag === "policy" ? "down" : n.tag === "flow" ? "brand" : "neutral"}>{n.tag}</Chip>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14.5, color: "var(--ink-900)", lineHeight: 1.45, marginTop: 5, letterSpacing: "-0.005em" }}>{n.title}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── fundamentals panel ─────────────────────────────────────────────────────

function FundamentalsPanel({ t }) {
  const rows = [
    { k: "Revenue · TTM", v: "$96.3B", d: "+208% YoY", tone: "up" },
    { k: "Gross margin",  v: "75.6%", d: "+390 bps", tone: "up" },
    { k: "Op margin",     v: "61.2%", d: "+1,420 bps", tone: "up" },
    { k: "Net income",    v: "$53.0B", d: "+581% YoY", tone: "up" },
    { k: "FCF",           v: "$33.0B", d: "+450%", tone: "up" },
    { k: "Cash",          v: "$34.8B", d: "—" },
    { k: "Debt",          v: "$10.0B", d: "—" },
    { k: "EV/EBITDA · fwd", v: "32.4×", d: "vs sect 24.1×", tone: "down" },
  ];
  return (
    <Section eyebrow="Fundamentals" title="The math">
      <div>
        {rows.map((r, i) => (
          <div key={r.k} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, padding: "9px 0", borderBottom: i < rows.length - 1 ? "1px solid var(--border-hair)" : "none", alignItems: "baseline" }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--fg-dim)" }}>{r.k}</span>
            <span className="t-mono" style={{ fontSize: 12.5, color: "var(--ink-1000)" }}>{r.v}</span>
            <span className={r.tone === "up" ? "u-profit t-mono" : r.tone === "down" ? "u-loss t-mono" : "t-mono"} style={{ fontSize: 10.5, color: r.tone ? undefined : "var(--fg-hint)", minWidth: 90, textAlign: "right" }}>{r.d}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── peers ─────────────────────────────────────────────────────────────────

function PeersPanel({ onPickTicker }) {
  const peers = [
    { sym: "AMD",  name: "AMD",         pct: 1.70, regime: 0.78, mcap: "271B" },
    { sym: "AVGO", name: "Broadcom",    pct: 0.82, regime: 0.74, mcap: "748B" },
    { sym: "TSM",  name: "TSMC",        pct: 1.04, regime: 0.81, mcap: "1.06T" },
    { sym: "INTC", name: "Intel",       pct: -0.68, regime: 0.32, mcap: "138B" },
    { sym: "ASML", name: "ASML",        pct: 0.46, regime: 0.69, mcap: "324B" },
    { sym: "MU",   name: "Micron",      pct: 1.18, regime: 0.61, mcap: "112B" },
  ];
  return (
    <Section eyebrow="Sector" title="Semis · peer view">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "var(--border-hair)" }}>
        {peers.map(p => (
          <div key={p.sym} onClick={() => onPickTicker(p.sym)} style={{ background: "var(--bg)", padding: "12px 14px", cursor: "default" }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-elev-1)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "var(--bg)"}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--font-ui)", fontWeight: 500, fontSize: 12.5, color: "var(--ink-1000)" }}>{p.sym}</span>
              <Delta value={p.pct} dec={2} />
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, color: "var(--fg-muted)" }}>{p.name}</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 9, alignItems: "center" }}>
              <div style={{ flex: 1, height: 3, background: "var(--ink-300)", borderRadius: 2, marginRight: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${p.regime * 100}%`, background: "var(--gold-300)" }} />
              </div>
              <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)" }}>{p.regime.toFixed(2)}</span>
            </div>
            <div className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)", marginTop: 4 }}>mcap {p.mcap}</div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ─── options skew sketch ────────────────────────────────────────────────────

function OptionsSkew() {
  const strikes = [115, 120, 125, 130, 135, 140, 145, 150, 155];
  const ivs = [54, 48, 44, 41, 39, 40, 42, 45, 49];
  const w = 480, h = 140;
  const min = 36, max = 56, span = max - min;
  const pts = ivs.map((v, i) => `${(i / (ivs.length - 1)) * w},${h - ((v - min) / span) * h}`);
  const path = "M " + pts.join(" L ");
  return (
    <Section eyebrow="Options" title="IV skew · 30d">
      <div style={{ position: "relative", width: "100%", aspectRatio: `${w} / ${h}`, background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4 }}>
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
          {/* atm line */}
          <line x1={w * 0.5} y1="0" x2={w * 0.5} y2={h} stroke="var(--gold-700)" strokeDasharray="2 3" strokeWidth="1" />
          <text x={w * 0.5 + 4} y="12" fontFamily="var(--font-mono)" fontSize="10" fill="var(--gold-300)">ATM 135</text>
          {/* skew curve */}
          <path d={path} fill="none" stroke="var(--ice-500)" strokeWidth="1.4" />
          {ivs.map((v, i) => {
            const x = (i / (ivs.length - 1)) * w;
            const y = h - ((v - min) / span) * h;
            return <circle key={i} cx={x} cy={y} r="3" fill="var(--ink-050)" stroke="var(--ice-500)" strokeWidth="1.2" />;
          })}
          {/* strikes labels */}
          {strikes.map((s, i) => (
            <text key={s} x={(i / (strikes.length - 1)) * w} y={h - 4} fontFamily="var(--font-mono)" fontSize="9" fill="var(--fg-hint)" textAnchor="middle">{s}</text>
          ))}
        </svg>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 11 }}>
        <div><span className="t-label" style={{ fontSize: 9, marginRight: 8 }}>25Δ skew</span><span style={{ color: "var(--ink-1000)" }}>+2.4 vol</span></div>
        <div><span className="t-label" style={{ fontSize: 9, marginRight: 8 }}>Put/Call</span><span style={{ color: "var(--ink-1000)" }}>0.62</span></div>
        <div><span className="t-label" style={{ fontSize: 9, marginRight: 8 }}>OI · ATM</span><span style={{ color: "var(--ink-1000)" }}>14,210</span></div>
        <div><span className="t-label" style={{ fontSize: 9, marginRight: 8 }}>Term · 30/90</span><span style={{ color: "var(--ink-1000)" }}>−1.8</span></div>
      </div>
    </Section>
  );
}

if (typeof window !== "undefined") window.TickerPage = TickerPage;


// Trade terminal — chart-as-hero
// Layout: top metric ribbon · left L2/tape (200) · CENTER big chart (everything else lives to the right) · right rail (asset tabs + ticket + risk + AI memo)
// Center has fixed structure: compact TradeHeader → CHART (flex:1, fills viewport) → small volume rail
// Right rail scrolls if content overflows; chart never shrinks.

const TradePage = ({ tweaks, sym = "NVDA", onPickTicker }) => {
  const t = MOCK_TICKER;
  const [asset, setAsset] = useState("stock");
  const [side, setSide] = useState("buy");
  const [qty, setQty] = useState(250);
  const [orderType, setOrderType] = useState("limit");
  const [limitPx, setLimitPx] = useState(134.80);
  const [stopPct, setStopPct] = useState(4.0);
  const [optStrike, setOptStrike] = useState(140);
  const [optType, setOptType] = useState("call");
  const [contracts, setContracts] = useState(10);
  const [range, setRange] = useState("3M");
  const [chartMode, setChartMode] = useState("candle");
  const [overlays, setOverlays] = useState({
    sma20: true, sma50: true, sma200: false,
    ema9: false, ema21: false,
    vwap: true, anchoredVwap: false,
    bollinger: false, keltner: false, donchian: false,
    rsi: false, macd: false,
    volProfile: false,
    regime: true, signals: true, levels: true,
    earnings: true, exDiv: false,
    avgPrice: true,
  });
  const [builderStrategy, setBuilderStrategy] = useState("vertical-call");
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  const isOption = asset !== "stock";
  const notional = isOption ? contracts * 284 : qty * limitPx;
  const stopPx = limitPx * (1 - stopPct / 100);
  const riskDollars = isOption ? contracts * 284 : qty * (limitPx - stopPx);
  const riskPct = (riskDollars / MOCK_PORTFOLIO.equity) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "var(--border)" }}>
      <MetricRibbon t={t} />
      <div style={{ display: "grid", gridTemplateColumns: `30px 1fr ${rightCollapsed ? "36px" : "380px"}`, gap: 1, flex: 1, minHeight: 0, position: "relative" }}>
        {/* LEFT — slim rail (always 30px); expanded panel overlays chart */}
        <aside style={{ background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 14, gap: 10 }}>
          <a onClick={() => setLeftCollapsed(c => !c)} title={leftCollapsed ? "Open book" : "Collapse"}
             style={{ fontFamily: "var(--font-ui)", fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--fg-muted)", cursor: "default", writingMode: "vertical-rl", transform: "rotate(180deg)", padding: "10px 0" }}>
            {leftCollapsed ? "▸" : "◂"} &nbsp; {isOption ? "Options book" : "Order book · L2"}
          </a>
        </aside>
        {!leftCollapsed && (
          <aside style={{
            position: "absolute", top: 0, bottom: 0, left: 31, width: 260, zIndex: 20,
            background: "var(--pill-bg)",
            backdropFilter: "blur(14px) saturate(140%)",
            WebkitBackdropFilter: "blur(14px) saturate(140%)",
            borderRight: "1px solid var(--border)",
            boxShadow: "var(--shadow-2)",
            overflow: "auto", display: "flex", flexDirection: "column"
          }}>
            <div style={{ position: "sticky", top: 0, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: "var(--pill-bg)", borderBottom: "1px solid var(--border-hair)", backdropFilter: "blur(8px)" }}>
              <span className="t-label" style={{ fontSize: 8.5 }}>{isOption ? "Options · book" : "Order book · L2"}</span>
              <a onClick={() => setLeftCollapsed(true)} title="Collapse"
                 style={{ fontFamily: "var(--font-ui)", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--fg-muted)", cursor: "default", padding: "2px 6px", border: "1px solid var(--border-hair)", borderRadius: 2 }}>◂ close</a>
            </div>
            {isOption ? (<OptionsOrderBookPanel />) : (<><OrderBookPanel last={t.px} /><TimeAndSalesPanel /></>)}
          </aside>
        )}

        {/* CENTER — chart hero */}
        <section style={{ background: "var(--bg)", padding: "18px 24px 20px", display: "flex", flexDirection: "column", gap: 12, minHeight: 0, overflow: "hidden" }}>
          <TradeHeader t={t} />
          <ChartToolbar range={range} setRange={setRange} chartMode={chartMode} setChartMode={setChartMode} overlays={overlays} setOverlays={setOverlays} />
          <div style={{ flex: 1, minHeight: 320, display: "flex" }}>
            <HeroChart t={t} range={range} chartMode={chartMode} overlays={overlays} limitPx={limitPx} stopPx={stopPx} side={side} />
          </div>
          <VolumeRail t={t} />
        </section>

        {/* RIGHT — collapsible, pushes (in-grid) */}
        {rightCollapsed ? (
          <aside style={{ background: "var(--bg-elev-1)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 14, gap: 10 }}>
            <a onClick={() => setRightCollapsed(false)} title="Open stage order"
               style={{ fontFamily: "var(--font-ui)", fontSize: 9, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--fg-muted)", cursor: "default", writingMode: "vertical-rl", padding: "10px 0" }}>
              ◂ &nbsp; Stage order
            </a>
          </aside>
        ) : (
        <aside style={{ background: "var(--bg-elev-1)", overflow: "auto", padding: "18px 20px 20px", display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
          <a onClick={() => setRightCollapsed(true)} title="Collapse"
             style={{ position: "absolute", top: 14, right: 14, fontFamily: "var(--font-ui)", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--fg-muted)", cursor: "default", padding: "2px 6px", border: "1px solid var(--border-hair)", borderRadius: 2, zIndex: 2 }}>close ▸</a>
          <AssetTabs asset={asset} setAsset={setAsset} />
          {asset === "stock" && <OrderTicket {...{ side, setSide, qty, setQty, orderType, setOrderType, limitPx, setLimitPx, stopPct, setStopPct, notional, stopPx, riskDollars, riskPct }} />}
          {asset === "option" && <>
            <OptionChainPanel optStrike={optStrike} setOptStrike={setOptStrike} optType={optType} setOptType={setOptType} setLimitPx={setLimitPx} />
            <OptionForm {...{ side, setSide, contracts, setContracts, optStrike, setOptStrike, optType, setOptType, orderType, setOrderType, limitPx, setLimitPx }} />
            <GreeksStrip />
            <PayoffPanel />
            <RiskPreviewCard notional={notional} riskDollars={riskDollars} riskPct={riskPct} stopPx={stopPx} isOption />
          </>}
          {asset === "builder" && <OptionBuilder strategy={builderStrategy} setStrategy={setBuilderStrategy} />}
          <AIMemoPanel isOption={isOption} />
          <button style={{ marginTop: 4, height: 46, background: side === "buy" ? "var(--up-500)" : "var(--down-500)", color: "var(--up-on)", border: 0, borderRadius: 4, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", cursor: "default" }}>
            Stage {isOption ? `${side} to open` : `${side} order`} →
          </button>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-muted)", textAlign: "center", marginTop: -8 }}>Reviewed against regime + risk policy</div>
        </aside>
        )}
      </div>
    </div>
  );
};

// ─── metric ribbon ───────────────────────────────────────────────────────────

function MetricRibbon({ t }) {
  const cells = [
    { label: "Symbol",   value: <><span style={{ color: "var(--ink-1000)" }}>{t.sym}</span> <span style={{ color: "var(--fg-hint)", fontFamily: "var(--font-display)", fontStyle: "italic" }}>· Nvidia</span></>, big: true },
    { label: "Last",     value: <><span style={{ color: "var(--ink-1000)" }}>{t.px.toFixed(2)}</span> <span className="u-profit" style={{ marginLeft: 6 }}>{fmtPct(t.pct, 2)}</span></> },
    { label: "Bid × Ask",value: <><span style={{ color: "var(--ice-500)" }}>134.81</span> <span style={{ color: "var(--fg-hint)", margin: "0 4px" }}>×</span><span style={{ color: "var(--gold-300)" }}>134.83</span></> },
    { label: "Spread",   value: <>$0.02 <span style={{ color: "var(--fg-hint)", marginLeft: 4 }}>1.5 bps</span></> },
    { label: "Day range",value: <>132.10 <span style={{ color: "var(--fg-hint)", margin: "0 6px" }}>—</span> 135.44</> },
    { label: "Volume · ADV", value: <>28.4M <span style={{ color: "var(--fg-hint)", margin: "0 4px" }}>/</span> 42.1M</> },
    { label: "IV · IV rank", value: <>41.2% <span style={{ color: "var(--fg-hint)", marginLeft: 6 }}>82</span></> },
    { label: "Earnings", value: <>14d <span style={{ color: "var(--fg-hint)", marginLeft: 6 }}>Nov 18 AMC</span></> },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.1fr repeat(7, 1fr)", background: "var(--ink-100)", borderBottom: "1px solid var(--border)" }}>
      {cells.map((c, i) => (
        <div key={i} style={{ padding: "10px 14px", borderRight: i < cells.length - 1 ? "1px solid var(--border-hair)" : "0", display: "flex", flexDirection: "column", gap: 3 }}>
          <span className="t-label" style={{ fontSize: 8.5 }}>{c.label}</span>
          <span style={{ fontFamily: c.big ? "var(--font-display)" : "var(--font-mono)", fontStyle: c.big ? "italic" : "normal", fontSize: c.big ? 16 : 13, color: "var(--ink-900)" }}>{c.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── compact center header ───────────────────────────────────────────────────

function TradeHeader({ t }) {
  const stats = [
    { k: "VWAP", v: "134.16" }, { k: "ATR · 14", v: "$3.20" },
    { k: "Beta", v: "1.72" }, { k: "Short %", v: "2.4" }, { k: "Borrow", v: "easy" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 28, alignItems: "flex-end", paddingBottom: 10, borderBottom: "1px solid var(--border-hair)" }}>
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 26, color: "var(--ink-1000)", letterSpacing: "-0.025em", lineHeight: 0.95 }}>Nvidia</div>
        <div style={{ marginTop: 4, display: "flex", gap: 9, fontFamily: "var(--font-ui)", fontSize: 10, color: "var(--fg-muted)", letterSpacing: "0.16em" }}>
          <span style={{ color: "var(--ink-1000)", fontWeight: 600 }}>NVDA</span><span>·</span><span>NASDAQ</span><span>·</span><span>SEMIS</span>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 22 }}>
        {stats.map(s => (
          <div key={s.k} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 56 }}>
            <span className="t-label" style={{ fontSize: 8.5 }}>{s.k}</span>
            <span className="t-mono" style={{ fontSize: 12.5, color: "var(--ink-900)" }}>{s.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── chart toolbar (range + overlays) ────────────────────────────────────────

const OVERLAY_GROUPS = [
  { group: "Moving averages", items: [
    { key: "sma20",  label: "SMA · 20",  dot: "var(--ice-500)" },
    { key: "sma50",  label: "SMA · 50",  dot: "var(--gold-700)" },
    { key: "sma200", label: "SMA · 200", dot: "var(--ink-400)" },
    { key: "ema9",   label: "EMA · 9",   dot: "var(--brand)" },
    { key: "ema21",  label: "EMA · 21",  dot: "var(--gold-500)" },
  ]},
  { group: "Volume / VWAP", items: [
    { key: "vwap",         label: "VWAP",          dot: "var(--gold-300)" },
    { key: "anchoredVwap", label: "Anchored VWAP", dot: "var(--gold-700)" },
    { key: "volProfile",   label: "Volume profile", dot: "var(--ink-400)" },
    { key: "avgPrice",     label: "Avg cost · 128.40", dot: "var(--brand)" },
  ]},
  { group: "Bands", items: [
    { key: "bollinger", label: "Bollinger · 20·2",  dot: "var(--ice-500)" },
    { key: "keltner",   label: "Keltner · 20·1.5",  dot: "var(--gold-700)" },
    { key: "donchian",  label: "Donchian · 20",     dot: "var(--ink-400)" },
  ]},
  { group: "Oscillators · separate pane", items: [
    { key: "rsi",  label: "RSI · 14",       dot: "var(--brand)" },
    { key: "macd", label: "MACD · 12·26·9", dot: "var(--ice-500)" },
  ]},
  { group: "Layers", items: [
    { key: "levels",   label: "Support · resistance", dot: "var(--down-500)" },
    { key: "signals",  label: "Strategy signals",     dot: "var(--brand)" },
    { key: "regime",   label: "Regime bands",         dot: "var(--ink-400)" },
    { key: "earnings", label: "Earnings markers",     dot: "var(--gold-500)" },
    { key: "exDiv",    label: "Ex-dividend dates",    dot: "var(--ice-500)" },
  ]},
];

function ChartToolbar({ range, setRange, chartMode, setChartMode, overlays, setOverlays }) {
  const ranges = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "ALL"];
  const modes = [{ id: "candle", label: "Bars" }, { id: "line", label: "Line" }];
  const [open, setOpen] = useState(false);
  const onCount = Object.values(overlays).filter(Boolean).length;
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, position: "relative" }}>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ display: "flex", gap: 1, background: "var(--ink-100)", border: "1px solid var(--border-hair)", borderRadius: 3, padding: 2 }}>
          {ranges.map(r => (
            <a key={r} onClick={() => setRange(r)} style={{
              fontFamily: "var(--font-mono)", fontSize: 10.5,
              color: range === r ? "var(--ink-1000)" : "var(--fg-muted)",
              background: range === r ? "var(--bg)" : "transparent",
              padding: "4px 10px", borderRadius: 2, cursor: "default", letterSpacing: "0.04em", minWidth: 28, textAlign: "center"
            }}>{r}</a>
          ))}
        </div>
        <div style={{ display: "flex", gap: 1, background: "var(--ink-100)", border: "1px solid var(--border-hair)", borderRadius: 3, padding: 2 }}>
          {modes.map(m => (
            <a key={m.id} onClick={() => setChartMode(m.id)} style={{
              fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase",
              color: chartMode === m.id ? "var(--ink-1000)" : "var(--fg-muted)",
              background: chartMode === m.id ? "var(--bg)" : "transparent",
              padding: "4px 10px", borderRadius: 2, cursor: "default"
            }}>{m.label}</a>
          ))}
        </div>
      </div>
      <a onClick={() => setOpen(o => !o)} style={{
        display: "inline-flex", alignItems: "center", gap: 8,
        fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase",
        color: open ? "var(--ink-1000)" : "var(--fg-muted)",
        background: open ? "var(--ink-100)" : "transparent",
        border: "1px solid var(--border)", padding: "5px 12px", borderRadius: 3, cursor: "default"
      }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--brand)" }} />
        Studies <span className="t-mono" style={{ fontSize: 9.5, letterSpacing: "0.04em", color: "var(--fg-hint)" }}>{onCount}</span>
        <span style={{ fontSize: 8, marginLeft: 2, color: "var(--fg-hint)" }}>{open ? "▲" : "▼"}</span>
      </a>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 30,
          width: 280, background: "var(--bg-elev-2)", border: "1px solid var(--border)", borderRadius: 4,
          boxShadow: "var(--shadow-2)", maxHeight: 360, overflow: "auto"
        }}>
          {OVERLAY_GROUPS.map(g => (
            <div key={g.group} style={{ borderBottom: "1px solid var(--border-hair)" }}>
              <div className="t-label" style={{ padding: "9px 12px 4px", fontSize: 8.5 }}>{g.group}</div>
              {g.items.map(it => {
                const on = overlays[it.key];
                return (
                  <a key={it.key} onClick={() => setOverlays(o => ({ ...o, [it.key]: !o[it.key] }))} style={{
                    display: "flex", alignItems: "center", gap: 9, padding: "6px 12px", cursor: "default",
                    background: on ? "var(--ink-100)" : "transparent",
                  }}>
                    <span style={{
                      width: 12, height: 12, border: "1px solid " + (on ? it.dot : "var(--border)"),
                      background: on ? it.dot : "transparent", borderRadius: 2, display: "inline-flex",
                      alignItems: "center", justifyContent: "center", color: "var(--bg)", fontSize: 9, lineHeight: 1
                    }}>{on ? "✓" : ""}</span>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: on ? "var(--ink-1000)" : "var(--ink-900)" }}>{it.label}</span>
                  </a>
                );
              })}
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 10 }}>
            <a onClick={() => setOverlays(Object.fromEntries(OVERLAY_GROUPS.flatMap(g => g.items).map(it => [it.key, false])))} style={{ color: "var(--fg-muted)", cursor: "default" }}>clear all</a>
            <a onClick={() => setOpen(false)} style={{ color: "var(--brand)", cursor: "default" }}>done</a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HERO CHART ──────────────────────────────────────────────────────────────

function HeroChart({ t, range, chartMode, overlays, limitPx, stopPx, side }) {
  const data = t.chart;
  const w = 1000, h = 420;
  const min = Math.min(...data) - 2;
  const max = Math.max(...data) + 2;
  const span = max - min;
  const xs = data.map((_, i) => (i / (data.length - 1)) * w);
  const ys = data.map(v => h - ((v - min) / span) * h);
  const linePath = "M " + xs.map((x, i) => `${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" L ");
  const fillPath = linePath + ` L ${w} ${h} L 0 ${h} Z`;

  // synthesize OHLC bars from the close-price series
  const candles = data.map((c, i) => {
    const prev = i === 0 ? c : data[i - 1];
    const o = prev;
    const wiggle = (Math.sin(i * 1.7) * 0.6 + Math.cos(i * 0.93) * 0.4) * (Math.abs(c - prev) + 0.6);
    const hi = Math.max(o, c) + Math.abs(wiggle);
    const lo = Math.min(o, c) - Math.abs(wiggle * 0.7);
    return { o, h: hi, l: lo, c };
  });
  const candleW = (w / data.length) * 0.65;
  const priceToY = (px) => h - ((px - min) / span) * h;

  const sma = (n) => data.map((_, i) => {
    if (i < n) return null;
    const slice = data.slice(i - n, i);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
  const sma20 = sma(8), sma50 = sma(20);
  const smaPath = (arr) => "M " + arr.map((v, i) => v == null ? null : `${xs[i].toFixed(1)} ${(h - ((v - min) / span) * h).toFixed(1)}`).filter(Boolean).join(" L ");

  const markers = [
    { x: xs[12], y: ys[12], type: "buy" },
    { x: xs[38], y: ys[38], type: "exit" },
    { x: xs[56], y: ys[56], type: "buy" },
    { x: xs[74], y: ys[74], type: "now" },
  ];

  const levels = [
    { tag: "R2", px: 138.50, kind: "r" }, { tag: "R1", px: 136.20, kind: "r" },
    { tag: "S1", px: 132.10, kind: "s" }, { tag: "S2", px: 128.40, kind: "s" },
  ];

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0, width: "100%", background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4 }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        <defs>
          <linearGradient id="goldFillT" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#c9a66b" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#c9a66b" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="heatLegendT" x1="0" x2="1">
            <stop offset="0%" stopColor="rgba(60,80,130,0.4)" />
            <stop offset="40%" stopColor="rgba(190,50,170,0.7)" />
            <stop offset="75%" stopColor="rgba(230,150,40,0.85)" />
            <stop offset="100%" stopColor="rgba(255,240,180,0.95)" />
          </linearGradient>
        </defs>

        {/* regime bands */}
        {overlays.regime && (<>
          <rect x="0" y="0" width={w * 0.22} height={h} fill="var(--regime-down)" />
          <rect x={w * 0.22} y="0" width={w * 0.56} height={h} fill="var(--regime-info)" />
          <rect x={w * 0.78} y="0" width={w * 0.22} height={h} fill="var(--regime-up)" />
        </>)}

        {/* grid */}
        <g stroke="var(--border-hair)" strokeWidth="1">
          {[0.25, 0.5, 0.75].map(p => <line key={p} x1="0" y1={h * p} x2={w} y2={h * p} />)}
        </g>

        {/* y labels */}
        {[0.05, 0.5, 0.95].map((p, i) => (
          <text key={i} x={w - 8} y={h * p + 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="var(--fg-hint)">
            {(max - p * span).toFixed(1)}
          </text>
        ))}

        {/* SMAs */}
        {overlays.sma200 && <path d={smaPath(sma(40))} fill="none" stroke="var(--ink-400)" strokeWidth="1" strokeDasharray="4 3" opacity="0.7" />}
        {overlays.sma50 && <path d={smaPath(sma50)} fill="none" stroke="var(--gold-700)" strokeWidth="1.1" strokeDasharray="3 3" opacity="0.75" />}
        {overlays.sma20 && <path d={smaPath(sma20)} fill="none" stroke="var(--ice-500)" strokeWidth="1.1" strokeDasharray="2 3" opacity="0.7" />}
        {overlays.ema9  && <path d={smaPath(sma(4))}  fill="none" stroke="var(--brand)"     strokeWidth="0.9" opacity="0.7" />}
        {overlays.ema21 && <path d={smaPath(sma(10))} fill="none" stroke="var(--gold-500)"  strokeWidth="0.9" opacity="0.7" />}

        {/* VWAP — slow-drifting line near mean */}
        {overlays.vwap && (() => {
          const meanY = priceToY(data.reduce((a, b) => a + b, 0) / data.length + 0.4);
          const vw = data.map((_, i) => {
            const win = data.slice(Math.max(0, i - 12), i + 1);
            return win.reduce((a, b) => a + b, 0) / win.length + (Math.sin(i / 6) * 0.4);
          });
          const path = "M " + vw.map((v, i) => `${xs[i].toFixed(1)} ${priceToY(v).toFixed(1)}`).join(" L ");
          return (<>
            <path d={path} fill="none" stroke="var(--gold-300)" strokeWidth="1.2" strokeDasharray="6 3" opacity="0.85" />
            <text x={w - 8} y={meanY - 4} textAnchor="end" fontFamily="var(--font-mono)" fontSize="9" fill="var(--gold-300)">VWAP</text>
          </>);
        })()}

        {/* Anchored VWAP — from t/3 mark */}
        {overlays.anchoredVwap && (() => {
          const start = Math.floor(data.length / 3);
          const seg = [];
          let sum = 0;
          for (let i = start; i < data.length; i++) {
            sum += data[i];
            seg.push({ x: xs[i], y: priceToY(sum / (i - start + 1) - 0.6) });
          }
          const path = "M " + seg.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ");
          return (<>
            <line x1={xs[start]} x2={xs[start]} y1="0" y2={h} stroke="var(--gold-700)" strokeWidth="0.6" strokeDasharray="2 4" opacity="0.6" />
            <path d={path} fill="none" stroke="var(--gold-700)" strokeWidth="1.2" />
          </>);
        })()}

        {/* Bollinger bands */}
        {overlays.bollinger && (() => {
          const n = 20;
          const upper = [], lower = [];
          for (let i = 0; i < data.length; i++) {
            const win = data.slice(Math.max(0, i - n), i + 1);
            const m = win.reduce((a, b) => a + b, 0) / win.length;
            const sd = Math.sqrt(win.reduce((a, b) => a + (b - m) ** 2, 0) / win.length);
            upper.push(m + 2 * sd); lower.push(m - 2 * sd);
          }
          const up = "M " + upper.map((v, i) => `${xs[i].toFixed(1)} ${priceToY(v).toFixed(1)}`).join(" L ");
          const dn = "M " + lower.map((v, i) => `${xs[i].toFixed(1)} ${priceToY(v).toFixed(1)}`).join(" L ");
          const fill = up + " L " + lower.slice().reverse().map((v, i) => `${xs[data.length - 1 - i].toFixed(1)} ${priceToY(v).toFixed(1)}`).join(" L ") + " Z";
          return (<>
            <path d={fill} fill="var(--tint-info-1)" />
            <path d={up} fill="none" stroke="var(--ice-500)" strokeWidth="0.8" opacity="0.7" />
            <path d={dn} fill="none" stroke="var(--ice-500)" strokeWidth="0.8" opacity="0.7" />
          </>);
        })()}

        {/* Donchian channel */}
        {overlays.donchian && (() => {
          const n = 20;
          const hi = [], lo = [];
          for (let i = 0; i < data.length; i++) {
            const win = data.slice(Math.max(0, i - n), i + 1);
            hi.push(Math.max(...win) + 0.6); lo.push(Math.min(...win) - 0.6);
          }
          const hp = "M " + hi.map((v, i) => `${xs[i].toFixed(1)} ${priceToY(v).toFixed(1)}`).join(" L ");
          const lp = "M " + lo.map((v, i) => `${xs[i].toFixed(1)} ${priceToY(v).toFixed(1)}`).join(" L ");
          return (<>
            <path d={hp} fill="none" stroke="var(--ink-400)" strokeWidth="0.7" strokeDasharray="1 3" opacity="0.6" />
            <path d={lp} fill="none" stroke="var(--ink-400)" strokeWidth="0.7" strokeDasharray="1 3" opacity="0.6" />
          </>);
        })()}

        {/* Volume profile — right edge histogram */}
        {overlays.volProfile && (() => {
          const buckets = 16;
          const counts = Array(buckets).fill(0);
          data.forEach(v => {
            const idx = Math.min(buckets - 1, Math.max(0, Math.floor(((v - min) / span) * buckets)));
            counts[idx] += 1;
          });
          const maxC = Math.max(...counts);
          const slot = h / buckets;
          return (
            <g>
              {counts.map((c, i) => (
                <rect key={i} x={w - (c / maxC) * 80 - 26} y={h - (i + 1) * slot} width={(c / maxC) * 80} height={slot - 0.6} fill="var(--tint-brand-2)" />
              ))}
            </g>
          );
        })()}

        {/* avg cost line */}
        {overlays.avgPrice && (() => {
          const avg = 128.40;
          if (avg < min || avg > max) return null;
          const y = priceToY(avg);
          return (
            <g>
              <line x1="0" x2={w - 30} y1={y} y2={y} stroke="var(--brand)" strokeWidth="0.8" strokeDasharray="6 3" opacity="0.85" />
              <text x="6" y={y - 3} fontFamily="var(--font-mono)" fontSize="9" fill="var(--brand)">avg cost · 128.40</text>
            </g>
          );
        })()}

        {/* earnings markers */}
        {overlays.earnings && (() => {
          const x = xs[Math.floor(xs.length * 0.42)];
          return (
            <g>
              <line x1={x} x2={x} y1="0" y2={h} stroke="var(--gold-500)" strokeWidth="0.6" strokeDasharray="3 3" opacity="0.7" />
              <rect x={x - 14} y={6} width="28" height="11" rx="1" fill="var(--pill-bg)" stroke="var(--gold-500)" strokeWidth="0.5" />
              <text x={x} y={14} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing="0.08em" fill="var(--gold-500)">EARN</text>
            </g>
          );
        })()}

        {/* support / resistance */}
        {overlays.levels && levels.map((lv, i) => {
          if (lv.px < min || lv.px > max) return null;
          const y = h - ((lv.px - min) / span) * h;
          const stroke = lv.kind === "r" ? "var(--tint-down-3)" : "var(--tint-up-3)";
          const text   = lv.kind === "r" ? "var(--down-500)" : "rgba(168,208,77,0.75)";
          const xEnd = w - 56;
          return (
            <g key={i}>
              <line x1="0" y1={y} x2={xEnd} y2={y} stroke={stroke} strokeWidth="0.7" strokeDasharray="1 4" />
              <rect x="6" y={y - 7} width="22" height="11" rx="1.5" fill="var(--pill-bg)" stroke={stroke} strokeWidth="0.5" />
              <text x="17" y={y + 1.5} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="7.5" letterSpacing="0.08em" fill={text}>{lv.tag}</text>
              <text x={xEnd - 4} y={y - 3} textAnchor="end" fontFamily="var(--font-mono)" fontSize="9" fill={text}>{lv.px.toFixed(2)}</text>
            </g>
          );
        })}

        {/* order book HEATMAP — only on 1D */}
        {range === "1D" && (() => {
          const last = data[data.length - 1];
          const tick = 0.10, priceLevels = 28, timeSlots = 60;
          const wallPrices = [128.40, 132.10, 134.10, 136.20, 138.50];
          const cellW = w / timeSlots, cellH = h / priceLevels;
          const cells = [];
          for (let ti = 0; ti < timeSlots; ti++) {
            for (let pi = 0; pi < priceLevels; pi++) {
              const offset = pi - priceLevels / 2;
              const px = +(last + offset * tick).toFixed(2);
              if (px < min || px > max) continue;
              let v = Math.max(0, 0.18 - Math.abs(offset) / priceLevels);
              wallPrices.forEach(wp => {
                const d = Math.abs(px - wp);
                if (d < 0.25) {
                  const wallStrength = (1 - d / 0.25) * 0.95;
                  const tf = wp === 134.10 ? 0.4 + (ti / timeSlots) * 0.6
                          : wp === 136.20 ? 1 - (ti / timeSlots) * 0.5
                          : 0.7 + Math.sin((ti / timeSlots) * 6 + wp) * 0.2;
                  v = Math.max(v, wallStrength * tf);
                }
              });
              const noise = Math.sin(ti * 0.7 + pi * 1.3) * 0.5 + Math.cos(ti * 0.31 + pi * 0.41) * 0.3;
              if (noise > 0.55) v = Math.max(v, (noise - 0.55) * 1.4);
              if (v < 0.05) continue;
              cells.push({ ti, pi, px, v: Math.min(1, v) });
            }
          }
          const priceToY = (px) => h - ((px - min) / span) * h;
          return (
            <g>
              {cells.map((c, i) => {
                const x = c.ti * cellW;
                const y = priceToY(c.px) - cellH / 2;
                const v = c.v;
                let fill;
                if (v < 0.30) fill = `rgba(60, 80, 130, ${0.12 + v * 0.6})`;
                else if (v < 0.55) { const tt = (v - 0.30) / 0.25; fill = `rgba(${60 + tt * 130}, ${80 - tt * 30}, ${130 + tt * 40}, ${0.45 + tt * 0.2})`; }
                else if (v < 0.80) { const tt = (v - 0.55) / 0.25; fill = `rgba(${190 + tt * 40}, ${50 + tt * 100}, ${170 - tt * 130}, ${0.65 + tt * 0.15})`; }
                else { const tt = (v - 0.80) / 0.20; fill = `rgba(${230 + tt * 25}, ${150 + tt * 90}, ${40 + tt * 100}, ${0.80 + tt * 0.18})`; }
                return <rect key={i} x={x} y={y} width={cellW + 0.5} height={cellH + 0.5} fill={fill} />;
              })}
              <g>
                <rect x={w - 162} y="8" width="154" height="16" rx="2" fill="var(--pill-bg)" stroke="var(--border-hair)" strokeWidth="0.5" />
                <text x={w - 155} y="19" fontFamily="var(--font-ui)" fontSize="7" letterSpacing="0.18em" fill="var(--fg-hint)">LIQUIDITY HEATMAP · L2</text>
                <rect x={w - 60} y="12" width="48" height="8" fill="url(#heatLegendT)" />
              </g>
            </g>
          );
        })()}

        {/* limit / stop guides */}
        {[
          { px: limitPx, label: `${side} limit · ${limitPx.toFixed(2)}`, color: side === "buy" ? "var(--up-500)" : "var(--down-500)" },
          { px: stopPx,  label: `stop · ${stopPx.toFixed(2)}`,           color: "var(--down-500)" },
        ].filter(g => g.px >= min && g.px <= max).map((g, i) => {
          const y = h - ((g.px - min) / span) * h;
          return (
            <g key={i}>
              <line x1="0" y1={y} x2={w - 60} y2={y} stroke={g.color} strokeWidth="0.9" strokeDasharray="3 3" opacity="0.85" />
              <text x="6" y={y - 3} fontFamily="var(--font-mono)" fontSize="9" fill={g.color}>{g.label}</text>
            </g>
          );
        })}

        {/* price — line or candles */}
        {chartMode === "line" ? (<>
          <path d={fillPath} fill="url(#goldFillT)" />
          <path d={linePath} fill="none" stroke="var(--gold-300)" strokeWidth="1.5" strokeLinejoin="round" />
        </>) : (
          <g>
            {candles.map((cd, i) => {
              const up = cd.c >= cd.o;
              const color = up ? "var(--up-500)" : "var(--down-500)";
              const cx = xs[i];
              return (
                <g key={i}>
                  <line x1={cx} x2={cx} y1={priceToY(cd.h)} y2={priceToY(cd.l)} stroke={color} strokeWidth="0.7" opacity="0.85" />
                  <rect x={cx - candleW / 2} y={priceToY(Math.max(cd.o, cd.c))} width={candleW} height={Math.max(0.6, Math.abs(priceToY(cd.o) - priceToY(cd.c)))} fill={up ? color : "transparent"} stroke={color} strokeWidth="0.7" />
                </g>
              );
            })}
          </g>
        )}

        {/* signals */}
        {overlays.signals && markers.map((m, i) => (
          <g key={i}>
            {m.type === "buy" && <circle cx={m.x} cy={m.y} r="6" fill="none" stroke="var(--up-500)" strokeWidth="1.6" />}
            {m.type === "exit" && <rect x={m.x - 5} y={m.y - 5} width="10" height="10" fill="none" stroke="var(--down-500)" strokeWidth="1.6" />}
            {m.type === "now" && (<>
              <line x1={m.x} y1="0" x2={m.x} y2={h} stroke="var(--gold-300)" strokeDasharray="2 3" strokeWidth="0.8" />
              <circle cx={m.x} cy={m.y} r="5" fill="var(--gold-300)" stroke="var(--ink-050)" strokeWidth="2" />
            </>)}
          </g>
        ))}
      </svg>

      <div style={{ position: "absolute", top: 10, left: 14, display: "flex", gap: 14, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>
        <span>O <span style={{ color: "var(--ink-1000)" }}>132.86</span></span>
        <span>H <span style={{ color: "var(--ink-1000)" }}>135.44</span></span>
        <span>L <span style={{ color: "var(--ink-1000)" }}>132.10</span></span>
        <span>C <span style={{ color: "var(--up-500)" }}>134.82</span></span>
        <span>V <span style={{ color: "var(--ink-1000)" }}>28.4M</span></span>
      </div>
    </div>
  );
}

// ─── volume rail (under chart) ───────────────────────────────────────────────

function VolumeRail({ t }) {
  const data = t.chart;
  return (
    <div style={{ height: 56, position: "relative", flex: "0 0 auto" }}>
      <div className="t-label" style={{ position: "absolute", top: 4, left: 4, fontSize: 8.5, zIndex: 1 }}>Volume</div>
      <svg viewBox="0 0 1000 56" preserveAspectRatio="none" style={{ width: "100%", height: "100%", display: "block" }}>
        {data.map((_, i) => {
          const vol = 28 + Math.sin(i / 5) * 14 + Math.abs(Math.sin(i * 1.3)) * 8;
          const bh = vol / 50 * 56;
          const up = i % 3 !== 0;
          return <rect key={i} x={i * (1000 / data.length)} y={56 - bh} width={1000 / data.length - 1} height={bh} fill={up ? "var(--up-500)" : "var(--down-500)"} opacity={i > 70 ? 0.7 : 0.45} />;
        })}
      </svg>
    </div>
  );
}

// ─── asset tabs ──────────────────────────────────────────────────────────────

function AssetTabs({ asset, setAsset }) {
  const tabs = [
    { id: "stock",   label: "Stocks" },
    { id: "option",  label: "Options" },
    { id: "builder", label: "Options builder" },
  ];
  return (
    <div>
      <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)", letterSpacing: "-0.02em", lineHeight: 1, marginBottom: 12 }}>Stage order</div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${tabs.length}, 1fr)`, borderBottom: "1px solid var(--border)" }}>
        {tabs.map(tab => {
          const on = asset === tab.id;
          return (
            <a key={tab.id} onClick={() => setAsset(tab.id)} style={{
              textAlign: "center", padding: "9px 6px",
              fontFamily: "var(--font-ui)", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase",
              color: on ? "var(--ink-1000)" : "var(--fg-muted)",
              borderBottom: on ? "2px solid var(--brand)" : "2px solid transparent", marginBottom: -1,
              background: on ? "var(--bg-elev-2)" : "transparent", cursor: "default"
            }}>{tab.label}</a>
          );
        })}
      </div>
    </div>
  );
}

// ─── options builder — multi-strategy ────────────────────────────────────────

const BUILDER_STRATEGIES = [
  { id: "vertical-call",  group: "Verticals",  label: "Bull call spread",   legs: ["Buy call lower K", "Sell call higher K"], outlook: "bullish · capped", credit: false },
  { id: "vertical-put",   group: "Verticals",  label: "Bear put spread",    legs: ["Buy put higher K", "Sell put lower K"],   outlook: "bearish · capped", credit: false },
  { id: "iron-condor",    group: "Neutral",    label: "Iron condor",        legs: ["Sell put + buy lower put", "Sell call + buy higher call"], outlook: "range-bound · credit", credit: true },
  { id: "iron-butterfly", group: "Neutral",    label: "Iron butterfly",     legs: ["Sell ATM call + put", "Buy wings on each side"], outlook: "pinned · credit", credit: true },
  { id: "calendar",       group: "Time",       label: "Calendar spread",    legs: ["Sell near-dated", "Buy far-dated · same K"], outlook: "low IV near, high IV far", credit: false },
  { id: "diagonal",       group: "Time",       label: "Diagonal spread",    legs: ["Sell near · K1", "Buy far · K2"], outlook: "directional + theta", credit: false },
  { id: "straddle",       group: "Volatility", label: "Long straddle",      legs: ["Buy ATM call", "Buy ATM put"], outlook: "big move · either side", credit: false },
  { id: "strangle",       group: "Volatility", label: "Short strangle",     legs: ["Sell OTM call", "Sell OTM put"], outlook: "range-bound · credit", credit: true },
  { id: "covered-call",   group: "Income",     label: "Covered call",       legs: ["Long 100 sh", "Sell call OTM"], outlook: "income · capped upside", credit: true },
  { id: "csp",            group: "Income",     label: "Cash-secured put",   legs: ["Sell put · cash collateral"], outlook: "willing buyer at K", credit: true },
];

function OptionBuilder({ strategy, setStrategy }) {
  const sel = BUILDER_STRATEGIES.find(s => s.id === strategy) || BUILDER_STRATEGIES[0];
  const groups = [...new Set(BUILDER_STRATEGIES.map(s => s.group))];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* strategy picker */}
      <div>
        <div className="t-label" style={{ marginBottom: 8 }}>Strategy</div>
        <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 4, display: "flex", flexDirection: "column", gap: 2, maxHeight: 220, overflow: "auto" }}>
          {groups.map(g => (
            <div key={g}>
              <div style={{ padding: "5px 8px 3px", fontFamily: "var(--font-ui)", fontSize: 8.5, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--fg-hint)" }}>{g}</div>
              {BUILDER_STRATEGIES.filter(s => s.group === g).map(s => (
                <a key={s.id} onClick={() => setStrategy(s.id)} style={{
                  display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8,
                  padding: "6px 8px", borderRadius: 2,
                  background: strategy === s.id ? "var(--bg-elev-2)" : "transparent",
                  borderLeft: "2px solid " + (strategy === s.id ? "var(--brand)" : "transparent"),
                  cursor: "default"
                }}>
                  <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: strategy === s.id ? "var(--ink-1000)" : "var(--ink-900)" }}>{s.label}</span>
                  <span className="t-mono" style={{ fontSize: 9.5, color: s.credit ? "var(--up-500)" : "var(--gold-300)" }}>{s.credit ? "credit" : "debit"}</span>
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* selected strategy detail */}
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4 }}>
        <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid var(--border-hair)" }}>
          <div className="t-label" style={{ fontSize: 8.5 }}>{sel.group} · {sel.outlook}</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--ink-1000)", letterSpacing: "-0.02em", marginTop: 2 }}>{sel.label}</div>
        </div>
        {/* legs */}
        <div style={{ padding: "8px 12px" }}>
          <div className="t-label" style={{ fontSize: 8.5, marginBottom: 6 }}>Legs</div>
          {sel.legs.map((leg, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 8, padding: "5px 0", borderBottom: i < sel.legs.length - 1 ? "1px solid var(--border-hair)" : "0", alignItems: "center" }}>
              <span className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)", width: 14 }}>L{i + 1}</span>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--ink-900)" }}>{leg}</span>
              <a style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--brand)", letterSpacing: "0.06em", cursor: "default" }}>edit ›</a>
            </div>
          ))}
        </div>
        {/* economics */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: "1px solid var(--border-hair)" }}>
          {[
            { k: "Net " + (sel.credit ? "credit" : "debit"), v: sel.credit ? "+1.42" : "−2.18", tone: sel.credit ? "up" : "down" },
            { k: "Max profit", v: sel.credit ? "$142" : "$282", tone: "up" },
            { k: "Max loss",   v: sel.credit ? "−$358" : "−$218", tone: "down" },
          ].map((cell, i) => (
            <div key={i} style={{ padding: "9px 10px", borderRight: i < 2 ? "1px solid var(--border-hair)" : "0", display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="t-label" style={{ fontSize: 8.5 }}>{cell.k}</span>
              <span className={cell.tone === "up" ? "u-profit" : "u-loss"} style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{cell.v}</span>
            </div>
          ))}
        </div>
        {/* breakevens + POP */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid var(--border-hair)" }}>
          <div style={{ padding: "8px 10px", borderRight: "1px solid var(--border-hair)" }}>
            <div className="t-label" style={{ fontSize: 8.5 }}>Breakeven</div>
            <div className="t-mono" style={{ fontSize: 12, color: "var(--ink-1000)", marginTop: 2 }}>$133.42 · $141.58</div>
          </div>
          <div style={{ padding: "8px 10px" }}>
            <div className="t-label" style={{ fontSize: 8.5 }}>Prob of profit</div>
            <div className="t-mono" style={{ fontSize: 12, color: "var(--ice-500)", marginTop: 2 }}>62%</div>
          </div>
        </div>
      </div>

      <PayoffPanel />
      <GreeksStrip />
    </div>
  );
}

// ─── ORDER TICKET (stock) ─────────────────────────────────────────────────────

function OrderTicket(p) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
        <button onClick={() => p.setSide("buy")}  style={tradeBtnStyle("buy",  p.side === "buy")}>Buy</button>
        <button onClick={() => p.setSide("sell")} style={tradeBtnStyle("sell", p.side === "sell")}>Sell</button>
      </div>
      <Field label="Quantity">
        <input value={p.qty} onChange={(e) => p.setQty(+e.target.value || 0)} style={inputStyle} />
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)", marginLeft: 8, alignSelf: "center" }}>≈ {fmtMoney(p.notional, { dec: 0 })}</span>
      </Field>
      <Field label="Order type">
        <div style={{ display: "flex", gap: 4, flex: 1 }}>
          {["market", "limit", "stop"].map(tp => (
            <button key={tp} onClick={() => p.setOrderType(tp)} style={{
              flex: 1, fontFamily: "var(--font-ui)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase",
              color: p.orderType === tp ? "var(--ink-1000)" : "var(--fg-muted)",
              background: p.orderType === tp ? "var(--bg-elev-2)" : "transparent",
              border: "1px solid var(--border)", padding: "7px 0", borderRadius: 3, cursor: "default"
            }}>{tp}</button>
          ))}
        </div>
      </Field>
      {p.orderType === "limit" && (
        <Field label="Limit price">
          <input value={p.limitPx.toFixed(2)} onChange={(e) => p.setLimitPx(+e.target.value || 0)} style={inputStyle} />
        </Field>
      )}
      <Field label="Stop loss · % of entry">
        <input value={p.stopPct.toFixed(1)} onChange={(e) => p.setStopPct(+e.target.value || 0)} style={inputStyle} />
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)", marginLeft: 8, alignSelf: "center" }}>≈ {p.stopPx.toFixed(2)}</span>
      </Field>
      <div style={{ marginTop: 12, padding: "12px 12px", background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4 }}>
        <div className="t-label" style={{ marginBottom: 8 }}>Position sizer</div>
        <input type="range" min="50" max="600" step="25" value={p.qty} onChange={(e) => p.setQty(+e.target.value)} style={{ width: "100%", accentColor: "var(--gold-500)" }} />
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)", marginTop: 4 }}>
          <span>50</span><span>600 sh</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, marginTop: 8 }}>
          {[100, 250, 500].map(n => (
            <button key={n} onClick={() => p.setQty(n)} style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "5px 0", color: "var(--fg-muted)", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 2, cursor: "default" }}>{n}</button>
          ))}
          <button onClick={() => p.setQty(Math.max(1, Math.floor(MOCK_PORTFOLIO.equity * 0.005 / Math.max(0.01, p.limitPx - p.stopPx))))} style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "5px 0", color: "var(--brand)", background: "var(--brand-tint)", border: "1px solid rgba(201,166,107,0.35)", borderRadius: 2, cursor: "default" }}>0.5% R</button>
        </div>
      </div>
      <RiskPreviewCard notional={p.notional} riskDollars={p.riskDollars} riskPct={p.riskPct} stopPx={p.stopPx} />
    </div>
  );
}

// ─── shared risk preview ─────────────────────────────────────────────────────

function RiskPreviewCard({ notional, riskDollars, riskPct, stopPx, isOption }) {
  return (
    <div style={{ marginTop: 12, padding: "12px 12px", background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4 }}>
      <div className="t-label" style={{ marginBottom: 10 }}>Risk preview</div>
      <RiskRow label="Notional" v={fmtMoney(notional, { dec: 0 })} />
      <RiskRow label="Risk · $" v={fmtMoney(riskDollars, { dec: 0 })} tone="down" />
      <RiskRow label="Risk · % equity" v={fmtPct(riskPct, 2)} tone={riskPct > 1 ? "down" : "up"} />
      {!isOption && <RiskRow label="Stop · price" v={"$" + stopPx.toFixed(2)} />}
      <RiskRow label="Reward target" v="+8.0%" tone="up" />
      <RiskRow label="R:R" v="2.0×" />
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-hair)", display: "flex", flexDirection: "column", gap: 5 }}>
        <Check ok label="Risk under 1% account cap" />
        <Check ok label="Regime fit · 0.82 (bull / low-vol)" />
        <Check ok label="Sector exposure · semis 18% → 19% (cap 25%)" />
        <Check warn label="Earnings inside hold window (14d)" />
      </div>
    </div>
  );
}
function RiskRow({ label, v, tone }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontFamily: "var(--font-mono)", fontSize: 12 }}>
      <span style={{ color: "var(--fg-muted)" }}>{label}</span>
      <span className={tone === "up" ? "u-profit" : tone === "down" ? "u-loss" : ""} style={{ color: tone ? undefined : "var(--ink-1000)" }}>{v}</span>
    </div>
  );
}
function Check({ ok, warn, label }) {
  const color = ok ? "var(--up-500)" : warn ? "var(--amber-500)" : "var(--down-500)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--fg-dim)" }}>
      <span style={{ width: 14, height: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", color }}>{ok ? "✓" : warn ? "!" : "×"}</span>
      <span>{label}</span>
    </div>
  );
}

// ─── option chain ────────────────────────────────────────────────────────────

function OptionChainPanel({ optStrike, setOptStrike, optType, setOptType, setLimitPx }) {
  const [expiry, setExpiry] = useState("Nov 21");
  const expiries = ["Nov 21 · 14d", "Dec 19 · 42d", "Jan 16 · 70d"];
  const spot = 134.82;
  // strikes around spot
  const strikes = [125, 130, 132, 134, 135, 137, 140, 142, 145, 150];
  // synthesized chain rows
  const rows = strikes.map(k => {
    const callItm = spot > k;
    const putItm  = spot < k;
    const callMid = Math.max(0.05, spot - k + 4 + (k % 5 === 0 ? 0.6 : 0)).toFixed(2);
    const putMid  = Math.max(0.05, k - spot + 4 + (k % 5 === 0 ? 0.6 : 0)).toFixed(2);
    const callDelta = Math.max(0.02, Math.min(0.98, 0.5 + (spot - k) * 0.06)).toFixed(2);
    const putDelta  = (-(1 - +callDelta)).toFixed(2);
    const iv = (38 + Math.abs(k - spot) * 0.4).toFixed(1);
    const oi = Math.round(800 + Math.abs(k - 135) * 240 + (k % 5 === 0 ? 1200 : 0));
    return { k, callItm, putItm, callMid, putMid, callDelta, putDelta, iv, oi };
  });
  const selectRow = (k, side) => {
    setOptStrike(k);
    setOptType(side);
    setLimitPx(+(side === "call"
      ? Math.max(0.05, spot - k + 4 + (k % 5 === 0 ? 0.6 : 0))
      : Math.max(0.05, k - spot + 4 + (k % 5 === 0 ? 0.6 : 0))).toFixed(2));
  };
  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "10px 12px 8px", borderBottom: "1px solid var(--border-hair)" }}>
        <span className="t-label">Option chain</span>
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} style={{ background: "var(--ink-100)", border: "1px solid var(--border-hair)", color: "var(--ink-1000)", fontFamily: "var(--font-mono)", fontSize: 10.5, padding: "2px 6px", borderRadius: 2, outline: "none" }}>
          {expiries.map(x => <option key={x}>{x}</option>)}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 0.7fr 1fr 1fr 1fr", padding: "5px 10px", fontFamily: "var(--font-ui)", fontSize: 8.5, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--fg-hint)", borderBottom: "1px solid var(--border-hair)" }}>
        <span>Δ</span><span style={{ textAlign: "right" }}>Mid</span><span style={{ textAlign: "right" }}>OI</span>
        <span style={{ textAlign: "center" }}>K</span>
        <span>OI</span><span style={{ textAlign: "right" }}>Mid</span><span style={{ textAlign: "right" }}>Δ</span>
      </div>
      <div style={{ maxHeight: 220, overflow: "auto" }}>
        {rows.map(r => {
          const callSel = optStrike === r.k && optType === "call";
          const putSel  = optStrike === r.k && optType === "put";
          const atTheMoney = Math.abs(r.k - spot) < 1;
          return (
            <div key={r.k} style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr 0.7fr 1fr 1fr 1fr",
              padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 11, alignItems: "center",
              borderBottom: "1px solid var(--border-hair)",
              background: atTheMoney ? "var(--ink-100)" : "transparent",
            }}>
              {/* CALL side */}
              <a onClick={() => selectRow(r.k, "call")} style={{ color: r.callItm ? "var(--up-500)" : "var(--fg-dim)", cursor: "default", padding: "2px 0", background: callSel ? "var(--tint-up-2)" : "transparent", paddingLeft: callSel ? 4 : 0 }}>{r.callDelta}</a>
              <a onClick={() => selectRow(r.k, "call")} style={{ color: "var(--ink-1000)", textAlign: "right", cursor: "default", background: callSel ? "var(--tint-up-2)" : "transparent" }}>{r.callMid}</a>
              <a onClick={() => selectRow(r.k, "call")} style={{ color: "var(--fg-hint)", textAlign: "right", cursor: "default", background: callSel ? "var(--tint-up-2)" : "transparent", paddingRight: callSel ? 4 : 0 }}>{r.oi >= 1000 ? (r.oi / 1000).toFixed(1) + "k" : r.oi}</a>
              {/* strike */}
              <span style={{ textAlign: "center", color: atTheMoney ? "var(--gold-300)" : "var(--ink-900)", fontWeight: atTheMoney ? 600 : 400 }}>{r.k}</span>
              {/* PUT side */}
              <a onClick={() => selectRow(r.k, "put")} style={{ color: "var(--fg-hint)", cursor: "default", paddingLeft: putSel ? 4 : 0, background: putSel ? "var(--tint-down-2)" : "transparent" }}>{r.oi >= 1000 ? (r.oi / 1000).toFixed(1) + "k" : r.oi}</a>
              <a onClick={() => selectRow(r.k, "put")} style={{ color: "var(--ink-1000)", textAlign: "right", cursor: "default", background: putSel ? "var(--tint-down-2)" : "transparent" }}>{r.putMid}</a>
              <a onClick={() => selectRow(r.k, "put")} style={{ color: r.putItm ? "var(--down-500)" : "var(--fg-dim)", textAlign: "right", cursor: "default", background: putSel ? "var(--tint-down-2)" : "transparent", paddingRight: putSel ? 4 : 0 }}>{r.putDelta}</a>
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 0.7fr 1fr", padding: "6px 10px", fontFamily: "var(--font-ui)", fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--fg-hint)", borderTop: "1px solid var(--border-hair)" }}>
        <span style={{ color: "var(--up-500)" }}>Calls</span>
        <span style={{ textAlign: "center", color: "var(--fg-muted)", fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: 0, textTransform: "none" }}>spot {spot.toFixed(2)}</span>
        <span style={{ textAlign: "right", color: "var(--down-500)" }}>Puts</span>
      </div>
    </div>
  );
}

// ─── option single-leg form ──────────────────────────────────────────────────

function OptionForm(p) {
  const expiries = ["Nov 21 · 14d", "Dec 19 · 42d", "Jan 16 · 70d"];
  const [expiry, setExpiry] = useState(expiries[0]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 10 }}>
        <button onClick={() => p.setSide("buy")}  style={tradeBtnStyle("buy",  p.side === "buy")}>Buy<br /><span style={{ fontSize: 8, opacity: 0.7 }}>to open</span></button>
        <button onClick={() => p.setSide("sell")} style={tradeBtnStyle("sell", p.side === "sell")}>Sell<br /><span style={{ fontSize: 8, opacity: 0.7 }}>to open</span></button>
      </div>
      <Field label="Expiry">
        <select value={expiry} onChange={(e) => setExpiry(e.target.value)} style={inputStyle}>
          {expiries.map(x => <option key={x}>{x}</option>)}
        </select>
      </Field>
      <Field label="Strike · type">
        <input value={"$" + p.optStrike} onChange={(e) => p.setOptStrike(+e.target.value.replace(/\D/g, "") || 0)} style={{ ...inputStyle, flex: 1 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, marginLeft: 6, flex: 1 }}>
          <button onClick={() => p.setOptType("call")} style={optTypeBtn(p.optType === "call")}>Call</button>
          <button onClick={() => p.setOptType("put")}  style={optTypeBtn(p.optType === "put")}>Put</button>
        </div>
      </Field>
      <Field label="Contracts">
        <input value={p.contracts} onChange={(e) => p.setContracts(+e.target.value || 0)} style={inputStyle} />
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)", marginLeft: 8, alignSelf: "center" }}>mid 2.84 · IV 41%</span>
      </Field>
      <Field label="Order · limit">
        <select value={p.orderType} onChange={(e) => p.setOrderType(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
          <option value="market">Market</option><option value="limit">Limit</option>
        </select>
        <input value={p.limitPx.toFixed(2)} onChange={(e) => p.setLimitPx(+e.target.value || 0)} style={{ ...inputStyle, flex: 1, marginLeft: 6 }} />
      </Field>
    </div>
  );
}
const optTypeBtn = (on) => ({
  height: 36, fontFamily: "var(--font-ui)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase",
  color: on ? "var(--ink-1000)" : "var(--fg-muted)",
  background: on ? "var(--bg-elev-2)" : "transparent",
  border: "1px solid var(--border)", borderRadius: 3, cursor: "default"
});

// ─── L2 + tape (unchanged) ───────────────────────────────────────────────────

// ─── options order book ──────────────────────────────────────────────────────

function OptionsOrderBookPanel() {
  const [tab, setTab] = useState("calls");
  const expiry = "Nov 21 · 14d";
  // synth book around ATM strikes
  const callRows = [
    { k: 130, bid: 5.45, ask: 5.55, bidSz: 142, askSz: 88,  vol: 4210, oi: 18400, iv: 38.4 },
    { k: 132, bid: 3.95, ask: 4.05, bidSz: 96,  askSz: 124, vol: 6840, oi: 12300, iv: 39.1 },
    { k: 134, bid: 2.78, ask: 2.86, bidSz: 215, askSz: 188, vol: 11240, oi: 22800, iv: 40.2 },
    { k: 135, bid: 2.32, ask: 2.40, bidSz: 320, askSz: 260, vol: 18420, oi: 31200, iv: 40.8 },
    { k: 137, bid: 1.48, ask: 1.55, bidSz: 188, askSz: 232, vol: 9820, oi: 16400, iv: 41.6 },
    { k: 140, bid: 0.78, ask: 0.84, bidSz: 412, askSz: 528, vol: 24210, oi: 42800, iv: 42.4 },
    { k: 142, bid: 0.42, ask: 0.46, bidSz: 124, askSz: 96,  vol: 6840, oi: 11200, iv: 43.1 },
    { k: 145, bid: 0.18, ask: 0.22, bidSz: 88,  askSz: 64,  vol: 3210, oi: 7400,  iv: 44.8 },
  ];
  const putRows = [
    { k: 125, bid: 0.12, ask: 0.16, bidSz: 64,  askSz: 88,  vol: 1840, oi: 4200,  iv: 44.2 },
    { k: 128, bid: 0.32, ask: 0.38, bidSz: 96,  askSz: 124, vol: 4210, oi: 8600,  iv: 42.8 },
    { k: 130, bid: 0.62, ask: 0.68, bidSz: 188, askSz: 232, vol: 8420, oi: 14800, iv: 41.6 },
    { k: 132, bid: 1.18, ask: 1.24, bidSz: 320, askSz: 260, vol: 12240, oi: 21400, iv: 40.4 },
    { k: 134, bid: 1.92, ask: 2.00, bidSz: 412, askSz: 528, vol: 18820, oi: 36400, iv: 40.0 },
    { k: 135, bid: 2.42, ask: 2.50, bidSz: 215, askSz: 188, vol: 9420, oi: 18800, iv: 39.6 },
    { k: 137, bid: 3.62, ask: 3.72, bidSz: 142, askSz: 88,  vol: 4840, oi: 9200,  iv: 39.2 },
    { k: 140, bid: 5.78, ask: 5.92, bidSz: 96,  askSz: 124, vol: 2210, oi: 5400,  iv: 38.8 },
  ];
  const rows = tab === "calls" ? callRows : putRows;
  const maxSz = Math.max(...rows.flatMap(r => [r.bidSz, r.askSz]));
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "10px 12px 8px" }}>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-1000)", lineHeight: 1 }}>NVDA options</div>
        <div className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)", marginTop: 3 }}>{expiry}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", padding: "0 8px", gap: 4, marginBottom: 6 }}>
        {[{ id: "calls", l: "Calls", c: "var(--up-500)" }, { id: "puts", l: "Puts", c: "var(--down-500)" }].map(t2 => (
          <a key={t2.id} onClick={() => setTab(t2.id)} style={{
            textAlign: "center", padding: "6px 0", cursor: "default",
            fontFamily: "var(--font-ui)", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase",
            color: tab === t2.id ? t2.c : "var(--fg-muted)",
            border: "1px solid " + (tab === t2.id ? t2.c : "var(--border-hair)"),
            background: tab === t2.id ? (t2.id === "calls" ? "var(--tint-up-1)" : "var(--tint-down-1)") : "transparent",
            borderRadius: 2,
          }}>{t2.l}</a>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 0.7fr 0.9fr 0.9fr 0.7fr", padding: "5px 10px", fontFamily: "var(--font-ui)", fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg-hint)", borderBottom: "1px solid var(--border-hair)" }}>
        <span>K</span><span style={{ textAlign: "right" }}>BidSz</span><span style={{ textAlign: "right" }}>Bid×Ask</span><span style={{ textAlign: "right" }}>AskSz</span><span style={{ textAlign: "right" }}>IV</span>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {rows.map((r, i) => {
          const atm = Math.abs(r.k - 134.82) < 1;
          return (
            <div key={i} style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr 0.7fr 0.9fr 0.9fr 0.7fr", padding: "4px 10px", fontFamily: "var(--font-mono)", fontSize: 10.5, alignItems: "center", borderBottom: "1px solid var(--border-hair)", background: atm ? "var(--tint-brand-1)" : "transparent" }}>
              <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${(r.bidSz / maxSz) * 32}%`, background: "var(--tint-up-1)" }} />
              <span style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${(r.askSz / maxSz) * 32}%`, background: "var(--tint-down-1)" }} />
              <span style={{ position: "relative", color: atm ? "var(--gold-300)" : "var(--ink-1000)", fontWeight: atm ? 600 : 400 }}>{r.k}</span>
              <span style={{ position: "relative", color: "var(--up-500)", textAlign: "right" }}>{r.bidSz}</span>
              <span style={{ position: "relative", color: "var(--ink-900)", textAlign: "right" }}>{r.bid.toFixed(2)} <span style={{ color: "var(--fg-hint)" }}>·</span> {r.ask.toFixed(2)}</span>
              <span style={{ position: "relative", color: "var(--down-500)", textAlign: "right" }}>{r.askSz}</span>
              <span style={{ position: "relative", color: "var(--fg-muted)", textAlign: "right" }}>{r.iv.toFixed(1)}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderTop: "1px solid var(--border-hair)", padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 10.5 }}>
        <span style={{ color: "var(--fg-muted)" }}>Total Vol <span style={{ color: "var(--ink-1000)" }}>{rows.reduce((a, r) => a + r.vol, 0).toLocaleString()}</span></span>
        <span style={{ color: "var(--fg-muted)", textAlign: "right" }}>OI <span style={{ color: "var(--ink-1000)" }}>{(rows.reduce((a, r) => a + r.oi, 0) / 1000).toFixed(0)}k</span></span>
      </div>
    </div>
  );
}

function OrderBookPanel({ last }) {
  const asks = [
    { px: 134.91, sz: 3200 }, { px: 134.89, sz: 5800 }, { px: 134.87, sz: 4300 },
    { px: 134.86, sz: 8200 }, { px: 134.85, sz: 6840 }, { px: 134.84, sz: 11200 }, { px: 134.83, sz: 9820 },
  ];
  const bids = [
    { px: 134.81, sz: 12400 }, { px: 134.80, sz: 8300 }, { px: 134.79, sz: 6200 },
    { px: 134.78, sz: 9400 }, { px: 134.76, sz: 4800 }, { px: 134.74, sz: 7100 }, { px: 134.72, sz: 3700 },
  ];
  const maxSz = Math.max(...asks.map(a => a.sz), ...bids.map(b => b.sz));
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "14px 14px 8px" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: "var(--ink-1000)", fontWeight: 400 }}>Order book</h3>
        <span className="t-label" style={{ fontSize: 8.5 }}>L2</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 1, padding: "0 10px 4px", fontFamily: "var(--font-ui)", fontSize: 8, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--fg-hint)" }}>
        <span>Bid sz</span><span style={{ textAlign: "center" }}>Price</span><span style={{ textAlign: "right" }}>Ask sz</span>
      </div>
      {asks.map((a, i) => <BookRow key={"a" + i} side="ask" px={a.px} sz={a.sz} maxSz={maxSz} />)}
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", padding: "7px 10px", background: "var(--bg-elev-1)", borderTop: "1px solid var(--border-hair)", borderBottom: "1px solid var(--border-hair)", alignItems: "center" }}>
        <span className="t-mono" style={{ color: "var(--up-500)", fontSize: 10 }}>▲ {last.toFixed(2)}</span>
        <span className="t-mono" style={{ color: "var(--ink-1000)", textAlign: "center", fontSize: 11, padding: "0 8px" }}>${last.toFixed(2)}</span>
        <span className="t-mono" style={{ color: "var(--fg-hint)", fontSize: 8.5, textAlign: "right" }}>0.04s</span>
      </div>
      {bids.map((b, i) => <BookRow key={"b" + i} side="bid" px={b.px} sz={b.sz} maxSz={maxSz} />)}
      <div style={{ padding: "7px 10px", display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-muted)", borderTop: "1px solid var(--border-hair)" }}>
        <span>Spread $0.02</span><span>1.5 bps</span>
      </div>
    </div>
  );
}
function BookRow({ side, px, sz, maxSz }) {
  const fill = side === "bid" ? "var(--tint-up-2)" : "var(--tint-down-2)";
  const text = side === "bid" ? "var(--up-500)" : "var(--down-500)";
  return (
    <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1fr auto 1fr", padding: "3px 10px", fontFamily: "var(--font-mono)", fontSize: 10.5, alignItems: "center" }}>
      <span style={{ position: "absolute", [side === "bid" ? "left" : "right"]: 0, top: 0, bottom: 0, width: `${(sz / maxSz) * 100}%`, background: fill }} />
      <span style={{ position: "relative", color: side === "bid" ? "var(--ink-900)" : "transparent" }}>{side === "bid" && sz.toLocaleString()}</span>
      <span style={{ position: "relative", color: text, textAlign: "center", padding: "0 10px" }}>{px.toFixed(2)}</span>
      <span style={{ position: "relative", color: side === "ask" ? "var(--ink-900)" : "transparent", textAlign: "right" }}>{side === "ask" && sz.toLocaleString()}</span>
    </div>
  );
}
function TimeAndSalesPanel() {
  const ticks = [
    { ts: "14:32:08", px: 134.82, sz: 200 }, { ts: "14:32:06", px: 134.81, sz: 8400 },
    { ts: "14:32:05", px: 134.81, sz: 300 }, { ts: "14:32:03", px: 134.81, sz: 500 },
    { ts: "14:32:01", px: 134.81, sz: 1200 }, { ts: "14:31:56", px: 134.80, sz: 12000 },
  ];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "12px 14px 8px" }}>
        <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: "var(--ink-1000)", fontWeight: 400 }}>Time &amp; sales</h3>
        <span className="t-label" style={{ fontSize: 8.5 }}>Last 8</span>
      </div>
      {ticks.map((tk, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "auto auto 1fr", gap: 10, padding: "4px 14px", fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-dim)", borderBottom: "1px solid var(--border-hair)", alignItems: "baseline" }}>
          <span style={{ color: "var(--fg-hint)" }}>{tk.ts}</span>
          <span style={{ color: "var(--ink-1000)" }}>{tk.px.toFixed(2)}</span>
          <span style={{ color: "var(--ink-900)", textAlign: "right" }}>{tk.sz.toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// ─── greeks + payoff ─────────────────────────────────────────────────────────

function GreeksStrip() {
  const greeks = [
    { sym: "Δ", v: "0.42" }, { sym: "Γ", v: "0.018" }, { sym: "Θ", v: "−0.094" },
    { sym: "ν", v: "0.142" }, { sym: "ρ", v: "0.041" },
  ];
  return (
    <div>
      <div className="t-label" style={{ marginBottom: 8 }}>Greeks · per contract</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5 }}>
        {greeks.map(g => (
          <div key={g.sym} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, padding: "7px 4px", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--gold-300)", lineHeight: 1 }}>{g.sym}</div>
            <div className="t-mono" style={{ fontSize: 11, color: "var(--ink-1000)", marginTop: 4 }}>{g.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
function PayoffPanel() {
  const w = 100, h = 36, minS = 130, maxS = 160, strike = 140, premium = 2.84, contracts = 10;
  const xs = Array.from({ length: 60 }, (_, i) => minS + (i / 59) * (maxS - minS));
  const pnl = xs.map(s => (Math.max(0, s - strike) - premium) * 100 * contracts);
  const pnlMin = Math.min(...pnl), pnlMax = Math.max(...pnl), pnlSpan = pnlMax - pnlMin;
  const xToSvg = (s) => ((s - minS) / (maxS - minS)) * w;
  const yToSvg = (p) => h - ((p - pnlMin) / pnlSpan) * h;
  const path = "M " + xs.map((s, i) => `${xToSvg(s).toFixed(2)} ${yToSvg(pnl[i]).toFixed(2)}`).join(" L ");
  const yZero = yToSvg(0), spot = 134.82, breakeven = strike + premium;
  return (
    <div>
      <div className="t-label" style={{ marginBottom: 8 }}>Payoff at expiry</div>
      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3, padding: "8px 6px 6px" }}>
        <svg viewBox={`0 0 ${w} ${h + 4}`} preserveAspectRatio="none" style={{ width: "100%", height: 70 }}>
          <line x1="0" x2={w} y1={yZero} y2={yZero} stroke="var(--border)" strokeWidth="0.25" strokeDasharray="0.6 0.6" />
          <rect x="0" y={yZero} width={xToSvg(breakeven)} height={h - yZero} fill="var(--tint-down-1)" />
          <rect x={xToSvg(breakeven)} y="0" width={w - xToSvg(breakeven)} height={yZero} fill="var(--tint-up-1)" />
          <path d={path} fill="none" stroke="var(--gold-300)" strokeWidth="0.7" strokeLinejoin="round" />
          <line x1={xToSvg(spot)} x2={xToSvg(spot)} y1="0" y2={h} stroke="var(--ice-500)" strokeWidth="0.3" strokeDasharray="0.6 0.8" opacity="0.6" />
        </svg>
      </div>
    </div>
  );
}

// ─── AI memo ─────────────────────────────────────────────────────────────────

function AIMemoPanel({ isOption }) {
  return (
    <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold-500)", boxShadow: "0 0 8px var(--gold-500)", animation: "pulse 2s infinite" }} />
          <span className="t-label" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>AI · Memo</span>
        </span>
        <span className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)" }}>14:32 · 180ms</span>
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--ink-900)", lineHeight: 1.5 }}>
        {isOption ? (
          <>The <span style={{ color: "var(--gold-300)" }}>$140 call 14d</span> isolates the move you want — upside into print with capped downside. IV at <span style={{ color: "var(--gold-300)" }}>82 rank</span> means you're paying up; theta bleeds $94/day.</>
        ) : (
          <>Adding to <span style={{ color: "var(--gold-300)" }}>NVDA</span> here lines up with the Momentum &amp; Quality thesis from Oct 28. Regime fit <span style={{ color: "var(--gold-300)" }}>0.82</span>. Earnings 14d — size for the print.</>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 9 }}>
        <Chip tone="brand">Regime fit 0.82</Chip>
        <Chip tone="up">Risk gates pass</Chip>
        <Chip tone="muted">Earnings 14d</Chip>
      </div>
    </div>
  );
}

if (typeof window !== "undefined") Object.assign(window, { HeroChart, ChartToolbar, OVERLAY_GROUPS });

// ─── shared ──────────────────────────────────────────────────────────────────

const inputStyle = {
  flex: 1, background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 3,
  padding: "0 12px", height: 36, color: "var(--ink-1000)", fontFamily: "var(--font-mono)", fontSize: 13, outline: "none", minWidth: 0
};
const tradeBtnStyle = (kind, on) => ({
  height: 38, fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase",
  color: kind === "buy" ? "var(--up-500)" : "var(--down-500)",
  background: on ? (kind === "buy" ? "var(--tint-up-2)" : "var(--tint-down-2)") : "transparent",
  border: `1px solid ${kind === "buy" ? "var(--tint-up-3)" : "var(--tint-down-3)"}`,
  borderRadius: 3, cursor: "default", lineHeight: 1.05
});
function Field({ label, children, value, sub }) {
  return (
    <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 5 }}>
      <div className="t-label" style={{ fontSize: 9.5 }}>{label}</div>
      <div style={{ display: children ? "flex" : "block" }}>
        {children ?? (
          <>
            <div className="t-body-sm" style={{ color: "var(--ink-1000)", fontWeight: 500 }}>{value}</div>
            {sub && <div className="t-mono" style={{ marginTop: 3, fontSize: 10, color: "var(--fg-muted)" }}>{sub}</div>}
          </>
        )}
      </div>
    </div>
  );
}

if (typeof window !== "undefined") window.TradePage = TradePage;


// Research / Symbols index — monitor view: filter, sort, scan, drill in.

const ResearchPage = ({ tweaks, onPickTicker }) => {
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("score");

  const meta = {
    NVDA: { regime: 0.84, score: 0.92, signals: ["pivot", "trend", "ai"],   earningsIn: 14, sector: "Semis" },
    META: { regime: 0.71, score: 0.79, signals: ["rs", "trend"],            earningsIn: 41, sector: "Tech" },
    TSLA: { regime: 0.42, score: 0.51, signals: [],                          earningsIn: 8,  sector: "Auto" },
    AAPL: { regime: 0.58, score: 0.62, signals: ["trend"],                   earningsIn: 56, sector: "Tech" },
    MSFT: { regime: 0.67, score: 0.71, signals: ["trend"],                   earningsIn: 60, sector: "Tech" },
    SPY:  { regime: 0.78, score: 0.78, signals: ["regime"],                  earningsIn: null, sector: "Index" },
    XOM:  { regime: 0.55, score: 0.74, signals: ["pead"],                    earningsIn: 89, sector: "Energy" },
    INTC: { regime: 0.22, score: 0.34, signals: ["short"],                   earningsIn: 30, sector: "Semis" },
    UNH:  { regime: 0.48, score: 0.41, signals: ["mean-rev"],                earningsIn: 62, sector: "Health" },
  };

  const enriched = MOCK_WATCHLIST.map(w => {
    const inBook = MOCK_POSITIONS.find(p => p.sym === w.sym);
    const m = meta[w.sym] || { regime: 0.5, score: 0.5, signals: [], earningsIn: null, sector: "—" };
    return { ...w, ...m, inBook };
  });

  const summary = {
    total: enriched.length,
    inBook: enriched.filter(r => r.inBook).length,
    signals: enriched.filter(r => r.signals.length > 0 && r.score >= 0.6).length,
    earnings: enriched.filter(r => r.earningsIn != null && r.earningsIn <= 21).length,
  };

  const filtered = enriched.filter(r => {
    if (filter === "book")     return !!r.inBook;
    if (filter === "watching") return !r.inBook;
    if (filter === "signals")  return r.signals.length > 0 && r.score >= 0.6;
    if (filter === "earnings") return r.earningsIn != null && r.earningsIn <= 21;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "symbol")   return a.sym.localeCompare(b.sym);
    if (sort === "chg")      return b.pct - a.pct;
    if (sort === "regime")   return b.regime - a.regime;
    if (sort === "earnings") return (a.earningsIn ?? 999) - (b.earningsIn ?? 999);
    return b.score - a.score;
  });

  const filters = [
    { id: "all",      label: "All",      count: enriched.length },
    { id: "book",     label: "In book",  count: summary.inBook },
    { id: "watching", label: "Watching", count: enriched.length - summary.inBook },
    { id: "signals",  label: "Signals",  count: summary.signals },
    { id: "earnings", label: "Earnings ≤ 21d", count: summary.earnings },
  ];

  return (
    <div style={{ overflow: "auto", height: "100%", padding: "24px 32px 60px" }}>
      <div style={{ paddingBottom: 18, borderBottom: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="t-label">Research</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 44, color: "var(--ink-1000)", letterSpacing: "-0.025em", lineHeight: 1, marginTop: 6 }}>Symbols · monitor</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg-dim)", marginTop: 6 }}>Click any name to open its research view.</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnGhostR}>＋ Add symbol</button>
          <button style={btnGhostR}>Import list</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24, padding: "22px 0 18px", borderBottom: "1px solid var(--border-hair)" }}>
        <Stat label="Symbols tracked" value={summary.total} big />
        <Stat label="In book" value={summary.inBook} />
        <Stat label="Signals firing" value={summary.signals} tone="up" />
        <Stat label="Earnings ≤ 21d" value={summary.earnings} />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0" }}>
        <div style={{ display: "flex", gap: 4 }}>
          {filters.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: "6px 11px", fontFamily: "var(--font-ui)", fontSize: 11.5,
              color: filter === f.id ? "var(--ink-1000)" : "var(--fg-muted)",
              background: filter === f.id ? "var(--bg-elev-1)" : "transparent",
              border: filter === f.id ? "1px solid var(--border)" : "1px solid transparent",
              borderRadius: 3, cursor: "default", display: "inline-flex", alignItems: "center", gap: 6
            }}>
              {f.label}
              <span className="t-mono" style={{ fontSize: 10, color: filter === f.id ? "var(--brand)" : "var(--fg-hint)" }}>{f.count}</span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="t-label" style={{ fontSize: 9 }}>Sort</span>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{
            padding: "5px 10px", fontFamily: "var(--font-mono)", fontSize: 11,
            background: "var(--bg-elev-1)", color: "var(--ink-1000)",
            border: "1px solid var(--border)", borderRadius: 3
          }}>
            <option value="score">Signal score</option>
            <option value="symbol">Symbol (A→Z)</option>
            <option value="chg">Day change</option>
            <option value="regime">Regime fit</option>
            <option value="earnings">Earnings (soonest)</option>
          </select>
        </div>
      </div>

      <div style={{ border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden", background: "var(--bg)" }}>
        <div style={tableHeaderR}>
          <div>Symbol</div>
          <div style={{ textAlign: "right" }}>Last · Day</div>
          <div>5d</div>
          <div>Regime fit</div>
          <div>Signals</div>
          <div>Position</div>
          <div style={{ textAlign: "right" }}>Earnings</div>
          <div></div>
        </div>
        {sorted.length === 0 && (
          <div style={{ padding: "60px 16px", textAlign: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg-dim)" }}>
            No symbols match this filter.
          </div>
        )}
        {sorted.map(r => (
          <div key={r.sym} onClick={() => onPickTicker(r.sym)} className="research-row" style={tableRowR}>
            <div>
              <div style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 13, color: "var(--ink-1000)", letterSpacing: "0.02em" }}>{r.sym}</div>
              <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, color: "var(--fg-muted)" }}>{r.name} · <span style={{ color: "var(--fg-hint)" }}>{r.sector}</span></div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-1000)" }}>{r.px.toFixed(2)}</div>
              <div style={{ marginTop: 1 }}>
                <Delta value={r.pct} dec={2} />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center" }}>
              <Sparkline data={r.spark} color={r.pct >= 0 ? "var(--up-500)" : "var(--down-500)"} width={72} height={24} />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, height: 4, background: "var(--ink-300)", borderRadius: 1, position: "relative" }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${r.regime * 100}%`, background: r.regime >= 0.6 ? "var(--up-500)" : r.regime >= 0.4 ? "var(--gold-500)" : "var(--down-500)" }} />
              </div>
              <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", minWidth: 28, textAlign: "right" }}>{r.regime.toFixed(2)}</span>
            </div>

            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {r.signals.length === 0 ? (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-hint)" }}>—</span>
              ) : (
                r.signals.map(s => <Chip key={s} tone={s === "short" ? "down" : s === "ai" ? "brand" : "up"}>{signalLabelR(s)}</Chip>)
              )}
            </div>

            <div>
              {r.inBook ? (
                <>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--ink-1000)" }}>
                    {r.inBook.qty} <span style={{ color: r.inBook.side === "short" ? "var(--down-500)" : "var(--up-500)", fontSize: 10 }}>{r.inBook.side}</span>
                  </div>
                  <div className={r.inBook.pl >= 0 ? "u-profit t-mono" : "u-loss t-mono"} style={{ fontSize: 10.5 }}>
                    {r.inBook.pl >= 0 ? "+" : "−"}${Math.abs(r.inBook.pl).toFixed(0)} · {r.inBook.plPct >= 0 ? "+" : ""}{r.inBook.plPct.toFixed(1)}%
                  </div>
                </>
              ) : <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-hint)" }}>—</span>}
            </div>

            <div style={{ textAlign: "right" }}>
              {r.earningsIn != null ? (
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11.5,
                  color: r.earningsIn <= 14 ? "var(--gold-500)" : "var(--fg-muted)",
                  fontWeight: r.earningsIn <= 14 ? 600 : 400,
                }}>{r.earningsIn}d</span>
              ) : <span style={{ fontSize: 11, color: "var(--fg-hint)" }}>—</span>}
            </div>

            <div style={{ textAlign: "right" }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: "var(--brand)", fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase" }}>Open →</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        <div style={{ padding: "16px 18px", border: "1px solid var(--border)", background: "var(--ink-100)", borderRadius: 4 }}>
          <div className="t-label" style={{ marginBottom: 10 }}>AI · scan summary</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14.5, color: "var(--ink-900)", lineHeight: 1.55 }}>
            Of <b>{summary.total}</b> tracked names, <b>{summary.signals}</b> are firing high-conviction signals today; <b>NVDA</b> remains the strongest setup (pivot break, regime fit 0.84, AI thesis intact). <b>{summary.earnings}</b> have earnings inside three weeks — TSLA in 8 days warrants tighter risk.
          </div>
        </div>
        <div style={{ padding: "16px 18px", border: "1px solid var(--border)", background: "var(--ink-100)", borderRadius: 4 }}>
          <div className="t-label" style={{ marginBottom: 10 }}>Universe → here</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--fg-dim)", lineHeight: 1.55 }}>
            S&P 1500 → liquidity filter → strategy fit → <b style={{ color: "var(--brand)", fontStyle: "normal", fontFamily: "var(--font-ui)", letterSpacing: "0.04em" }}>your monitor</b>. Pipeline narrows the 4,823-name universe down to these {summary.total}. <a style={{ color: "var(--brand)", textDecoration: "none" }}>Open pipeline →</a>
          </div>
        </div>
      </div>

      <style>{`.research-row:hover { background: var(--bg-elev-1); }`}</style>
    </div>
  );
};

const signalLabelR = (s) => ({
  pivot: "Pivot", trend: "Trend", pead: "PEAD", ai: "AI",
  rs: "RS rank", short: "Short", regime: "Regime", "mean-rev": "Mean rev",
}[s] || s);

const tableHeaderR = {
  display: "grid",
  gridTemplateColumns: "1.6fr 1fr 90px 1.3fr 1.5fr 1fr 80px 70px",
  gap: 14,
  padding: "10px 16px",
  background: "var(--ink-100)",
  borderBottom: "1px solid var(--border)",
  fontFamily: "var(--font-ui)", fontSize: 9.5, fontWeight: 600,
  letterSpacing: "0.14em", textTransform: "uppercase",
  color: "var(--fg-hint)",
};

const tableRowR = {
  display: "grid",
  gridTemplateColumns: "1.6fr 1fr 90px 1.3fr 1.5fr 1fr 80px 70px",
  gap: 14,
  padding: "12px 16px",
  borderBottom: "1px solid var(--border-hair)",
  alignItems: "center",
  cursor: "pointer",
  transition: "background 0.08s",
};

const btnGhostR = {
  padding: "8px 14px",
  fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600,
  letterSpacing: "0.12em", textTransform: "uppercase",
  background: "transparent", color: "var(--fg-muted)",
  border: "1px solid var(--border)", borderRadius: 3,
  cursor: "default",
};

if (typeof window !== "undefined") Object.assign(window, { ResearchPage });


// Position detail · Command palette · Empty states · Mobile preview.

// ─── ExtrasEmptyState helper ───────────────────────────────────────────────────────

const ExtrasEmptyState = ({ icon = "○", title, body, action, onAction }) => (
  <div style={{ padding: "60px 32px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 12 }}>
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 36, color: "var(--fg-hint)", lineHeight: 1 }}>{icon}</div>
    <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", letterSpacing: "-0.015em" }}>{title}</div>
    {body && <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--fg-dim)", maxWidth: 360, lineHeight: 1.5 }}>{body}</div>}
    {action && (
      <button onClick={onAction} style={{ marginTop: 8, padding: "8px 14px", fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", background: "var(--brand)", color: "var(--brand-on)", border: 0, borderRadius: 3, cursor: "default" }}>{action}</button>
    )}
  </div>
);

// ─── Position detail ────────────────────────────────────────────────────────

const PositionPage = ({ sym = "NVDA", onPickTicker, onTrade, onBack }) => {
  const pos = MOCK_POSITIONS.find(p => p.sym === sym);
  if (!pos) {
    return <ExtrasEmptyState icon="∅" title="No open position in this symbol" body="Open a research view to see signals, AI thesis, and stage a trade." action="Open research" onAction={() => onPickTicker(sym)} />;
  }
  const mv = pos.qty * pos.last;
  const cost = pos.qty * pos.avg;
  const daysHeld = 18; // synthetic
  const stopDist = ((pos.last - pos.stop) / pos.last) * 100;

  // synthetic trade log
  const log = [
    { ts: "Oct 28 · 09:42", side: "buy",  qty: 100, px: 127.84, note: "Pivot break entry" },
    { ts: "Oct 28 · 14:18", side: "buy",  qty: 80,  px: 128.50, note: "Add on confirmation" },
    { ts: "Nov 02 · 10:05", side: "buy",  qty: 70,  px: 129.84, note: "Scale-in · AI thesis intact" },
  ];

  return (
    <div style={{ overflow: "auto", height: "100%", padding: "20px 32px 60px" }}>
      <div style={{ marginBottom: 8 }}>
        <a onClick={onBack} style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--fg-muted)", cursor: "default" }}>← Book · positions</a>
      </div>

      <div style={{ paddingBottom: 20, borderBottom: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="t-label">Position · {pos.strategy}</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 56, color: "var(--ink-1000)", letterSpacing: "-0.025em", lineHeight: 1, marginTop: 6 }}>
            {pos.qty} <span style={{ color: pos.side === "short" ? "var(--down-500)" : "var(--up-500)" }}>{pos.side}</span> {pos.sym}
          </div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg-dim)", marginTop: 6 }}>
            Opened {pos.opened} · held {daysHeld} days
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => onPickTicker(sym)} style={{ padding: "8px 14px", fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", background: "transparent", color: "var(--fg-muted)", border: "1px solid var(--border)", borderRadius: 3, cursor: "default" }}>Research</button>
          <button onClick={onTrade} style={{ padding: "8px 14px", fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", background: "var(--brand)", color: "var(--brand-on)", border: 0, borderRadius: 3, cursor: "default" }}>Adjust trade</button>
        </div>
      </div>

      {/* hero stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 28, padding: "24px 0 20px", borderBottom: "1px solid var(--border-hair)" }}>
        <Stat label="Avg cost" value={"$" + pos.avg.toFixed(2)} />
        <Stat label="Last" value={"$" + pos.last.toFixed(2)} />
        <Stat label="Unrealized" value={(pos.pl >= 0 ? "+$" : "−$") + Math.abs(pos.pl).toLocaleString()} tone={pos.pl >= 0 ? "up" : "down"} big />
        <Stat label="Return" value={(pos.plPct >= 0 ? "+" : "") + pos.plPct.toFixed(2) + "%"} tone={pos.plPct >= 0 ? "up" : "down"} />
        <Stat label="Market value" value={"$" + mv.toLocaleString()} />
        <Stat label="Cost basis" value={"$" + cost.toLocaleString()} />
      </div>

      {/* Trade log + risk panel */}
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, marginTop: 24 }}>
        <div>
          <div className="t-label" style={{ marginBottom: 12 }}>Trade log</div>
          {log.map((t, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "auto auto auto 1fr auto", gap: 14, padding: "11px 0", borderBottom: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 12, alignItems: "baseline" }}>
              <span style={{ color: "var(--fg-hint)", fontSize: 11 }}>{t.ts}</span>
              <Chip tone={t.side === "buy" ? "up" : "down"}>{t.side}</Chip>
              <span style={{ color: "var(--ink-1000)" }}>{t.qty} @ {t.px.toFixed(2)}</span>
              <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-muted)" }}>{t.note}</span>
              <span className="u-profit" style={{ fontSize: 11.5 }}>+${((pos.last - t.px) * t.qty).toFixed(0)}</span>
            </div>
          ))}
          <div style={{ marginTop: 22 }}>
            <div className="t-label" style={{ marginBottom: 10 }}>Scale-out plan · 3 levels</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {[
                { trigger: "+8%",   px: 138.69, qty: 80, note: "Take 1/3 at first resistance" },
                { trigger: "+15%",  px: 147.67, qty: 80, note: "Take 1/3 at next pivot" },
                { trigger: "Trail", px: "+10% trail", qty: 90, note: "Ride remainder to trail-stop" },
              ].map((p, i) => (
                <div key={i} style={{ padding: "12px 14px", border: "1px solid var(--border)", background: "var(--ink-100)", borderRadius: 3 }}>
                  <div className="t-label" style={{ color: "var(--brand)" }}>Step {i + 1} · {p.trigger}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--ink-1000)", marginTop: 6 }}>{typeof p.px === "number" ? "$" + p.px.toFixed(2) : p.px}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>Qty {p.qty}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-muted)", marginTop: 6, lineHeight: 1.4 }}>{p.note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="t-label" style={{ marginBottom: 12 }}>Risk · live</div>
          <div style={{ padding: "14px 16px", border: "1px solid var(--border)", background: "var(--ink-100)", borderRadius: 4 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 10, columnGap: 16, fontFamily: "var(--font-mono)", fontSize: 12 }}>
              <span style={{ color: "var(--fg-muted)" }}>Stop · hard</span>
              <span style={{ color: "var(--down-500)" }}>${pos.stop.toFixed(2)} · {stopDist.toFixed(1)}%</span>
              <span style={{ color: "var(--fg-muted)" }}>Risk if stop</span>
              <span style={{ color: "var(--ink-1000)" }}>−${((pos.last - pos.stop) * pos.qty).toFixed(0)}</span>
              <span style={{ color: "var(--fg-muted)" }}>Concentration</span>
              <span style={{ color: "var(--ink-1000)" }}>11.9% / 15% cap</span>
              <span style={{ color: "var(--fg-muted)" }}>Strategy alloc</span>
              <span style={{ color: "var(--ink-1000)" }}>32% / 40% cap</span>
              <span style={{ color: "var(--fg-muted)" }}>Earnings in</span>
              <span style={{ color: "var(--gold-500)" }}>14d · pre-event</span>
              <span style={{ color: "var(--fg-muted)" }}>Beta · book</span>
              <span style={{ color: "var(--ink-1000)" }}>+0.18 contribution</span>
            </div>
          </div>

          <div style={{ marginTop: 18, padding: 14, background: "var(--ink-100)", border: "1px solid var(--border)", borderLeft: "2px solid var(--brand)", borderRadius: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <StatusDot tone="up" size={5} />
              <span className="t-label" style={{ fontSize: 9 }}>AI · position memo</span>
              <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>updated 4m ago</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13.5, color: "var(--ink-900)", lineHeight: 1.5 }}>
              Position is performing in-pattern with the M&Q thesis: trend intact, regime fit elevated, no fundamental breakage. Earnings inside the next two weeks suggest holding the first scale-out and tightening trail to 8% post-print rather than adding before.
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <div className="t-label" style={{ marginBottom: 10 }}>Total exposure to {sym}</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 8, fontFamily: "var(--font-mono)", fontSize: 12 }}>
              <span style={{ color: "var(--fg-muted)" }}>Direct · stock</span>
              <span style={{ color: "var(--ink-1000)" }}>250 sh · ${mv.toLocaleString()}</span>
              <span style={{ color: "var(--fg-muted)" }}>Options · 145C 30d</span>
              <span style={{ color: "var(--ink-1000)" }}>5 ct · ~$1,380 Δ-equiv</span>
              <span style={{ color: "var(--fg-muted)" }}>SMH · ETF holding</span>
              <span style={{ color: "var(--ink-1000)" }}>~$2,100 effective</span>
              <span style={{ color: "var(--fg-muted)", borderTop: "1px solid var(--border-hair)", paddingTop: 8 }}>Total</span>
              <span style={{ color: "var(--brand)", borderTop: "1px solid var(--border-hair)", paddingTop: 8 }}>${(mv + 1380 + 2100).toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Command palette ────────────────────────────────────────────────────────

const CommandPalette = ({ open, onClose, onNav, onPickTicker }) => {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef(null);

  const items = useMemo(() => {
    const pages = [
      { kind: "page", id: "dashboard", label: "Dashboard",            hint: "⌘D · daily P&L, briefing, movers" },
      { kind: "page", id: "watchlists", label: "Watchlists",          hint: "⌘R · your bench of names" },
      { kind: "page", id: "trade",     label: "Trade terminal",       hint: "⌘J · order ticket + book" },
      { kind: "page", id: "strategies", label: "Strategies",          hint: "Book of strategies, performance" },
      { kind: "page", id: "pipeline",   label: "Pipeline",            hint: "Universe → live trades" },
      { kind: "page", id: "analytics",  label: "Analytics",           hint: "Performance, attribution" },
      { kind: "page", id: "alerts",     label: "Alerts",              hint: "What needs you" },
      { kind: "page", id: "positions",  label: "Positions · book",    hint: "All open positions" },
    ];
    const syms = MOCK_WATCHLIST.map(w => ({ kind: "ticker", id: w.sym, label: w.sym, hint: w.name + " · $" + w.px.toFixed(2) }));
    const actions = [
      { kind: "action", id: "stage-amd",  label: "Stage trade · AMD",      hint: "From pipeline" },
      { kind: "action", id: "close-tsla", label: "Close position · TSLA",  hint: "Confirm dialog" },
      { kind: "action", id: "pause-ai",   label: "Pause AI · Alpha strategy", hint: "Active · −1.18%" },
    ];
    const all = [...pages, ...syms, ...actions];
    if (!q.trim()) return all.slice(0, 12);
    const Q = q.toLowerCase();
    return all.filter(i => i.label.toLowerCase().includes(Q) || i.hint.toLowerCase().includes(Q)).slice(0, 16);
  }, [q]);

  useEffect(() => { setIdx(0); }, [q, open]);
  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus();
  }, [open]);

  const run = (item) => {
    if (!item) return;
    if (item.kind === "page") onNav(item.id);
    else if (item.kind === "ticker") onPickTicker(item.id);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, items.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
      if (e.key === "Enter")     { e.preventDefault(); run(items[idx]); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items, idx]);

  if (!open) return null;

  const groups = items.reduce((acc, i) => { (acc[i.kind] = acc[i.kind] || []).push(i); return acc; }, {});
  const order = ["page", "ticker", "action"];
  const labelFor = { page: "Pages", ticker: "Symbols", action: "Actions" };

  let runningIdx = -1;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,7,5,0.62)", backdropFilter: "blur(6px)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "14vh" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: 640, maxWidth: "92vw", background: "var(--bg)", border: "1px solid var(--border-strong)", borderRadius: 6, boxShadow: "0 30px 80px rgba(0,0,0,0.6)", overflow: "hidden", display: "flex", flexDirection: "column", maxHeight: "70vh" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border-hair)", display: "flex", alignItems: "center", gap: 12 }}>
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-hint)" }}>⌘K</span>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Jump to page, symbol, or action…" style={{
            flex: 1, background: "transparent", border: 0, outline: 0,
            fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)",
            letterSpacing: "-0.005em",
          }} />
          <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>↑↓ · ↵ · Esc</span>
        </div>
        <div style={{ overflow: "auto", flex: 1 }}>
          {items.length === 0 && <ExtrasEmptyState icon="∅" title="No matches" body="Try a ticker, page name, or action keyword." />}
          {order.map(k => {
            const list = groups[k] || [];
            if (list.length === 0) return null;
            return (
              <div key={k}>
                <div style={{ padding: "10px 18px 4px", fontFamily: "var(--font-ui)", fontSize: 9.5, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg-hint)" }}>{labelFor[k]}</div>
                {list.map(item => {
                  runningIdx++;
                  const active = runningIdx === idx;
                  return (
                    <div key={item.id + "-" + item.kind} onClick={() => run(item)} onMouseEnter={() => setIdx(runningIdx)} style={{
                      padding: "9px 18px", display: "flex", justifyContent: "space-between", alignItems: "baseline",
                      background: active ? "var(--bg-elev-1)" : "transparent",
                      borderLeft: active ? "2px solid var(--brand)" : "2px solid transparent",
                      cursor: "default",
                    }}>
                      <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{item.label}</span>
                      <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>{item.hint}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ─── Mobile preview page ────────────────────────────────────────────────────

const MobilePage = () => {
  return (
    <div style={{ overflow: "auto", height: "100%", padding: "24px 32px 60px" }}>
      <div style={{ paddingBottom: 18, borderBottom: "1px solid var(--border-hair)" }}>
        <div className="t-label">Mobile companion</div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 44, color: "var(--ink-1000)", letterSpacing: "-0.025em", lineHeight: 1, marginTop: 6 }}>On the go</div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg-dim)", marginTop: 6, maxWidth: 640 }}>
          The desk lives on desktop. Mobile is a deliberate companion — glance at the book, react to alerts, close a position. No charts, no studies, no order-book ladders.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 36, marginTop: 36, justifyContent: "center" }}>
        <PhoneFrame label="Today">
          <MBHeader title="Today" sub="Mon · 11:24 ET · open" />
          <div style={{ padding: "16px 16px 8px" }}>
            <div className="t-label">Book P&L · today</div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 36, color: "var(--up-500)", lineHeight: 1, marginTop: 4 }}>+$1,840</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-muted)" }}>+0.65% · risk used 38%</div>
          </div>
          <div style={{ padding: "8px 16px" }}>
            <div className="t-label" style={{ marginBottom: 6 }}>What needs you</div>
            {[
              { tone: "down", text: "TSLA stop hit · auto-closed", ts: "11:08" },
              { tone: "up",   text: "AMD pivot break · stage?",    ts: "10:42" },
              { tone: "neutral", text: "FOMC minutes · 14:00",     ts: "09:08" },
            ].map((a, i) => (
              <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid var(--border-hair)", display: "flex", gap: 10, alignItems: "baseline" }}>
                <StatusDot tone={a.tone} size={5} />
                <span style={{ flex: 1, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13.5, color: "var(--ink-900)", lineHeight: 1.4 }}>{a.text}</span>
                <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>{a.ts}</span>
              </div>
            ))}
          </div>
        </PhoneFrame>

        <PhoneFrame label="Book">
          <MBHeader title="Book" sub="8 positions · $112,840" />
          {MOCK_POSITIONS.slice(0, 6).map(p => (
            <div key={p.sym} style={{ padding: "11px 16px", borderBottom: "1px solid var(--border-hair)", display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 10, alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)", fontWeight: 600 }}>{p.sym}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>{p.qty} · ${p.last.toFixed(2)}</span>
              <span className={p.pl >= 0 ? "u-profit t-mono" : "u-loss t-mono"} style={{ fontSize: 12 }}>{p.pl >= 0 ? "+" : "−"}${Math.abs(p.pl).toFixed(0)}</span>
            </div>
          ))}
        </PhoneFrame>

        <PhoneFrame label="Position">
          <MBHeader title="NVDA" sub="250 long · M&Q" back />
          <div style={{ padding: "16px 16px 8px" }}>
            <div className="t-label">Unrealized</div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 38, color: "var(--up-500)", lineHeight: 1 }}>+$1,602</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg-muted)" }}>+5.0% · stop −9.3%</div>
          </div>
          <div style={{ padding: "0 16px 14px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button style={{ padding: "10px 12px", background: "var(--brand)", color: "var(--brand-on)", border: 0, borderRadius: 4, fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>Add</button>
            <button style={{ padding: "10px 12px", background: "rgba(224,120,86,0.14)", color: "var(--down-500)", border: "1px solid rgba(224,120,86,0.4)", borderRadius: 4, fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}>Close</button>
          </div>
          <div style={{ padding: "8px 16px" }}>
            <div className="t-label">Trade log</div>
            {[
              { d: "Oct 28", t: "buy 100 @ 127.84" },
              { d: "Oct 28", t: "buy 80 @ 128.50"  },
              { d: "Nov 02", t: "buy 70 @ 129.84"  },
            ].map((l, i) => (
              <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-1000)" }}>{l.t}</span>
                <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>{l.d}</span>
              </div>
            ))}
          </div>
        </PhoneFrame>
      </div>
    </div>
  );
};

const PhoneFrame = ({ children, label }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
    <div style={{ width: 280, height: 580, borderRadius: 36, background: "#000", padding: 8, boxShadow: "0 30px 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.04)" }}>
      <div style={{ width: "100%", height: "100%", borderRadius: 28, background: "var(--bg)", overflow: "hidden", position: "relative", display: "flex", flexDirection: "column" }}>
        <div style={{ position: "absolute", top: 6, left: "50%", transform: "translateX(-50%)", width: 90, height: 22, background: "#000", borderRadius: 14, zIndex: 2 }} />
        <div style={{ paddingTop: 36, height: "100%", overflow: "auto" }}>
          {children}
        </div>
      </div>
    </div>
    <span className="t-label" style={{ color: "var(--fg-muted)" }}>{label}</span>
  </div>
);

const MBHeader = ({ title, sub, back }) => (
  <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid var(--border-hair)" }}>
    {back && <div style={{ fontFamily: "var(--font-ui)", fontSize: 10, color: "var(--fg-muted)", marginBottom: 4 }}>← Book</div>}
    <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", letterSpacing: "-0.02em", lineHeight: 1 }}>{title}</div>
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", marginTop: 3 }}>{sub}</div>
  </div>
);

if (typeof window !== "undefined") Object.assign(window, { PositionPage, CommandPalette, MobilePage, ExtrasEmptyState });


// Strategies, Pipeline, Analytics, Alerts — secondary pages, polished pass.

// ─── shared helpers ──────────────────────────────────────────────────────────

const monthsRow = (year, vals) => (
  <div style={{ display: "grid", gridTemplateColumns: "44px repeat(12, 1fr)", gap: 4, alignItems: "center" }}>
    <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-hint)" }}>{year}</span>
    {vals.map((v, i) => {
      const empty = v == null;
      const tone = v == null ? "var(--ink-200)" :
                   v >= 4 ? "var(--up-500)" :
                   v >= 1 ? "var(--tint-up-3)" :
                   v >= 0 ? "var(--tint-up-2)" :
                   v >= -2 ? "var(--tint-down-3)" :
                              "var(--down-500)";
      return (
        <div key={i} style={{ height: 28, background: tone, border: "1px solid var(--border-hair)", borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span className="t-mono" style={{ fontSize: 9.5, color: empty ? "var(--fg-hint)" : v >= 0 ? "var(--brand-on)" : "var(--fg)", fontWeight: 600 }}>
            {empty ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1)}
          </span>
        </div>
      );
    })}
  </div>
);

// ─── strategies ──────────────────────────────────────────────────────────────

const LegacyStrategiesPage = ({ tweaks, onNav }) => {
  const [sel, setSel] = useState(MOCK_STRATEGIES[0].num);
  const cur = MOCK_STRATEGIES.find(s => s.num === sel);

  const curve = useMemo(() => {
    const pts = 120;
    return Array.from({ length: pts }, (_, i) => 100 + i * 0.18 + Math.sin(i / 6) * 4 + (i > 80 ? (i - 80) * (cur.pct > 0 ? 0.4 : -0.2) : 0));
  }, [sel]);
  const ddCurve = useMemo(() => curve.map((v, i) => {
    const peak = Math.max(...curve.slice(0, i + 1));
    return ((v - peak) / peak) * 100;
  }), [curve]);
  const maxDD = Math.min(...ddCurve);

  // Synthetic monthly returns for selected strategy
  const monthly = {
    "01": [[2024, [1.2, -0.4, 2.8, 1.5, -1.2, 0.8, 3.4, 2.1, -0.6, 1.9, 2.4, null]]],
    "02": [[2024, [0.4, 0.8, -1.4, 2.1, 0.6, -0.2, 1.4, 0.9, 0.4, 1.1, 1.8, null]]],
    "03": [[2024, [0.0, 0.0, 0.6, 0.8, -0.4, 0.0, 0.4, 0.6, 0.2, 0.0, 0.6, null]]],
    "04": [[2024, [-0.4, 0.6, -1.2, -0.8, -0.2, 0.0, -1.1, -0.4, 0.0, -0.8, 0.0, null]]],
    "05": [[2024, [0.4, 0.2, 0.6, 0.4, -0.2, 0.4, 0.6, 0.4, 0.2, 0.4, 0.4, null]]],
    "06": [[2024, [-0.6, 0.4, -1.8, -0.4, -2.4, -0.8, 0.4, -0.4, 0.0, -1.2, -1.2, null]]],
  }[sel] || [[2024, []]];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100%", overflow: "hidden", gap: 1, background: "var(--border)" }}>
      <aside style={{ background: "var(--bg)", overflow: "auto" }}>
        <div style={{ padding: "20px 22px 14px", borderBottom: "1px solid var(--border)" }}>
          <div className="t-label">06 strategies</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 26, color: "var(--ink-1000)", letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 6 }}>Book of strategies</div>
        </div>
        {MOCK_STRATEGIES.map(s => (
          <div key={s.num} onClick={() => setSel(s.num)} style={{ padding: "14px 22px", cursor: "default", borderLeft: sel === s.num ? "2px solid var(--brand)" : "2px solid transparent", background: sel === s.num ? "var(--bg-elev-1)" : "transparent", borderBottom: "1px solid var(--border-hair)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{s.name}</span>
              <span className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)" }}>{s.num}</span>
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, color: "var(--fg-muted)", marginTop: 1 }}>{s.style}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-ui)", fontSize: 10.5, color: "var(--fg-muted)" }}>
                <StatusDot tone={s.active ? "up" : "off"} size={5} />{s.active ? "Active" : "Paused"}
              </span>
              <Delta value={s.pct} dec={2} />
            </div>
          </div>
        ))}
      </aside>

      <section style={{ background: "var(--bg)", overflow: "auto", padding: "24px 32px 60px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", paddingBottom: 18, borderBottom: "1px solid var(--border-hair)" }}>
          <div>
            <div className="t-label">Strategy {cur.num}</div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 40, color: "var(--ink-1000)", lineHeight: 1, letterSpacing: "-0.025em", marginTop: 6 }}>{cur.name}</div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: "var(--fg-dim)", marginTop: 6 }}>{cur.style}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnGhostS}>Backtest</button>
            <button style={btnGhostS}>Edit rules</button>
            <button style={{ ...btnGhostS, background: cur.active ? "rgba(224,120,86,0.1)" : "var(--brand)", color: cur.active ? "var(--down-500)" : "var(--brand-on)", border: cur.active ? "1px solid var(--tint-down-3)" : "0" }}>{cur.active ? "Pause" : "Activate"}</button>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 28, padding: "22px 0 16px" }}>
          <Stat label="30d return" value={fmtPct(cur.pct)} tone={cur.pct >= 0 ? "up" : "down"} big />
          <Stat label="Sharpe" value={cur.sharpe.toFixed(2)} />
          <Stat label="Max drawdown" value={cur.dd.toFixed(1) + "%"} tone="down" />
          <Stat label="Open positions" value={cur.positions} />
          <Stat label="Allocation" value={cur.allocPct + "%"} />
          <Stat label="Avg hold" value="6.4d" />
        </div>

        {/* Equity + drawdown twin chart */}
        <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div className="t-label">Equity curve · 6m</div>
            <div className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>Max DD <span style={{ color: "var(--down-500)" }}>{maxDD.toFixed(1)}%</span></div>
          </div>
          <div style={{ position: "relative", height: 200 }}>
            <Sparkline data={curve} color={cur.pct >= 0 ? "var(--up-500)" : "var(--down-500)"} width={1200} height={200} fill />
          </div>
          <div style={{ borderTop: "1px solid var(--border-hair)", marginTop: 8, paddingTop: 8 }}>
            <div className="t-label" style={{ marginBottom: 6 }}>Drawdown</div>
            <div style={{ position: "relative", height: 60 }}>
              <Sparkline data={ddCurve} color="var(--down-500)" width={1200} height={60} fill />
            </div>
          </div>
        </div>

        {/* Monthly heatmap */}
        <div style={{ marginTop: 22 }}>
          <div className="t-label" style={{ marginBottom: 10 }}>Monthly returns</div>
          <div style={{ display: "grid", gridTemplateColumns: "44px repeat(12, 1fr)", gap: 4, marginBottom: 4 }}>
            <span></span>
            {["J","F","M","A","M","J","J","A","S","O","N","D"].map((m, i) => (
              <span key={i} className="t-label" style={{ fontSize: 9, color: "var(--fg-hint)", textAlign: "center" }}>{m}</span>
            ))}
          </div>
          {monthly.map(([y, vals]) => <div key={y} style={{ marginBottom: 4 }}>{monthsRow(y, vals)}</div>)}
        </div>

        <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 24 }}>
          <div>
            <div className="t-label" style={{ marginBottom: 12 }}>Recent trades</div>
            <div>
              {[
                { sym: "NVDA", side: "buy",  px: 128.41, qty: 250, when: "Oct 28", pl: "+$1,602", state: "open" },
                { sym: "AAPL", side: "buy",  px: 218.40, qty: 100, when: "Oct 12", pl: "+$844",   state: "open" },
                { sym: "MSFT", side: "buy",  px: 412.30, qty: 60,  when: "Sep 30", pl: "+$600",   state: "open" },
                { sym: "GOOGL", side: "sell",px: 188.10, qty: 40,  when: "Sep 22", pl: "+$210",   state: "closed" },
                { sym: "AMD",  side: "buy",  px: 162.80, qty: 80,  when: "Sep 14", pl: "−$148",   state: "closed" },
              ].map((t, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "auto auto 1fr auto auto auto", gap: 14, padding: "9px 0", borderBottom: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 12, alignItems: "baseline" }}>
                  <span style={{ color: "var(--ink-1000)", fontWeight: 500 }}>{t.sym}</span>
                  <Chip tone={t.side === "buy" ? "up" : "down"}>{t.side}</Chip>
                  <span style={{ color: "var(--fg-muted)" }}>{t.qty} @ {t.px.toFixed(2)}</span>
                  <span style={{ color: "var(--fg-hint)", fontSize: 10.5 }}>{t.state}</span>
                  <span style={{ color: "var(--fg-hint)" }}>{t.when}</span>
                  <span className={t.pl.startsWith("+") ? "u-profit" : "u-loss"}>{t.pl}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="t-label" style={{ marginBottom: 12 }}>Rules · in plain language</div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-900)", lineHeight: 1.55 }}>
              Buy when a name in the S&P 1500 trades through its 3-week pivot with regime-fit above 0.6 and 50-day above 200-day. Hold 5–20 days, scale into earnings drift if it triggers. Stop at 4% from entry; take profits into resistance or strategy circuit breaker.
            </div>
            <div style={{ marginTop: 14, display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Chip tone="brand">5–20d hold</Chip>
              <Chip tone="muted">Long only</Chip>
              <Chip tone="muted">Pivot break · 3w</Chip>
              <Chip tone="muted">Stop −4%</Chip>
              <Chip tone="muted">Risk cap 0.5%</Chip>
            </div>
            <div style={{ marginTop: 18, padding: 14, background: "var(--ink-100)", border: "1px solid var(--border)", borderLeft: "2px solid var(--brand)", borderRadius: 3 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <StatusDot tone="up" size={5} />
                <span className="t-label" style={{ fontSize: 9 }}>AI · diagnostic</span>
                <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>updated 14m ago</span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13.5, color: "var(--ink-900)", lineHeight: 1.5 }}>
                {cur.pct >= 0 ? "Strategy is performing in-pattern. Win rate stable, drift toward earnings names accounting for ~60% of recent gains." : "Strategy underperforming its base rate. Consider tightening regime-fit threshold from 0.5 to 0.65 or pausing during current chop."}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

// ─── pipeline ────────────────────────────────────────────────────────────────

const PipelinePage = () => {
  const candidates = [
    { sym: "AMD",  strat: "Momentum & Quality", note: "3-week pivot break · regime fit 0.78", score: 0.84, regime: 0.78, signals: ["pivot", "trend"] },
    { sym: "META", strat: "Momentum & Quality", note: "RS rank top 5% · gap-and-go fade",      score: 0.79, regime: 0.71, signals: ["rs", "trend"] },
    { sym: "ASML", strat: "Pairs · Sector",     note: "Spread vs TSM at +1.6σ; pair candidate", score: 0.71, regime: 0.62, signals: ["pair"] },
    { sym: "JNJ",  strat: "Mean Reversion",     note: "Oversold RSI 28 · prior support hold",   score: 0.62, regime: 0.55, signals: ["mean-rev"] },
  ];

  return (
    <div style={{ overflow: "auto", height: "100%", padding: "24px 32px 60px" }}>
      <div style={{ paddingBottom: 18, borderBottom: "1px solid var(--border-hair)" }}>
        <div className="t-label">Pipeline</div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 44, color: "var(--ink-1000)", letterSpacing: "-0.025em", lineHeight: 1, marginTop: 6 }}>Universe → live</div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg-dim)", marginTop: 6 }}>How 4,823 names get squeezed into 2 trades.</div>
      </div>

      {/* funnel */}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${MOCK_PIPELINE.length}, 1fr)`, gap: 0, marginTop: 28, position: "relative" }}>
        {MOCK_PIPELINE.map((s, i) => {
          const ratio = Math.log(s.count + 1) / Math.log(5000);
          const prev = i > 0 ? MOCK_PIPELINE[i - 1].count : null;
          const dropPct = prev ? Math.round((1 - s.count / prev) * 100) : null;
          return (
            <div key={s.stage} style={{ padding: "16px 18px 18px", borderRight: i < MOCK_PIPELINE.length - 1 ? "1px solid var(--border)" : "0", background: i === MOCK_PIPELINE.length - 1 ? "var(--bg-elev-1)" : "var(--bg)", position: "relative" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)" }}>{String(i + 1).padStart(2, "0")}</span>
                <div className="t-label">{s.stage}</div>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 32, color: "var(--ink-1000)", fontWeight: 300, lineHeight: 1, letterSpacing: "-0.025em", marginTop: 10 }}>{s.count.toLocaleString()}</div>
              {dropPct != null && (
                <div className="t-mono" style={{ fontSize: 10.5, color: "var(--down-500)", marginTop: 2 }}>−{dropPct}% from prior</div>
              )}
              <div style={{ marginTop: 12, height: 4, background: "var(--ink-300)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${ratio * 100}%`, background: "linear-gradient(90deg, var(--gold-700), var(--gold-300))" }} />
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-muted)", marginTop: 12, lineHeight: 1.4 }}>{s.narrow}</div>
              {/* arrow */}
              {i < MOCK_PIPELINE.length - 1 && (
                <div style={{ position: "absolute", right: -7, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-hint)", fontSize: 10, zIndex: 1 }}>›</div>
              )}
            </div>
          );
        })}
      </div>

      {/* candidates */}
      <div style={{ marginTop: 32, padding: 24, border: "1px solid var(--border)", borderRadius: 6, background: "var(--ink-100)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <div className="t-label">Staged · awaiting your review</div>
          <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-muted)" }}>{candidates.length} candidates · top 0.08% of universe</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
          {candidates.map(c => (
            <div key={c.sym} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderLeft: "2px solid var(--brand)", borderRadius: 3, padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <span style={{ fontFamily: "var(--font-ui)", fontWeight: 600, fontSize: 14, color: "var(--ink-1000)" }}>{c.sym}</span>
                  <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-muted)", marginLeft: 8 }}>{c.strat}</span>
                </div>
                <span className="t-mono" style={{ fontSize: 13, color: "var(--brand)" }}>{c.score.toFixed(2)}</span>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10 }}>
                <span className="t-label" style={{ fontSize: 9 }}>Regime</span>
                <div style={{ flex: 1, height: 3, background: "var(--ink-300)", borderRadius: 2, position: "relative" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${c.regime * 100}%`, background: "var(--up-500)" }} />
                </div>
                <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)" }}>{c.regime.toFixed(2)}</span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--ink-900)", marginTop: 10, lineHeight: 1.45 }}>{c.note}</div>
              <div style={{ marginTop: 12, display: "flex", gap: 6, alignItems: "center" }}>
                {c.signals.map(s => <Chip key={s} tone="up">{s}</Chip>)}
                <span style={{ flex: 1 }} />
                <button style={{ padding: "6px 12px", fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", background: "var(--brand)", color: "var(--brand-on)", border: 0, borderRadius: 2, cursor: "default" }}>Stage</button>
                <button style={{ padding: "6px 12px", fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", background: "transparent", color: "var(--fg-muted)", border: "1px solid var(--border)", borderRadius: 2, cursor: "default" }}>Skip</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── analytics ───────────────────────────────────────────────────────────────

const AnalyticsPage = () => {
  const equity = useMemo(() => Array.from({ length: 90 }, (_, i) =>
    100000 + i * 120 + Math.sin(i / 7) * 1800 + (i > 60 ? (i - 60) * 80 : 0)
  ), []);
  const ddCurve = useMemo(() => equity.map((v, i) => {
    const peak = Math.max(...equity.slice(0, i + 1));
    return ((v - peak) / peak) * 100;
  }), [equity]);

  const buckets = [
    { name: "Momentum & Quality", contrib: 4280, pct: 1.51 },
    { name: "Regime Adaptive",    contrib: 1820, pct: 0.64 },
    { name: "PEAD",               contrib: 612,  pct: 0.22 },
    { name: "Pairs · Sector",     contrib: 410,  pct: 0.14 },
    { name: "AI Alpha",           contrib: -1180, pct: -0.42 },
    { name: "Mean Reversion",     contrib: 0,    pct: 0 },
  ];
  const max = Math.max(...buckets.map(b => Math.abs(b.contrib)));

  const sectors = [
    { name: "Semiconductors", pct: 6.4 },
    { name: "Tech · large cap", pct: 3.2 },
    { name: "Energy", pct: 1.1 },
    { name: "Healthcare", pct: -1.3 },
    { name: "Financials", pct: 1.8 },
    { name: "Industrials", pct: 0.4 },
  ];

  const winners = [
    { sym: "NVDA", strat: "M&Q",  pl: 1602 },
    { sym: "SPY",  strat: "Reg",  pl: 5145 },
    { sym: "AAPL", strat: "M&Q",  pl: 844 },
    { sym: "MSFT", strat: "M&Q",  pl: 600 },
    { sym: "JPM",  strat: "Pair", pl: 412 },
  ];
  const losers = [
    { sym: "UNH",  strat: "AI",   pl: -272 },
    { sym: "AMD",  strat: "M&Q",  pl: -148 },
    { sym: "TSLA", strat: "Mean", pl: -86 },
  ];

  const monthly = [
    [2024, [1.2, -0.4, 2.8, 1.5, -1.2, 0.8, 3.4, 2.1, -0.6, 1.9, 2.4, null]],
    [2023, [0.8, 1.4, -2.1, 1.2, 0.4, 1.8, -0.6, 1.4, 2.2, -0.8, 0.6, 1.1]],
  ];

  return (
    <div style={{ overflow: "auto", height: "100%", padding: "24px 32px 60px" }}>
      <div style={{ paddingBottom: 18, borderBottom: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div className="t-label">Analytics</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 44, color: "var(--ink-1000)", letterSpacing: "-0.025em", lineHeight: 1, marginTop: 6 }}>Performance · review</div>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {["7D", "30D", "90D", "YTD", "1Y", "ALL"].map(p => (
            <button key={p} style={{ padding: "6px 11px", fontFamily: "var(--font-mono)", fontSize: 11, color: p === "30D" ? "var(--ink-1000)" : "var(--fg-muted)", background: p === "30D" ? "var(--bg-elev-1)" : "transparent", border: p === "30D" ? "1px solid var(--border)" : "1px solid transparent", borderRadius: 3, cursor: "default" }}>{p}</button>
          ))}
        </div>
      </div>

      {/* hero stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 28, padding: "22px 0 20px", borderBottom: "1px solid var(--border-hair)" }}>
        <Stat label="P&L · 30d" value="+$5,962" tone="up" big />
        <Stat label="Sharpe" value="1.32" />
        <Stat label="Win rate" value="64%" />
        <Stat label="Profit factor" value="1.47" />
        <Stat label="Max DD" value="−4.1%" tone="down" />
        <Stat label="Avg hold" value="6.4d" />
      </div>

      {/* equity + drawdown */}
      <div style={{ marginTop: 22, background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div className="t-label">Equity curve · 90 days</div>
          <div style={{ display: "flex", gap: 14, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>
            <span>Start <span style={{ color: "var(--ink-1000)" }}>$100,000</span></span>
            <span>Now <span style={{ color: "var(--up-500)" }}>$112,840</span></span>
            <span>+12.84%</span>
          </div>
        </div>
        <div style={{ position: "relative", height: 220 }}>
          <Sparkline data={equity} color="var(--up-500)" width={1200} height={220} fill />
        </div>
        <div style={{ borderTop: "1px solid var(--border-hair)", marginTop: 10, paddingTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <div className="t-label">Drawdown</div>
            <span className="t-mono" style={{ fontSize: 10.5, color: "var(--down-500)" }}>Max −4.1% · current −0.6%</span>
          </div>
          <div style={{ position: "relative", height: 60 }}>
            <Sparkline data={ddCurve} color="var(--down-500)" width={1200} height={60} fill />
          </div>
        </div>
      </div>

      {/* monthly heatmap */}
      <div style={{ marginTop: 24 }}>
        <div className="t-label" style={{ marginBottom: 10 }}>Monthly returns</div>
        <div style={{ display: "grid", gridTemplateColumns: "44px repeat(12, 1fr)", gap: 4, marginBottom: 4 }}>
          <span></span>
          {["J","F","M","A","M","J","J","A","S","O","N","D"].map((m, i) => (
            <span key={i} className="t-label" style={{ fontSize: 9, color: "var(--fg-hint)", textAlign: "center" }}>{m}</span>
          ))}
        </div>
        {monthly.map(([y, vals]) => <div key={y} style={{ marginBottom: 4 }}>{monthsRow(y, vals)}</div>)}
      </div>

      {/* attribution */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginTop: 30 }}>
        <div>
          <div className="t-label" style={{ marginBottom: 14 }}>By strategy</div>
          {buckets.map(b => (
            <div key={b.name} style={{ display: "grid", gridTemplateColumns: "180px 1fr 90px", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--border-hair)", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)" }}>{b.name}</span>
              <div style={{ position: "relative", height: 6, background: "var(--ink-300)", borderRadius: 1 }}>
                <div style={{ position: "absolute", left: "50%", top: 0, height: "100%", width: `${(Math.abs(b.contrib) / max) * 50}%`, transform: b.contrib < 0 ? "translateX(-100%)" : "translateX(0)", background: b.contrib >= 0 ? "var(--up-500)" : "var(--down-500)" }} />
                <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--border-strong)" }} />
              </div>
              <span className={b.contrib >= 0 ? "u-profit t-mono" : "u-loss t-mono"} style={{ fontSize: 12, textAlign: "right" }}>{b.contrib >= 0 ? "+" : ""}${b.contrib.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="t-label" style={{ marginBottom: 14 }}>By sector</div>
          {sectors.map(s => (
            <div key={s.name} style={{ display: "grid", gridTemplateColumns: "180px 1fr 60px", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--border-hair)", alignItems: "center" }}>
              <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)" }}>{s.name}</span>
              <div style={{ position: "relative", height: 6, background: "var(--ink-300)", borderRadius: 1 }}>
                <div style={{ position: "absolute", left: "50%", top: 0, height: "100%", width: `${(Math.abs(s.pct) / 8) * 50}%`, transform: s.pct < 0 ? "translateX(-100%)" : "translateX(0)", background: s.pct >= 0 ? "var(--up-500)" : "var(--down-500)" }} />
              </div>
              <Delta value={s.pct} dec={1} style={{ textAlign: "right", fontSize: 12 }} />
            </div>
          ))}
        </div>
      </div>

      {/* winners / losers */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32, marginTop: 30 }}>
        <div>
          <div className="t-label" style={{ marginBottom: 12 }}>Top winners · 30d</div>
          {winners.map(w => (
            <div key={w.sym} style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px", gap: 14, padding: "9px 0", borderBottom: "1px solid var(--border-hair)", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{w.sym} <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11, color: "var(--fg-muted)", fontWeight: 400 }}>{w.strat}</span></span>
              <div style={{ height: 4, background: "var(--ink-300)", borderRadius: 1, position: "relative" }}>
                <div style={{ height: "100%", width: `${(w.pl / 5145) * 100}%`, background: "var(--up-500)" }} />
              </div>
              <span className="u-profit t-mono" style={{ fontSize: 12, textAlign: "right" }}>+${w.pl.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <div>
          <div className="t-label" style={{ marginBottom: 12 }}>Top losers · 30d</div>
          {losers.map(l => (
            <div key={l.sym} style={{ display: "grid", gridTemplateColumns: "1fr 80px 100px", gap: 14, padding: "9px 0", borderBottom: "1px solid var(--border-hair)", alignItems: "baseline" }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{l.sym} <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11, color: "var(--fg-muted)", fontWeight: 400 }}>{l.strat}</span></span>
              <div style={{ height: 4, background: "var(--ink-300)", borderRadius: 1, position: "relative" }}>
                <div style={{ height: "100%", width: `${(Math.abs(l.pl) / 272) * 100}%`, background: "var(--down-500)" }} />
              </div>
              <span className="u-loss t-mono" style={{ fontSize: 12, textAlign: "right" }}>−${Math.abs(l.pl).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── alerts ──────────────────────────────────────────────────────────────────

const AlertsPage = () => {
  const [filter, setFilter] = useState("all");

  const all = [
    { tone: "up",      kind: "trade",   ts: "Today 11:14",  text: "NVDA filled · 250 @ 134.82 · M&Q strategy.", group: "today" },
    { tone: "up",      kind: "signal",  ts: "Today 10:42",  text: "AMD pivot break triggered · regime fit 0.78 · candidate staged.", group: "today" },
    { tone: "neutral", kind: "news",    ts: "Today 09:08",  text: "Fed minutes due 14:00 · 4 names in book have rate sensitivity.", group: "today" },
    { tone: "down",    kind: "risk",    ts: "Today 08:30",  text: "Daily risk-budget at 62% used · approaching cap.", group: "today" },
    { tone: "neutral", kind: "trade",   ts: "Yest 16:01",   text: "Daily P&L close: +$1,840 · within strategy expectations.", group: "yesterday" },
    { tone: "down",    kind: "trade",   ts: "Yest 14:22",   text: "TSLA broke −2% intraday stop on Pairs · Sector. Closed automatically.", group: "yesterday" },
    { tone: "up",      kind: "signal",  ts: "Yest 09:35",   text: "PEAD signal triggered for XOM after better-than-est earnings.", group: "yesterday" },
    { tone: "neutral", kind: "news",    ts: "Mon 16:00",    text: "Weekly summary ready · click to read briefing.", group: "week" },
    { tone: "neutral", kind: "risk",    ts: "Mon 11:42",    text: "Position concentration in NVDA reaching 12.9% — cap is 15%.", group: "week" },
  ];

  const kinds = [
    { id: "all",    label: "All" },
    { id: "trade",  label: "Trades" },
    { id: "signal", label: "Signals" },
    { id: "risk",   label: "Risk" },
    { id: "news",   label: "News & macro" },
  ];

  const filtered = filter === "all" ? all : all.filter(a => a.kind === filter);
  const groups = [
    { id: "today",     label: "Today" },
    { id: "yesterday", label: "Yesterday" },
    { id: "week",      label: "Earlier this week" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", height: "100%", overflow: "hidden", gap: 1, background: "var(--border)" }}>
      <section style={{ background: "var(--bg)", overflow: "auto", padding: "24px 32px 60px" }}>
        <div style={{ paddingBottom: 18, borderBottom: "1px solid var(--border-hair)" }}>
          <div className="t-label">Alerts</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 44, color: "var(--ink-1000)", letterSpacing: "-0.025em", lineHeight: 1, marginTop: 6 }}>Things that need you</div>
        </div>

        {/* filter chips */}
        <div style={{ display: "flex", gap: 4, padding: "16px 0", borderBottom: "1px solid var(--border-hair)" }}>
          {kinds.map(k => {
            const count = k.id === "all" ? all.length : all.filter(a => a.kind === k.id).length;
            return (
              <button key={k.id} onClick={() => setFilter(k.id)} style={{
                padding: "6px 11px", fontFamily: "var(--font-ui)", fontSize: 11.5,
                color: filter === k.id ? "var(--ink-1000)" : "var(--fg-muted)",
                background: filter === k.id ? "var(--bg-elev-1)" : "transparent",
                border: filter === k.id ? "1px solid var(--border)" : "1px solid transparent",
                borderRadius: 3, cursor: "default", display: "inline-flex", alignItems: "center", gap: 6,
              }}>
                {k.label}
                <span className="t-mono" style={{ fontSize: 10, color: filter === k.id ? "var(--brand)" : "var(--fg-hint)" }}>{count}</span>
              </button>
            );
          })}
        </div>

        {groups.map(g => {
          const list = filtered.filter(a => a.group === g.id);
          if (list.length === 0) return null;
          return (
            <div key={g.id} style={{ marginTop: 22 }}>
              <div className="t-label" style={{ marginBottom: 8, color: "var(--fg-hint)" }}>{g.label}</div>
              {list.map((a, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "auto auto auto 1fr auto", gap: 14, padding: "13px 0", borderBottom: "1px solid var(--border-hair)", alignItems: "baseline" }}>
                  <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-hint)", letterSpacing: "0.04em", minWidth: 90 }}>{a.ts}</span>
                  <StatusDot tone={a.tone === "up" ? "up" : a.tone === "down" ? "down" : "neutral"} size={6} />
                  <Chip tone="muted">{a.kind}</Chip>
                  <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: "var(--ink-900)", lineHeight: 1.45, letterSpacing: "-0.005em" }}>{a.text}</span>
                  <a style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--brand)", cursor: "default" }}>Open →</a>
                </div>
              ))}
            </div>
          );
        })}
      </section>

      {/* alert rules sidebar */}
      <aside style={{ background: "var(--bg)", overflow: "auto", padding: "24px 22px 60px" }}>
        <div className="t-label">Active rules</div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", letterSpacing: "-0.02em", lineHeight: 1.05, marginTop: 6 }}>What you're listening for</div>

        <div style={{ marginTop: 20 }}>
          {[
            { name: "Daily risk budget", crit: "Notify when ≥ 60% used", on: true },
            { name: "Position concentration", crit: "Notify when any name ≥ 12%", on: true },
            { name: "Strategy stop hit", crit: "Always notify", on: true },
            { name: "PEAD signals", crit: "Active for current book", on: true },
            { name: "Macro events", crit: "FOMC, CPI, NFP", on: true },
            { name: "Sector rotation", crit: "Notify on regime shift", on: false },
          ].map((r, i) => (
            <div key={i} style={{ padding: "12px 0", borderBottom: "1px solid var(--border-hair)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--ink-1000)", fontWeight: 500 }}>{r.name}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--font-ui)", fontSize: 10, color: r.on ? "var(--up-500)" : "var(--fg-hint)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  <StatusDot tone={r.on ? "up" : "off"} size={4} />
                  {r.on ? "On" : "Off"}
                </span>
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-muted)", marginTop: 2 }}>{r.crit}</div>
            </div>
          ))}
        </div>

        <button style={{ width: "100%", marginTop: 20, padding: "10px 14px", fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", background: "var(--brand)", color: "var(--brand-on)", border: 0, borderRadius: 3, cursor: "default" }}>＋ Add rule</button>
      </aside>
    </div>
  );
};

// ─── shared style ────────────────────────────────────────────────────────────

const btnGhostS = {
  padding: "8px 14px",
  fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600,
  letterSpacing: "0.12em", textTransform: "uppercase",
  background: "var(--ink-100)", color: "var(--fg-dim)",
  border: "1px solid var(--border)", borderRadius: 3,
  cursor: "default",
};

// ─── stub ────────────────────────────────────────────────────────────────────

const StubPage = ({ title }) => (
  <div style={{ padding: "60px 48px", display: "flex", flexDirection: "column", gap: 14, alignItems: "flex-start" }}>
    <div className="t-label">Coming soon</div>
    <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 64, color: "var(--ink-1000)", letterSpacing: "-0.025em", fontWeight: 400 }}>{title}</h1>
    <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--fg-dim)", maxWidth: 520, lineHeight: 1.5 }}>
      This page lives in the redesign brief, but the prototype focused attention on Dashboard and the Ticker/Research surface. Tap the nav above to return to those.
    </div>
  </div>
);

if (typeof window !== "undefined") Object.assign(window, { LegacyStrategiesPage, PipelinePage, AnalyticsPage, AlertsPage, StubPage });


// Strategies — book catalogue.
// The strategies page is the INDEX of every strategy in the system, grouped
// by readiness stage. Detail lives on the per-strategy Playbook page.

const STRAT_CATALOG = [
  // — LIVE (autonomous, real money) —
  { id: "momentum-quality",  name: "Cross-Sectional Momentum + Quality", short: "Momentum + Quality", group: "Fundamental", stage: "live",     kind: "auto",     regime: "Thrives in bull trends",                    sharpe: 1.42, cagr:  0.184, maxDD: -0.041, win: 0.62, positions: 4, invested:  96400, mtd:  3.42 },
  { id: "pead",              name: "Post-Earnings Announcement Drift",   short: "PEAD",               group: "Fundamental", stage: "live",     kind: "auto",     regime: "Event-driven, all regimes",                  sharpe: 0.94, cagr:  0.112, maxDD: -0.028, win: 0.58, positions: 1, invested:  42100, mtd:  0.62 },
  { id: "regime-adaptive",   name: "SMA + VIX Regime Allocation",        short: "Regime Adaptive",    group: "Fundamental", stage: "live",     kind: "auto",     regime: "Adjusts to any regime",                      sharpe: 1.18, cagr:  0.094, maxDD: -0.032, win: 0.55, positions: 1, invested:  51200, mtd:  1.84 },
  { id: "sector-rotation",   name: "Sector Rotation Model",              short: "Sector Rotation",    group: "Fundamental", stage: "live",     kind: "auto",     regime: "Monthly GICS rotation · bond risk-off",      sharpe: 1.08, cagr:  0.142, maxDD: -0.067, win: 0.61, positions: 3, invested:  38200, mtd:  1.21 },
  { id: "ts-momentum",       name: "Time-Series Momentum",               short: "TS Momentum",        group: "Technical",   stage: "live",     kind: "auto",     regime: "Sign-of-12M ETF momentum",                   sharpe: 0.86, cagr:  0.082, maxDD: -0.054, win: 0.54, positions: 2, invested:  18400, mtd:  0.74 },
  { id: "rsi2-reversal",     name: "RSI-2 Mean Reversion",               short: "RSI-2 Reversal",     group: "Technical",   stage: "live",     kind: "auto",     regime: "Short-term dip buying · 75% win rate",       sharpe: 1.24, cagr:  0.098, maxDD: -0.051, win: 0.74, positions: 2, invested:  21800, mtd:  0.92 },
  { id: "dual-momentum",     name: "Dual Momentum",                      short: "Dual Momentum",      group: "Technical",   stage: "live",     kind: "auto",     regime: "GEM: US / ex-US / bonds",                    sharpe: 0.78, cagr:  0.071, maxDD: -0.082, win: 0.51, positions: 1, invested:  14200, mtd:  0.31 },
  { id: "pairs-trading",     name: "Statistical Arbitrage Pairs",        short: "Pairs Trading",      group: "Technical",   stage: "live",     kind: "auto",     regime: "Market-neutral · all regimes",               sharpe: 0.86, cagr:  0.062, maxDD: -0.014, win: 0.68, positions: 2, invested:  14200, mtd:  0.41 },
  // — PAPER-ONLY —
  { id: "kama-breakout",     name: "KAMA + ATR Breakout",                short: "KAMA Breakout",      group: "Technical",   stage: "paper",    kind: "auto",     regime: "Vol-adaptive squeeze breakouts",             sharpe: null, cagr: null,    maxDD: null,    win: null, positions: 0, invested:      0, mtd:  0.00, paperReason: "Thin OOS sample · 38 trades" },
  { id: "orb",               name: "Opening Range Breakout",             short: "ORB",                group: "Technical",   stage: "paper",    kind: "auto",     regime: "Paper-only intraday breakout",               sharpe: 4.78, cagr:  0.412, maxDD: -0.018, win: 0.81, positions: 0, invested:      0, mtd:  0.00, paperReason: "Live disabled · in-sample fit risk" },
  { id: "vwap-strategy",     name: "VWAP Bounce / Breakout",             short: "VWAP",               group: "Technical",   stage: "paper",    kind: "auto",     regime: "Paper-only VWAP pullback",                   sharpe: 1.04, cagr:  0.082, maxDD: -0.041, win: 0.62, positions: 0, invested:      0, mtd:  0.00, paperReason: "Awaiting intraday data feed" },
  // — RESEARCH (read-only screeners) —
  { id: "earnings-options",  name: "Earnings Options Play",              short: "Earnings Options",   group: "Fundamental", stage: "research", kind: "research", regime: "Research screener · pick your own trade",    sharpe: null, cagr: null,    maxDD: null,    win: null, positions: 0, invested:      0, mtd:  0.00 },
  { id: "trading-agents",    name: "TradingAgents Research",             short: "TradingAgents",      group: "Fundamental", stage: "research", kind: "research", regime: "Multi-agent thesis desk · read-only",        sharpe: null, cagr: null,    maxDD: null,    win: null, positions: 0, invested:      0, mtd:  0.00 },
  // — COMING SOON (planned) —
  { id: "ai-alpha",          name: "AI Alpha",                           short: "AI Alpha",           group: "Fundamental", stage: "planned",  kind: "auto",     regime: "AI-driven · regime-aware",                   sharpe: null, cagr: null,    maxDD: null,    win: null, positions: 0, invested:      0, mtd:  0.00, planNote: "Needs price-feature pipeline" },
  { id: "mean-reversion",    name: "Mean Reversion",                     short: "Mean Reversion",     group: "Technical",   stage: "planned",  kind: "auto",     regime: "Favored in sideways markets",                sharpe: null, cagr: null,    maxDD: null,    win: null, positions: 0, invested:      0, mtd:  0.00, planNote: "Priority gap · negative-corr to momentum" },
  { id: "vcp-breakout",      name: "VCP Breakout",                       short: "VCP",                group: "Technical",   stage: "planned",  kind: "auto",     regime: "Minervini SEPA methodology",                 sharpe: null, cagr: null,    maxDD: null,    win: null, positions: 0, invested:      0, mtd:  0.00, planNote: "Spec drafted · awaiting backtest" },
  { id: "gap-fill",          name: "Overnight Gap Fill",                 short: "Gap Fill",           group: "Technical",   stage: "planned",  kind: "auto",     regime: "Planned intraday concept",                   sharpe: null, cagr: null,    maxDD: null,    win: null, positions: 0, invested:      0, mtd:  0.00, planNote: "Spec stage" },
  { id: "dividend-capture",  name: "Dividend Capture",                   short: "Dividend",           group: "Fundamental", stage: "planned",  kind: "auto",     regime: "Income-focused · stable markets",            sharpe: null, cagr: null,    maxDD: null,    win: null, positions: 0, invested:      0, mtd:  0.00, planNote: "Awaiting tax-lot integration" },
  // — OTHER —
  { id: "manual",            name: "Manual / Discretionary",             short: "Manual",             group: "Other",       stage: "manual",   kind: "auto",     regime: "Trader-initiated · all regimes",             sharpe: null, cagr: null,    maxDD: null,    win: null, positions: 1, invested:   8420, mtd:  0.18 },
];

const STRAT_FILTERS = [
  { id: "all",         label: "All" },
  { id: "ready",       label: "Ready" },
  { id: "paper",       label: "Paper-only" },
  { id: "research",    label: "Research" },
  { id: "planned",     label: "Coming soon" },
  { id: "needs-attn",  label: "Needs attention" },
];

const stageMatchesFilter = (stage, kind, f) => {
  if (f === "all") return true;
  if (f === "ready") return stage === "live";
  if (f === "paper") return stage === "paper";
  if (f === "research") return stage === "research" || kind === "research";
  if (f === "planned") return stage === "planned";
  if (f === "needs-attn") return stage === "paper" || stage === "planned";
  return true;
};

const StrategiesPage = ({ tweaks, onNav }) => {
  const [filter, setFilter] = useState("all");
  const [group, setGroup] = useState("all"); // all | fundamental | technical | other

  const filtered = STRAT_CATALOG.filter(s => stageMatchesFilter(s.stage, s.kind, filter))
    .filter(s => group === "all" || s.group.toLowerCase() === group);

  const counts = {
    live:     STRAT_CATALOG.filter(s => s.stage === "live").length,
    paper:    STRAT_CATALOG.filter(s => s.stage === "paper").length,
    research: STRAT_CATALOG.filter(s => s.stage === "research").length,
    planned:  STRAT_CATALOG.filter(s => s.stage === "planned").length,
    total:    STRAT_CATALOG.length,
  };

  const sections = [
    { key: "live",     title: "Live",        sub: "Real money · autonomous",                     stage: "live"     },
    { key: "paper",    title: "Paper-only",  sub: "Routed to Alpaca paper · live blocked",       stage: "paper"    },
    { key: "research", title: "Research",    sub: "Decision-support screeners · no auto-trading", stage: "research" },
    { key: "planned",  title: "Coming soon", sub: "Planned · spec drafted · not yet wired",      stage: "planned"  },
    { key: "manual",   title: "Manual",      sub: "Trader-initiated · ledger-tracked",           stage: "manual"   },
  ];

  return (
    <div style={{ padding: "20px 24px 60px", maxWidth: 1640, margin: "0 auto" }}>
      <SPHeader counts={counts} />
      <SPContribution />
      <SPWorkbench filter={filter} setFilter={setFilter} group={group} setGroup={setGroup} counts={counts} />
      <div style={{ display: "grid", gap: 26, marginTop: 18 }}>
        {sections.map(sec => {
          const items = filtered.filter(s => s.stage === sec.stage);
          if (items.length === 0) return null;
          return <SPSection key={sec.key} title={sec.title} sub={sec.sub} items={items} onNav={onNav} />;
        })}
        {filtered.length === 0 && (
          <div style={{ padding: "40px 0", textAlign: "center", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)" }}>No strategies match this filter.</div>
        )}
      </div>
      <SPGapsMemo onNav={onNav} />
      <SPCorrelation />
    </div>
  );
};

// ─── header ──────────────────────────────────────────────────────────────

function SPHeader({ counts }) {
  return (
    <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 0 14px", borderBottom: "1px solid var(--border-hair)", marginBottom: 18 }}>
      <div>
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>STRATEGIES / BOOK CATALOGUE</div>
        <h1 style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em" }}>
          The book of strategies
        </h1>
        <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 14, maxWidth: 640 }}>
          {counts.total} catalogued · {counts.live} live · {counts.paper} paper-only · {counts.research} research · {counts.planned} coming soon. Click any card to open its playbook.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>
        <StatusDot tone="up" size={6} />
        <span>Registry · synced 2m ago</span>
        <span style={{ marginLeft: 10, padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 3, color: "var(--ink-1000)", background: "var(--bg-elev-1)" }}>+ New strategy</span>
      </div>
    </header>
  );
}

// ─── today's contribution bar ────────────────────────────────────────────

function SPContribution() {
  const live = STRAT_CATALOG.filter(s => s.stage === "live" || s.stage === "manual");
  const total = live.reduce((a, s) => a + Math.abs(s.mtd) * (s.invested || 1), 0);
  // synthetic intraday $ contributions
  const pl = {
    "momentum-quality":  +1402,
    "pead":              +318,
    "regime-adaptive":   +186,
    "sector-rotation":   +94,
    "ts-momentum":       -82,
    "rsi2-reversal":     +212,
    "dual-momentum":     +18,
    "pairs-trading":     +64,
    "manual":            -38,
  };
  const day = Object.values(pl).reduce((a, b) => a + b, 0);
  const grossUp = Object.values(pl).filter(v => v > 0).reduce((a, b) => a + b, 0);
  const grossDn = Object.values(pl).filter(v => v < 0).reduce((a, b) => a + b, 0);
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "16px 18px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>TODAY'S CONTRIBUTION</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)", marginTop: 2 }}>What each strategy made today</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="t-mono" style={{ fontSize: 22, color: day >= 0 ? "var(--up-500)" : "var(--down-500)", fontWeight: 500 }}>
            {day >= 0 ? "+" : "−"}${Math.abs(day).toLocaleString()}
          </div>
          <div className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)" }}>
            <span style={{ color: "var(--up-500)" }}>+${grossUp.toLocaleString()}</span> / <span style={{ color: "var(--down-500)" }}>−${Math.abs(grossDn).toLocaleString()}</span>
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${live.length}, 1fr)`, gap: 4, alignItems: "end", height: 90 }}>
        {live.map(s => {
          const v = pl[s.id] || 0;
          const max = Math.max(...Object.values(pl).map(Math.abs));
          const h = (Math.abs(v) / max) * 100;
          return (
            <div key={s.id} style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", position: "relative", cursor: "default" }}>
              <div style={{
                height: `${h}%`,
                minHeight: 2,
                background: v >= 0 ? "var(--up-500)" : "var(--down-500)",
                opacity: 0.85,
                borderRadius: "1px 1px 0 0",
              }} />
              <div className="t-mono" style={{ fontSize: 9.5, color: v >= 0 ? "var(--up-500)" : "var(--down-500)", textAlign: "center", marginTop: 4 }}>
                {v >= 0 ? "+" : "−"}${Math.abs(v)}
              </div>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: 9.5, color: "var(--fg-hint)", textAlign: "center", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.short}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── readiness workbench ─────────────────────────────────────────────────

function SPWorkbench({ filter, setFilter, group, setGroup, counts }) {
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "14px 16px", marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>READINESS</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--ink-1000)", marginTop: 2 }}>What can trade, what's blocked, why</div>
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          {[
            { label: "Ready",       val: counts.live,     tone: "var(--up-500)" },
            { label: "Paper-only",  val: counts.paper,    tone: "var(--gold-300)" },
            { label: "Research",    val: counts.research, tone: "var(--brand)" },
            { label: "Coming soon", val: counts.planned,  tone: "var(--fg-muted)" },
          ].map(d => (
            <div key={d.label} style={{ minWidth: 64 }}>
              <div className="t-label" style={{ color: "var(--fg-hint)" }}>{d.label.toUpperCase()}</div>
              <div className="t-mono" style={{ fontSize: 18, color: d.tone, marginTop: 2, fontWeight: 500 }}>{d.val}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
        {STRAT_FILTERS.map(f => {
          const active = filter === f.id;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              padding: "6px 12px", fontFamily: "var(--font-ui)", fontSize: 12,
              border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
              background: active ? "var(--tint-brand-2)" : "var(--bg-elev-1)",
              color: active ? "var(--brand)" : "var(--fg-muted)",
              borderRadius: 3, cursor: "default", fontWeight: active ? 500 : 400,
            }}>{f.label}</button>
          );
        })}
        <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)", margin: "0 6px" }} />
        {[{ id: "all", l: "All groups" }, { id: "fundamental", l: "Fundamental" }, { id: "technical", l: "Technical" }, { id: "other", l: "Other" }].map(g => {
          const active = group === g.id;
          return (
            <button key={g.id} onClick={() => setGroup(g.id)} style={{
              padding: "6px 12px", fontFamily: "var(--font-ui)", fontSize: 12,
              border: `1px solid ${active ? "var(--border-strong)" : "var(--border)"}`,
              background: active ? "var(--bg-elev-2)" : "transparent",
              color: active ? "var(--ink-1000)" : "var(--fg-muted)",
              borderRadius: 3, cursor: "default",
            }}>{g.l}</button>
          );
        })}
      </div>
    </div>
  );
}

// ─── section ─────────────────────────────────────────────────────────────

function SPSection({ title, sub, items, onNav }) {
  return (
    <section>
      <header style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 24, color: "var(--ink-1000)", fontWeight: 400, letterSpacing: "-0.015em" }}>{title}</h2>
        <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-hint)" }}>{String(items.length).padStart(2, "0")}</span>
        <span style={{ flex: 1, height: 1, background: "var(--border-hair)" }} />
        <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-muted)" }}>{sub}</span>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 12 }}>
        {items.map(s => <SPCard key={s.id} s={s} onOpen={() => onNav("playbook", { strat: s.name })} />)}
      </div>
    </section>
  );
}

// ─── card ────────────────────────────────────────────────────────────────

function SPCard({ s, onOpen }) {
  const isPlanned = s.stage === "planned";
  const isResearch = s.stage === "research";
  const isPaper = s.stage === "paper";
  const isLive = s.stage === "live";
  const fmtPct = (x) => x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const fmtSharpe = (x) => x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(2)}`;
  const fmtDD = (x) => x == null ? "—" : `${(x * 100).toFixed(1)}%`;
  const fmtUsd = (n) => {
    if (!n) return "$0";
    if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  const readiness = isLive ? { label: "READY", tone: "var(--up-500)", reason: "Live, autonomous, unblocked" }
    : isPaper ? { label: "PAPER-ONLY", tone: "var(--gold-300)", reason: s.paperReason || "Routed to paper" }
    : isResearch ? { label: "READ-ONLY", tone: "var(--brand)", reason: "Screener · pick your own trade" }
    : isPlanned ? { label: "COMING SOON", tone: "var(--fg-muted)", reason: s.planNote || "Spec stage" }
    : { label: "MANUAL", tone: "var(--fg)", reason: "Trader-initiated · ledger-tracked" };

  return (
    <div onClick={onOpen} style={{
      background: "var(--ink-100)",
      border: isPlanned ? "1px dashed var(--border)" : "1px solid var(--border)",
      borderRadius: 4,
      padding: 16,
      display: "flex", flexDirection: "column", gap: 10,
      opacity: isPlanned ? 0.75 : 1,
      cursor: isPlanned ? "default" : "default",
      transition: "border-color 0.15s",
    }} onMouseEnter={e => { if (!isPlanned) e.currentTarget.style.borderColor = "var(--border-strong)"; }} onMouseLeave={e => { if (!isPlanned) e.currentTarget.style.borderColor = "var(--border)"; }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 19, color: "var(--ink-1000)", lineHeight: 1.15, letterSpacing: "-0.01em" }}>{s.name}</div>
          <div style={{ marginTop: 3, fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--fg-hint)", letterSpacing: "0.06em", textTransform: "uppercase" }}>{s.group}{isResearch ? " · RESEARCH" : ""}</div>
        </div>
        {isLive && <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 10, color: s.mtd >= 0 ? "var(--up-500)" : "var(--down-500)" }}>
          <StatusDot tone={s.mtd >= 0 ? "up" : "down"} size={5} />
          <span>{s.mtd >= 0 ? "+" : ""}{s.mtd.toFixed(2)}% MTD</span>
        </div>}
      </div>

      {/* readiness */}
      <div style={{ background: "var(--bg-elev-1)", border: "1px solid var(--border-hair)", borderRadius: 3, padding: "8px 10px", display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="t-mono" style={{ fontSize: 9.5, color: readiness.tone, padding: "1px 6px", border: `1px solid ${readiness.tone}`, borderRadius: 2, letterSpacing: "0.06em", fontWeight: 600 }}>{readiness.label}</span>
        <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg)", lineHeight: 1.35 }}>{readiness.reason}</span>
      </div>

      {/* regime note */}
      <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.4 }}>
        {s.regime}
      </div>

      {/* stats row */}
      {!isResearch && !isPlanned && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderTop: "1px solid var(--border-hair)", paddingTop: 10 }}>
          {[
            { label: "OOS SHARPE",  val: fmtSharpe(s.sharpe), tone: s.sharpe == null ? "var(--fg-muted)" : s.sharpe > 1 ? "var(--up-500)" : s.sharpe > 0 ? "var(--ink-1000)" : "var(--down-500)" },
            { label: "CAGR",        val: fmtPct(s.cagr),      tone: s.cagr == null ? "var(--fg-muted)" : "var(--ink-1000)" },
            { label: "MAX DD",      val: fmtDD(s.maxDD),      tone: s.maxDD == null ? "var(--fg-muted)" : "var(--down-500)" },
          ].map(c => (
            <div key={c.label}>
              <div className="t-label" style={{ fontSize: 9, color: "var(--fg-hint)" }}>{c.label}</div>
              <div className="t-mono" style={{ fontSize: 14, color: c.tone, marginTop: 2, fontWeight: 500 }}>{c.val}</div>
            </div>
          ))}
        </div>
      )}

      {/* research metrics */}
      {isResearch && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, borderTop: "1px solid var(--border-hair)", paddingTop: 10 }}>
          {s.id === "trading-agents" ? [
            { l: "MODE", v: "Read-only" },
            { l: "AGENTS", v: "6+ debate" },
            { l: "OUTPUT", v: "Saved memo" },
          ].map(x => (
            <div key={x.l}><div className="t-label" style={{ fontSize: 9, color: "var(--fg-hint)" }}>{x.l}</div><div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--ink-1000)", marginTop: 2 }}>{x.v}</div></div>
          )) : [
            { l: "THIS WEEK", v: "12 events" },
            { l: "AVG IV RANK", v: "62" },
            { l: "TOP SETUP", v: "Long straddle" },
          ].map(x => (
            <div key={x.l}><div className="t-label" style={{ fontSize: 9, color: "var(--fg-hint)" }}>{x.l}</div><div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--ink-1000)", marginTop: 2 }}>{x.v}</div></div>
          ))}
        </div>
      )}

      {/* footer */}
      {(isLive || s.stage === "manual") && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid var(--border-hair)", paddingTop: 8, fontFamily: "var(--font-mono)", fontSize: 11 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--fg-muted)" }}>
            <StatusDot tone={s.positions > 0 ? "up" : "off"} size={5} />
            <span style={{ color: "var(--ink-1000)", fontWeight: 500 }}>{s.positions}</span> open
          </span>
          <span style={{ color: "var(--fg-muted)" }}>Invested <span style={{ color: "var(--ink-1000)", fontWeight: 500 }}>{fmtUsd(s.invested)}</span></span>
        </div>
      )}
      {isPaper && (
        <div style={{ borderTop: "1px solid var(--border-hair)", paddingTop: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gold-300)", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--gold-300)" }} />
          <span>Live submission disabled</span>
        </div>
      )}
      {isPlanned && (
        <div style={{ borderTop: "1px dashed var(--border-hair)", paddingTop: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-hint)" }}>
          Catalogued · backend not yet wired
        </div>
      )}

      {/* hover affordance */}
      {!isPlanned && (
        <div style={{ marginTop: -2, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--brand)", display: "flex", alignItems: "center", gap: 6 }}>
          Open playbook →
        </div>
      )}
    </div>
  );
}

// ─── gaps memo (from research report) ────────────────────────────────────

function SPGapsMemo({ onNav }) {
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderLeft: "2px solid var(--brand)", borderRadius: 4, padding: "18px 22px", marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--gold-500)", boxShadow: "0 0 10px var(--gold-500)" }} />
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>AI · BOOK DIAGNOSTIC</div>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>last research review · April 8 · sharpe target 1.0–1.5</span>
      </div>
      <h3 style={{ margin: "12px 0 10px", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", fontWeight: 400, letterSpacing: "-0.015em" }}>
        What the book is missing
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
        {[
          { h: "Mean reversion gap",
            body: "Book is 100% momentum-oriented. Mean reversion is negatively-correlated with momentum — adding it cuts portfolio drawdown and adds 2–4% annual return. Highest-impact addition.",
            tone: "down", action: "Promote · Mean Reversion" },
          { h: "Intraday monitoring",
            body: "Stops are tracked but only checked twice a day. Move stops to native Alpaca OCO orders, plus a 60-second news poll and 11AM/2PM mid-day scans. Prevents the next UNH-style hold.",
            tone: "warn", action: "See Risk → Concentration" },
          { h: "Claude lacks price context",
            body: "AI Alpha analyses narratives without seeing charts, RSI, EMAs, or distance from 50/200 MA. Promote AI Alpha after the price-feature pipeline lands.",
            tone: "neutral", action: "AI Alpha · planned" },
        ].map((c, i) => (
          <div key={i}>
            <div className="t-label" style={{ color: c.tone === "down" ? "var(--down-500)" : c.tone === "warn" ? "var(--gold-300)" : "var(--brand)", letterSpacing: "0.18em" }}>{c.h}</div>
            <p style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg)", fontSize: 13.5, lineHeight: 1.55 }}>{c.body}</p>
            <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--brand)", letterSpacing: "0.05em" }}>{c.action} →</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── correlation matrix (small, between live strategies) ─────────────────

function SPCorrelation() {
  const live = ["Momentum + Q", "PEAD", "Regime", "Sector Rot", "TS Mom", "RSI-2", "Pairs"];
  const data = [
    [1.00, 0.31, 0.42, 0.61, 0.78, -0.18, 0.04],
    [0.31, 1.00, 0.18, 0.22, 0.24, -0.05, 0.02],
    [0.42, 0.18, 1.00, 0.51, 0.46, -0.08, 0.09],
    [0.61, 0.22, 0.51, 1.00, 0.58, -0.12, 0.06],
    [0.78, 0.24, 0.46, 0.58, 1.00, -0.21, 0.03],
    [-0.18, -0.05, -0.08, -0.12, -0.21, 1.00, 0.01],
    [0.04, 0.02, 0.09, 0.06, 0.03, 0.01, 1.00],
  ];
  const cellColor = (v) => {
    if (v < 0) {
      const t = Math.min(1, Math.abs(v) / 0.5);
      return `rgba(168,208,77, ${0.10 + t * 0.45})`;
    }
    const t = Math.max(0, (v - 0.2) / 0.8);
    return `rgba(201,166,107, ${0.06 + t * 0.50})`;
  };
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18, marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>STRATEGY CORRELATION · 90D</div>
          <h3 style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", fontWeight: 400 }}>How the strategies move together</h3>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>negative = diversifier</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `120px repeat(${live.length}, 1fr)`, gap: 2 }}>
        <div></div>
        {live.map(s => <div key={s} className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)", textAlign: "center", padding: "4px 0" }}>{s}</div>)}
        {data.map((row, ri) => (
          <React.Fragment key={ri}>
            <div className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", padding: "4px 6px", textAlign: "right" }}>{live[ri]}</div>
            {row.map((v, ci) => (
              <div key={ci} style={{
                background: ri === ci ? "var(--bg-elev-2)" : cellColor(v),
                fontFamily: "var(--font-mono)", fontSize: 10.5,
                color: Math.abs(v) > 0.6 ? "var(--ink-1000)" : "var(--fg)",
                textAlign: "center", padding: "8px 0",
                fontWeight: Math.abs(v) > 0.7 ? 600 : 400,
                border: ri === ci ? "1px solid var(--border-strong)" : "none"
              }}>{v.toFixed(2)}</div>
            ))}
          </React.Fragment>
        ))}
      </div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>
        RSI-2 is the only consistent diversifier (negative correlation to momentum cluster) · TS Mom + Momentum + Q overlap heavily (0.78) — consider consolidating
      </div>
    </div>
  );
}

if (typeof window !== "undefined") Object.assign(window, { StrategiesPage });


// Watchlists — first-class page.
// "Your bench of names" — the universe of symbols that strategies hunt within.

const WL_LISTS = [
  { id: "core",       name: "Core Universe",          owner: "you",    count: 84, purpose: "S&P 100 + your hand-picked adds. The default hunting ground for cross-sectional momentum.", feeds: ["Momentum + Q", "Sector Rot", "TS Mom"], updated: "Static · last edit Mar 12" },
  { id: "ai-semis",   name: "AI · Semis",             owner: "you",    count: 18, purpose: "Long-bias bench for the AI build cycle. Curated weekly.", feeds: ["Momentum + Q", "PEAD"], updated: "Static · last edit Apr 02" },
  { id: "earnings",   name: "Earnings · This week",   owner: "ai",     count: 22, purpose: "Auto-populated from the calendar. Drops tickers on Friday close.", feeds: ["PEAD", "Earnings Options"], updated: "Auto-rebuilt · 06:14 today" },
  { id: "rsi-dip",    name: "RSI-2 dip candidates",   owner: "ai",     count: 7,  purpose: "Names trading below the 200d MA with RSI-2 < 10. Refreshed pre-open.", feeds: ["RSI-2 Reversal"], updated: "Auto-rebuilt · 09:14 today" },
  { id: "mean-rev",   name: "Mean reversion bench",   owner: "ai",     count: 14, purpose: "Statistically extended names — z-score > 2.0 vs 60d mean. For when Mean Reversion goes live.", feeds: ["Mean Reversion (planned)"], updated: "Auto-rebuilt · 09:14 today" },
  { id: "ipo",        name: "Recent IPOs",            owner: "you",    count: 11, purpose: "IPO'd in the last 18 months, market cap > $5B. Manual add only.", feeds: [], updated: "Static · last edit Feb 28" },
  { id: "shorts",     name: "Short bench",            owner: "you",    count: 9,  purpose: "Distribution candidates · weak earnings + chart breakdown. Read-only for now.", feeds: ["Pairs Trading"], updated: "Static · last edit Mar 28" },
];

const WL_SYMBOLS = {
  core: [
    { sym: "NVDA", name: "Nvidia",            px: 134.82, chg:  1.74, pct:  1.31, vol: "28.4M", techScore: 92, fundScore: 88, signal: "long",     strats: ["Momentum + Q"], reason: "Held · Momentum + Q · entered Mar 18", earnings: null,  preMkt: 0.82 },
    { sym: "META", name: "Meta",              px: 612.40, chg:  8.30, pct:  1.37, vol: "11.2M", techScore: 88, fundScore: 91, signal: "candidate", strats: ["Momentum + Q","PEAD"], reason: "Pipeline candidate · Momentum + Q (3 confirmations)", earnings: null,  preMkt: 1.04 },
    { sym: "AMD",  name: "Adv. Micro",        px: 158.25, chg:  3.18, pct:  2.05, vol: "22.8M", techScore: 81, fundScore: 76, signal: "candidate", strats: ["Momentum + Q"], reason: "Watch · base building near 50d MA",                            earnings: "Apr 28", preMkt: 1.42 },
    { sym: "ASML", name: "ASML",              px: 712.80, chg: -4.20, pct: -0.59, vol: " 1.2M", techScore: 78, fundScore: 84, signal: "candidate", strats: ["Momentum + Q","PEAD"], reason: "Watch · earnings April 17",                                  earnings: "Apr 17", preMkt: -0.31 },
    { sym: "MSFT", name: "Microsoft",         px: 416.32, chg: -1.12, pct: -0.27, vol: " 8.4M", techScore: 74, fundScore: 92, signal: null,        strats: [], reason: "Bench · no signal", earnings: "Apr 24", preMkt: -0.18 },
    { sym: "GOOGL",name: "Alphabet",          px: 168.41, chg:  0.82, pct:  0.49, vol: " 9.1M", techScore: 71, fundScore: 90, signal: null,        strats: [], reason: "Bench · sector rotation candidate", earnings: "Apr 25", preMkt: 0.21 },
    { sym: "AAPL", name: "Apple",             px: 224.18, chg: -0.42, pct: -0.19, vol: "12.6M", techScore: 62, fundScore: 89, signal: null,        strats: [], reason: "Bench · trading sideways", earnings: "May 02", preMkt: -0.06 },
    { sym: "TSLA", name: "Tesla",             px: 248.50, chg: -3.40, pct: -1.35, vol: "31.2M", techScore: 48, fundScore: 64, signal: "avoid",     strats: [], reason: "Avoided · failed momentum filter (Mar)", earnings: "Apr 23", preMkt: -2.18 },
    { sym: "AVGO", name: "Broadcom",          px: 1842.20, chg: 12.40, pct:  0.68, vol: " 1.8M", techScore: 84, fundScore: 86, signal: null,       strats: [], reason: "Bench · approaching breakout level", earnings: null, preMkt: 0.42 },
    { sym: "CRM",  name: "Salesforce",        px: 312.45, chg: -2.18, pct: -0.69, vol: " 3.2M", techScore: 58, fundScore: 78, signal: null,        strats: [], reason: "Bench", earnings: null, preMkt: -0.34 },
    { sym: "AMZN", name: "Amazon",            px: 198.14, chg:  1.02, pct:  0.52, vol: "14.8M", techScore: 76, fundScore: 88, signal: null,        strats: [], reason: "Bench · base building", earnings: "Apr 30", preMkt: 0.62 },
    { sym: "NFLX", name: "Netflix",           px: 1024.30, chg:  4.20, pct:  0.41, vol: " 2.1M", techScore: 79, fundScore: 82, signal: null,       strats: [], reason: "Bench · trend intact", earnings: "Apr 18", preMkt: 0.14 },
  ],
  "ai-semis": [
    { sym: "NVDA", name: "Nvidia",            px: 134.82, chg:  1.74, pct:  1.31, vol: "28.4M", techScore: 92, fundScore: 88, signal: "long",     strats: ["Momentum + Q"], reason: "Held · cornerstone position", earnings: null, preMkt: 0.82 },
    { sym: "AMD",  name: "Adv. Micro",        px: 158.25, chg:  3.18, pct:  2.05, vol: "22.8M", techScore: 81, fundScore: 76, signal: "candidate", strats: ["Momentum + Q"], reason: "Pipeline candidate", earnings: "Apr 28", preMkt: 1.42 },
    { sym: "ASML", name: "ASML",              px: 712.80, chg: -4.20, pct: -0.59, vol: " 1.2M", techScore: 78, fundScore: 84, signal: "candidate", strats: ["PEAD"], reason: "Earnings April 17", earnings: "Apr 17", preMkt: -0.31 },
    { sym: "AVGO", name: "Broadcom",          px: 1842.20, chg: 12.40, pct: 0.68, vol: " 1.8M", techScore: 84, fundScore: 86, signal: null,       strats: [], reason: "Watch · breakout setup", earnings: null, preMkt: 0.42 },
    { sym: "TSM",  name: "Taiwan Semi",       px: 178.40, chg:  0.92, pct:  0.52, vol: " 4.2M", techScore: 75, fundScore: 88, signal: null,        strats: [], reason: "Bench", earnings: "Apr 17", preMkt: 0.18 },
    { sym: "MU",   name: "Micron",            px: 102.18, chg:  2.40, pct:  2.40, vol: "12.4M", techScore: 72, fundScore: 71, signal: null,        strats: [], reason: "Bench · cyclical recovery", earnings: null, preMkt: 1.02 },
  ],
  earnings: [
    { sym: "ASML", name: "ASML",              px: 712.80, chg: -4.20, pct: -0.59, vol: " 1.2M", techScore: 78, fundScore: 84, signal: "candidate", strats: ["PEAD"], reason: "PEAD will fade post-print", earnings: "Apr 17", preMkt: -0.31 },
    { sym: "NFLX", name: "Netflix",           px: 1024.30, chg:  4.20, pct:  0.41, vol: " 2.1M", techScore: 79, fundScore: 82, signal: null,       strats: [], reason: "PEAD watching · drift candidate", earnings: "Apr 18", preMkt: 0.14 },
    { sym: "TSLA", name: "Tesla",             px: 248.50, chg: -3.40, pct: -1.35, vol: "31.2M", techScore: 48, fundScore: 64, signal: "avoid",     strats: [], reason: "PEAD will short post-print if drift", earnings: "Apr 23", preMkt: -2.18 },
    { sym: "MSFT", name: "Microsoft",         px: 416.32, chg: -1.12, pct: -0.27, vol: " 8.4M", techScore: 74, fundScore: 92, signal: null,        strats: [], reason: "Bench", earnings: "Apr 24", preMkt: -0.18 },
    { sym: "GOOGL",name: "Alphabet",          px: 168.41, chg:  0.82, pct:  0.49, vol: " 9.1M", techScore: 71, fundScore: 90, signal: null,        strats: [], reason: "Bench", earnings: "Apr 25", preMkt: 0.21 },
    { sym: "AMD",  name: "Adv. Micro",        px: 158.25, chg:  3.18, pct:  2.05, vol: "22.8M", techScore: 81, fundScore: 76, signal: "candidate", strats: ["Momentum + Q"], reason: "Already long-bias · expects beat", earnings: "Apr 28", preMkt: 1.42 },
    { sym: "AMZN", name: "Amazon",            px: 198.14, chg:  1.02, pct:  0.52, vol: "14.8M", techScore: 76, fundScore: 88, signal: null,        strats: [], reason: "Bench", earnings: "Apr 30", preMkt: 0.62 },
    { sym: "AAPL", name: "Apple",             px: 224.18, chg: -0.42, pct: -0.19, vol: "12.6M", techScore: 62, fundScore: 89, signal: null,        strats: [], reason: "Bench", earnings: "May 02", preMkt: -0.06 },
  ],
  "rsi-dip": [
    { sym: "PFE",  name: "Pfizer",            px:  24.18, chg: -0.42, pct: -1.71, vol: "32.4M", techScore: 32, fundScore: 71, signal: "long",     strats: ["RSI-2 Reversal"], reason: "Held · RSI-2 = 6 · entered yest", earnings: null, preMkt: -0.42 },
    { sym: "JNJ",  name: "Johnson & J",       px: 148.20, chg: -1.42, pct: -0.95, vol: " 4.2M", techScore: 38, fundScore: 78, signal: "candidate", strats: ["RSI-2 Reversal"], reason: "RSI-2 = 8 · trigger ready", earnings: null, preMkt: -0.18 },
    { sym: "KO",   name: "Coca-Cola",         px:  64.18, chg: -0.32, pct: -0.50, vol: "10.4M", techScore: 41, fundScore: 76, signal: null,        strats: [], reason: "Watch · RSI-2 = 12", earnings: null, preMkt: -0.08 },
    { sym: "PEP",  name: "PepsiCo",           px: 158.20, chg: -0.62, pct: -0.39, vol: " 3.8M", techScore: 44, fundScore: 78, signal: null,        strats: [], reason: "Watch · RSI-2 = 14", earnings: null, preMkt: -0.12 },
  ],
  "mean-rev": [
    { sym: "GME",  name: "GameStop",          px:  28.40, chg:  4.20, pct: 17.36, vol: "92.4M", techScore: 88, fundScore: 18, signal: "candidate", strats: ["Mean Reversion (planned)"], reason: "Z = +3.4 · extended", earnings: null, preMkt: 12.4 },
    { sym: "PLTR", name: "Palantir",          px:  88.20, chg:  3.40, pct:  4.01, vol: "44.4M", techScore: 84, fundScore: 62, signal: "candidate", strats: ["Mean Reversion (planned)"], reason: "Z = +2.8", earnings: null, preMkt: 1.42 },
    { sym: "MSTR", name: "MicroStrategy",     px: 282.40, chg:  6.20, pct:  2.24, vol: "12.4M", techScore: 79, fundScore: 38, signal: "candidate", strats: ["Mean Reversion (planned)"], reason: "Z = +2.4", earnings: null, preMkt: 0.82 },
    { sym: "COIN", name: "Coinbase",          px: 228.40, chg:  3.20, pct:  1.42, vol: " 8.2M", techScore: 71, fundScore: 58, signal: null,        strats: [], reason: "Z = +2.1", earnings: null, preMkt: 0.42 },
  ],
  ipo: [
    { sym: "ARM",  name: "Arm Holdings",      px: 132.40, chg:  1.42, pct:  1.08, vol: " 4.2M", techScore: 72, fundScore: 68, signal: null,        strats: [], reason: "Bench · post-IPO base", earnings: null, preMkt: 0.42 },
    { sym: "RDDT", name: "Reddit",            px:  78.40, chg:  2.40, pct:  3.16, vol: " 8.4M", techScore: 78, fundScore: 52, signal: null,        strats: [], reason: "Bench · trend forming", earnings: null, preMkt: 0.82 },
    { sym: "BIRK", name: "Birkenstock",       px:  62.40, chg: -0.20, pct: -0.32, vol: " 1.2M", techScore: 58, fundScore: 71, signal: null,        strats: [], reason: "Bench", earnings: null, preMkt: -0.08 },
  ],
  shorts: [
    { sym: "TSLA", name: "Tesla",             px: 248.50, chg: -3.40, pct: -1.35, vol: "31.2M", techScore: 48, fundScore: 64, signal: "candidate", strats: ["Pairs Trading"], reason: "Short leg · paired vs RIVN", earnings: "Apr 23", preMkt: -2.18 },
    { sym: "BYND", name: "Beyond Meat",       px:   4.20, chg: -0.18, pct: -4.11, vol: " 4.2M", techScore: 28, fundScore: 18, signal: null,        strats: [], reason: "Short watch · breakdown", earnings: null, preMkt: -0.42 },
    { sym: "PTON", name: "Peloton",           px:   8.40, chg: -0.12, pct: -1.41, vol: "12.4M", techScore: 32, fundScore: 28, signal: null,        strats: [], reason: "Short watch", earnings: null, preMkt: -0.18 },
  ],
};

const WL_FILTERS = [
  { id: "all",       label: "All" },
  { id: "movers",    label: "Movers" },
  { id: "signals",   label: "With signal" },
  { id: "earnings",  label: "Earnings ≤ 7d" },
  { id: "premkt",    label: "Pre-mkt > 1%" },
  { id: "held",      label: "Held" },
];

const matchesWlFilter = (s, f) => {
  if (f === "all") return true;
  if (f === "movers") return Math.abs(s.pct) > 1.5;
  if (f === "signals") return s.signal && s.signal !== "avoid";
  if (f === "earnings") return !!s.earnings;
  if (f === "premkt") return Math.abs(s.preMkt || 0) > 1;
  if (f === "held") return s.signal === "long";
  return true;
};

const WatchlistsPage = ({ onNav }) => {
  const [activeId, setActiveId] = useState("core");
  const [filter, setFilter] = useState("all");
  const active = WL_LISTS.find(l => l.id === activeId);
  const symbols = (WL_SYMBOLS[activeId] || []).filter(s => matchesWlFilter(s, filter));

  return (
    <div style={{ padding: "20px 24px 60px", maxWidth: 1640, margin: "0 auto" }}>
      <WLHeader />
      <WLPulse />
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, marginTop: 16, alignItems: "start" }}>
        <WLRail lists={WL_LISTS} activeId={activeId} setActiveId={setActiveId} />
        <div style={{ display: "grid", gap: 12, minWidth: 0 }}>
          <WLActiveHeader list={active} onNav={onNav} />
          <WLFilterBar filter={filter} setFilter={setFilter} list={active} symbols={WL_SYMBOLS[activeId] || []} />
          <WLTable symbols={symbols} onNav={onNav} />
          <WLAIMemo list={active} />
        </div>
      </div>
    </div>
  );
};

// ─── header ──────────────────────────────────────────────────────────────

function WLHeader() {
  return (
    <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 0 14px", borderBottom: "1px solid var(--border-hair)", marginBottom: 16 }}>
      <div>
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>WATCHLISTS / BENCH</div>
        <h1 style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em" }}>
          Your bench of names
        </h1>
        <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 14, maxWidth: 720 }}>
          {WL_LISTS.length} lists · {WL_LISTS.reduce((a,l)=>a+l.count,0)} unique symbols. Lists feed strategies — strategies hunt only inside their assigned bench.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>
        <StatusDot tone="up" size={6} />
        <span>Auto-lists · refreshed 09:14</span>
        <span style={{ marginLeft: 10, padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 3, color: "var(--ink-1000)", background: "var(--bg-elev-1)" }}>+ New list</span>
      </div>
    </header>
  );
}

// ─── pulse band ──────────────────────────────────────────────────────────

function WLPulse() {
  // top movers, signals firing, earnings this week
  const all = Object.values(WL_SYMBOLS).flat();
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter(s => seen.has(s.sym) ? false : (seen.add(s.sym), true));
  };
  const gainers = dedupe([...all].sort((a,b)=>b.pct-a.pct).slice(0, 5));
  const losers  = dedupe([...all].sort((a,b)=>a.pct-b.pct).slice(0, 5));
  const signals = dedupe(all.filter(s => s.signal && s.signal !== "avoid")).slice(0, 5);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
      {[
        { title: "Top movers · gainers", tone: "var(--up-500)", items: gainers, valFn: s => `+${s.pct.toFixed(2)}%` },
        { title: "Top movers · laggards", tone: "var(--down-500)", items: losers, valFn: s => `${s.pct.toFixed(2)}%` },
        { title: "Signals firing today",  tone: "var(--brand)",   items: signals, valFn: s => s.signal === "long" ? "HELD" : s.signal === "candidate" ? "CAND" : "—" },
      ].map((card, i) => (
        <div key={i} style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "12px 14px" }}>
          <div className="t-eyebrow-italic" style={{ color: card.tone, letterSpacing: "0.2em" }}>{card.title}</div>
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {card.items.length === 0 && <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 12 }}>None</div>}
            {card.items.map(s => (
              <div key={s.sym} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--border-hair)" }}>
                <span className="t-mono" style={{ fontSize: 12, color: "var(--ink-1000)", fontWeight: 500 }}>{s.sym}</span>
                <span style={{ flex: 1, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-muted)", margin: "0 8px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                <span className="t-mono" style={{ fontSize: 11, color: card.tone, fontWeight: 500 }}>{card.valFn(s)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── left rail ───────────────────────────────────────────────────────────

function WLRail({ lists, activeId, setActiveId }) {
  return (
    <aside style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 12, position: "sticky", top: 12 }}>
      <div className="t-label" style={{ color: "var(--fg-hint)", padding: "0 4px 8px" }}>YOUR LISTS</div>
      <div style={{ display: "grid", gap: 2 }}>
        {lists.map(l => {
          const active = l.id === activeId;
          return (
            <button key={l.id} onClick={() => setActiveId(l.id)} style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "9px 10px",
              background: active ? "var(--bg-elev-2)" : "transparent",
              border: active ? "1px solid var(--border-strong)" : "1px solid transparent",
              borderLeft: active ? "2px solid var(--brand)" : "2px solid transparent",
              borderRadius: 3, cursor: "default",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: active ? "var(--ink-1000)" : "var(--fg)", fontWeight: active ? 500 : 400 }}>{l.name}</span>
                <span className="t-mono" style={{ fontSize: 10.5, color: active ? "var(--brand)" : "var(--fg-hint)" }}>{l.count}</span>
              </div>
              <div style={{ marginTop: 2, fontFamily: "var(--font-mono)", fontSize: 9.5, color: l.owner === "ai" ? "var(--brand)" : "var(--fg-hint)", letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {l.owner === "ai" ? "AI · auto" : "MANUAL"} · feeds {l.feeds.length}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 12, padding: "10px 4px 0", borderTop: "1px solid var(--border-hair)" }}>
        <div className="t-label" style={{ color: "var(--fg-hint)", marginBottom: 6 }}>QUICK ADD</div>
        <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "6px 8px", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3 }}>
          <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>$</span>
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)", flex: 1 }}>SYM…</span>
          <span className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.05em" }}>↵</span>
        </div>
      </div>
    </aside>
  );
}

// ─── active list header ──────────────────────────────────────────────────

function WLActiveHeader({ list, onNav }) {
  if (!list) return null;
  const isAI = list.owner === "ai";
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 28, color: "var(--ink-1000)", fontWeight: 400, letterSpacing: "-0.015em" }}>{list.name}</h2>
            <span className="t-mono" style={{ fontSize: 10, padding: "2px 7px", border: `1px solid ${isAI ? "var(--brand)" : "var(--border)"}`, color: isAI ? "var(--brand)" : "var(--fg-muted)", borderRadius: 2, letterSpacing: "0.05em" }}>
              {isAI ? "AI · AUTO-REBUILT" : "MANUAL"}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14.5, color: "var(--fg-muted)", maxWidth: 760, lineHeight: 1.5 }}>{list.purpose}</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-hint)" }}>{list.updated}</span>
          <span style={{ display: "flex", gap: 6 }}>
            <span style={{ padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--ink-1000)", background: "var(--bg-elev-1)" }}>Edit list</span>
            <span style={{ padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--fg-muted)" }}>Export</span>
          </span>
        </div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-hair)", display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div>
          <div className="t-label" style={{ color: "var(--fg-hint)" }}>SYMBOLS</div>
          <div className="t-mono" style={{ fontSize: 18, color: "var(--ink-1000)", fontWeight: 500, marginTop: 2 }}>{list.count}</div>
        </div>
        <span style={{ width: 1, height: 32, background: "var(--border-hair)" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t-label" style={{ color: "var(--fg-hint)" }}>FEEDS STRATEGIES</div>
          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
            {list.feeds.length === 0 && <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)" }}>None · reference list</span>}
            {list.feeds.map(f => (
              <span key={f} onClick={() => onNav("playbook", { strat: f })} style={{
                padding: "3px 9px", border: "1px solid var(--border)", borderRadius: 2,
                fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5,
                color: "var(--ink-1000)", background: "var(--bg-elev-1)", cursor: "default"
              }}>{f}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── filter bar ──────────────────────────────────────────────────────────

function WLFilterBar({ filter, setFilter, list, symbols }) {
  const counts = {
    all:      symbols.length,
    movers:   symbols.filter(s => Math.abs(s.pct) > 1.5).length,
    signals:  symbols.filter(s => s.signal && s.signal !== "avoid").length,
    earnings: symbols.filter(s => !!s.earnings).length,
    premkt:   symbols.filter(s => Math.abs(s.preMkt || 0) > 1).length,
    held:     symbols.filter(s => s.signal === "long").length,
  };
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {WL_FILTERS.map(f => {
        const active = filter === f.id;
        return (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: "6px 12px", fontFamily: "var(--font-ui)", fontSize: 12,
            border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
            background: active ? "rgba(201,166,107,0.15)" : "var(--bg-elev-1)",
            color: active ? "var(--brand)" : "var(--fg-muted)",
            borderRadius: 3, cursor: "default", display: "inline-flex", alignItems: "center", gap: 6,
          }}>
            <span>{f.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: active ? "var(--brand)" : "var(--fg-hint)" }}>{counts[f.id]}</span>
          </button>
        );
      })}
      <span style={{ flex: 1 }} />
      <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-hint)", alignSelf: "center", letterSpacing: "0.05em" }}>
        sort · % chg desc
      </span>
    </div>
  );
}

// ─── table ───────────────────────────────────────────────────────────────

function WLTable({ symbols, onNav }) {
  if (symbols.length === 0) {
    return (
      <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "32px 18px", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 15 }}>No symbols match this filter.</div>
      </div>
    );
  }
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 90px 80px 84px 110px 110px 1.6fr", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-elev-1)", gap: 12, alignItems: "center" }}>
        {["SYMBOL", "NAME", "PRICE", "% CHG", "VOL", "TECH / FUND", "STATUS", "WHY ON THIS LIST"].map(h => (
          <span key={h} className="t-label" style={{ color: "var(--fg-hint)" }}>{h}</span>
        ))}
      </div>
      {symbols.map((s, i) => <WLRow key={s.sym} s={s} odd={i % 2 === 1} onNav={onNav} />)}
    </div>
  );
}

function WLRow({ s, odd, onNav }) {
  const up = s.pct >= 0;
  const status = s.signal === "long" ? { label: "HELD", tone: "var(--up-500)" }
    : s.signal === "candidate" ? { label: "CANDIDATE", tone: "var(--brand)" }
    : s.signal === "avoid" ? { label: "AVOID", tone: "var(--down-500)" }
    : null;
  return (
    <div onClick={() => onNav("ticker", { ticker: s.sym })} style={{
      display: "grid", gridTemplateColumns: "100px 1fr 90px 80px 84px 110px 110px 1.6fr",
      padding: "10px 14px", borderBottom: "1px solid var(--border-hair)",
      background: odd ? "var(--bg-elev-1)" : "transparent",
      gap: 12, alignItems: "center", cursor: "default", transition: "background 0.15s",
    }} onMouseEnter={e => e.currentTarget.style.background = "var(--bg-elev-2)"}
       onMouseLeave={e => e.currentTarget.style.background = odd ? "var(--bg-elev-1)" : "transparent"}>
      <span className="t-mono" style={{ fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{s.sym}</span>
      <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
      <span className="t-mono" style={{ fontSize: 12, color: "var(--ink-1000)", textAlign: "right" }}>{s.px.toFixed(2)}</span>
      <span className="t-mono" style={{ fontSize: 12, color: up ? "var(--up-500)" : "var(--down-500)", textAlign: "right", fontWeight: 500 }}>{up ? "+" : ""}{s.pct.toFixed(2)}%</span>
      <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)", textAlign: "right" }}>{s.vol}</span>
      <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <ScoreBlock val={s.techScore} label="T" />
        <ScoreBlock val={s.fundScore} label="F" />
      </span>
      <span>
        {status ? (
          <span className="t-mono" style={{ fontSize: 9.5, padding: "2px 7px", border: `1px solid ${status.tone}`, color: status.tone, borderRadius: 2, letterSpacing: "0.05em", fontWeight: 600 }}>{status.label}</span>
        ) : (
          <span className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)" }}>—</span>
        )}
      </span>
      <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {s.reason}
        {s.earnings && <span className="t-mono" style={{ marginLeft: 8, fontSize: 9.5, color: "var(--gold-300)", padding: "1px 6px", border: "1px solid var(--gold-300)", borderRadius: 2, fontStyle: "normal" }}>EARN {s.earnings}</span>}
      </span>
    </div>
  );
}

function ScoreBlock({ val, label }) {
  const tone = val >= 75 ? "var(--up-500)" : val >= 50 ? "var(--ink-1000)" : val >= 35 ? "var(--gold-300)" : "var(--down-500)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 5px", border: "1px solid var(--border-hair)", borderRadius: 2, background: "var(--bg-elev-1)" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-hint)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: tone, fontWeight: 500 }}>{val}</span>
    </span>
  );
}

// ─── AI memo ─────────────────────────────────────────────────────────────

function WLAIMemo({ list }) {
  if (!list) return null;
  const memos = {
    core: [
      { h: "Today's standout", body: "META is your highest-conviction candidate today — Momentum + Q has 3 confirmation signals fired. Pipeline is queuing entry, awaiting allocation slot." },
      { h: "Watch the laggard", body: "TSLA is down 1.3% pre-market on delivery miss whispers. Already flagged AVOID after the March momentum filter. Holding the line." },
      { h: "Quiet bench", body: "Half the list is mid-range with no signal. That's healthy — momentum is concentrated, the rest waits for its turn." },
    ],
    "ai-semis": [
      { h: "Cycle intact", body: "5 of 6 names are in uptrend. The AI build cycle thesis is alive — keep the bench tight, don't over-add." },
      { h: "ASML earnings 17 Apr", body: "PEAD will fade or follow the post-print drift; consider sizing down ahead of print if you're long." },
      { h: "Watch AVGO", body: "Approaching breakout level (~$1850). Tech score 84 — a clean break makes it a Momentum + Q candidate." },
    ],
    earnings: [
      { h: "PEAD active", body: "ASML on Apr 17 is the first big test. PEAD will trade the drift autonomously — your scaled size, not max." },
      { h: "Pre-print sizing", body: "Three names you hold (MSFT, GOOGL, AMD) report next week. Review concentration before Friday close." },
      { h: "Volatility expected", body: "Tesla on Apr 23 is the wildcard. Already on AVOID — PEAD won't initiate, but options screener may surface." },
    ],
    "rsi-dip": [
      { h: "PFE held", body: "Entered yesterday at RSI-2 = 6. RSI now at 22 — within strategy hold band. Strategy will exit on close above 5d MA." },
      { h: "JNJ trigger ready", body: "RSI-2 = 8, below 200d MA, low-vol regime. RSI-2 Reversal will queue entry on next pre-open scan if conditions hold." },
      { h: "Avoid GME", body: "Not in this list — RSI-2 = 9 but above 200d MA. Mean reversion long against an extended uptrend is not the play." },
    ],
    "mean-rev": [
      { h: "Strategy not live yet", body: "Mean Reversion is on the planned roadmap (Phase 2). This bench is being curated now so the model has a clean universe at launch." },
      { h: "GME alert", body: "Z = +3.4 today — most extended in your bench. When Mean Reversion goes live, this is exactly the setup it'd short." },
    ],
    ipo: [],
    shorts: [
      { h: "Pairs Trading active", body: "TSLA / RIVN pair currently open — short TSLA, long RIVN, market-neutral. Pairs strategy manages exit." },
      { h: "Reference only", body: "BYND and PTON are watch-only. No strategy currently shorts directly outside the pairs book." },
    ],
  };
  const items = memos[list.id] || [{ h: "No notes", body: "AI hasn't generated insights for this list yet." }];
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderLeft: "2px solid var(--brand)", borderRadius: 4, padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold-500)", boxShadow: "0 0 10px var(--gold-500)" }} />
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>AI · BENCH NOTES</div>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>regenerated 09:14 · Claude</span>
      </div>
      <h3 style={{ margin: "10px 0 12px", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 20, color: "var(--ink-1000)", fontWeight: 400 }}>
        What's interesting on this bench today
      </h3>
      <div style={{ display: "grid", gridTemplateColumns: items.length === 3 ? "1fr 1fr 1fr" : items.length === 2 ? "1fr 1fr" : "1fr", gap: 18 }}>
        {items.map((m, i) => (
          <div key={i}>
            <div className="t-label" style={{ color: "var(--brand)", letterSpacing: "0.18em" }}>{m.h}</div>
            <p style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg)", fontSize: 13.5, lineHeight: 1.55 }}>{m.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

if (typeof window !== "undefined") Object.assign(window, { WatchlistsPage });


// Reports & Tax — realized P&L, tax lots, wash sales, document exports.

const TAX_YEARS = [
  { id: "2025", label: "2025", current: true },
  { id: "2024", label: "2024" },
  { id: "2023", label: "2023" },
  { id: "2022", label: "2022" },
];

const TAX_PERIODS = [
  { id: "ytd",  label: "Year-to-date" },
  { id: "q4",   label: "Q4" },
  { id: "q3",   label: "Q3" },
  { id: "q2",   label: "Q2" },
  { id: "q1",   label: "Q1" },
  { id: "year", label: "Full year" },
];

const REALIZED = [
  { sym: "NVDA", name: "Nvidia",           strategy: "Momentum + Q",     opened: "2024-08-26", closed: "2025-09-04", qty:  200, basis:  22460, proceeds:  23880, gain:  1420, term: "lt", wash: false },
  { sym: "META", name: "Meta",             strategy: "Momentum + Q",     opened: "2025-01-12", closed: "2025-03-22", qty:  100, basis:  56240, proceeds:  61200, gain:  4960, term: "st", wash: false },
  { sym: "AAPL", name: "Apple",            strategy: "Manual",           opened: "2024-11-04", closed: "2025-02-14", qty:  150, basis:  33180, proceeds:  35640, gain:  2460, term: "st", wash: false },
  { sym: "AMD",  name: "Adv. Micro",       strategy: "Momentum + Q",     opened: "2025-02-04", closed: "2025-02-28", qty:   80, basis:  11648, proceeds:  10288, gain: -1360, term: "st", wash: true },
  { sym: "AMD",  name: "Adv. Micro",       strategy: "Momentum + Q",     opened: "2025-03-12", closed: "2025-04-02", qty:  100, basis:  14820, proceeds:  15825, gain:  1005, term: "st", wash: false },
  { sym: "XOM",  name: "ExxonMobil",       strategy: "PEAD",             opened: "2025-02-08", closed: "2025-02-22", qty:  200, basis:  22980, proceeds:  23440, gain:   460, term: "st", wash: false },
  { sym: "JPM",  name: "JPMorgan",         strategy: "Sector Rotation",  opened: "2024-12-04", closed: "2025-01-18", qty:  100, basis:  23420, proceeds:  24380, gain:   960, term: "st", wash: false },
  { sym: "GOOGL",name: "Alphabet",         strategy: "PEAD",             opened: "2025-01-30", closed: "2025-02-04", qty:  150, basis:  28104, proceeds:  27420, gain:  -684, term: "st", wash: false },
  { sym: "TSLA", name: "Tesla",            strategy: "Manual",           opened: "2024-09-10", closed: "2025-01-20", qty:   50, basis:  12420, proceeds:  10780, gain: -1640, term: "st", wash: false },
  { sym: "PFE",  name: "Pfizer",           strategy: "RSI-2 Reversal",   opened: "2025-03-18", closed: "2025-03-21", qty:  500, basis:  12840, proceeds:  13180, gain:   340, term: "st", wash: false },
  { sym: "RIVN", name: "Rivian",           strategy: "Pairs Trading",    opened: "2025-02-01", closed: "2025-02-28", qty:  300, basis:   4680, proceeds:   4920, gain:   240, term: "st", wash: false },
  { sym: "TSLA", name: "Tesla",            strategy: "Pairs Trading",    opened: "2025-02-01", closed: "2025-02-28", qty:  -20, basis:   5240, proceeds:   5482, gain:   242, term: "st", wash: false },
];

const OPEN_LOTS = [
  { sym: "NVDA", strategy: "Momentum + Q", lot: "2025-03-18-A", qty:  300, openDate: "2025-03-18", basis: 38640, mkt: 40446, unreal:  1806, term: "st" },
  { sym: "META", strategy: "Momentum + Q", lot: "2025-03-22-A", qty:  100, openDate: "2025-03-22", basis: 60100, mkt: 61240, unreal:  1140, term: "st" },
  { sym: "AVGO", strategy: "Manual",       lot: "2024-12-08-A", qty:   25, openDate: "2024-12-08", basis: 41240, mkt: 46055, unreal:  4815, term: "lt" },
  { sym: "PFE",  strategy: "RSI-2 Reversal", lot: "2025-04-08-A", qty:  500, openDate: "2025-04-08", basis: 12180, mkt: 12090, unreal: -90, term: "st" },
  { sym: "XOM",  strategy: "PEAD",         lot: "2025-04-07-A", qty:  200, openDate: "2025-04-07", basis: 23280, mkt: 23420, unreal:   140, term: "st" },
  { sym: "VTI",  strategy: "Regime Adapt", lot: "2025-02-14-A", qty:  150, openDate: "2025-02-14", basis: 38420, mkt: 38740, unreal:   320, term: "st" },
];

const WASH_SALES = [
  { sym: "AMD", date: "2025-02-28", lossDisallowed:  -1360, replacement: "2025-03-12 · 100 sh @ $148.20", note: "30-day rule · loss added to basis of replacement lot" },
];

const DOCUMENTS = [
  { id: "1099b-2024", title: "Form 1099-B",        period: "Tax year 2024", available: true,  size: "412 KB", note: "Final · issued by Alpaca · Feb 14 2025" },
  { id: "yes-2024",   title: "Year-end summary",   period: "Tax year 2024", available: true,  size: "128 KB", note: "Realized + dividend + interest summary" },
  { id: "tradelog-2024", title: "Trade log (CSV)", period: "Tax year 2024", available: true,  size: "  88 KB", note: "All fills · ready for accountant import" },
  { id: "1099b-2025", title: "Form 1099-B",        period: "Tax year 2025", available: false, size: "—",      note: "Available February 2026" },
  { id: "yes-2025",   title: "Year-end summary",   period: "Tax year 2025", available: false, size: "—",      note: "Available January 2026 · preview YTD" },
  { id: "tradelog-2025", title: "Trade log (CSV)", period: "Tax year 2025", available: true,  size: " 142 KB", note: "Live export · YTD through today" },
];

const STRATEGY_ATTRIB = [
  { strat: "Momentum + Quality",   realized:  6025, openUnreal:  2946, fees: -84,  net:  6025, share: 0.42 },
  { strat: "PEAD",                 realized:  -224, openUnreal:   140, fees: -42,  net:  -224, share: 0.05 },
  { strat: "Sector Rotation",      realized:   960, openUnreal:     0, fees: -22,  net:   960, share: 0.12 },
  { strat: "RSI-2 Reversal",       realized:   340, openUnreal:   -90, fees: -14,  net:   340, share: 0.08 },
  { strat: "Pairs Trading",        realized:   482, openUnreal:     0, fees: -28,  net:   482, share: 0.06 },
  { strat: "Manual",               realized:   820, openUnreal:  4815, fees: -12,  net:   820, share: 0.27 },
];

const ReportsPage = ({ tweaks, onNav }) => {
  const [year, setYear] = useState("2025");
  const [period, setPeriod] = useState("ytd");
  const [tab, setTab] = useState("realized"); // realized | lots | wash | strategy | docs

  // totals
  const realized = REALIZED;
  const grossGains = realized.filter(r => r.gain > 0).reduce((a,r) => a + r.gain, 0);
  const grossLoss  = realized.filter(r => r.gain < 0).reduce((a,r) => a + r.gain, 0);
  const net        = grossGains + grossLoss;
  const stGain     = realized.filter(r => r.term === "st").reduce((a,r) => a + r.gain, 0);
  const ltGain     = realized.filter(r => r.term === "lt").reduce((a,r) => a + r.gain, 0);
  const washCount  = realized.filter(r => r.wash).length;
  const openUnreal = OPEN_LOTS.reduce((a,l) => a + l.unreal, 0);

  return (
    <div style={{ padding: "20px 24px 60px", maxWidth: 1640, margin: "0 auto" }}>
      <RPHeader />
      <RPPeriodBar year={year} setYear={setYear} period={period} setPeriod={setPeriod} />
      <RPMetrics net={net} grossGains={grossGains} grossLoss={grossLoss} stGain={stGain} ltGain={ltGain} washCount={washCount} openUnreal={openUnreal} count={realized.length} />
      <RPDisclaimer />
      <RPTabs tab={tab} setTab={setTab} counts={{ realized: realized.length, lots: OPEN_LOTS.length, wash: WASH_SALES.length, strategy: STRATEGY_ATTRIB.length, docs: DOCUMENTS.length }} />
      <div style={{ marginTop: 12 }}>
        {tab === "realized" && <RPRealized rows={realized} onNav={onNav} />}
        {tab === "lots"     && <RPLots     rows={OPEN_LOTS} onNav={onNav} />}
        {tab === "wash"     && <RPWash     rows={WASH_SALES} />}
        {tab === "strategy" && <RPStrategy rows={STRATEGY_ATTRIB} onNav={onNav} />}
        {tab === "docs"     && <RPDocs     rows={DOCUMENTS} />}
      </div>
    </div>
  );
};

// ─── header ──────────────────────────────────────────────────────────────

function RPHeader() {
  return (
    <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 0 14px", borderBottom: "1px solid var(--border-hair)", marginBottom: 16 }}>
      <div>
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>REPORTS / TAX & LOTS</div>
        <h1 style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em" }}>
          Reports & tax
        </h1>
        <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 14, maxWidth: 720 }}>
          Realized P&amp;L · open lots · wash sales · year-end documents. Numbers are preliminary until your broker issues final forms.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>
        <StatusDot tone="up" size={6} />
        <span>Reconciled with Alpaca · 09:14 today</span>
        <span style={{ marginLeft: 10, padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 3, color: "var(--ink-1000)", background: "var(--bg-elev-1)" }}>Export bundle</span>
      </div>
    </header>
  );
}

// ─── period bar ──────────────────────────────────────────────────────────

function RPPeriodBar({ year, setYear, period, setPeriod }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, padding: "10px 14px", background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4 }}>
      <span className="t-label" style={{ color: "var(--fg-hint)" }}>TAX YEAR</span>
      <div style={{ display: "flex", gap: 4 }}>
        {TAX_YEARS.map(y => {
          const active = year === y.id;
          return (
            <button key={y.id} onClick={() => setYear(y.id)} style={{
              padding: "5px 11px", fontFamily: "var(--font-mono)", fontSize: 12,
              border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
              background: active ? "rgba(201,166,107,0.15)" : "var(--bg-elev-1)",
              color: active ? "var(--brand)" : "var(--ink-1000)",
              borderRadius: 3, cursor: "default", fontWeight: active ? 600 : 400,
            }}>{y.label}{y.current && " · CURRENT"}</button>
          );
        })}
      </div>
      <span style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />
      <span className="t-label" style={{ color: "var(--fg-hint)" }}>PERIOD</span>
      <div style={{ display: "flex", gap: 4 }}>
        {TAX_PERIODS.map(p => {
          const active = period === p.id;
          return (
            <button key={p.id} onClick={() => setPeriod(p.id)} style={{
              padding: "5px 10px", fontFamily: "var(--font-ui)", fontSize: 11.5,
              border: `1px solid ${active ? "var(--border-strong)" : "var(--border)"}`,
              background: active ? "var(--bg-elev-2)" : "transparent",
              color: active ? "var(--ink-1000)" : "var(--fg-muted)",
              borderRadius: 3, cursor: "default",
            }}>{p.label}</button>
          );
        })}
      </div>
      <span style={{ flex: 1 }} />
      <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-hint)" }}>basis method · FIFO · change in Settings</span>
    </div>
  );
}

// ─── top metrics ─────────────────────────────────────────────────────────

function RPMetrics({ net, grossGains, grossLoss, stGain, ltGain, washCount, openUnreal, count }) {
  const fmt = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString()}`;
  const cells = [
    { label: "NET REALIZED", val: fmt(net), tone: net >= 0 ? "var(--up-500)" : "var(--down-500)", sub: `${count} closed lots` },
    { label: "GROSS GAINS",  val: `+$${grossGains.toLocaleString()}`, tone: "var(--up-500)",   sub: `${REALIZED.filter(r=>r.gain>0).length} winners` },
    { label: "GROSS LOSSES", val: `−$${Math.abs(grossLoss).toLocaleString()}`, tone: "var(--down-500)", sub: `${REALIZED.filter(r=>r.gain<0).length} losers` },
    { label: "SHORT-TERM",   val: fmt(stGain), tone: stGain >= 0 ? "var(--ink-1000)" : "var(--down-500)", sub: "ordinary income tax" },
    { label: "LONG-TERM",    val: fmt(ltGain), tone: ltGain >= 0 ? "var(--ink-1000)" : "var(--down-500)", sub: "preferential rate" },
    { label: "WASH SALES",   val: String(washCount), tone: washCount > 0 ? "var(--gold-300)" : "var(--fg-muted)", sub: washCount > 0 ? "loss deferred to basis" : "none flagged" },
    { label: "OPEN UNREAL.", val: fmt(openUnreal), tone: openUnreal >= 0 ? "var(--up-500)" : "var(--down-500)", sub: `${OPEN_LOTS.length} open lots` },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cells.length}, 1fr)`, gap: 0, background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "16px 18px", marginBottom: 14 }}>
      {cells.map((c, i) => (
        <div key={c.label} style={{ borderRight: i < cells.length - 1 ? "1px solid var(--border-hair)" : "none", paddingRight: 14, paddingLeft: i === 0 ? 0 : 14 }}>
          <div className="t-label" style={{ color: "var(--fg-hint)" }}>{c.label}</div>
          <div className="t-mono" style={{ fontSize: 20, color: c.tone, marginTop: 4, fontWeight: 500, letterSpacing: "-0.01em" }}>{c.val}</div>
          <div style={{ marginTop: 3, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, color: "var(--fg-muted)" }}>{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── disclaimer ──────────────────────────────────────────────────────────

function RPDisclaimer() {
  return (
    <div style={{ background: "rgba(201,166,107,0.08)", border: "1px solid var(--gold-300)", borderLeft: "2px solid var(--gold-500)", borderRadius: 4, padding: "10px 14px", marginBottom: 14, display: "flex", alignItems: "baseline", gap: 12 }}>
      <span className="t-mono" style={{ fontSize: 9.5, color: "var(--gold-500)", padding: "2px 7px", border: "1px solid var(--gold-500)", borderRadius: 2, letterSpacing: "0.05em", fontWeight: 600 }}>PRELIMINARY</span>
      <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)", lineHeight: 1.5 }}>
        These figures are calculated from your trade history and are not tax advice. Final 1099-B from Alpaca governs your return — wash-sale and corporate-action adjustments may differ. Consult a tax professional before filing.
      </span>
    </div>
  );
}

// ─── tabs ────────────────────────────────────────────────────────────────

function RPTabs({ tab, setTab, counts }) {
  const tabs = [
    { id: "realized", label: "Realized P&L",     count: counts.realized },
    { id: "lots",     label: "Open lots",        count: counts.lots },
    { id: "wash",     label: "Wash sales",       count: counts.wash },
    { id: "strategy", label: "By strategy",      count: counts.strategy },
    { id: "docs",     label: "Documents",        count: counts.docs },
  ];
  return (
    <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
      {tabs.map(t => {
        const active = tab === t.id;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "10px 16px", fontFamily: "var(--font-ui)", fontSize: 13,
            background: "transparent", border: "none",
            borderBottom: active ? "2px solid var(--brand)" : "2px solid transparent",
            color: active ? "var(--ink-1000)" : "var(--fg-muted)",
            cursor: "default", display: "inline-flex", alignItems: "center", gap: 8,
            fontWeight: active ? 500 : 400,
          }}>
            <span>{t.label}</span>
            <span className="t-mono" style={{ fontSize: 10, color: active ? "var(--brand)" : "var(--fg-hint)" }}>{t.count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── realized P&L table ──────────────────────────────────────────────────

function RPRealized({ rows, onNav }) {
  const fmt = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString()}`;
  const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 130px 90px 90px 80px 90px 90px 90px 84px 70px 70px", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-elev-1)", gap: 10, alignItems: "center" }}>
        {["SYM", "NAME", "STRATEGY", "OPENED", "CLOSED", "DAYS", "QTY", "BASIS", "PROCEEDS", "GAIN", "TERM", "WASH"].map(h => (
          <span key={h} className="t-label" style={{ color: "var(--fg-hint)" }}>{h}</span>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} onClick={() => onNav("ticker", { ticker: r.sym })} style={{
          display: "grid", gridTemplateColumns: "70px 1fr 130px 90px 90px 80px 90px 90px 90px 84px 70px 70px",
          padding: "9px 14px", borderBottom: "1px solid var(--border-hair)",
          background: i % 2 === 1 ? "var(--bg-elev-1)" : "transparent",
          gap: 10, alignItems: "center", cursor: "default",
        }}>
          <span className="t-mono" style={{ fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{r.sym}</span>
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg)" }}>{r.name}</span>
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-muted)" }}>{r.strategy}</span>
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>{r.opened}</span>
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>{r.closed}</span>
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)", textAlign: "right" }}>{days(r.opened, r.closed)}</span>
          <span className="t-mono" style={{ fontSize: 11.5, color: "var(--ink-1000)", textAlign: "right" }}>{r.qty.toLocaleString()}</span>
          <span className="t-mono" style={{ fontSize: 11.5, color: "var(--ink-1000)", textAlign: "right" }}>${r.basis.toLocaleString()}</span>
          <span className="t-mono" style={{ fontSize: 11.5, color: "var(--ink-1000)", textAlign: "right" }}>${r.proceeds.toLocaleString()}</span>
          <span className="t-mono" style={{ fontSize: 12, color: r.gain >= 0 ? "var(--up-500)" : "var(--down-500)", textAlign: "right", fontWeight: 500 }}>{fmt(r.gain)}</span>
          <span className="t-mono" style={{ fontSize: 9.5, padding: "2px 5px", border: `1px solid ${r.term === "lt" ? "var(--up-500)" : "var(--border)"}`, color: r.term === "lt" ? "var(--up-500)" : "var(--fg-muted)", borderRadius: 2, letterSpacing: "0.05em", textAlign: "center", justifySelf: "center", fontWeight: 600 }}>{r.term === "lt" ? "LONG" : "SHORT"}</span>
          <span style={{ textAlign: "center" }}>
            {r.wash ? <span className="t-mono" style={{ fontSize: 9.5, padding: "2px 5px", border: "1px solid var(--gold-500)", color: "var(--gold-500)", borderRadius: 2, letterSpacing: "0.05em", fontWeight: 600 }}>YES</span> : <span style={{ color: "var(--fg-hint)" }}>—</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── open lots ───────────────────────────────────────────────────────────

function RPLots({ rows, onNav }) {
  const fmt = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString()}`;
  const today = new Date("2025-04-08");
  const daysOpen = (d) => Math.round((today - new Date(d)) / 86400000);
  return (
    <div>
      <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "70px 130px 130px 100px 84px 90px 100px 100px 100px 70px", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-elev-1)", gap: 10, alignItems: "center" }}>
          {["SYM", "STRATEGY", "LOT ID", "OPENED", "DAYS", "QTY", "BASIS", "MARKET VAL", "UNREALIZED", "TERM"].map(h => (
            <span key={h} className="t-label" style={{ color: "var(--fg-hint)" }}>{h}</span>
          ))}
        </div>
        {rows.map((l, i) => (
          <div key={l.lot} onClick={() => onNav("ticker", { ticker: l.sym })} style={{
            display: "grid", gridTemplateColumns: "70px 130px 130px 100px 84px 90px 100px 100px 100px 70px",
            padding: "9px 14px", borderBottom: "1px solid var(--border-hair)",
            background: i % 2 === 1 ? "var(--bg-elev-1)" : "transparent",
            gap: 10, alignItems: "center", cursor: "default",
          }}>
            <span className="t-mono" style={{ fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{l.sym}</span>
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg)" }}>{l.strategy}</span>
            <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>{l.lot}</span>
            <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>{l.openDate}</span>
            <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)", textAlign: "right" }}>{daysOpen(l.openDate)}</span>
            <span className="t-mono" style={{ fontSize: 11.5, color: "var(--ink-1000)", textAlign: "right" }}>{l.qty.toLocaleString()}</span>
            <span className="t-mono" style={{ fontSize: 11.5, color: "var(--ink-1000)", textAlign: "right" }}>${l.basis.toLocaleString()}</span>
            <span className="t-mono" style={{ fontSize: 11.5, color: "var(--ink-1000)", textAlign: "right" }}>${l.mkt.toLocaleString()}</span>
            <span className="t-mono" style={{ fontSize: 12, color: l.unreal >= 0 ? "var(--up-500)" : "var(--down-500)", textAlign: "right", fontWeight: 500 }}>{fmt(l.unreal)}</span>
            <span className="t-mono" style={{ fontSize: 9.5, padding: "2px 5px", border: `1px solid ${l.term === "lt" ? "var(--up-500)" : "var(--border)"}`, color: l.term === "lt" ? "var(--up-500)" : "var(--fg-muted)", borderRadius: 2, letterSpacing: "0.05em", textAlign: "center", justifySelf: "center", fontWeight: 600 }}>{l.term === "lt" ? "LONG" : "SHORT"}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, padding: "10px 14px", background: "rgba(201,166,107,0.06)", border: "1px solid var(--border-hair)", borderLeft: "2px solid var(--brand)", borderRadius: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)" }}>
        <span className="t-mono" style={{ fontSize: 9.5, color: "var(--brand)", marginRight: 8, letterSpacing: "0.06em", fontWeight: 600 }}>TAX-LOSS HARVEST</span>
        Only PFE (-$90) is currently in the red. Selling now realizes a short-term loss; replacement buys within 30 days trigger wash-sale rules. AVGO crosses long-term threshold on Dec 9 — held since 2024-12-08.
      </div>
    </div>
  );
}

// ─── wash sales ──────────────────────────────────────────────────────────

function RPWash({ rows }) {
  if (rows.length === 0) {
    return (
      <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "32px 18px", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 15 }}>No wash sales flagged for this period.</div>
      </div>
    );
  }
  const fmt = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString()}`;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ padding: "12px 14px", background: "rgba(201,166,107,0.08)", border: "1px solid var(--gold-300)", borderRadius: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13.5, color: "var(--fg)", lineHeight: 1.55 }}>
        <span className="t-mono" style={{ fontSize: 10, color: "var(--gold-500)", marginRight: 8, padding: "2px 6px", border: "1px solid var(--gold-500)", borderRadius: 2, letterSpacing: "0.05em", fontStyle: "normal", fontWeight: 600 }}>30-DAY RULE</span>
        Selling at a loss and re-buying the same security within 30 days defers the loss — the disallowed amount is added to the cost basis of the replacement lot.
      </div>
      <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "80px 110px 130px 1fr 130px", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-elev-1)", gap: 12, alignItems: "center" }}>
          {["SYM", "DATE", "LOSS DEFERRED", "REPLACEMENT LOT", "STATUS"].map(h => (
            <span key={h} className="t-label" style={{ color: "var(--fg-hint)" }}>{h}</span>
          ))}
        </div>
        {rows.map((w, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "80px 110px 130px 1fr 130px", padding: "12px 14px", gap: 12, alignItems: "center", borderBottom: "1px solid var(--border-hair)" }}>
            <span className="t-mono" style={{ fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{w.sym}</span>
            <span className="t-mono" style={{ fontSize: 11.5, color: "var(--fg-muted)" }}>{w.date}</span>
            <span className="t-mono" style={{ fontSize: 12, color: "var(--down-500)", fontWeight: 500 }}>{fmt(w.lossDisallowed)}</span>
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg)" }}>{w.replacement}<div style={{ marginTop: 2, fontSize: 11.5, color: "var(--fg-muted)" }}>{w.note}</div></span>
            <span className="t-mono" style={{ fontSize: 9.5, padding: "2px 7px", border: "1px solid var(--gold-500)", color: "var(--gold-500)", borderRadius: 2, letterSpacing: "0.05em", justifySelf: "start", fontWeight: 600 }}>BASIS ADJUSTED</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── strategy attribution ────────────────────────────────────────────────

function RPStrategy({ rows, onNav }) {
  const fmt = (n) => `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString()}`;
  const total = rows.reduce((a, r) => a + r.realized, 0);
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.6fr 90px 130px 130px 100px 1fr", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg-elev-1)", gap: 12, alignItems: "center" }}>
        {["STRATEGY", "SHARE", "REALIZED", "OPEN UNREALIZED", "FEES", "CONTRIBUTION"].map(h => (
          <span key={h} className="t-label" style={{ color: "var(--fg-hint)" }}>{h}</span>
        ))}
      </div>
      {rows.map((r, i) => {
        const w = total === 0 ? 0 : Math.abs(r.realized) / Math.max(...rows.map(x => Math.abs(x.realized)));
        return (
          <div key={r.strat} onClick={() => onNav("playbook", { strat: r.strat })} style={{
            display: "grid", gridTemplateColumns: "1.6fr 90px 130px 130px 100px 1fr",
            padding: "12px 14px", borderBottom: "1px solid var(--border-hair)",
            background: i % 2 === 1 ? "var(--bg-elev-1)" : "transparent",
            gap: 12, alignItems: "center", cursor: "default",
          }}>
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14.5, color: "var(--ink-1000)", letterSpacing: "-0.005em" }}>{r.strat}</span>
            <span className="t-mono" style={{ fontSize: 11.5, color: "var(--fg-muted)", textAlign: "right" }}>{(r.share * 100).toFixed(0)}%</span>
            <span className="t-mono" style={{ fontSize: 13, color: r.realized >= 0 ? "var(--up-500)" : "var(--down-500)", textAlign: "right", fontWeight: 500 }}>{fmt(r.realized)}</span>
            <span className="t-mono" style={{ fontSize: 12, color: r.openUnreal >= 0 ? "var(--up-500)" : "var(--down-500)", textAlign: "right" }}>{fmt(r.openUnreal)}</span>
            <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)", textAlign: "right" }}>{fmt(r.fees)}</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, height: 6, background: "var(--bg-elev-1)", borderRadius: 1, position: "relative", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${w * 100}%`, background: r.realized >= 0 ? "var(--up-500)" : "var(--down-500)", opacity: 0.7 }} />
              </span>
              <span className="t-mono" style={{ fontSize: 10, color: "var(--brand)" }}>open →</span>
            </span>
          </div>
        );
      })}
      <div style={{ padding: "12px 14px", background: "var(--bg-elev-2)", borderTop: "1px solid var(--border)", display: "grid", gridTemplateColumns: "1.6fr 90px 130px 130px 100px 1fr", gap: 12, alignItems: "center" }}>
        <span className="t-label" style={{ color: "var(--fg-hint)" }}>TOTAL · YTD</span>
        <span></span>
        <span className="t-mono" style={{ fontSize: 14, color: total >= 0 ? "var(--up-500)" : "var(--down-500)", textAlign: "right", fontWeight: 600 }}>{fmt(total)}</span>
        <span></span><span></span><span></span>
      </div>
    </div>
  );
}

// ─── documents ───────────────────────────────────────────────────────────

function RPDocs({ rows }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {rows.map(d => (
        <div key={d.id} style={{
          background: "var(--ink-100)",
          border: d.available ? "1px solid var(--border)" : "1px dashed var(--border)",
          borderLeft: d.available ? "2px solid var(--brand)" : "2px dashed var(--border)",
          borderRadius: 4, padding: "14px 16px",
          display: "flex", alignItems: "center", gap: 14,
          opacity: d.available ? 1 : 0.7,
        }}>
          <div style={{
            width: 44, height: 56, border: "1px solid var(--border)", borderRadius: 3,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-muted)", letterSpacing: "0.05em",
            background: "var(--bg-elev-1)", flexShrink: 0,
          }}>
            <span style={{ color: "var(--brand)", fontSize: 11, fontWeight: 600 }}>{d.title.includes("CSV") ? "CSV" : "PDF"}</span>
            <span style={{ marginTop: 2 }}>{d.id.split("-").pop()}</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--ink-1000)", fontWeight: 500 }}>{d.title}</span>
              <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>· {d.period}</span>
            </div>
            <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.4 }}>{d.note}</div>
            <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-hint)" }}>{d.size}</div>
          </div>
          {d.available ? (
            <span style={{ padding: "6px 12px", border: "1px solid var(--brand)", color: "var(--brand)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12, background: "rgba(201,166,107,0.08)" }}>Download ↓</span>
          ) : (
            <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.05em" }}>NOT YET AVAILABLE</span>
          )}
        </div>
      ))}
    </div>
  );
}

if (typeof window !== "undefined") Object.assign(window, { ReportsPage });


// Settings — personal account configuration. Operator/admin lives in Control Center.

const SettingsPage = ({ onNav }) => {
  const [section, setSection] = useState("profile");
  const sections = [
    { id: "profile",      label: "Profile",         hint: "Name, email, avatar" },
    { id: "preferences",  label: "Preferences",     hint: "Timezone, density, theme" },
    { id: "trading",      label: "Trading defaults", hint: "Order type, sizing, cost basis" },
    { id: "broker",       label: "Broker · Alpaca", hint: "Connection · paper / live" },
    { id: "notifications",label: "Notifications",   hint: "Email · in-app · digest" },
    { id: "ai",           label: "AI access",       hint: "Personal Anthropic key, model" },
    { id: "security",     label: "Security",        hint: "Password, 2FA, sessions" },
    { id: "billing",      label: "Plan & billing",  hint: "Current plan · invoices" },
    { id: "danger",       label: "Danger zone",     hint: "Export · delete account" },
  ];
  return (
    <div style={{ padding: "20px 24px 60px", maxWidth: 1320, margin: "0 auto" }}>
      <STHeader />
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 18, marginTop: 18, alignItems: "start" }}>
        <STRail sections={sections} active={section} setActive={setSection} />
        <div style={{ minWidth: 0 }}>
          {section === "profile"       && <STProfile />}
          {section === "preferences"   && <STPreferences />}
          {section === "trading"       && <STTrading />}
          {section === "broker"        && <STBroker />}
          {section === "notifications" && <STNotifications />}
          {section === "ai"            && <STAI />}
          {section === "security"      && <STSecurity />}
          {section === "billing"       && <STBilling />}
          {section === "danger"        && <STDanger />}
        </div>
      </div>
    </div>
  );
};

function STHeader() {
  return (
    <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 0 14px", borderBottom: "1px solid var(--border-hair)" }}>
      <div>
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>SETTINGS / ACCOUNT</div>
        <h1 style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em" }}>Settings</h1>
        <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 14 }}>Your personal preferences. Operator and tenant-wide controls live in the Control Center.</div>
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>changes save automatically</div>
    </header>
  );
}

function STRail({ sections, active, setActive }) {
  return (
    <aside style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 8, position: "sticky", top: 12 }}>
      {sections.map(s => {
        const a = s.id === active;
        return (
          <button key={s.id} onClick={() => setActive(s.id)} style={{
            display: "block", width: "100%", textAlign: "left",
            padding: "9px 12px",
            background: a ? "var(--bg-elev-2)" : "transparent",
            borderLeft: a ? "2px solid var(--brand)" : "2px solid transparent",
            border: a ? "1px solid var(--border-strong)" : "1px solid transparent",
            borderLeftWidth: 2,
            borderRadius: 3, cursor: "default", marginBottom: 1,
          }}>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: a ? "var(--ink-1000)" : "var(--fg)", fontWeight: a ? 500 : 400 }}>{s.label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-hint)", marginTop: 2, letterSpacing: "0.03em" }}>{s.hint}</div>
          </button>
        );
      })}
    </aside>
  );
}

// ─── primitives ──────────────────────────────────────────────────────────

function STCard({ title, sub, children }) {
  return (
    <section style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: "18px 22px", marginBottom: 14 }}>
      <header style={{ marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid var(--border-hair)" }}>
        <h2 style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", fontWeight: 400, letterSpacing: "-0.015em" }}>{title}</h2>
        {sub && <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5, maxWidth: 720 }}>{sub}</div>}
      </header>
      {children}
    </section>
  );
}

function STField({ label, hint, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 18, padding: "12px 0", borderBottom: "1px solid var(--border-hair)", alignItems: "center" }}>
      <div>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ marginTop: 3, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, color: "var(--fg-muted)", lineHeight: 1.4 }}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function STInput({ value, mono, width = "100%" }) {
  return (
    <input defaultValue={value} style={{
      width, padding: "7px 10px",
      fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)", fontSize: 12.5,
      color: "var(--ink-1000)", background: "var(--bg-elev-1)",
      border: "1px solid var(--border)", borderRadius: 3, outline: "none",
    }} />
  );
}

function STSelect({ value, options, width = 240 }) {
  return (
    <select defaultValue={value} style={{
      width, padding: "7px 10px",
      fontFamily: "var(--font-ui)", fontSize: 12.5,
      color: "var(--ink-1000)", background: "var(--bg-elev-1)",
      border: "1px solid var(--border)", borderRadius: 3, outline: "none",
    }}>
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

function STToggle({ on }) {
  const [v, setV] = useState(on);
  return (
    <button onClick={() => setV(x => !x)} style={{
      width: 38, height: 20, borderRadius: 10,
      background: v ? "var(--up-500)" : "var(--bg-elev-1)",
      border: "1px solid var(--border)", padding: 0, position: "relative", cursor: "default",
      transition: "background 150ms",
    }}>
      <span style={{
        position: "absolute", top: 1, left: v ? 19 : 1, width: 16, height: 16, borderRadius: "50%",
        background: "var(--ink-1000)", boxShadow: "0 1px 3px rgba(0,0,0,0.4)", transition: "left 150ms",
      }} />
    </button>
  );
}

function STButton({ children, tone = "default" }) {
  const tones = {
    default: { bg: "var(--bg-elev-1)", color: "var(--ink-1000)", border: "var(--border)" },
    primary: { bg: "rgba(201,166,107,0.15)", color: "var(--brand)", border: "var(--brand)" },
    danger:  { bg: "rgba(201,75,75,0.10)", color: "var(--down-500)", border: "var(--down-500)" },
  };
  const t = tones[tone];
  return (
    <span style={{
      display: "inline-block", padding: "6px 14px",
      background: t.bg, color: t.color, border: `1px solid ${t.border}`,
      borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12, cursor: "default",
    }}>{children}</span>
  );
}

// ─── sections ────────────────────────────────────────────────────────────

function STProfile() {
  return (
    <STCard title="Profile" sub="What appears on receipts, in audit logs, and to anyone you collaborate with.">
      <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "8px 0 14px", borderBottom: "1px solid var(--border-hair)" }}>
        <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--brand)", color: "var(--ink-050)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em" }}>OS</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)" }}>Operator</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>operator@tradingalpha.net</div>
          <div style={{ marginTop: 6 }}><STButton>Upload new avatar</STButton></div>
        </div>
      </div>
      <STField label="Display name" hint="Used in audit log entries and team views"><STInput value="Operator" width={320} /></STField>
      <STField label="Email" hint="Login email · primary notification recipient"><STInput value="operator@tradingalpha.net" mono width={320} /></STField>
      <STField label="Phone" hint="Optional · used only for security alerts and SMS 2FA"><STInput value="+1 (555) 123-4567" mono width={220} /></STField>
      <STField label="Role" hint="Set by admins · contact ops to change">
        <span className="t-mono" style={{ fontSize: 11, padding: "4px 10px", border: "1px solid var(--brand)", color: "var(--brand)", borderRadius: 2, letterSpacing: "0.06em", fontWeight: 600 }}>OPERATOR</span>
      </STField>
    </STCard>
  );
}

function STPreferences() {
  return (
    <STCard title="Preferences" sub="Per-user display preferences. These don't affect strategy execution.">
      <STField label="Timezone" hint="Used everywhere except market session times (always ET)">
        <STSelect value="America/Los_Angeles" options={[
          { v: "America/Los_Angeles", l: "America / Los Angeles · PT" },
          { v: "America/New_York", l: "America / New York · ET" },
          { v: "America/Chicago", l: "America / Chicago · CT" },
          { v: "Europe/London", l: "Europe / London · BST" },
          { v: "Asia/Tokyo", l: "Asia / Tokyo · JST" },
        ]} width={300} />
      </STField>
      <STField label="Density" hint="Comfortable adds breathing room · Dense fits more on screen">
        <STSelect value="dense" options={[{ v: "comfortable", l: "Comfortable" }, { v: "dense", l: "Dense" }]} width={180} />
      </STField>
      <STField label="Theme" hint="System follows OS · Dark is the default authoring theme">
        <STSelect value="dark" options={[{ v: "dark", l: "Dark" }, { v: "system", l: "System" }, { v: "light", l: "Light · beta" }]} width={180} />
      </STField>
      <STField label="Number format" hint="$1,234.56 vs $1.234,56 · affects display only, never calculations">
        <STSelect value="us" options={[{ v: "us", l: "1,234.56 · US" }, { v: "eu", l: "1.234,56 · EU" }]} width={180} />
      </STField>
      <STField label="Default landing page" hint="Where AlphaDesk opens after login">
        <STSelect value="dashboard" options={[
          { v: "dashboard", l: "Dashboard" }, { v: "watchlists", l: "Watchlists" }, { v: "trade", l: "Trade" },
        ]} width={220} />
      </STField>
    </STCard>
  );
}

function STTrading() {
  return (
    <>
    <STCard title="Trading defaults" sub="Pre-fill values on the order ticket. The strategy book overrides these per playbook.">
      <STField label="Default order type" hint="What loads when you open the ticker">
        <STSelect value="limit" options={[
          { v: "market", l: "Market" }, { v: "limit", l: "Limit" }, { v: "stop", l: "Stop" }, { v: "stop-limit", l: "Stop-limit" },
        ]} width={220} />
      </STField>
      <STField label="Default time-in-force"><STSelect value="day" options={[{ v: "day", l: "Day" }, { v: "gtc", l: "GTC" }, { v: "ioc", l: "IOC" }, { v: "fok", l: "FOK" }]} width={180} /></STField>
      <STField label="Default sizing" hint="How the ticket interprets blank size field">
        <STSelect value="risk" options={[
          { v: "risk", l: "% of equity at risk · 0.50%" }, { v: "notional", l: "Notional dollars · $5,000" }, { v: "shares", l: "Fixed shares · 100" },
        ]} width={300} />
      </STField>
      <STField label="Confirm market orders" hint="Show a confirmation dialog before any market order"><STToggle on={true} /></STField>
      <STField label="Confirm orders > $25k" hint="Always confirm large orders regardless of type"><STToggle on={true} /></STField>
      <STField label="Cost basis method" hint="Used for tax-lot accounting on sells">
        <STSelect value="fifo" options={[{ v: "fifo", l: "FIFO · first in, first out" }, { v: "lifo", l: "LIFO" }, { v: "spec", l: "Specific identification" }, { v: "avg", l: "Average cost" }]} width={300} />
      </STField>
    </STCard>
    </>
  );
}

const BROKERS = [
  { id: "alpaca",   name: "Alpaca",                 mark: "α", color: "#FFD600",  asset: "US equities · options · crypto", since: "2015", status: "connected", paper: true, account: "PA3KW2J18ZNX", linked: "Mar 14", default: true,  notes: "REST + paper account · best for algorithmic trading" },
  { id: "ibkr",     name: "Interactive Brokers",    mark: "IB", color: "#D32F2F", asset: "Global equities · futures · FX · options", since: "1978", status: "connected", paper: false, account: "U7421906",     linked: "Apr 02", default: false, notes: "TWS / IB Gateway · widest market coverage" },
  { id: "schwab",   name: "Charles Schwab",         mark: "CS", color: "#00A0DC", asset: "US equities · options · futures (post-TDA)", since: "1971", status: "available", notes: "OAuth via Schwab Developer · TDA accounts auto-migrated" },
  { id: "tradier",  name: "Tradier",                mark: "T",  color: "#0076FF", asset: "US equities · options",            since: "2012", status: "available", notes: "Flat-fee options · clean REST API" },
  { id: "etrade",   name: "E*TRADE",                mark: "E*", color: "#6633CC", asset: "US equities · options · mutual funds", since: "1991", status: "available", notes: "OAuth 1.0a · slow approval queue" },
  { id: "kraken",   name: "Kraken",                 mark: "K",  color: "#5841D8", asset: "Crypto spot + futures",            since: "2011", status: "available", notes: "Crypto-only · for the crypto strategies" },
  { id: "coinbase", name: "Coinbase Advanced",      mark: "C",  color: "#0052FF", asset: "Crypto spot",                      since: "2012", status: "soon",      notes: "OAuth integration in beta · target Q3 2026" },
  { id: "robinhood",name: "Robinhood",              mark: "R",  color: "#8FE100", asset: "US equities · options · crypto",   since: "2013", status: "soon",      notes: "Awaiting public API · target Q4 2026" },
];

function STBroker() {
  const [open, setOpen] = useState("alpaca");
  const active = BROKERS.find(b => b.default) || BROKERS[0];
  return (
    <>
    <STCard title="Active broker" sub="Order execution and account data flow through this broker. Each strategy can override per-playbook in the strategy book.">
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "center", padding: "4px 0 12px", borderBottom: "1px solid var(--border-hair)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <BrokerMark broker={active} size={48} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", letterSpacing: "-0.015em" }}>{active.name}</span>
              <span className="t-mono" style={{ fontSize: 9, padding: "2px 6px", border: "1px solid var(--brand)", color: "var(--brand)", borderRadius: 2, letterSpacing: "0.06em", fontWeight: 600 }}>DEFAULT</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <StatusDot tone="up" size={5} />
                <span className="t-mono" style={{ fontSize: 10, color: "var(--up-500)", letterSpacing: "0.05em", fontWeight: 600 }}>CONNECTED</span>
              </span>
            </div>
            <div style={{ marginTop: 3, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)" }}>{active.asset}</div>
            <div style={{ marginTop: 2, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-hint)" }}>account · {active.account} · linked {active.linked} · last reconciled 09:14 today</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="t-eyebrow-italic" style={{ color: "var(--fg-muted)", fontSize: 9.5, letterSpacing: "0.18em" }}>SWITCH DEFAULT</div>
          <STSelect value="alpaca" options={BROKERS.filter(b => b.status === "connected").map(b => ({ v: b.id, l: b.name }))} width={220} />
        </div>
      </div>
      <STField label="Daily live-mode approval" hint="Re-confirm live trading once per day with 2FA · applies to all brokers"><STToggle on={true} /></STField>
      <STField label="Test default broker"><STButton>Run paper · then live test</STButton></STField>
    </STCard>

    <STCard title="All brokers" sub="Add another broker to route specific strategies, hold positions across firms, or fail over if one is degraded.">
      <div style={{ display: "flex", gap: 10, padding: "4px 0 14px", borderBottom: "1px solid var(--border-hair)", marginBottom: 6, flexWrap: "wrap" }}>
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)", letterSpacing: "0.08em" }}>FILTER ·</span>
        {[{ k: "all", l: "All", n: BROKERS.length }, { k: "connected", l: "Connected", n: BROKERS.filter(b => b.status === "connected").length }, { k: "available", l: "Available", n: BROKERS.filter(b => b.status === "available").length }, { k: "soon", l: "Coming soon", n: BROKERS.filter(b => b.status === "soon").length }].map((f, i) => (
          <span key={f.k} className="t-mono" style={{ fontSize: 10.5, padding: "3px 9px", borderRadius: 2, letterSpacing: "0.05em", border: i === 0 ? "1px solid var(--ink-1000)" : "1px solid var(--border)", color: i === 0 ? "var(--ink-1000)" : "var(--fg-muted)", fontWeight: i === 0 ? 600 : 400 }}>{f.l} <span style={{ color: "var(--fg-hint)", marginLeft: 4 }}>{f.n}</span></span>
        ))}
      </div>
      {BROKERS.map(b => (
        <BrokerRow key={b.id} broker={b} expanded={open === b.id} onToggle={() => setOpen(open === b.id ? null : b.id)} />
      ))}
    </STCard>
    </>
  );
}

function BrokerMark({ broker, size = 36 }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 4, background: broker.color, color: "var(--brand-on)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 600, fontSize: size * 0.42, letterSpacing: "-0.02em", flexShrink: 0 }}>{broker.mark}</div>
  );
}

function BrokerRow({ broker, expanded, onToggle }) {
  const tone = broker.status === "connected" ? "up" : broker.status === "soon" ? "down" : null;
  const statusLabel = broker.status === "connected" ? "CONNECTED" : broker.status === "soon" ? "COMING SOON" : "AVAILABLE";
  return (
    <div style={{ borderBottom: "1px solid var(--border-hair)" }}>
      <div onClick={onToggle} style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 14, padding: "12px 0", alignItems: "center", cursor: "default" }}>
        <BrokerMark broker={broker} size={36} />
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--ink-1000)" }}>{broker.name}</span>
            <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>· est {broker.since}</span>
            {broker.default && <span className="t-mono" style={{ fontSize: 9, padding: "1px 5px", border: "1px solid var(--brand)", color: "var(--brand)", borderRadius: 2, letterSpacing: "0.06em", fontWeight: 600 }}>DEFAULT</span>}
          </div>
          <div style={{ marginTop: 2, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-muted)" }}>{broker.asset}</div>
          <div style={{ marginTop: 2, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-hint)" }}>{broker.notes}</div>
        </div>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          {tone && <StatusDot tone={tone} size={5} />}
          <span className="t-mono" style={{ fontSize: 9.5, color: tone === "up" ? "var(--up-500)" : tone === "down" ? "var(--fg-hint)" : "var(--fg-muted)", letterSpacing: "0.06em", fontWeight: 600 }}>{statusLabel}</span>
        </span>
        <span className="t-mono" style={{ fontSize: 14, color: "var(--fg-muted)", width: 14, textAlign: "center" }}>{expanded ? "−" : "+"}</span>
      </div>
      {expanded && <BrokerExpanded broker={broker} />}
    </div>
  );
}

function BrokerExpanded({ broker }) {
  if (broker.status === "soon") {
    return (
      <div style={{ padding: "0 0 16px 50px" }}>
        <div style={{ padding: "12px 16px", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderLeft: "2px solid var(--gold-500)", borderRadius: 3, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)" }}>
          {broker.name} integration is in development. {broker.notes}.
          <div style={{ marginTop: 8 }}><STButton>Notify me when available</STButton></div>
        </div>
      </div>
    );
  }
  if (broker.status === "available") {
    return (
      <div style={{ padding: "4px 0 18px 50px" }}>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)", marginBottom: 12, maxWidth: 640, lineHeight: 1.55 }}>Connect your {broker.name} account to route orders. We'll request read + trade scopes only — never withdraw or transfer permissions.</div>
        <BrokerCredentialFields broker={broker} hasKeys={false} />
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <STButton tone="primary">Connect {broker.name}</STButton>
          <STButton>Read setup guide ↗</STButton>
        </div>
      </div>
    );
  }
  // connected
  return (
    <div style={{ padding: "4px 0 18px 50px" }}>
      <div style={{ display: "flex", gap: 14, marginBottom: 14, padding: "10px 14px", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3 }}>
        <ConnStat k="ACCOUNT"      v={broker.account} mono />
        <ConnStat k="LINKED"       v={broker.linked} />
        <ConnStat k="LAST SYNC"    v="09:14:22 today" mono />
        <ConnStat k="API LATENCY"  v="42ms" mono tone="up" />
        <ConnStat k="RATE LIMIT"   v="230 / 200 req/min" mono />
      </div>
      <BrokerCredentialFields broker={broker} hasKeys={true} />
      <div style={{ marginTop: 14, padding: "10px 14px", background: "rgba(201,166,107,0.06)", border: "1px solid var(--gold-300)", borderRadius: 3, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg)" }}>
        Keys are encrypted at rest with AES-256. Live keys never appear in logs or AI memos.
      </div>
      <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <STButton>Test connection</STButton>
        <STButton>Reconcile positions now</STButton>
        {!broker.default && <STButton tone="primary">Make default</STButton>}
        <STButton tone="danger">Disconnect</STButton>
      </div>
    </div>
  );
}

function BrokerCredentialFields({ broker, hasKeys }) {
  // IBKR / Schwab / E*TRADE use OAuth, others use key+secret
  const oauth = broker.id === "schwab" || broker.id === "etrade";
  if (oauth) {
    return (
      <>
        <STField label="OAuth status" hint={`${broker.name} uses OAuth · keys never leave their servers`}>
          {hasKeys ? <span className="t-mono" style={{ fontSize: 10.5, padding: "3px 8px", border: "1px solid var(--up-500)", color: "var(--up-500)", borderRadius: 2, letterSpacing: "0.05em", fontWeight: 600 }}>AUTHORIZED · expires Aug 14</span> : <STButton tone="primary">Authorize via {broker.name} ↗</STButton>}
        </STField>
        {hasKeys && <STField label="Refresh token" hint="Auto-rotated every 60 min · stored encrypted"><STInput value="••••••••••••••••••••••" mono /></STField>}
        <STField label="Default account" hint="If you have multiple accounts under this broker">
          <STSelect value="primary" options={[{ v: "primary", l: "Primary · individual margin" }, { v: "ira", l: "IRA · Roth" }]} width={300} />
        </STField>
      </>
    );
  }
  if (broker.id === "ibkr") {
    return (
      <>
        <STField label="Connection mode" hint="TWS for desktop · IB Gateway for headless">
          <STSelect value="gateway" options={[{ v: "gateway", l: "IB Gateway · headless · port 4001" }, { v: "tws", l: "TWS · port 7497" }]} width={300} />
        </STField>
        <STField label="Host"><STInput value="127.0.0.1" mono width={220} /></STField>
        <STField label="Port"><STInput value="4001" mono width={120} /></STField>
        <STField label="Client ID" hint="Unique per concurrent connection · 0–999"><STInput value="42" mono width={120} /></STField>
        <STField label="Account" hint="UXXXXXXX · individual or master account"><STInput value={hasKeys ? broker.account : ""} mono width={220} /></STField>
      </>
    );
  }
  // alpaca / tradier / kraken — key + secret with paper/live split for alpaca
  return (
    <>
      {broker.id === "alpaca" && (
        <>
          <STField label="Mode" hint="Top-bar paper / live toggle picks which keys are used at runtime">
            <STSelect value="both" options={[{ v: "both", l: "Both paper and live keys configured" }, { v: "paper", l: "Paper only" }, { v: "live", l: "Live only" }]} width={300} />
          </STField>
          <STField label="Paper key"   hint="Active when paper mode is on"><STInput value={hasKeys ? "PKABC1234567890DEFG" : ""} mono /></STField>
          <STField label="Paper secret"><STInput value={hasKeys ? "•••••••••••••••••••••••" : ""} mono /></STField>
          <STField label="Live key"    hint="Active when live mode is on · requires daily 2FA approval"><STInput value={hasKeys ? "AKLIVE0987654321XYZ" : ""} mono /></STField>
          <STField label="Live secret"><STInput value={hasKeys ? "•••••••••••••••••••••••" : ""} mono /></STField>
        </>
      )}
      {broker.id === "tradier" && (
        <>
          <STField label="Environment"><STSelect value="prod" options={[{ v: "prod", l: "Production" }, { v: "sandbox", l: "Sandbox" }]} width={220} /></STField>
          <STField label="Access token"><STInput value={hasKeys ? "•••••••••••••••••••••••" : ""} mono /></STField>
          <STField label="Account number"><STInput value={hasKeys ? "VA12345678" : ""} mono width={220} /></STField>
        </>
      )}
      {broker.id === "kraken" && (
        <>
          <STField label="API key"><STInput value={hasKeys ? "•••••••••••••••••••••••" : ""} mono /></STField>
          <STField label="Private key"><STInput value={hasKeys ? "•••••••••••••••••••••••" : ""} mono /></STField>
          <STField label="Permissions" hint="Required scopes — set these in your Kraken API settings">
            <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
              {["query funds", "query open orders", "query closed orders", "create order", "cancel order"].map(p => (
                <span key={p} className="t-mono" style={{ fontSize: 10, padding: "2px 7px", border: "1px solid var(--up-500)", color: "var(--up-500)", borderRadius: 2, letterSpacing: "0.04em" }}>{p}</span>
              ))}
            </span>
          </STField>
        </>
      )}
    </>
  );
}

function ConnStat({ k, v, mono, tone }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>{k}</div>
      <div style={{ marginTop: 3, fontFamily: mono ? "var(--font-mono)" : "var(--font-display)", fontStyle: mono ? "normal" : "italic", fontSize: mono ? 12 : 14, color: tone === "up" ? "var(--up-500)" : "var(--ink-1000)" }}>{v}</div>
    </div>
  );
}

function STNotifications() {
  return (
    <STCard title="Notifications" sub="Where AlphaDesk reaches you. The notification bell in the top bar always shows in-app messages regardless of these settings.">
      <STField label="Email · daily briefing" hint="Pre-market summary · 06:30 ET"><STToggle on={true} /></STField>
      <STField label="Email · weekly performance" hint="Friday 17:00 ET · attribution + drawdown"><STToggle on={true} /></STField>
      <STField label="Email · order fills" hint="One email per fill · noisy on active strategies"><STToggle on={false} /></STField>
      <STField label="Email · stop-loss triggered" hint="Always sent for risk events"><STToggle on={true} /></STField>
      <STField label="In-app · agent activity feed" hint="Stream agent decisions in the bell drawer"><STToggle on={true} /></STField>
      <STField label="In-app · pipeline candidates" hint="When a new candidate enters the pipeline"><STToggle on={true} /></STField>
      <STField label="SMS · risk events only" hint="Stop-outs · margin calls · feed disconnects"><STToggle on={false} /></STField>
      <STField label="Quiet hours" hint="Suppress non-critical notifications during these hours">
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <STInput value="22:00" mono width={80} />
          <span style={{ color: "var(--fg-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>—</span>
          <STInput value="06:00" mono width={80} />
        </span>
      </STField>
    </STCard>
  );
}

function STAI() {
  return (
    <STCard title="AI access" sub="AlphaDesk uses Anthropic's Claude for the morning briefing, post-trade memos, and strategy commentary. You can supply your own key to bypass the tenant pool.">
      <div style={{ padding: "10px 14px", background: "rgba(201,166,107,0.08)", border: "1px solid var(--gold-300)", borderLeft: "2px solid var(--gold-500)", borderRadius: 3, marginBottom: 12, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)" }}>
        Personal keys are encrypted at rest. Costs from your key are billed directly by Anthropic, not through your AlphaDesk plan.
      </div>
      <STField label="Use my own Anthropic key" hint="When off, you share the tenant pool · subject to fair-use limits"><STToggle on={false} /></STField>
      <STField label="Anthropic API key" hint="sk-ant-... · stored encrypted"><STInput value="" mono /></STField>
      <STField label="Default model" hint="Used for briefings, memos, and AI-Alpha commentary">
        <STSelect value="sonnet" options={[
          { v: "haiku", l: "claude-haiku-4.5 · fast · default" },
          { v: "sonnet", l: "claude-sonnet-4.5 · best for analysis" },
          { v: "opus", l: "claude-opus-4 · highest quality" },
        ]} width={320} />
      </STField>
      <STField label="Monthly token budget" hint="Caps your AI spend · set to 0 for unlimited">
        <STInput value="$25.00" mono width={120} />
      </STField>
      <STField label="Show AI cost in commentary" hint="Each AI memo footer shows tokens spent"><STToggle on={true} /></STField>
    </STCard>
  );
}

function STSecurity() {
  return (
    <>
    <STCard title="Password & 2FA">
      <STField label="Password" hint="Last changed 47 days ago"><STButton>Change password</STButton></STField>
      <STField label="Two-factor authentication" hint="TOTP via authenticator app · enabled Apr 02"><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><span className="t-mono" style={{ fontSize: 10.5, padding: "3px 8px", border: "1px solid var(--up-500)", color: "var(--up-500)", borderRadius: 2, letterSpacing: "0.05em", fontWeight: 600 }}>ENABLED</span><STButton>Re-enroll</STButton></span></STField>
      <STField label="Recovery codes" hint="Single-use codes if you lose your authenticator"><STButton>Generate new codes</STButton></STField>
      <STField label="Live-trading 2FA challenge" hint="Re-prompt 2FA when switching to live mode"><STToggle on={true} /></STField>
    </STCard>
    <STCard title="Active sessions" sub="Sign out anywhere you don't recognize.">
      {[
        { device: "MacBook Pro · Chrome 138",  loc: "San Francisco, CA · IP 73.220.* (current)", last: "active now",       current: true  },
        { device: "iPhone 15 · AlphaDesk iOS", loc: "San Francisco, CA · IP 73.220.*",            last: "2 hours ago",     current: false },
        { device: "Linux · Firefox 142",       loc: "Oakland, CA · IP 67.180.*",                  last: "yesterday 23:14", current: false },
      ].map((s, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 14, padding: "11px 0", borderBottom: "1px solid var(--border-hair)", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-1000)" }}>{s.device}{s.current && <span className="t-mono" style={{ marginLeft: 8, fontSize: 9, color: "var(--brand)", padding: "1px 5px", border: "1px solid var(--brand)", borderRadius: 2, letterSpacing: "0.05em", fontStyle: "normal" }}>CURRENT</span>}</div>
            <div style={{ marginTop: 2, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>{s.loc}</div>
          </div>
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>{s.last}</span>
          {!s.current && <STButton tone="danger">Revoke</STButton>}
          {s.current && <span style={{ width: 1 }} />}
        </div>
      ))}
      <div style={{ marginTop: 12 }}><STButton tone="danger">Sign out all other sessions</STButton></div>
    </STCard>
    </>
  );
}

function STBilling() {
  return (
    <>
    <STCard title="Plan" sub="Your current AlphaDesk plan. Compare features at tradingalpha.net/pricing.">
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "center", padding: "8px 0 14px", borderBottom: "1px solid var(--border-hair)" }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>CURRENT PLAN</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 26, color: "var(--ink-1000)", letterSpacing: "-0.015em" }}>Operator · invite-only</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)" }}>All strategies · live trading · personal AI key · admin access · billed monthly</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="t-mono" style={{ fontSize: 22, color: "var(--ink-1000)", fontWeight: 500 }}>$249<span style={{ fontSize: 13, color: "var(--fg-muted)" }}>/mo</span></div>
          <div className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)" }}>renews May 14, 2026</div>
        </div>
      </div>
      <STField label="Payment method" hint="Visa ending in 4242 · expires 09/2027"><STButton>Update card</STButton></STField>
      <STField label="Billing email"><STInput value="billing@tradingalpha.net" mono width={320} /></STField>
    </STCard>
    <STCard title="Invoices" sub="Last 6 invoices · all paid.">
      {[
        { date: "Apr 14 2026", amount: "$249.00", status: "Paid", id: "INV-202604-OPR" },
        { date: "Mar 14 2026", amount: "$249.00", status: "Paid", id: "INV-202603-OPR" },
        { date: "Feb 14 2026", amount: "$249.00", status: "Paid", id: "INV-202602-OPR" },
        { date: "Jan 14 2026", amount: "$249.00", status: "Paid", id: "INV-202601-OPR" },
        { date: "Dec 14 2025", amount: "$249.00", status: "Paid", id: "INV-202512-OPR" },
        { date: "Nov 14 2025", amount: "$249.00", status: "Paid", id: "INV-202511-OPR" },
      ].map((iv, i) => (
        <div key={iv.id} style={{ display: "grid", gridTemplateColumns: "120px 100px 80px 1fr 120px", gap: 14, padding: "10px 0", borderBottom: "1px solid var(--border-hair)", alignItems: "center" }}>
          <span className="t-mono" style={{ fontSize: 11.5, color: "var(--ink-1000)" }}>{iv.date}</span>
          <span className="t-mono" style={{ fontSize: 12, color: "var(--ink-1000)", fontWeight: 500 }}>{iv.amount}</span>
          <span className="t-mono" style={{ fontSize: 9.5, padding: "2px 7px", border: "1px solid var(--up-500)", color: "var(--up-500)", borderRadius: 2, letterSpacing: "0.05em", justifySelf: "start", fontWeight: 600 }}>{iv.status.toUpperCase()}</span>
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>{iv.id}</span>
          <STButton>Download PDF</STButton>
        </div>
      ))}
    </STCard>
    </>
  );
}

function STDanger() {
  return (
    <STCard title="Danger zone" sub="Destructive actions. There is no undo for any of these.">
      <STField label="Export all data" hint="Trades, watchlists, AI memos, audit log · ZIP"><STButton>Request export</STButton></STField>
      <STField label="Reset preferences" hint="Wipe display preferences · keeps trading data"><STButton>Reset</STButton></STField>
      <STField label="Sign out everywhere" hint="Revokes every session including this one"><STButton tone="danger">Sign out everywhere</STButton></STField>
      <STField label="Delete account" hint="30-day grace period · positions must be flat first"><STButton tone="danger">Delete account…</STButton></STField>
    </STCard>
  );
}

if (typeof window !== "undefined") Object.assign(window, { SettingsPage });


// Onboarding — post-approval guided setup. Six steps, sticky progress rail, full-screen take-over.

const ONBOARDING_STEPS = [
  { id: "welcome",   n: "01", label: "Welcome",          hint: "What AlphaDesk does for you" },
  { id: "broker",    n: "02", label: "Connect broker",   hint: "Paper account first · live later" },
  { id: "strategies",n: "03", label: "Pick strategies",  hint: "Start with two · add more anytime" },
  { id: "risk",      n: "04", label: "Set risk limits",  hint: "Per-trade · per-day · per-strategy" },
  { id: "ai",        n: "05", label: "AI access",        hint: "Briefings · memos · BYO key (optional)" },
  { id: "ready",     n: "06", label: "You're set",       hint: "What happens at the next open" },
];

const OnboardingPage = ({ onNav }) => {
  const [step, setStep] = useState("welcome");
  const idx = ONBOARDING_STEPS.findIndex(s => s.id === step);
  const next = () => { const n = ONBOARDING_STEPS[idx + 1]; if (n) setStep(n.id); };
  const back = () => { const p = ONBOARDING_STEPS[idx - 1]; if (p) setStep(p.id); };
  const last = idx === ONBOARDING_STEPS.length - 1;

  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg)", zIndex: 100, display: "grid", gridTemplateColumns: "380px 1fr", overflow: "hidden" }}>
      <OBRail step={step} setStep={setStep} idx={idx} />
      <div style={{ overflow: "auto", display: "flex", flexDirection: "column" }}>
        <OBTopBar onNav={onNav} idx={idx} total={ONBOARDING_STEPS.length} />
        <div style={{ flex: 1, padding: "32px 60px 40px", maxWidth: 920, margin: "0 auto", width: "100%" }}>
          {step === "welcome"    && <OBWelcome />}
          {step === "broker"     && <OBBroker />}
          {step === "strategies" && <OBStrategies />}
          {step === "risk"       && <OBRisk />}
          {step === "ai"         && <OBAI />}
          {step === "ready"      && <OBReady onNav={onNav} />}
        </div>
        <OBFooter idx={idx} total={ONBOARDING_STEPS.length} onBack={back} onNext={next} last={last} onNav={onNav} />
      </div>
    </div>
  );
};

function OBTopBar({ onNav, idx, total }) {
  return (
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 24px", borderBottom: "1px solid var(--border-hair)", background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)", letterSpacing: "0.18em" }}>FIRST-RUN SETUP · STEP {idx + 1} OF {total}</span>
      </div>
      <button onClick={() => onNav("dashboard", { resetHistory: true })} style={{ background: "none", border: "none", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", cursor: "default", letterSpacing: "0.05em" }}>
        Skip for now ↗
      </button>
    </header>
  );
}

function OBRail({ step, setStep, idx }) {
  return (
    <aside style={{ background: "var(--ink-100)", borderRight: "1px solid var(--border)", padding: "32px 28px", overflow: "auto", display: "flex", flexDirection: "column" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--brand)", color: "var(--ink-050)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 600, fontSize: 16, letterSpacing: "-0.02em" }}>α</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)", letterSpacing: "-0.015em" }}>AlphaDesk</div>
        </div>
        <div className="t-eyebrow-italic" style={{ marginTop: 24, color: "var(--brand)", letterSpacing: "0.2em" }}>WELCOME · OPERATOR</div>
        <h1 style={{ margin: "8px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1 }}>Six small steps before your first market open.</h1>
        <p style={{ marginTop: 12, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.55, maxWidth: 320 }}>You can change every choice here later in Settings or Control Center. Nothing here puts capital at risk — live trading needs a separate approval after broker linkage.</p>
      </div>

      <div style={{ marginTop: 32, flex: 1 }}>
        {ONBOARDING_STEPS.map((s, i) => {
          const done = i < idx, active = i === idx;
          return (
            <button key={s.id} onClick={() => i <= idx && setStep(s.id)} style={{
              display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
              background: active ? "var(--bg-elev-2)" : "transparent",
              border: active ? "1px solid var(--border-strong)" : "1px solid transparent",
              borderLeft: active ? "2px solid var(--brand)" : done ? "2px solid var(--up-500)" : "2px solid transparent",
              borderRadius: 3, marginBottom: 2, cursor: i <= idx ? "default" : "not-allowed",
              opacity: i <= idx ? 1 : 0.45,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span className="t-mono" style={{ fontSize: 10.5, color: done ? "var(--up-500)" : active ? "var(--brand)" : "var(--fg-hint)", letterSpacing: "0.05em", fontWeight: 600 }}>
                  {done ? "✓" : s.n}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: active || done ? "var(--ink-1000)" : "var(--fg)", fontWeight: active ? 500 : 400 }}>{s.label}</div>
                  <div style={{ marginTop: 1, fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.03em" }}>{s.hint}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 20, padding: "12px 14px", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3 }}>
        <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.18em" }}>STUCK?</div>
        <div style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)" }}>Email <span style={{ color: "var(--brand)" }}>onboard@tradingalpha.net</span> — typically replied within 2 hours during weekdays.</div>
      </div>
    </aside>
  );
}

function OBFooter({ idx, total, onBack, onNext, last, onNav }) {
  return (
    <footer style={{ borderTop: "1px solid var(--border-hair)", padding: "16px 60px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg)" }}>
      <button onClick={onBack} disabled={idx === 0} style={{ background: "none", border: "1px solid var(--border)", padding: "8px 18px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 13, color: idx === 0 ? "var(--fg-hint)" : "var(--ink-1000)", cursor: idx === 0 ? "not-allowed" : "default", opacity: idx === 0 ? 0.4 : 1 }}>← Back</button>
      <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)", letterSpacing: "0.06em" }}>{idx + 1} / {total}</span>
      {last
        ? <button onClick={() => onNav("dashboard", { resetHistory: true })} style={{ background: "var(--brand)", color: "var(--ink-050)", border: "1px solid var(--brand)", padding: "8px 22px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 500, cursor: "default" }}>Open AlphaDesk →</button>
        : <button onClick={onNext} style={{ background: "var(--brand)", color: "var(--ink-050)", border: "1px solid var(--brand)", padding: "8px 22px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 500, cursor: "default" }}>Continue →</button>}
    </footer>
  );
}

// ─── primitives ──────────────────────────────────────────────────────────

function OBHead({ eyebrow, title, sub }) {
  return (
    <header style={{ marginBottom: 28 }}>
      <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>{eyebrow}</div>
      <h2 style={{ margin: "8px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 38, fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1.1, textWrap: "balance" }}>{title}</h2>
      {sub && <p style={{ marginTop: 12, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 16, lineHeight: 1.55, maxWidth: 680, textWrap: "pretty" }}>{sub}</p>}
    </header>
  );
}

function OBCard({ children, accent, style }) {
  return (
    <div style={{
      background: "var(--ink-100)", border: "1px solid var(--border)",
      borderLeft: accent ? `2px solid ${accent}` : "1px solid var(--border)",
      borderRadius: 4, padding: "18px 22px", marginBottom: 14, ...style,
    }}>{children}</div>
  );
}

function OBRow({ active, onClick, children }) {
  return (
    <div onClick={onClick} style={{
      display: "grid", gridTemplateColumns: "20px 1fr auto", gap: 14, alignItems: "center",
      padding: "14px 16px", marginBottom: 8,
      background: active ? "rgba(201,166,107,0.08)" : "var(--ink-100)",
      border: active ? "1px solid var(--brand)" : "1px solid var(--border)",
      borderRadius: 4, cursor: "default",
    }}>
      <span style={{ width: 16, height: 16, borderRadius: "50%", border: active ? "5px solid var(--brand)" : "1px solid var(--border-strong)", background: active ? "var(--ink-050)" : "transparent", boxSizing: "border-box" }} />
      {children}
    </div>
  );
}

// ─── steps ───────────────────────────────────────────────────────────────

function OBWelcome() {
  return (
    <>
      <OBHead
        eyebrow="01 / WELCOME"
        title="A trading desk that reads, decides, and trades alongside you."
        sub="AlphaDesk is a tightly-scoped trading environment for serious operators. Six AI agents — Scout, Strategist, Analyst, Risk, Execution, Memo — pre-process the open, surface candidates, and execute the rules you set. You stay in command of every order."
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 8 }}>
        {[
          { eb: "MORNING",   t: "Briefed before the bell",     b: "06:30 ET pre-market memo: overnight news, gap movers, your watchlists, and which strategies the agents think are live today." },
          { eb: "INTRADAY",  t: "Pipeline of candidates",      b: "Scout filters the universe down to a working pipeline. You approve, defer, or veto — the desk doesn't move money without your say-so." },
          { eb: "RISK",      t: "Pre-trade and live limits",   b: "Per-trade max loss, per-day stop-out, per-strategy book size, and a live drawdown circuit breaker. All editable, all auditable." },
          { eb: "EVENING",   t: "Memo every fill",             b: "Every trade gets a structured memo: thesis, fill quality, deviation from rules, and what to read overnight. Post-mortem in the morning." },
        ].map(c => (
          <OBCard key={c.eb}>
            <div className="t-eyebrow-italic" style={{ color: "var(--brand)", fontSize: 10, letterSpacing: "0.2em" }}>{c.eb}</div>
            <div style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)", letterSpacing: "-0.015em" }}>{c.t}</div>
            <div style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.55 }}>{c.b}</div>
          </OBCard>
        ))}
      </div>
      <OBCard accent="var(--gold-500)" style={{ marginTop: 4 }}>
        <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 16, alignItems: "center" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: "var(--ink-200)", color: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, fontWeight: 500 }}>✓</div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--ink-1000)" }}>You've been approved as an Operator.</div>
            <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)" }}>Approved by sarah@tradingalpha.net on Apr 14 · all strategies and live trading available after broker linkage.</div>
          </div>
        </div>
      </OBCard>
    </>
  );
}

function OBBroker() {
  const [pick, setPick] = useState("alpaca");
  return (
    <>
      <OBHead
        eyebrow="02 / BROKER"
        title="Connect a broker — paper account first."
        sub="Pick where AlphaDesk should send orders. We strongly recommend starting with paper trading: every strategy, agent, and risk limit runs identically in paper mode, but with no capital at risk for the first two weeks."
      />
      {[
        { id: "alpaca",  mark: "α",  color: "#FFD600",  name: "Alpaca",                 sub: "US equities · options · crypto · best-supported · 60-second setup",         status: "fastest" },
        { id: "ibkr",    mark: "IB", color: "#D32F2F",  name: "Interactive Brokers",    sub: "Global equities · futures · FX · widest market coverage",                  status: "" },
        { id: "schwab",  mark: "CS", color: "#00A0DC",  name: "Charles Schwab",         sub: "US equities · options · futures · OAuth · TDA accounts auto-migrated",     status: "" },
        { id: "tradier", mark: "T",  color: "#0076FF",  name: "Tradier",                sub: "US equities · options · flat-fee options pricing",                          status: "" },
        { id: "later",   mark: "—",  color: "var(--ink-300)", name: "Decide later",     sub: "Run a paper-paper sandbox with synthetic fills · no broker required",       status: "demo" },
      ].map(b => (
        <OBRow key={b.id} active={pick === b.id} onClick={() => setPick(b.id)}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 4, background: b.color, color: "var(--brand-on)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 600, fontSize: 17 }}>{b.mark}</div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 17, color: "var(--ink-1000)" }}>{b.name}</span>
                {b.status === "fastest" && <span className="t-mono" style={{ fontSize: 9, padding: "2px 6px", border: "1px solid var(--brand)", color: "var(--brand)", borderRadius: 2, letterSpacing: "0.05em", fontWeight: 600 }}>RECOMMENDED</span>}
                {b.status === "demo" && <span className="t-mono" style={{ fontSize: 9, padding: "2px 6px", border: "1px solid var(--border-strong)", color: "var(--fg-muted)", borderRadius: 2, letterSpacing: "0.05em" }}>DEMO MODE</span>}
              </div>
              <div style={{ marginTop: 3, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)" }}>{b.sub}</div>
            </div>
          </div>
          <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)", letterSpacing: "0.05em" }}>{b.id === "alpaca" ? "API key + secret" : b.id === "ibkr" ? "TWS / Gateway" : b.id === "schwab" || b.id === "etrade" ? "OAuth ↗" : b.id === "later" ? "—" : "API token"}</span>
        </OBRow>
      ))}
      {pick === "alpaca" && (
        <OBCard style={{ marginTop: 14 }}>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>ALPACA · PAPER KEYS</div>
          <div style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.55 }}>Generate a paper-trading key pair from <span style={{ color: "var(--brand)" }}>app.alpaca.markets ↗</span> and paste below. Live keys are added later from Settings — never during onboarding.</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
            <div>
              <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.18em" }}>API KEY</div>
              <input placeholder="PKABC1234567890DEFG" style={{ marginTop: 4, width: "100%", padding: "8px 11px", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-1000)", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3, outline: "none" }} />
            </div>
            <div>
              <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.18em" }}>API SECRET</div>
              <input placeholder="•••••••••••••••••••••" style={{ marginTop: 4, width: "100%", padding: "8px 11px", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-1000)", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3, outline: "none" }} />
            </div>
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            <span style={{ display: "inline-block", padding: "6px 14px", background: "rgba(201,166,107,0.15)", color: "var(--brand)", border: "1px solid var(--brand)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12, cursor: "default" }}>Verify keys</span>
            <span style={{ display: "inline-block", padding: "6px 14px", background: "var(--bg-elev-1)", color: "var(--ink-1000)", border: "1px solid var(--border)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12, cursor: "default" }}>Generate keys ↗</span>
          </div>
        </OBCard>
      )}
    </>
  );
}

function OBStrategies() {
  const [picks, setPicks] = useState({ "01": true, "02": true, "03": false, "04": false, "05": false, "06": false });
  const toggle = id => setPicks(p => ({ ...p, [id]: !p[id] }));
  const count = Object.values(picks).filter(Boolean).length;
  const STRATS = [
    { n: "01", name: "Earnings Drift",         book: "$15k",  sharpe: "1.42", style: "Event · multi-day hold",   diff: "Easy",     fit: true,  desc: "Holds winners through the post-earnings drift window. Long-only, rules-based, ~3 trades/week." },
    { n: "02", name: "Mean Reversion 5d",      book: "$10k",  sharpe: "1.18", style: "Statistical · 1–5 days",   diff: "Easy",     fit: true,  desc: "Buys oversold S&P 500 names with intact 50-day trend. Tight stops, fast turnover." },
    { n: "03", name: "Momentum Breakout",      book: "$20k",  sharpe: "1.08", style: "Trend · multi-week",       diff: "Medium",   fit: false, desc: "52-week high breakouts with confirming volume. Holds 2–6 weeks. Higher drawdowns, larger wins." },
    { n: "04", name: "Pairs Trading · 12 pairs",book: "$25k", sharpe: "0.94", style: "OnboardingStat-arb · neutral",        diff: "Medium",   fit: false, desc: "Long/short cointegrated pairs. Market-neutral, low Sharpe but uncorrelated to the rest of the book." },
    { n: "05", name: "Options Wheel · QQQ",    book: "$30k",  sharpe: "1.31", style: "Income · weekly",          diff: "Hard",     fit: false, desc: "Cash-secured puts on QQQ + covered calls when assigned. Premium-income, rolls weekly." },
    { n: "06", name: "Crypto Momentum",        book: "$8k",   sharpe: "0.71", style: "24/7 · BTC + ETH",         diff: "Hard",     fit: false, desc: "Daily momentum sweeps on BTC and ETH. Requires connected crypto broker (Kraken / Coinbase)." },
  ];
  return (
    <>
      <OBHead
        eyebrow="03 / STRATEGIES"
        title="Pick the strategies you want active on day one."
        sub="Two enabled by default — adjust the picks here, or do it later in the Strategy Book. The agents only run strategies you've explicitly turned on. Every strategy can be paused, throttled, or unpinned at any time."
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 14px" }}>
        <div className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)", letterSpacing: "0.06em" }}>{count} OF 6 SELECTED · COMBINED BOOK ${["—","10","25","45","70","100","108"][count]}K</div>
        <span className="t-mono" style={{ fontSize: 11, color: "var(--brand)", letterSpacing: "0.05em" }}>Recommended for new operators →</span>
      </div>
      {STRATS.map(s => {
        const on = picks[s.n];
        return (
          <div key={s.n} onClick={() => toggle(s.n)} style={{
            display: "grid", gridTemplateColumns: "auto 1fr auto auto auto auto", gap: 16, alignItems: "center",
            padding: "14px 18px", marginBottom: 8,
            background: on ? "rgba(201,166,107,0.08)" : "var(--ink-100)",
            border: on ? "1px solid var(--brand)" : "1px solid var(--border)",
            borderRadius: 4, cursor: "default",
          }}>
            <span style={{
              width: 18, height: 18, borderRadius: 3,
              background: on ? "var(--brand)" : "transparent",
              border: on ? "1px solid var(--brand)" : "1px solid var(--border-strong)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--ink-050)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
            }}>{on ? "✓" : ""}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span className="t-mono" style={{ fontSize: 11, color: "var(--brand)", letterSpacing: "0.05em", fontWeight: 600 }}>{s.n}</span>
                <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 17, color: "var(--ink-1000)" }}>{s.name}</span>
                {s.fit && <span className="t-mono" style={{ fontSize: 9, padding: "1px 6px", border: "1px solid var(--up-500)", color: "var(--up-500)", borderRadius: 2, letterSpacing: "0.05em", fontWeight: 600 }}>GOOD FIT</span>}
              </div>
              <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-muted)", lineHeight: 1.5, maxWidth: 540 }}>{s.desc}</div>
            </div>
            <OnboardingStat k="STYLE"  v={s.style}  small />
            <OnboardingStat k="BOOK"   v={s.book}   mono small />
            <OnboardingStat k="SHARPE" v={s.sharpe} mono small tone="up" />
            <OnboardingStat k="EFFORT" v={s.diff}   small />
          </div>
        );
      })}
    </>
  );
}

function OnboardingStat({ k, v, mono, tone, small }) {
  return (
    <div style={{ minWidth: small ? 70 : 90 }}>
      <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>{k}</div>
      <div style={{ marginTop: 2, fontFamily: mono ? "var(--font-mono)" : "var(--font-display)", fontStyle: mono ? "normal" : "italic", fontSize: small ? 13 : 15, color: tone === "up" ? "var(--up-500)" : "var(--ink-1000)" }}>{v}</div>
    </div>
  );
}

function OBRisk() {
  return (
    <>
      <OBHead
        eyebrow="04 / RISK"
        title="Set the limits the desk will not cross."
        sub="These are hard caps. The agents won't open positions that would breach them, the execution engine won't fill them, and you'll see a clear circuit-breaker banner if any limit is hit. Tune later in Risk Center — we suggest defaults appropriate for paper trading."
      />
      {[
        { k: "Per-trade max loss",       v: "0.50%",  hint: "Stop-loss sizing baseline. A trade that would risk more than this on its stop is rejected.", scale: ["0.10%", "0.25%", "0.50%", "1.00%"], pick: 2 },
        { k: "Per-day stop-out",         v: "2.00%",  hint: "If the book is down this much in a single session, all strategies pause and require manual resume.", scale: ["1.00%", "1.50%", "2.00%", "3.00%"], pick: 2 },
        { k: "Max concurrent positions", v: "8",      hint: "Across all strategies. Helps keep the desk readable; new entries queue if at cap.", scale: ["4", "6", "8", "12"], pick: 2 },
        { k: "Max book size",            v: "$100k",  hint: "Total notional deployed across all strategies. Won't exceed this regardless of opportunity quality.", scale: ["$50k", "$100k", "$250k", "$500k"], pick: 1 },
        { k: "Live drawdown breaker",    v: "5.00%",  hint: "If the live account is down this much from peak, all live strategies halt and require operator + admin reset.", scale: ["3.00%", "5.00%", "7.50%", "10.0%"], pick: 1 },
      ].map(r => (
        <OBCard key={r.k}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 17, color: "var(--ink-1000)" }}>{r.k}</div>
              <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5, maxWidth: 580 }}>{r.hint}</div>
            </div>
            <div className="t-mono" style={{ fontSize: 22, color: "var(--brand)", fontWeight: 500 }}>{r.v}</div>
          </div>
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            {r.scale.map((s, i) => (
              <span key={s} className="t-mono" style={{
                flex: 1, textAlign: "center", padding: "8px 0",
                fontSize: 12, fontWeight: i === r.pick ? 600 : 400,
                color: i === r.pick ? "var(--brand)" : "var(--fg-muted)",
                background: i === r.pick ? "rgba(201,166,107,0.10)" : "var(--bg-elev-1)",
                border: i === r.pick ? "1px solid var(--brand)" : "1px solid var(--border)",
                borderRadius: 3, cursor: "default",
              }}>{s}</span>
            ))}
          </div>
        </OBCard>
      ))}
    </>
  );
}

function OBAI() {
  const [pick, setPick] = useState("pool");
  return (
    <>
      <OBHead
        eyebrow="05 / AI"
        title="Choose how the AI work gets billed."
        sub="The morning briefing, post-trade memos, and AI-Alpha commentary run on Anthropic's Claude. Use the tenant pool for a hassle-free start, or bring your own key to remove fair-use limits and bill costs directly to Anthropic."
      />
      <OBRow active={pick === "pool"} onClick={() => setPick("pool")}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 17, color: "var(--ink-1000)" }}>Use AlphaDesk's tenant pool · default</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5, maxWidth: 540 }}>Bundled with your operator plan · ~3M tokens/month soft cap · fair-use throttling under heavy load. Recommended for the first month.</div>
        </div>
        <span className="t-mono" style={{ fontSize: 10, color: "var(--brand)", letterSpacing: "0.05em" }}>INCLUDED</span>
      </OBRow>
      <OBRow active={pick === "byok"} onClick={() => setPick("byok")}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 17, color: "var(--ink-1000)" }}>Bring your own Anthropic key</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5, maxWidth: 540 }}>Costs billed directly by Anthropic. No fair-use throttling, choose your own model preferences, and a dedicated rate budget.</div>
        </div>
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-muted)", letterSpacing: "0.05em" }}>BYO KEY ↗</span>
      </OBRow>
      {pick === "byok" && (
        <OBCard style={{ marginTop: 6 }}>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>ANTHROPIC · API KEY</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 200px", gap: 12, marginTop: 10 }}>
            <input placeholder="sk-ant-api03-..." style={{ width: "100%", padding: "8px 11px", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-1000)", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3, outline: "none" }} />
            <select defaultValue="sonnet" style={{ padding: "8px 11px", fontFamily: "var(--font-ui)", fontSize: 12.5, color: "var(--ink-1000)", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3, outline: "none" }}>
              <option value="haiku">claude-haiku-4.5 · fast</option>
              <option value="sonnet">claude-sonnet-4.5 · default</option>
              <option value="opus">claude-opus-4 · highest quality</option>
            </select>
          </div>
        </OBCard>
      )}
      <OBCard accent="var(--gold-500)">
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-1000)" }}>What does the AI actually see?</div>
        <div style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.55 }}>
          Public market data, news headlines, your strategy rules, and your trades. Never your account number, broker keys, or PII. Every prompt and completion is auditable in Control Center → AI Activity.
        </div>
      </OBCard>
    </>
  );
}

function OBReady({ onNav }) {
  return (
    <>
      <OBHead
        eyebrow="06 / READY"
        title="Setup complete. Here's what happens at the next open."
        sub="The desk runs whether you're watching or not — but it never moves money without your approval. Here's the rough rhythm of a typical session, so you know what to expect."
      />
      <div style={{ position: "relative", paddingLeft: 20, marginBottom: 20 }}>
        <div style={{ position: "absolute", left: 7, top: 6, bottom: 6, width: 1, background: "var(--border-strong)" }} />
        {[
          { t: "06:30 ET", h: "Pre-market briefing in your inbox",     b: "Overnight headlines, gap movers, a fresh pipeline of candidates, agent confidence per strategy." },
          { t: "09:30 ET", h: "Bell rings · Scout starts surfacing",   b: "Pipeline updates as Scout finds setups. Risk pre-approves, but you click to confirm orders." },
          { t: "12:00 ET", h: "Midday memo: how the morning went",     b: "Quick tape from the Memo agent: trades on, what worked, what didn't, what the rest of the session might bring." },
          { t: "16:00 ET", h: "Close · Post-mortem auto-runs",         b: "Every fill gets a structured memo. The agents tag deviations from rules so you can review on your own time." },
          { t: "06:30 ET", h: "Tomorrow starts. The loop continues.",  b: "Ready overnight reading is queued in your inbox. The pipeline rebuilds while you sleep." },
        ].map((e, i) => (
          <div key={i} style={{ position: "relative", paddingLeft: 22, paddingBottom: 18 }}>
            <span style={{ position: "absolute", left: -6, top: 5, width: 12, height: 12, borderRadius: "50%", background: "var(--brand)", border: "2px solid var(--bg)" }} />
            <div className="t-mono" style={{ fontSize: 10, color: "var(--brand)", letterSpacing: "0.05em", fontWeight: 600 }}>{e.t}</div>
            <div style={{ marginTop: 3, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 17, color: "var(--ink-1000)" }}>{e.h}</div>
            <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.5, maxWidth: 580 }}>{e.b}</div>
          </div>
        ))}
      </div>
      <OBCard accent="var(--brand)">
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>FIRST RUN · SUMMARY</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginTop: 12 }}>
          <OnboardingStat k="BROKER"     v="Alpaca · paper" />
          <OnboardingStat k="STRATEGIES" v="2 enabled" />
          <OnboardingStat k="BOOK"       v="$25,000" mono />
          <OnboardingStat k="AI"         v="Tenant pool" />
        </div>
      </OBCard>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={() => onNav("dashboard", { resetHistory: true })} style={{ background: "var(--brand)", color: "var(--ink-050)", border: "1px solid var(--brand)", padding: "11px 28px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 500, cursor: "default" }}>Open the dashboard →</button>
        <button onClick={() => onNav("strategies", { resetHistory: true })} style={{ background: "var(--bg-elev-1)", color: "var(--ink-1000)", border: "1px solid var(--border)", padding: "11px 22px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 14, cursor: "default" }}>Tour the strategy book</button>
      </div>
    </>
  );
}

if (typeof window !== "undefined") Object.assign(window, { OnboardingPage });


// Marketing site — public-facing tradingalpha.net. Single-page composition with apply-for-access funnel.

const MarketingPage = ({ onNav }) => {
  const [section, setSection] = useState("home");
  // smooth-ish: sections render in same scroll container; nav just changes which CTAs / sections are highlighted
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg)", overflow: "auto", zIndex: 100 }}>
      <MKHeader section={section} setSection={setSection} onNav={onNav} />
      <MKHero onApply={() => setSection("apply")} />
      <MKThesis />
      <MKAgents />
      <MKStrategies />
      <MKResults />
      <MKPricing onApply={() => setSection("apply")} />
      <MKFAQ />
      {section === "apply" && <MKApplyOverlay onClose={() => setSection("home")} />}
      <MKFooter onNav={onNav} />
    </div>
  );
};

// ─── header ──────────────────────────────────────────────────────────────

function MKHeader({ section, setSection, onNav }) {
  return (
    <header style={{
      position: "sticky", top: 0, zIndex: 50,
      display: "grid", gridTemplateColumns: "auto 1fr auto", gap: 24, alignItems: "center",
      padding: "16px 40px",
      background: "rgba(13,12,10,0.78)", backdropFilter: "blur(12px)",
      borderBottom: "1px solid var(--border-hair)",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--brand)", color: "var(--ink-050)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 600, fontSize: 16 }}>α</div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)", letterSpacing: "-0.015em" }}>AlphaDesk</div>
        <span className="t-mono" style={{ marginLeft: 6, fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.18em" }}>BY TRADING ALPHA</span>
      </div>
      <nav style={{ display: "flex", gap: 22, justifyContent: "center" }}>
        {["Thesis", "Agents", "Strategies", "Results", "Pricing", "FAQ"].map(l => (
          <a key={l} href={`#${l.toLowerCase()}`} style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--fg)", textDecoration: "none" }}>{l}</a>
        ))}
      </nav>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={() => onNav("auth")} style={{ background: "none", border: "none", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", cursor: "default", letterSpacing: "0.05em" }}>Sign in →</button>
        <button onClick={() => setSection("apply")} style={{ background: "var(--brand)", color: "var(--ink-050)", border: "1px solid var(--brand)", padding: "8px 18px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 500, cursor: "default" }}>Apply for access</button>
      </div>
    </header>
  );
}

// ─── hero ────────────────────────────────────────────────────────────────

function MKHero({ onApply }) {
  return (
    <section style={{ padding: "80px 40px 100px", maxWidth: 1320, margin: "0 auto", position: "relative" }}>
      <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>INVITE-ONLY · OPERATOR ACCESS</div>
      <h1 style={{ margin: "20px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 96, fontWeight: 400, letterSpacing: "-0.035em", lineHeight: 0.95, maxWidth: 1100, textWrap: "balance" }}>
        A trading desk that <span style={{ color: "var(--brand)" }}>reads, decides, and trades</span> alongside you.
      </h1>
      <p style={{ marginTop: 28, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--fg-muted)", lineHeight: 1.45, maxWidth: 760, textWrap: "pretty" }}>
        Six AI agents — Scout, Strategist, Analyst, Risk, Execution, Memo — pre-process every market open, surface candidates, and execute against the rules you set. You stay in command of every order. Capital never moves without your signature.
      </p>
      <div style={{ marginTop: 36, display: "flex", gap: 12, alignItems: "center" }}>
        <button onClick={onApply} style={{ background: "var(--brand)", color: "var(--ink-050)", border: "1px solid var(--brand)", padding: "14px 28px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 500, cursor: "default" }}>Apply for access →</button>
        <button style={{ background: "var(--bg-elev-1)", color: "var(--ink-1000)", border: "1px solid var(--border)", padding: "14px 22px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 15, cursor: "default" }}>Watch a 90-second walkthrough</button>
        <span className="t-mono" style={{ marginLeft: 12, fontSize: 11, color: "var(--fg-muted)", letterSpacing: "0.05em" }}>NEXT COHORT · MAY 22 · 14 SEATS</span>
      </div>

      <div style={{ marginTop: 80, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 32, paddingTop: 32, borderTop: "1px solid var(--border-hair)" }}>
        {[
          { k: "OPERATORS",          v: "284",     s: "active across the platform" },
          { k: "STRATEGIES PUBLISHED", v: "23",   s: "fully backtested · all auditable" },
          { k: "TRADES / WEEK",      v: "11.4k",   s: "executed across all books" },
          { k: "MEDIAN OPERATOR YTD", v: "+18.2%", s: "net of fees · 2025" },
        ].map(s => (
          <div key={s.k}>
            <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9.5, letterSpacing: "0.16em" }}>{s.k}</div>
            <div style={{ marginTop: 6, fontFamily: "var(--font-mono)", fontSize: 36, color: "var(--ink-1000)", fontWeight: 500, letterSpacing: "-0.01em" }}>{s.v}</div>
            <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-muted)" }}>{s.s}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── thesis ──────────────────────────────────────────────────────────────

function MKThesis() {
  return (
    <section id="thesis" style={{ padding: "100px 40px", maxWidth: 1320, margin: "0 auto", borderTop: "1px solid var(--border-hair)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 60, alignItems: "start" }}>
        <div style={{ position: "sticky", top: 100 }}>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>01 / THESIS</div>
          <h2 style={{ margin: "12px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 48, fontWeight: 400, letterSpacing: "-0.025em", lineHeight: 1.0 }}>Why a desk, not a robo-advisor.</h2>
        </div>
        <div>
          {[
            { h: "Robo-advisors index. Funds index. We don't.",                  p: "AlphaDesk runs explicit, auditable strategies — earnings drift, mean reversion, momentum, pairs, options income. Every rule is visible. Every fill is explained. No black boxes, no proprietary scoring, no \"trust us.\"" },
            { h: "The agents read the tape. You stay the operator.",            p: "Scout, Strategist, Analyst, Risk, Execution, and Memo handle the data work — scanning thousands of names, generating theses, sizing positions, writing post-trade memos. You read, approve, modify, or reject. Capital never moves without your signature." },
            { h: "Risk first. Always.",                                         p: "Per-trade max loss, per-day stop-out, max book size, live drawdown breaker. Every limit is a hard cap — not a recommendation. The execution engine refuses orders that would breach them, and a circuit-breaker banner stops everything if they're hit." },
            { h: "Built for operators, not retail.",                            p: "If you're a quant, an ex-trader, a serious individual investor, or a small fund running personal capital — you're our user. We don't onboard people who don't already understand position sizing, beta, or the difference between Sharpe and Sortino." },
          ].map((c, i) => (
            <div key={i} style={{ paddingBottom: 36, marginBottom: 36, borderBottom: i < 3 ? "1px solid var(--border-hair)" : "none" }}>
              <div className="t-mono" style={{ fontSize: 11, color: "var(--brand)", letterSpacing: "0.08em" }}>0{i + 1}</div>
              <h3 style={{ margin: "8px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 28, fontWeight: 400, letterSpacing: "-0.015em", textWrap: "balance" }}>{c.h}</h3>
              <p style={{ marginTop: 10, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 17, color: "var(--fg-muted)", lineHeight: 1.55, textWrap: "pretty", maxWidth: 700 }}>{c.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── agents ──────────────────────────────────────────────────────────────

function MKAgents() {
  const AGENTS = [
    { n: "01", id: "scout",      name: "Scout",      role: "Universe filter",       color: "#7DA3D9", who: "Reduces 8,000+ tickers to a working pipeline of 30–60 each morning. Filters by liquidity, volatility regime, news flow, and strategy fit." },
    { n: "02", id: "strategist", name: "Strategist", role: "Thesis generator",      color: "#C9A66B", who: "Pairs candidates to active strategies. Writes a 3-line thesis per candidate: setup, catalyst, expected hold window. You see every thesis before it routes to Risk." },
    { n: "03", id: "analyst",    name: "Analyst",    role: "Confirmation",          color: "#7AB69F", who: "Pulls fundamentals, options flow, recent filings, and analyst revisions for each candidate. Surfaces disconfirming evidence as loudly as confirming." },
    { n: "04", id: "risk",       name: "Risk",       role: "Pre-trade gating",      color: "#D9914B", who: "Hard checks: per-trade max loss, position size vs book, current correlation, drawdown headroom. Either approves the order, or rejects with a one-line reason." },
    { n: "05", id: "execution",  name: "Execution",  role: "Order routing",         color: "#A87DD9", who: "Smart-routes to your broker, handles partial fills, manages stop and target legs, and reports realized vs theoretical fill quality." },
    { n: "06", id: "memo",       name: "Memo",       role: "Post-trade memory",     color: "#D17FA8", who: "Writes a structured memo for every closed trade: thesis recap, fill quality, deviation from rules, what to read overnight. Your trading journal, written for you." },
  ];
  return (
    <section id="agents" style={{ padding: "100px 40px", borderTop: "1px solid var(--border-hair)", background: "var(--ink-100)" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>02 / THE SIX AGENTS</div>
        <h2 style={{ margin: "12px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 64, fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 0.98, maxWidth: 1000, textWrap: "balance" }}>Six specialized agents. One operator. One auditable trail.</h2>
        <p style={{ marginTop: 16, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--fg-muted)", lineHeight: 1.5, maxWidth: 720 }}>Each agent has a narrow mandate. You see their work before it influences trades. Every agent reads the same data feed and posts to the same audit log — visible in Control Center.</p>
        <div style={{ marginTop: 48, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {AGENTS.map(a => (
            <div key={a.id} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderTop: `2px solid ${a.color}`, borderRadius: 4, padding: "22px 22px 20px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-hint)", letterSpacing: "0.05em" }}>{a.n}</span>
                <span className="t-mono" style={{ fontSize: 9.5, color: a.color, letterSpacing: "0.16em", fontWeight: 600 }}>{a.role.toUpperCase()}</span>
              </div>
              <h3 style={{ margin: "10px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em" }}>{a.name}</h3>
              <p style={{ marginTop: 10, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.55, textWrap: "pretty" }}>{a.who}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── strategies ──────────────────────────────────────────────────────────

function MKStrategies() {
  const ROWS = [
    { n: "01", name: "Earnings Drift",          style: "Event",     hold: "3–7 days",  sharpe: "1.42", cagr: "+22.4%", dd: "−8.1%",  ops: "184", note: "Long winners through post-earnings drift." },
    { n: "02", name: "Mean Reversion 5d",       style: "Statistical", hold: "1–5 days", sharpe: "1.18", cagr: "+14.7%", dd: "−5.4%",  ops: "227", note: "Oversold S&P 500 with intact 50-DMA trend." },
    { n: "03", name: "Momentum Breakout",       style: "Trend",      hold: "2–6 wks",   sharpe: "1.08", cagr: "+27.1%", dd: "−14.6%", ops: "151", note: "52-week-high breakouts with confirming volume." },
    { n: "04", name: "Pairs Trading · 12 pairs",style: "Stat-arb",   hold: "5–20 days", sharpe: "0.94", cagr: "+9.2%",  dd: "−3.8%",  ops: "92",  note: "Cointegrated long/short, market-neutral." },
    { n: "05", name: "Options Wheel · QQQ",     style: "Income",     hold: "weekly",    sharpe: "1.31", cagr: "+11.8%", dd: "−6.7%",  ops: "78",  note: "Cash-secured puts + covered calls." },
    { n: "06", name: "Crypto Momentum",         style: "24/7",       hold: "1–3 days",  sharpe: "0.71", cagr: "+34.2%", dd: "−21.4%", ops: "44",  note: "Daily momentum sweep on BTC + ETH." },
    { n: "07", name: "Sector Rotation",         style: "Macro",      hold: "monthly",   sharpe: "0.96", cagr: "+12.4%", dd: "−7.9%",  ops: "61",  note: "Top 3 SPDR sectors by 6-month strength." },
    { n: "08", name: "Volatility Term Structure",style: "VIX",       hold: "5–10 days", sharpe: "1.22", cagr: "+15.9%", dd: "−9.1%",  ops: "38",  note: "VXX/SVXY basket on contango-inversion signal." },
  ];
  return (
    <section id="strategies" style={{ padding: "100px 40px", borderTop: "1px solid var(--border-hair)" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>03 / THE STRATEGY BOOK</div>
        <h2 style={{ margin: "12px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 64, fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 0.98, maxWidth: 1000, textWrap: "balance" }}>23 published strategies. All auditable. All editable.</h2>
        <p style={{ marginTop: 16, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--fg-muted)", lineHeight: 1.5, maxWidth: 720 }}>Eight shown below. Each lives in a Strategy Playbook with full rules, backtest workbench, and live trades. Use as-is, fork to modify, or build your own from scratch.</p>
        <div style={{ marginTop: 36, border: "1px solid var(--border)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "44px 1.6fr 0.9fr 0.7fr 0.7fr 0.7fr 0.7fr 0.6fr", gap: 12, padding: "12px 18px", borderBottom: "1px solid var(--border)", background: "var(--ink-100)" }}>
            {["#", "STRATEGY", "STYLE", "HOLD", "SHARPE", "CAGR", "MAX DD", "OPS"].map(h => (
              <span key={h} className="t-eyebrow-italic" style={{ color: "var(--fg-muted)", fontSize: 9.5, letterSpacing: "0.16em" }}>{h}</span>
            ))}
          </div>
          {ROWS.map((r, i) => (
            <div key={r.n} style={{ display: "grid", gridTemplateColumns: "44px 1.6fr 0.9fr 0.7fr 0.7fr 0.7fr 0.7fr 0.6fr", gap: 12, padding: "16px 18px", borderBottom: i < ROWS.length - 1 ? "1px solid var(--border-hair)" : "none", alignItems: "center" }}>
              <span className="t-mono" style={{ fontSize: 11, color: "var(--brand)", letterSpacing: "0.05em" }}>{r.n}</span>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 17, color: "var(--ink-1000)" }}>{r.name}</div>
                <div style={{ marginTop: 2, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-muted)" }}>{r.note}</div>
              </div>
              <span className="t-mono" style={{ fontSize: 11, color: "var(--fg)", letterSpacing: "0.04em" }}>{r.style}</span>
              <span className="t-mono" style={{ fontSize: 11, color: "var(--fg)" }}>{r.hold}</span>
              <span className="t-mono" style={{ fontSize: 13, color: "var(--up-500)", fontWeight: 500 }}>{r.sharpe}</span>
              <span className="t-mono" style={{ fontSize: 13, color: "var(--up-500)", fontWeight: 500 }}>{r.cagr}</span>
              <span className="t-mono" style={{ fontSize: 13, color: "var(--down-500)" }}>{r.dd}</span>
              <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>{r.ops}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)" }}>Showing 8 of 23 · 15 more available after onboarding</span>
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-hint)" }}>Performance is from full-period backtests on out-of-sample data, 2018–2024. Past performance is not indicative of future returns.</span>
        </div>
      </div>
    </section>
  );
}

// ─── results ─────────────────────────────────────────────────────────────

function MKResults() {
  return (
    <section id="results" style={{ padding: "100px 40px", borderTop: "1px solid var(--border-hair)", background: "var(--ink-100)" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "start" }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>04 / RESULTS · TRANSPARENT</div>
          <h2 style={{ margin: "12px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 56, fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 1.0, textWrap: "balance" }}>How operators have actually performed.</h2>
          <p style={{ marginTop: 16, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 17, color: "var(--fg-muted)", lineHeight: 1.55, maxWidth: 540, textWrap: "pretty" }}>
            Aggregate figures from 284 active operators, 2025 YTD. Net of broker commissions, slippage, and AlphaDesk subscription. We don't curate or cherry-pick — every operator with ≥30 days of live trading is included.
          </p>
          <div style={{ marginTop: 28, padding: "16px 20px", background: "var(--bg)", border: "1px solid var(--border)", borderLeft: "2px solid var(--gold-500)", borderRadius: 3 }}>
            <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em", fontSize: 9.5 }}>FROM AN OPERATOR</div>
            <div style={{ marginTop: 8, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)", lineHeight: 1.5 }}>
              "I'd been running these strategies in spreadsheets and TradingView for years. AlphaDesk took the boring-but-mistake-prone work — pre-market scanning, sizing, post-trade journaling — off my plate without taking the trades themselves."
            </div>
            <div style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>— D. Ramirez · operator since Feb 2025 · ex-Citadel</div>
          </div>
        </div>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { k: "MEDIAN OPERATOR · YTD",      v: "+18.2%", tone: "up", b: "vs SPY +9.1% same period" },
              { k: "TOP-DECILE OPERATOR · YTD",  v: "+47.8%", tone: "up", b: "10th percentile" },
              { k: "BOTTOM-DECILE · YTD",        v: "−4.1%",  tone: "down", b: "10th percentile · honesty matters" },
              { k: "MEDIAN MAX DD",              v: "−6.4%",  tone: "down", b: "vs SPY −12.1% same period" },
              { k: "MEDIAN SHARPE",              v: "1.31",   tone: "up", b: "across all enabled strategies" },
              { k: "OPERATORS BEATING SPY",      v: "73%",    tone: "up", b: "with at least 90 days live" },
            ].map(s => (
              <div key={s.k} style={{ padding: "20px 22px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4 }}>
                <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9.5, letterSpacing: "0.16em" }}>{s.k}</div>
                <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 32, color: s.tone === "up" ? "var(--up-500)" : "var(--down-500)", fontWeight: 500, letterSpacing: "-0.01em" }}>{s.v}</div>
                <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-muted)" }}>{s.b}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, padding: "12px 16px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 3 }}>
            <div className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", letterSpacing: "0.04em", lineHeight: 1.6 }}>
              All figures are net of fees. Past performance is not indicative of future returns. Trading involves risk; you may lose more than your initial investment depending on leverage and instrument. Full methodology and per-strategy attribution available after onboarding.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── pricing ─────────────────────────────────────────────────────────────

function MKPricing({ onApply }) {
  return (
    <section id="pricing" style={{ padding: "100px 40px", borderTop: "1px solid var(--border-hair)" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>05 / PRICING</div>
        <h2 style={{ margin: "12px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 64, fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 0.98, maxWidth: 1000, textWrap: "balance" }}>Two plans. Both invite-only.</h2>
        <p style={{ marginTop: 16, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--fg-muted)", lineHeight: 1.5, maxWidth: 720 }}>We cap the number of operators per cohort to keep performance honest and support quality high. There's no free trial — but the application is short and we reply within a week.</p>
        <div style={{ marginTop: 48, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <PlanCard
            badge="OPERATOR"
            price="$249"
            period="/ month"
            tagline="Everything you need to run a personal trading book."
            cta="Apply for access"
            onCta={onApply}
            features={[
              "All 23 published strategies",
              "Live + paper trading via Alpaca, IBKR, Schwab, Tradier",
              "Bring-your-own Anthropic key (or use the tenant pool)",
              "Backtest workbench · unlimited runs",
              "Reports & tax · 1099-B + year-end summary",
              "Email + in-app support · 24h reply target",
            ]}
          />
          <PlanCard
            badge="DESK"
            price="$1,490"
            period="/ month"
            tagline="For small funds and prop teams running multiple operators."
            cta="Talk to us"
            onCta={onApply}
            featured
            features={[
              "Everything in Operator, plus —",
              "Up to 6 seats with role-based permissions (operator · admin · viewer)",
              "Tenant-wide audit log + compliance export",
              "Custom strategies authored by our quant team (3 included)",
              "Dedicated Slack channel · 2h reply target during market hours",
              "On-call quarterly performance review",
            ]}
          />
        </div>
        <div style={{ marginTop: 28, padding: "16px 20px", background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 3, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: "var(--fg)" }}>
            <span style={{ color: "var(--ink-1000)" }}>Annual prepay · 15% off.</span> Run a full year of strategies through earnings cycles, FOMC, and seasonal regimes.
          </div>
          <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)", letterSpacing: "0.05em" }}>BILLED ONCE · CANCEL ANYTIME WITH PRORATA</span>
        </div>
      </div>
    </section>
  );
}

function PlanCard({ badge, price, period, tagline, cta, onCta, features, featured }) {
  return (
    <div style={{
      padding: "28px 30px 26px",
      background: featured ? "var(--ink-100)" : "var(--bg)",
      border: featured ? "1px solid var(--brand)" : "1px solid var(--border)",
      borderTop: featured ? "2px solid var(--brand)" : "1px solid var(--border)",
      borderRadius: 4,
      position: "relative",
    }}>
      {featured && <span className="t-mono" style={{ position: "absolute", top: -10, right: 24, fontSize: 9.5, padding: "3px 10px", background: "var(--brand)", color: "var(--ink-050)", borderRadius: 2, letterSpacing: "0.18em", fontWeight: 600 }}>RECOMMENDED FOR TEAMS</span>}
      <span className="t-mono" style={{ fontSize: 11, color: "var(--brand)", letterSpacing: "0.18em", fontWeight: 600 }}>{badge}</span>
      <div style={{ marginTop: 16, display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 64, color: "var(--ink-1000)", fontWeight: 500, letterSpacing: "-0.02em" }}>{price}</span>
        <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg-muted)" }}>{period}</span>
      </div>
      <div style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg)", lineHeight: 1.45, maxWidth: 480 }}>{tagline}</div>
      <button onClick={onCta} style={{
        display: "block", width: "100%", marginTop: 22, padding: "12px 0",
        background: featured ? "var(--brand)" : "var(--bg-elev-1)",
        color: featured ? "var(--ink-050)" : "var(--ink-1000)",
        border: featured ? "1px solid var(--brand)" : "1px solid var(--border-strong)",
        borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 500, cursor: "default",
      }}>{cta} →</button>
      <ul style={{ margin: "24px 0 0", padding: 0, listStyle: "none" }}>
        {features.map((f, i) => (
          <li key={i} style={{ display: "flex", gap: 10, padding: "8px 0", borderBottom: i < features.length - 1 ? "1px solid var(--border-hair)" : "none", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-1000)", lineHeight: 1.45 }}>
            <span className="t-mono" style={{ color: "var(--brand)", fontSize: 12, marginTop: 2 }}>✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── faq ─────────────────────────────────────────────────────────────────

function MKFAQ() {
  const [open, setOpen] = useState(0);
  const QS = [
    { q: "Why is access invite-only?",                                a: "Three reasons: (1) we cap operators per cohort to keep our agents' API costs predictable, (2) we screen out users who don't already understand position sizing — strategies that win in a spreadsheet often lose in a real account due to operator behavior, (3) we'd rather have 300 happy operators than 30,000 unhappy ones. Application is short — we reply within a week." },
    { q: "Do you have access to my brokerage account?",                a: "AlphaDesk requests trade-level scopes only. We can read positions, route orders, and reconcile fills. We cannot move money in or out, change your contact info, or do anything outside what's needed to execute trades you've configured. Live keys are encrypted at rest with AES-256 and never appear in logs or AI memos." },
    { q: "Can I run my own strategies, not yours?",                    a: "Yes. The Strategy Workbench lets you fork any published playbook or build new ones from scratch. Define entry rules, confirmation rules, sizing logic, and exit conditions — then backtest and publish. The same six agents run your strategies as run ours." },
    { q: "What happens if an agent goes haywire?",                     a: "Multiple safety layers: pre-trade limits (Risk agent rejects bad orders), per-day stop-out (whole desk pauses), live drawdown breaker (full halt requiring operator + admin reset), and a manual kill-switch in the top bar that flattens everything in one click. We'd rather over-stop than under-stop." },
    { q: "How are AI costs handled?",                                  a: "Two options. (1) Tenant pool — included in your subscription, ~3M tokens/month soft cap, fair-use throttling under heavy load. (2) Bring your own Anthropic key — billed directly by Anthropic, no fair-use limits, model preferences fully under your control. Most operators start with the pool and switch to BYO once they're running multiple strategies." },
    { q: "What brokers do you support?",                               a: "Connected today: Alpaca, Interactive Brokers. Available with one-click setup: Charles Schwab, Tradier, E*TRADE, Kraken. In development: Coinbase Advanced (Q3 2026), Robinhood (Q4 2026 pending API). Adding a broker takes us about 6 weeks once their API is reasonable." },
    { q: "Can I cancel?",                                             a: "Yes, anytime. We prorate the remaining month and refund. Annual prepay refunds are also prorated. We don't lock anyone in — if AlphaDesk isn't a fit, we'd rather you leave on good terms than churn through support tickets." },
  ];
  return (
    <section id="faq" style={{ padding: "100px 40px", borderTop: "1px solid var(--border-hair)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "320px 1fr", gap: 60, alignItems: "start" }}>
        <div style={{ position: "sticky", top: 100 }}>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>06 / FAQ</div>
          <h2 style={{ margin: "12px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 48, fontWeight: 400, letterSpacing: "-0.025em", lineHeight: 1.0 }}>Common questions, answered carefully.</h2>
          <p style={{ marginTop: 16, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--fg-muted)", lineHeight: 1.6 }}>Don't see what you're asking? <span style={{ color: "var(--brand)" }}>hello@tradingalpha.net</span> — we read every email.</p>
        </div>
        <div>
          {QS.map((q, i) => {
            const isOpen = open === i;
            return (
              <div key={i} style={{ borderBottom: "1px solid var(--border-hair)" }}>
                <button onClick={() => setOpen(isOpen ? -1 : i)} style={{ display: "flex", width: "100%", textAlign: "left", justifyContent: "space-between", alignItems: "center", padding: "20px 0", background: "none", border: "none", cursor: "default" }}>
                  <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", letterSpacing: "-0.015em" }}>{q.q}</span>
                  <span className="t-mono" style={{ fontSize: 18, color: "var(--fg-muted)" }}>{isOpen ? "−" : "+"}</span>
                </button>
                {isOpen && <p style={{ margin: "0 0 22px", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg-muted)", lineHeight: 1.6, textWrap: "pretty", maxWidth: 720 }}>{q.a}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── apply overlay ───────────────────────────────────────────────────────

function MKApplyOverlay({ onClose }) {
  const [submitted, setSubmitted] = useState(false);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(13,12,10,0.85)", backdropFilter: "blur(8px)", zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "auto", padding: "60px 24px" }}>
      <div style={{ width: "100%", maxWidth: 720, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4 }}>
        <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "22px 28px", borderBottom: "1px solid var(--border-hair)" }}>
          <div>
            <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>APPLY FOR ACCESS · NEXT COHORT MAY 22</div>
            <h2 style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em" }}>Tell us who you are.</h2>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "1px solid var(--border)", padding: "5px 11px", borderRadius: 3, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-muted)", cursor: "default" }}>esc</button>
        </header>
        {submitted ? (
          <div style={{ padding: "60px 28px 50px", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--up-500)", color: "var(--ink-050)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 26, fontWeight: 500 }}>✓</div>
            <h3 style={{ margin: "20px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em" }}>Thanks. We'll be in touch.</h3>
            <p style={{ marginTop: 12, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 16, color: "var(--fg-muted)", lineHeight: 1.55, maxWidth: 460, margin: "12px auto 0" }}>We typically reply within 5 business days. If approved, you'll get a magic-link to start onboarding for the May 22 cohort.</p>
            <button onClick={onClose} style={{ marginTop: 28, background: "var(--brand)", color: "var(--ink-050)", border: "1px solid var(--brand)", padding: "10px 24px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 500, cursor: "default" }}>Back to site</button>
          </div>
        ) : <ApplyForm onSubmit={() => setSubmitted(true)} />}
      </div>
    </div>
  );
}

function ApplyForm({ onSubmit }) {
  return (
    <div style={{ padding: "8px 28px 24px" }}>
      <ApplyField label="Name" hint="Full legal name · used on the operator agreement"><ApplyInput placeholder="Jane Operator" /></ApplyField>
      <ApplyField label="Email" hint="Where we reply with the application decision"><ApplyInput placeholder="you@firm.com" mono /></ApplyField>
      <ApplyField label="LinkedIn or website" hint="Optional · helps us understand your background"><ApplyInput placeholder="linkedin.com/in/…" mono /></ApplyField>
      <ApplyField label="Plan interest">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <ApplyRadio label="Operator · $249/mo" sub="Personal book" checked />
          <ApplyRadio label="Desk · $1,490/mo" sub="Up to 6 seats" />
        </div>
      </ApplyField>
      <ApplyField label="Trading background" hint="Pick the closest fit · won't be held against you">
        <select defaultValue="ind" style={{ width: "100%", padding: "10px 12px", fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--ink-1000)", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3, outline: "none" }}>
          <option value="ind">Serious individual investor — 5+ years</option>
          <option value="quant">Quant or developer — building strategies</option>
          <option value="ext">Ex-trader or fund employee</option>
          <option value="prop">Currently at a prop or fund</option>
          <option value="newer">Newer trader — under 3 years</option>
        </select>
      </ApplyField>
      <ApplyField label="Capital you'd run on AlphaDesk" hint="Approximate · we won't pin you to it">
        <select defaultValue="m" style={{ width: "100%", padding: "10px 12px", fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--ink-1000)", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3, outline: "none" }}>
          <option value="s">Under $25k</option>
          <option value="m">$25k – $250k</option>
          <option value="l">$250k – $1M</option>
          <option value="xl">$1M+</option>
        </select>
      </ApplyField>
      <ApplyField label="What strategies are you most interested in?" hint="Helps us understand fit and prioritize the next cohort">
        <textarea placeholder="Earnings drift, mean reversion, my own breakout system…" rows={3} style={{ width: "100%", padding: "10px 12px", fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--ink-1000)", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3, outline: "none", resize: "vertical" }} />
      </ApplyField>
      <ApplyField label="How did you hear about us?" hint="Optional">
        <ApplyInput placeholder="Twitter, a friend, search, a podcast…" />
      </ApplyField>
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        <button onClick={onSubmit} style={{ flex: 1, background: "var(--brand)", color: "var(--ink-050)", border: "1px solid var(--brand)", padding: "12px 22px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 500, cursor: "default" }}>Submit application →</button>
        <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", letterSpacing: "0.05em", alignSelf: "center", maxWidth: 220, lineHeight: 1.5 }}>By submitting you agree we can contact you about your application.</span>
      </div>
    </div>
  );
}

function ApplyField({ label, hint, children }) {
  return (
    <div style={{ padding: "14px 0", borderBottom: "1px solid var(--border-hair)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{label}</div>
        {hint && <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, color: "var(--fg-muted)" }}>{hint}</div>}
      </div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}
function ApplyInput({ placeholder, mono }) {
  return <input placeholder={placeholder} style={{ width: "100%", padding: "10px 12px", fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)", fontSize: 13.5, color: "var(--ink-1000)", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3, outline: "none" }} />;
}
function ApplyRadio({ label, sub, checked }) {
  return (
    <div style={{ padding: "12px 14px", background: checked ? "rgba(201,166,107,0.08)" : "var(--bg-elev-1)", border: checked ? "1px solid var(--brand)" : "1px solid var(--border)", borderRadius: 3, cursor: "default", display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 14, height: 14, borderRadius: "50%", border: checked ? "4px solid var(--brand)" : "1px solid var(--border-strong)", background: checked ? "var(--ink-050)" : "transparent", boxSizing: "border-box", flexShrink: 0 }} />
      <div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-1000)" }}>{label}</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)" }}>{sub}</div>
      </div>
    </div>
  );
}

// ─── footer ──────────────────────────────────────────────────────────────

function MKFooter({ onNav }) {
  return (
    <footer style={{ borderTop: "1px solid var(--border-hair)", padding: "60px 40px 40px", background: "var(--ink-100)" }}>
      <div style={{ maxWidth: 1320, margin: "0 auto", display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr 1fr", gap: 40 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "var(--brand)", color: "var(--ink-050)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 600, fontSize: 14 }}>α</div>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)" }}>AlphaDesk</div>
          </div>
          <p style={{ marginTop: 14, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)", lineHeight: 1.55, maxWidth: 380 }}>
            A trading desk that reads, decides, and trades alongside you. Made by Trading Alpha · San Francisco · 2024.
          </p>
        </div>
        {[
          { h: "Product",  l: ["Thesis", "The agents", "Strategies", "Results", "Pricing"] },
          { h: "Company",  l: ["About", "Operators", "Press", "Careers · 2 open", "Contact"] },
          { h: "Legal",    l: ["Terms", "Privacy", "Risk disclosure", "Methodology", "Compliance"] },
        ].map(c => (
          <div key={c.h}>
            <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9.5, letterSpacing: "0.18em" }}>{c.h}</div>
            <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none" }}>
              {c.l.map(li => <li key={li} style={{ padding: "5px 0", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--fg)" }}>{li}</li>)}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: 1320, margin: "40px auto 0", paddingTop: 22, borderTop: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-hint)", letterSpacing: "0.05em" }}>© 2024–2026 TRADING ALPHA INC · ALL RIGHTS RESERVED</span>
        <span className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-hint)", letterSpacing: "0.05em", maxWidth: 700, textAlign: "right", lineHeight: 1.5 }}>
          Trading involves risk. Past performance is not indicative of future returns. AlphaDesk is a software platform · not a registered broker, advisor, or fund.
        </span>
      </div>
    </footer>
  );
}

if (typeof window !== "undefined") Object.assign(window, { MarketingPage });


// Auth — sign in, magic link, 2FA, recovery, account states. Full-screen takeover.

const AUTH_STATES = ["signin", "magic-sent", "twofa", "recovery", "pending", "rejected", "locked"];

const AuthPage = ({ onNav }) => {
  const [state, setState] = useState("signin");
  return (
    <div style={{ position: "fixed", inset: 0, background: "var(--bg)", zIndex: 100, display: "grid", gridTemplateColumns: "1fr 1.05fr", overflow: "hidden" }}>
      <AuthLeft state={state} setState={setState} />
      <AuthRight onNav={onNav} state={state} setState={setState} />
    </div>
  );
};

// ─── left brand pane ─────────────────────────────────────────────────────

function AuthLeft({ state, setState }) {
  return (
    <aside style={{ background: "var(--ink-100)", borderRight: "1px solid var(--border)", padding: "32px 44px 28px", display: "flex", flexDirection: "column", overflow: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--brand)", color: "var(--ink-050)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontWeight: 600, fontSize: 16 }}>α</div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 19, color: "var(--ink-1000)", letterSpacing: "-0.015em" }}>AlphaDesk</div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 480, marginLeft: 0 }}>
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>{new Date().toDateString().toUpperCase()} · 09:14 ET</div>
        <h1 style={{ margin: "16px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 56, fontWeight: 400, letterSpacing: "-0.03em", lineHeight: 0.98, textWrap: "balance" }}>
          Welcome back to <span style={{ color: "var(--brand)" }}>your desk</span>.
        </h1>
        <p style={{ marginTop: 18, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 17, color: "var(--fg-muted)", lineHeight: 1.55, maxWidth: 460, textWrap: "pretty" }}>
          The morning brief is ready. Three new pipeline candidates surfaced overnight, the Risk agent is green across all books, and your weekly memo is queued.
        </p>

        <div style={{ marginTop: 32, padding: "16px 18px", background: "var(--bg)", border: "1px solid var(--border)", borderLeft: "2px solid var(--brand)", borderRadius: 3 }}>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em", fontSize: 9.5 }}>BEFORE THE BELL · {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase()}</div>
          <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}>
            {[
              { t: "Scout has surfaced",        b: "47 candidates · 3 above 0.85 confidence" },
              { t: "Risk gating is GREEN",      b: "Drawdown headroom 4.6% · book size 71% of cap" },
              { t: "Earnings tonight",          b: "NVDA · CRM · ZS · 2 in your watchlists" },
              { t: "1 strategy needs review",   b: "Pairs · drift outside cointegration band" },
            ].map((r, i) => (
              <li key={i} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: i < 3 ? "1px solid var(--border-hair)" : "none" }}>
                <span className="t-mono" style={{ color: "var(--brand)", fontSize: 11, marginTop: 2 }}>·</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-1000)" }}>{r.t}</div>
                  <div style={{ marginTop: 1, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-muted)" }}>{r.b}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.06em" }}>TRADING ALPHA · TRADINGALPHA.NET</span>
        <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)", letterSpacing: "0.06em" }}>SYSTEM · OPERATIONAL</span>
      </div>
    </aside>
  );
}

// ─── right form pane ─────────────────────────────────────────────────────

function AuthRight({ onNav, state, setState }) {
  return (
    <div style={{ overflow: "auto", padding: "32px 60px", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", justifyContent: "flex-end", gap: 14, alignItems: "center" }}>
        <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)", letterSpacing: "0.05em" }}>NEW HERE?</span>
        <button onClick={() => onNav("marketing")} style={{ background: "var(--bg-elev-1)", color: "var(--ink-1000)", border: "1px solid var(--border-strong)", padding: "7px 14px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12.5, cursor: "default" }}>Apply for access ↗</button>
      </header>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", maxWidth: 480, margin: "0 auto", width: "100%" }}>
        {state === "signin"     && <AuthSignIn onSubmit={() => setState("magic-sent")} on2FA={() => setState("twofa")} onPending={() => setState("pending")} onRejected={() => setState("rejected")} onLocked={() => setState("locked")} />}
        {state === "magic-sent" && <AuthMagicSent onBack={() => setState("signin")} on2FA={() => setState("twofa")} />}
        {state === "twofa"      && <Auth2FA onSuccess={() => onNav("dashboard", { resetHistory: true })} onRecovery={() => setState("recovery")} onBack={() => setState("signin")} />}
        {state === "recovery"   && <AuthRecovery onSuccess={() => onNav("dashboard", { resetHistory: true })} onBack={() => setState("twofa")} />}
        {state === "pending"    && <AuthPending onBack={() => setState("signin")} />}
        {state === "rejected"   && <AuthRejected onBack={() => setState("signin")} />}
        {state === "locked"     && <AuthLocked onBack={() => setState("signin")} />}
      </div>

      <footer style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {AUTH_STATES.map(s => (
            <button key={s} onClick={() => setState(s)} className="t-mono" style={{
              fontSize: 9, padding: "3px 7px",
              background: s === state ? "var(--bg-elev-2)" : "transparent",
              border: s === state ? "1px solid var(--border-strong)" : "1px solid var(--border)",
              color: s === state ? "var(--ink-1000)" : "var(--fg-muted)",
              borderRadius: 2, letterSpacing: "0.05em", cursor: "default", fontWeight: s === state ? 600 : 400,
            }}>{s}</button>
          ))}
        </div>
        <span className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.05em" }}>DEMO · STATE PICKER</span>
      </footer>
    </div>
  );
}

// ─── states ──────────────────────────────────────────────────────────────

function AuthHead({ eyebrow, title, sub }) {
  return (
    <header style={{ marginBottom: 24 }}>
      <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>{eyebrow}</div>
      <h2 style={{ margin: "10px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 38, fontWeight: 400, letterSpacing: "-0.025em", lineHeight: 1.05, textWrap: "balance" }}>{title}</h2>
      {sub && <p style={{ marginTop: 12, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: "var(--fg-muted)", lineHeight: 1.55, textWrap: "pretty" }}>{sub}</p>}
    </header>
  );
}

function AuthInput({ placeholder, mono, type = "text", autoFocus, value }) {
  return <input type={type} placeholder={placeholder} defaultValue={value} autoFocus={autoFocus} style={{ width: "100%", padding: "12px 14px", fontFamily: mono ? "var(--font-mono)" : "var(--font-ui)", fontSize: 14, color: "var(--ink-1000)", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 3, outline: "none", boxSizing: "border-box" }} />;
}

function AuthPrimary({ children, onClick }) {
  return <button onClick={onClick} style={{ width: "100%", marginTop: 16, padding: "13px 0", background: "var(--brand)", color: "var(--ink-050)", border: "1px solid var(--brand)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 500, cursor: "default" }}>{children}</button>;
}

function AuthSignIn({ onSubmit, on2FA, onPending, onRejected, onLocked }) {
  return (
    <>
      <AuthHead eyebrow="SIGN IN" title="Operator login." sub="We sign you in with a magic link to your registered email. If 2FA is enabled, you'll be challenged after the link." />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label className="t-eyebrow-italic" style={{ color: "var(--fg-muted)", fontSize: 9.5, letterSpacing: "0.16em" }}>EMAIL</label>
        <AuthInput placeholder="you@firm.com" mono type="email" autoFocus />
      </div>
      <AuthPrimary onClick={onSubmit}>Email me a magic link →</AuthPrimary>
      <div style={{ marginTop: 20, padding: "12px 14px", background: "var(--ink-100)", border: "1px solid var(--border-hair)", borderRadius: 3 }}>
        <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>OR USE A SECURITY KEY</div>
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button style={{ flex: 1, background: "var(--bg-elev-1)", color: "var(--ink-1000)", border: "1px solid var(--border-strong)", padding: "9px 0", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12.5, cursor: "default" }}>YubiKey · Touch ID</button>
          <button onClick={on2FA} style={{ flex: 1, background: "var(--bg-elev-1)", color: "var(--ink-1000)", border: "1px solid var(--border-strong)", padding: "9px 0", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12.5, cursor: "default" }}>Authenticator code</button>
        </div>
      </div>
      <div style={{ marginTop: 16, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-hint)", letterSpacing: "0.04em", lineHeight: 1.6 }}>
        Sign-ins are logged with IP and device fingerprint. We'll flag a session you don't recognize.
      </div>
    </>
  );
}

function AuthMagicSent({ onBack, on2FA }) {
  return (
    <>
      <AuthHead eyebrow="LINK SENT" title="Check your email." sub="We sent a one-tap sign-in link to operator@tradingalpha.net. The link is valid for 10 minutes and works only on this device." />
      <div style={{ padding: "20px 22px", background: "var(--ink-100)", border: "1px solid var(--border)", borderLeft: "2px solid var(--brand)", borderRadius: 3, display: "flex", gap: 14, alignItems: "center" }}>
        <span style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--bg-elev-1)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand)", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18 }}>✉</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: "var(--ink-1000)" }}>Sign-in link sent</div>
          <div style={{ marginTop: 2, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>operator@tradingalpha.net · expires 09:24 ET</div>
        </div>
      </div>
      <button onClick={on2FA} style={{ width: "100%", marginTop: 16, padding: "12px 0", background: "var(--brand)", color: "var(--ink-050)", border: "1px solid var(--brand)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 500, cursor: "default" }}>Simulate clicking the link →</button>
      <div style={{ marginTop: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>Didn't get it? <span style={{ color: "var(--brand)" }}>Resend in 0:42</span></span>
        <button onClick={onBack} style={{ background: "none", border: "none", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", cursor: "default" }}>← Use a different email</button>
      </div>
    </>
  );
}

function Auth2FA({ onSuccess, onRecovery, onBack }) {
  return (
    <>
      <AuthHead eyebrow="TWO-FACTOR" title="Authenticator code." sub="Open your authenticator app and enter the 6-digit code for AlphaDesk. Codes refresh every 30 seconds." />
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, margin: "8px 0 18px" }}>
        {[1, 2, 3, 4, 5, 6].map(i => (
          <input key={i} maxLength={1} defaultValue={["8", "1", "4", "", "", ""][i - 1]} autoFocus={i === 4} style={{
            flex: 1, height: 64, textAlign: "center",
            fontFamily: "var(--font-mono)", fontSize: 28, color: "var(--ink-1000)", fontWeight: 500,
            background: "var(--bg-elev-1)", border: i === 4 ? "1px solid var(--brand)" : "1px solid var(--border)", borderRadius: 3, outline: "none",
            caretColor: "var(--brand)",
          }} />
        ))}
      </div>
      <AuthPrimary onClick={onSuccess}>Verify and sign in →</AuthPrimary>
      <div style={{ marginTop: 20, padding: "12px 14px", background: "var(--ink-100)", border: "1px solid var(--border-hair)", borderRadius: 3, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>LOST YOUR DEVICE?</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)" }}>Use one of your one-time recovery codes.</div>
        </div>
        <button onClick={onRecovery} style={{ background: "var(--bg-elev-1)", color: "var(--ink-1000)", border: "1px solid var(--border-strong)", padding: "7px 14px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12.5, cursor: "default" }}>Use recovery code</button>
      </div>
      <div style={{ marginTop: 14, textAlign: "center" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", cursor: "default" }}>← Back to sign in</button>
      </div>
    </>
  );
}

function AuthRecovery({ onSuccess, onBack }) {
  return (
    <>
      <AuthHead eyebrow="RECOVERY CODE" title="Use a recovery code." sub="Each recovery code works exactly once. After signing in, regenerate your codes from Settings · Security." />
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label className="t-eyebrow-italic" style={{ color: "var(--fg-muted)", fontSize: 9.5, letterSpacing: "0.16em" }}>RECOVERY CODE</label>
        <AuthInput placeholder="xxxx-xxxx-xxxx" mono autoFocus />
      </div>
      <AuthPrimary onClick={onSuccess}>Verify and sign in →</AuthPrimary>
      <div style={{ marginTop: 18, padding: "12px 14px", background: "rgba(217,145,75,0.08)", border: "1px solid var(--gold-300)", borderLeft: "2px solid var(--gold-500)", borderRadius: 3 }}>
        <div className="t-eyebrow-italic" style={{ color: "var(--gold-500)", fontSize: 9.5, letterSpacing: "0.16em" }}>HEADS UP</div>
        <div style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)", lineHeight: 1.55 }}>If you've lost both your device and your recovery codes, contact <span style={{ color: "var(--brand)" }}>support@tradingalpha.net</span> from your registered email. Identity verification takes 1–2 business days.</div>
      </div>
      <div style={{ marginTop: 14, textAlign: "center" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", cursor: "default" }}>← Back to authenticator</button>
      </div>
    </>
  );
}

function AuthPending({ onBack }) {
  return (
    <>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(217,145,75,0.15)", color: "var(--gold-500)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 28, marginBottom: 18 }}>⋯</div>
      <AuthHead eyebrow="APPLICATION PENDING" title="Your application is being reviewed." sub="Sarah and the operator-vetting team are reviewing your application. We typically reply within 5 business days. You'll get an email at the address you applied with — no further action needed." />
      <div style={{ padding: "16px 18px", background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 3 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>APPLIED</div>
            <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-1000)" }}>Apr 14, 2026</div>
          </div>
          <div>
            <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>NEXT COHORT</div>
            <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-1000)" }}>May 22, 2026</div>
          </div>
          <div>
            <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>STATUS</div>
            <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gold-500)", letterSpacing: "0.04em", fontWeight: 600 }}>UNDER REVIEW · 2/5 DAYS</div>
          </div>
          <div>
            <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>QUEUE POSITION</div>
            <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--ink-1000)" }}>14 of 47</div>
          </div>
        </div>
      </div>
      <div style={{ marginTop: 14, textAlign: "center" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", cursor: "default" }}>← Back to sign in</button>
      </div>
    </>
  );
}

function AuthRejected({ onBack }) {
  return (
    <>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(201,75,75,0.15)", color: "var(--down-500)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 28, marginBottom: 18 }}>—</div>
      <AuthHead eyebrow="APPLICATION DECLINED" title="Not the right fit, for now." sub="Sarah read your application carefully. AlphaDesk is built for operators with significant trading experience and the time to actively monitor a desk; we don't think we'd serve you well today. This isn't a permanent answer — many declined applicants reapply successfully later." />
      <div style={{ padding: "14px 16px", background: "var(--ink-100)", border: "1px solid var(--border-hair)", borderLeft: "2px solid var(--down-500)", borderRadius: 3 }}>
        <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>DECISION RATIONALE</div>
        <div style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)", lineHeight: 1.55 }}>"Trading background indicated under 1 year experience. We recommend reapplying after a year of consistent paper or live trading — we'd love to see what you've built."</div>
        <div style={{ marginTop: 8, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-hint)" }}>— sarah@tradingalpha.net · Apr 19, 2026</div>
      </div>
      <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
        <button style={{ flex: 1, background: "var(--bg-elev-1)", color: "var(--ink-1000)", border: "1px solid var(--border-strong)", padding: "10px 0", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 13, cursor: "default" }}>Reply with context</button>
        <button onClick={onBack} style={{ flex: 1, background: "var(--bg-elev-1)", color: "var(--ink-1000)", border: "1px solid var(--border-strong)", padding: "10px 0", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 13, cursor: "default" }}>Reapply in 6 months</button>
      </div>
    </>
  );
}

function AuthLocked({ onBack }) {
  return (
    <>
      <div style={{ width: 56, height: 56, borderRadius: "50%", background: "rgba(201,75,75,0.15)", color: "var(--down-500)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 26, marginBottom: 18 }}>⊘</div>
      <AuthHead eyebrow="ACCOUNT LOCKED" title="Too many failed sign-in attempts." sub="As a precaution, we've temporarily locked sign-in for this account. The lock expires automatically — or you can verify identity via email and unlock now." />
      <div style={{ padding: "14px 16px", background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 3 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>FAILED ATTEMPTS</div>
            <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 22, color: "var(--down-500)", fontWeight: 500 }}>5 / 5</div>
          </div>
          <div>
            <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>UNLOCKS IN</div>
            <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 22, color: "var(--ink-1000)", fontWeight: 500 }}>14:23</div>
          </div>
        </div>
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-hair)" }}>
          <div className="t-eyebrow-italic" style={{ color: "var(--fg-hint)", fontSize: 9, letterSpacing: "0.16em" }}>SUSPICIOUS LOGIN FROM</div>
          <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-1000)" }}>193.218.118.201 · Latvia · unrecognized device</div>
        </div>
      </div>
      <button style={{ width: "100%", marginTop: 16, padding: "12px 0", background: "var(--brand)", color: "var(--ink-050)", border: "1px solid var(--brand)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 14, fontWeight: 500, cursor: "default" }}>Unlock via email verification →</button>
      <div style={{ marginTop: 14, textAlign: "center" }}>
        <button onClick={onBack} style={{ background: "none", border: "none", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", cursor: "default" }}>← Back to sign in</button>
      </div>
    </>
  );
}

if (typeof window !== "undefined") Object.assign(window, { AuthPage });


// Risk page — portfolio risk surface
// Hero VaR/ES band · intraday budget burn-down · stress scenarios ·
// sector exposure · beta + correlation · concentration limits · AI memo

const RiskPage = ({ tweaks, onNav, onPickTicker }) => {
  return (
    <div style={{ padding: "20px 24px 40px", maxWidth: 1640, margin: "0 auto" }}>
      <RiskHeader />
      <RiskHero />
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16, marginBottom: 16 }}>
        <RiskScenarios />
        <RiskBudgetCard />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <RiskExposure />
        <RiskCorrelation />
      </div>
      <RiskConcentration onPickTicker={onPickTicker} />
      <RiskAIMemo />
    </div>
  );
};

// ─── header ─────────────────────────────────────────────────────────────

function RiskHeader() {
  return (
    <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 0 14px", borderBottom: "1px solid var(--border-hair)", marginBottom: 18 }}>
      <div>
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>RISK / PORTFOLIO SURFACE</div>
        <h1 style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em" }}>
          What can hurt us today
        </h1>
        <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 14 }}>
          Value at risk, scenario stress, exposure, correlation. Intraday risk budget burns down with every fill.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>
        <StatusDot tone="up" size={6} />
        <span>Risk engine · 24s ago</span>
        <span style={{ marginLeft: 10, padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 3, color: "var(--fg)" }}>Recompute</span>
      </div>
    </header>
  );
}

// ─── hero VaR band ───────────────────────────────────────────────────────

function RiskHero() {
  const card = { padding: "16px 18px", background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, position: "relative" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: 4, marginBottom: 16 }}>
      {[
        { label: "PORTFOLIO VALUE", val: "$284,512", sub: "−$1,840 today" },
        { label: "VAR · 1D · 95%", val: "$3,820", sub: "1.34% of book", tone: "warn" },
        { label: "VAR · 1D · 99%", val: "$6,720", sub: "2.36% of book", tone: "down" },
        { label: "VAR · 5D · 99%", val: "$15,030", sub: "5.28% of book", tone: "down" },
        { label: "EXPECTED SHORTFALL", val: "$8,940", sub: "tail beyond 99%", tone: "down" },
      ].map((m, i) => (
        <div key={i} style={card}>
          <div className="t-label" style={{ color: "var(--fg-hint)" }}>{m.label}</div>
          <div className="t-mono" style={{ marginTop: 6, fontSize: 24, color: m.tone === "down" ? "var(--down-500)" : m.tone === "warn" ? "var(--gold-300)" : "var(--ink-1000)", fontWeight: 500 }}>{m.val}</div>
          <div className="t-body-sm" style={{ marginTop: 2, color: "var(--fg-muted)", fontFamily: "var(--font-display)", fontStyle: "italic" }}>{m.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── intraday risk budget burn-down ──────────────────────────────────────

function RiskBudgetCard() {
  // synthetic burn series — 9:30 → 16:00, ET. Burn so far at ~14:00.
  const total = 5000;
  const used = 1840;
  const pct = (used / total) * 100;
  const points = [0, 280, 540, 720, 980, 1240, 1410, 1580, 1640, 1720, 1810, 1840];
  const xMax = 24; // 6.5h × ~4 ticks = 24
  const yMax = total;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (points.length - 1)) * 100} ${100 - (p / yMax) * 100}`).join(" ");
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>RISK BUDGET / INTRADAY</div>
          <div style={{ marginTop: 2, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)" }}>$1,840 of $5,000 used</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="t-mono" style={{ fontSize: 22, color: "var(--gold-300)", fontWeight: 500 }}>{pct.toFixed(0)}%</div>
          <div className="t-body-sm" style={{ color: "var(--fg-muted)", fontFamily: "var(--font-display)", fontStyle: "italic" }}>$3,160 remaining</div>
        </div>
      </div>
      {/* utilization bar */}
      <div style={{ marginTop: 14, height: 6, background: "var(--bg-elev-1)", borderRadius: 999, overflow: "hidden", position: "relative" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, var(--gold-500), var(--down-500))" }} />
        {[60, 80].map(threshold => (
          <div key={threshold} style={{ position: "absolute", left: `${threshold}%`, top: -2, bottom: -2, width: 1, background: threshold === 80 ? "var(--down-500)" : "var(--gold-300)", opacity: 0.7 }} />
        ))}
      </div>
      {/* burn-down chart */}
      <div style={{ marginTop: 18, position: "relative", height: 130, padding: "0 4px" }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          <defs>
            <linearGradient id="riskBurnGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--down-500)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--down-500)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* threshold guides */}
          <line x1="0" x2="100" y1={100 - (3000 / yMax) * 100} y2={100 - (3000 / yMax) * 100} stroke="var(--gold-300)" strokeWidth="0.4" strokeDasharray="2 2" opacity="0.6" />
          <line x1="0" x2="100" y1={100 - (4000 / yMax) * 100} y2={100 - (4000 / yMax) * 100} stroke="var(--down-500)" strokeWidth="0.4" strokeDasharray="2 2" opacity="0.6" />
          {/* fill */}
          <path d={`${path} L 100 100 L 0 100 Z`} fill="url(#riskBurnGrad)" />
          <path d={path} stroke="var(--down-500)" strokeWidth="1.4" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "stretch", justifyContent: "space-between", pointerEvents: "none" }}>
          {["09:30", "11:00", "12:30", "14:00", "15:30"].map((t, i) => (
            <div key={i} style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-hint)", alignSelf: "flex-end" }}>{t}</div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-hair)", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {[
          { label: "BURNED · MOMENTUM", val: "$1,120", pct: "61%" },
          { label: "BURNED · PEAD", val: "$420", pct: "23%" },
          { label: "BURNED · MANUAL", val: "$300", pct: "16%" },
        ].map((s, i) => (
          <div key={i}>
            <div className="t-label" style={{ color: "var(--fg-hint)" }}>{s.label}</div>
            <div className="t-mono" style={{ fontSize: 14, color: "var(--ink-1000)", marginTop: 2 }}>{s.val} <span style={{ color: "var(--fg-muted)", fontSize: 10 }}>{s.pct}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── stress scenarios ────────────────────────────────────────────────────

function RiskScenarios() {
  const scenarios = [
    { name: "Rates +50bps",        cat: "macro",  pl: -8420,  pct: -2.96, vsBook: -0.30, narrative: "Long-duration tech takes the brunt; SPY long offsets ~22%." },
    { name: "Oil −20%",             cat: "macro",  pl:  1240,  pct:  0.44, vsBook:  0.12, narrative: "No XLE long; small tailwind via QQQ." },
    { name: "VIX ×2 · vol +30%",   cat: "vol",    pl: -12600, pct: -4.43, vsBook: -0.45, narrative: "Mag-7 concentration · gamma-short via covered calls." },
    { name: "USD +5%",              cat: "macro",  pl: -2010,  pct: -0.71, vsBook: -0.08, narrative: "Foreign rev exposure on NVDA, META." },
    { name: "Tech sector −10%",    cat: "sector", pl: -18420, pct: -6.48, vsBook: -0.66, narrative: "61% portfolio in tech. Largest single risk." },
    { name: "Rotation · value+5%", cat: "factor", pl: -3140,  pct: -1.10, vsBook: -0.12, narrative: "Long quality/momentum — short-term drawdown then recovery." },
    { name: "Credit spreads +50bp",cat: "credit", pl: -1820,  pct: -0.64, vsBook: -0.07, narrative: "Indirect: HYG corr 0.6 to SPY beta exposure." },
    { name: "Liquidity shock",     cat: "liq",    pl: -9400,  pct: -3.30, vsBook: -0.34, narrative: "ADV-thin small-caps in PEAD bucket; 3-day exit risk." },
  ];
  const catColor = { macro: "var(--gold-300)", vol: "var(--down-500)", sector: "var(--brand)", factor: "var(--up-500)", credit: "var(--gold-500)", liq: "var(--fg-muted)" };
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>STRESS SCENARIOS</div>
          <h2 className="t-h3" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>What if today went sideways</h2>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)", padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 3 }}>+ Add scenario</span>
        </div>
      </div>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr", gap: 1, background: "var(--border-hair)", border: "1px solid var(--border-hair)", borderRadius: 3 }}>
        {scenarios.map(s => {
          const isLoss = s.pl < 0;
          const barWidth = Math.min(100, Math.abs(s.pct) * 14);
          return (
            <div key={s.name} style={{ display: "grid", gridTemplateColumns: "180px 1fr 100px 80px 70px", gap: 12, alignItems: "center", padding: "10px 12px", background: "var(--ink-100)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: catColor[s.cat] }} />
                <span className="t-body-sm" style={{ color: "var(--ink-1000)", fontWeight: 500 }}>{s.name}</span>
              </div>
              <div style={{ position: "relative", height: 14, background: "var(--bg-elev-1)", borderRadius: 2 }}>
                <div style={{
                  position: "absolute", left: isLoss ? `calc(50% - ${barWidth / 2}%)` : "50%",
                  width: `${barWidth / 2}%`, height: "100%",
                  background: isLoss ? "var(--down-500)" : "var(--up-500)", opacity: 0.65, borderRadius: 1
                }} />
                <div style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "var(--border-strong)" }} />
              </div>
              <div className="t-mono" style={{ fontSize: 13, color: isLoss ? "var(--down-500)" : "var(--up-500)", textAlign: "right", fontWeight: 500 }}>
                {isLoss ? "−" : "+"}${Math.abs(s.pl).toLocaleString()}
              </div>
              <div className="t-mono" style={{ fontSize: 12, color: "var(--fg-muted)", textAlign: "right" }}>
                {s.pct > 0 ? "+" : ""}{s.pct.toFixed(2)}%
              </div>
              <div className="t-mono" style={{ fontSize: 11, color: "var(--fg-hint)", textAlign: "right" }}>β {s.vsBook.toFixed(2)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>
        Worst case: <span style={{ color: "var(--down-500)" }}>−$18,420 on Tech sector −10%</span> · 6.48% drawdown · stop-equiv would trigger at $14,000.
      </div>
    </div>
  );
}

// ─── sector exposure ─────────────────────────────────────────────────────

function RiskExposure() {
  const sectors = [
    { name: "Technology",      gross: 174320, net: 168200, weight: 61.3, limit: 50, status: "over" },
    { name: "Communications",  gross: 32400,  net: 32400,  weight: 11.4, limit: 25, status: "ok" },
    { name: "Consumer Disc.",  gross: 28100,  net: 24400,  weight: 9.9,  limit: 25, status: "ok" },
    { name: "Industrials",     gross: 18200,  net: 18200,  weight: 6.4,  limit: 20, status: "ok" },
    { name: "Healthcare",      gross: 14800,  net: 14800,  weight: 5.2,  limit: 20, status: "ok" },
    { name: "Energy",          gross: 8420,   net: 8420,   weight: 3.0,  limit: 15, status: "ok" },
    { name: "Financials",      gross: 5800,   net: 5800,   weight: 2.0,  limit: 20, status: "low" },
    { name: "Cash",            gross: 2472,   net: 2472,   weight: 0.9,  limit: 100, status: "low" },
  ];
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18 }}>
      <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>SECTOR EXPOSURE</div>
      <h2 className="t-h3" style={{ margin: "2px 0 14px", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>Where the book is concentrated</h2>
      <div style={{ display: "grid", gap: 8 }}>
        {sectors.map(s => {
          const overLimit = s.weight > s.limit;
          return (
            <div key={s.name} style={{ display: "grid", gridTemplateColumns: "150px 1fr 80px 80px", gap: 12, alignItems: "center" }}>
              <span className="t-body-sm" style={{ color: "var(--ink-1000)" }}>{s.name}</span>
              <div style={{ position: "relative", height: 18, background: "var(--bg-elev-1)", borderRadius: 2, overflow: "visible" }}>
                <div style={{
                  width: `${Math.min(100, s.weight)}%`, height: "100%",
                  background: overLimit ? "var(--down-500)" : "var(--brand)",
                  opacity: 0.85, borderRadius: 1
                }} />
                <div style={{ position: "absolute", left: `${s.limit}%`, top: -3, bottom: -3, width: 1, background: "var(--gold-300)", opacity: 0.7 }} />
                {overLimit && <span className="t-mono" style={{ position: "absolute", right: 6, top: 2, fontSize: 9.5, color: "var(--ink-1000)", letterSpacing: "0.06em", fontWeight: 600 }}>OVER LIMIT</span>}
              </div>
              <div className="t-mono" style={{ fontSize: 12, color: overLimit ? "var(--down-500)" : "var(--ink-1000)", textAlign: "right", fontWeight: 500 }}>{s.weight.toFixed(1)}%</div>
              <div className="t-mono" style={{ fontSize: 11, color: "var(--fg-muted)", textAlign: "right" }}>limit {s.limit}%</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>
        Net long $284,540 · gross $284,540 · gross/equity 1.00× · concentration HHI 0.41 (high)
      </div>
    </div>
  );
}

// ─── correlation matrix ──────────────────────────────────────────────────

function RiskCorrelation() {
  const symbols = ["NVDA", "META", "MSFT", "AMZN", "SPY", "QQQ", "XLK"];
  // synthetic correlations — symmetric, diagonal = 1
  const data = [
    [1.00, 0.74, 0.68, 0.61, 0.62, 0.78, 0.81],
    [0.74, 1.00, 0.71, 0.66, 0.65, 0.81, 0.78],
    [0.68, 0.71, 1.00, 0.74, 0.72, 0.84, 0.86],
    [0.61, 0.66, 0.74, 1.00, 0.68, 0.79, 0.74],
    [0.62, 0.65, 0.72, 0.68, 1.00, 0.91, 0.84],
    [0.78, 0.81, 0.84, 0.79, 0.91, 1.00, 0.94],
    [0.81, 0.78, 0.86, 0.74, 0.84, 0.94, 1.00],
  ];
  const cellColor = (v) => {
    // gold gradient — low vals near bg, high vals saturated
    const t = Math.max(0, (v - 0.4) / 0.6);
    return `rgba(201, 166, 107, ${0.08 + t * 0.55})`;
  };
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>CORRELATION · 60D</div>
          <h2 className="t-h3" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>How the book moves together</h2>
        </div>
        <div style={{ display: "flex", gap: 6, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)" }}>
          {["30D", "60D", "90D", "1Y"].map(p => (
            <span key={p} style={{ padding: "3px 7px", border: "1px solid var(--border)", borderRadius: 3, color: p === "60D" ? "var(--ink-1000)" : "var(--fg-muted)", background: p === "60D" ? "var(--bg-elev-1)" : "transparent" }}>{p}</span>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: `60px repeat(${symbols.length}, 1fr)`, gap: 2 }}>
        <div></div>
        {symbols.map(s => <div key={s} className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", textAlign: "center", padding: "4px 0" }}>{s}</div>)}
        {data.map((row, ri) => (
          <React.Fragment key={ri}>
            <div className="t-mono" style={{ fontSize: 10.5, color: "var(--fg-muted)", padding: "4px 6px", textAlign: "right" }}>{symbols[ri]}</div>
            {row.map((v, ci) => (
              <div key={ci} style={{
                background: ri === ci ? "var(--bg-elev-2)" : cellColor(v),
                fontFamily: "var(--font-mono)", fontSize: 10.5,
                color: v > 0.85 ? "#1a1206" : v > 0.7 ? "var(--ink-1000)" : "var(--fg)",
                textAlign: "center", padding: "8px 0", fontWeight: v > 0.85 ? 600 : 400,
                border: ri === ci ? "1px solid var(--border-strong)" : "none"
              }}>
                {v.toFixed(2)}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-hair)", display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>
        <span>Avg pairwise: 0.76 · highest QQQ↔XLK 0.94</span>
        <span style={{ color: "var(--down-500)" }}>⚠ low diversification</span>
      </div>
    </div>
  );
}

// ─── concentration limits ────────────────────────────────────────────────

function RiskConcentration({ onPickTicker }) {
  const limits = [
    { dim: "per name",     subject: "NVDA",                 weight: 33680, limit: 25000, util: 134 },
    { dim: "per name",     subject: "META",                 weight: 18400, limit: 25000, util: 73 },
    { dim: "per name",     subject: "MSFT",                 weight: 14200, limit: 25000, util: 56 },
    { dim: "per strategy", subject: "Momentum & Quality",   weight: 96400, limit: 100000, util: 96 },
    { dim: "per strategy", subject: "PEAD",                 weight: 42100, limit: 60000, util: 70 },
    { dim: "per strategy", subject: "Pairs · Sector",       weight: 14200, limit: 40000, util: 35 },
    { dim: "per sector",   subject: "Technology",           weight: 174320, limit: 142000, util: 122 },
    { dim: "per sector",   subject: "Communications",       weight: 32400, limit: 71000, util: 45 },
  ];
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>CONCENTRATION LIMITS</div>
          <h2 className="t-h3" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>What's full, what's empty</h2>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)", padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 3 }}>Edit limits → Admin</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--border-hair)", border: "1px solid var(--border-hair)", borderRadius: 3 }}>
        {limits.map((l, i) => {
          const over = l.util > 100;
          const near = l.util >= 90 && l.util <= 100;
          return (
            <div key={i} onClick={() => l.dim === "per name" && onPickTicker?.(l.subject)} style={{ background: "var(--ink-100)", padding: "12px 14px", display: "grid", gridTemplateColumns: "1fr auto", gap: 8, cursor: l.dim === "per name" ? "default" : "default" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span className="t-mono" style={{ fontSize: 9.5, color: "var(--fg-hint)", letterSpacing: "0.06em" }}>{l.dim.toUpperCase()}</span>
                  <span className="t-body-sm" style={{ color: "var(--ink-1000)", fontWeight: 500 }}>{l.subject}</span>
                </div>
                <div style={{ marginTop: 6, position: "relative", height: 8, background: "var(--bg-elev-1)", borderRadius: 1 }}>
                  <div style={{
                    width: `${Math.min(100, l.util)}%`, height: "100%",
                    background: over ? "var(--down-500)" : near ? "var(--gold-300)" : "var(--brand)",
                    borderRadius: 1
                  }} />
                  {over && <div style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, border: "1px solid var(--down-500)", borderRadius: 1, pointerEvents: "none" }} />}
                </div>
                <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)" }}>
                  ${l.weight.toLocaleString()} of ${l.limit.toLocaleString()}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="t-mono" style={{ fontSize: 16, color: over ? "var(--down-500)" : near ? "var(--gold-300)" : "var(--ink-1000)", fontWeight: 500 }}>
                  {l.util}%
                </div>
                {over && <div className="t-mono" style={{ fontSize: 9, color: "var(--down-500)", letterSpacing: "0.06em" }}>BREACH</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── AI risk memo ────────────────────────────────────────────────────────

function RiskAIMemo() {
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderLeft: "2px solid var(--brand)", borderRadius: 4, padding: "18px 22px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--gold-500)", boxShadow: "0 0 10px var(--gold-500)" }} />
        <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>AI · RISK MEMO</div>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>regime: bull · low-vol · refreshed 8m ago</span>
      </div>
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 18 }}>
        {[
          { h: "What's working", body: "Quality + momentum bucket carries the book. Tech overweight is the alpha source — but it's also the single biggest risk vector and what the next three sections all flag.", tone: "up" },
          { h: "What's at risk", body: "Tech concentration breach (61% vs 50% limit). NVDA single-name breach (134% of limit). VIX expansion or a tech sector −10% would burn 4-7% of book in a session.", tone: "down" },
          { h: "Suggested action", body: "Trim NVDA back to limit (-$8,680), or open a paired short on QQQ to get gross neutral on tech. Re-running stress shows VaR 1d/95 drops 24% with the second option.", tone: "neutral" },
        ].map((c, i) => (
          <div key={i}>
            <div className="t-label" style={{ color: c.tone === "up" ? "var(--up-500)" : c.tone === "down" ? "var(--down-500)" : "var(--brand)", letterSpacing: "0.18em" }}>{c.h}</div>
            <p style={{ marginTop: 6, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg)", fontSize: 14, lineHeight: 1.55 }}>{c.body}</p>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-hair)", display: "flex", gap: 8 }}>
        {["Trim NVDA to limit", "Add QQQ short hedge", "Re-run with 50% sizing"].map(a => (
          <span key={a} style={{ padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--ink-1000)", background: "var(--bg-elev-1)" }}>{a}</span>
        ))}
      </div>
    </div>
  );
}

if (typeof window !== "undefined") Object.assign(window, { RiskPage });


// Strategy playbook — workflow document per strategy
// Stages (entry → confirmation → position → exit) · agents per stage ·
// inline backtest summary · live trades · scoped watchlist · edit-rules

const StrategyPlaybook = ({ tweaks, stratName = "Momentum & Quality", onNav, onBack, onPickTicker, onBacktest }) => {
  const s = (MOCK_STRATEGIES || []).find(x => x.name === stratName) || { name: stratName, num: "01", pct: 3.42, sharpe: 1.42, dd: -4.1, positions: 4, allocPct: 32, active: true };
  return (
    <div style={{ padding: "20px 24px 40px", maxWidth: 1640, margin: "0 auto" }}>
      <PBHeader s={s} onBack={onBack} onNav={onNav} />
      <PBHero s={s} />
      <PBStages onPickTicker={onPickTicker} />
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginBottom: 16 }}>
        <PBBacktest onBacktest={onBacktest} />
        <PBLiveTrades onPickTicker={onPickTicker} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <PBWatchlist onPickTicker={onPickTicker} />
        <PBEditRules />
      </div>
    </div>
  );
};

function PBHeader({ s, onBack, onNav }) {
  return (
    <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 0 14px", borderBottom: "1px solid var(--border-hair)", marginBottom: 18 }}>
      <div>
        <a onClick={() => (onBack ? onBack() : onNav?.("strategies"))} style={{ display: "inline-flex", alignItems: "baseline", gap: 6, fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-muted)", letterSpacing: "0.06em", cursor: "default" }}>← BACK</a>
        <div className="t-eyebrow-italic" style={{ marginTop: 8, color: "var(--brand)", letterSpacing: "0.2em" }}>STRATEGY · PLAYBOOK · {s.num}</div>
        <h1 style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em" }}>{s.name}</h1>
        <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 14 }}>Swing · 5–20 day hold · long-only · sized by ATR-based stop, capped at 1.5%R per name.</div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", border: "1px solid var(--border-strong)", borderRadius: 999, fontFamily: "var(--font-mono)", fontSize: 10.5, color: s.active ? "var(--up-500)" : "var(--fg-muted)", background: "var(--bg-elev-1)" }}>
          <StatusDot tone={s.active ? "up" : "muted"} size={5} />{s.active ? "ENABLED" : "PAUSED"}
        </span>
        <a onClick={() => onNav?.("admin")} style={{ padding: "4px 10px", border: "1px solid var(--border)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--ink-1000)", background: "var(--bg-elev-1)", cursor: "default" }}>Edit in Admin →</a>
      </div>
    </header>
  );
}

function PBHero({ s }) {
  const card = { padding: "14px 16px", background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4 };
  const stats = [
    { label: "RETURN · MTD",        val: `${s.pct >= 0 ? "+" : ""}${s.pct.toFixed(2)}%`, tone: s.pct >= 0 ? "up" : "down" },
    { label: "SHARPE · LIVE",       val: s.sharpe.toFixed(2) },
    { label: "MAX DRAWDOWN",        val: `${s.dd.toFixed(1)}%`, tone: "down" },
    { label: "POSITIONS",           val: String(s.positions) },
    { label: "ALLOC",               val: `${s.allocPct}%`, sub: `$${(284512 * s.allocPct / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
    { label: "WIN RATE · 90D",      val: "62%", sub: "23 / 37 closed" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${stats.length}, 1fr)`, gap: 1, background: "var(--border)", border: "1px solid var(--border)", borderRadius: 4, marginBottom: 16 }}>
      {stats.map((m, i) => (
        <div key={i} style={card}>
          <div className="t-label" style={{ color: "var(--fg-hint)" }}>{m.label}</div>
          <div className="t-mono" style={{ marginTop: 6, fontSize: 22, color: m.tone === "up" ? "var(--up-500)" : m.tone === "down" ? "var(--down-500)" : "var(--ink-1000)", fontWeight: 500 }}>{m.val}</div>
          {m.sub && <div className="t-body-sm" style={{ marginTop: 2, color: "var(--fg-muted)", fontFamily: "var(--font-display)", fontStyle: "italic" }}>{m.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function PBStages({ onPickTicker }) {
  const stages = [
    {
      n: "01", title: "Entry rules", agent: "Research",
      rules: ["Universe: Russell 1000 · price > $10 · ADV > $20M", "Quality: ROIC > 15% · debt/equity < 1.0", "Momentum: 12-1 returns top quartile · 50d > 200d MA"],
      live: "12 candidates surfaced today · top: NVDA, META, ASML",
    },
    {
      n: "02", title: "Confirmation", agent: "Signal",
      rules: ["Volume > 1.5× ADV on confirmation candle", "RSI 14 between 50-70 (no overbought)", "Sector regime: must align with portfolio overweight"],
      live: "3 of 12 candidates confirmed in last 24h",
    },
    {
      n: "03", title: "Position", agent: "Risk",
      rules: ["Risk per name = 1.5%R · stop at 2× ATR(14) below entry", "Max 6 concurrent positions · max 35% per sector", "Override: cap at half-size if VaR > 1.2× baseline"],
      live: "Currently 4/6 slots filled · NVDA, META, MSFT, AMZN",
    },
    {
      n: "04", title: "Exit", agent: "Execution",
      rules: ["Trail stop: 2× ATR after +1R achieved", "Time stop: close if flat after 20 trading days", "Reverse signal: exit if 50d MA breaks decisively"],
      live: "0 exits today · last exit: PLTR on time-stop, +0.84R",
    },
  ];
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>WORKFLOW · 4 STAGES</div>
          <h2 className="t-h3" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>How a trade moves through the playbook</h2>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--border-hair)", border: "1px solid var(--border-hair)", borderRadius: 3 }}>
        {stages.map(st => (
          <div key={st.n} style={{ background: "var(--ink-100)", padding: 16, position: "relative" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span className="t-mono" style={{ fontSize: 11, color: "var(--fg-hint)", letterSpacing: "0.08em" }}>{st.n}</span>
              <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 18, color: "var(--ink-1000)", letterSpacing: "-0.01em", fontWeight: 400 }}>{st.title}</h3>
            </div>
            <div style={{ marginTop: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 999, fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--brand)", letterSpacing: "0.06em" }}>
                <StatusDot tone="up" size={4} />AGENT · {st.agent.toUpperCase()}
              </span>
            </div>
            <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 6 }}>
              {st.rules.map((r, i) => (
                <li key={i} style={{ fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg)", fontSize: 13, lineHeight: 1.4, paddingLeft: 12, position: "relative" }}>
                  <span style={{ position: "absolute", left: 0, top: 8, width: 4, height: 1, background: "var(--brand)" }} />{r}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-hair)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--up-500)", letterSpacing: "0.04em" }}>
              ↳ {st.live}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PBBacktest({ onBacktest }) {
  // tiny equity curve
  const points = Array.from({ length: 60 }, (_, i) => 100 + i * 0.42 + Math.sin(i / 4) * 4 + (i > 30 ? Math.sin((i - 30) / 2) * 6 : 0));
  const yMin = Math.min(...points), yMax = Math.max(...points);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (points.length - 1)) * 100} ${100 - ((p - yMin) / (yMax - yMin)) * 100}`).join(" ");
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>BACKTEST · CURRENT</div>
          <h2 className="t-h3" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>2019–2024 · published Oct 12</h2>
        </div>
        <a onClick={() => onBacktest?.()} style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--brand)", letterSpacing: "0.06em", padding: "4px 10px", border: "1px solid var(--border-strong)", borderRadius: 3, cursor: "default" }}>OPEN IN WORKBENCH →</a>
      </div>
      <div style={{ marginTop: 12, height: 130 }}>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
          <defs>
            <linearGradient id="pbBacktestGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--up-500)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="var(--up-500)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${path} L 100 100 L 0 100 Z`} fill="url(#pbBacktestGrad)" />
          <path d={path} stroke="var(--up-500)" strokeWidth="1.4" fill="none" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-hair)", display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
        {[
          { l: "CAGR",     v: "+18.4%" },
          { l: "SHARPE",   v: "1.51" },
          { l: "SORTINO",  v: "2.18" },
          { l: "MAX DD",   v: "−12.4%", tone: "down" },
          { l: "WIN RATE", v: "58%" },
        ].map((m, i) => (
          <div key={i}>
            <div className="t-label" style={{ color: "var(--fg-hint)" }}>{m.l}</div>
            <div className="t-mono" style={{ fontSize: 14, color: m.tone === "down" ? "var(--down-500)" : "var(--ink-1000)", fontWeight: 500 }}>{m.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PBLiveTrades({ onPickTicker }) {
  const trades = [
    { sym: "NVDA", side: "long", qty: 250, avg: 128.41, last: 134.82, pl: 1602.50, plPct: 5.0,  age: "12d" },
    { sym: "META", side: "long", qty: 30,  avg: 612.40, last: 632.10, pl: 591.00,  plPct: 3.2,  age: "8d" },
    { sym: "MSFT", side: "long", qty: 40,  avg: 416.20, last: 422.85, pl: 266.00,  plPct: 1.6,  age: "6d" },
    { sym: "AMZN", side: "long", qty: 60,  avg: 198.70, last: 195.10, pl: -216.00, plPct: -1.8, age: "3d" },
  ];
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18 }}>
      <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>LIVE · IN-PLAYBOOK</div>
      <h2 className="t-h3" style={{ margin: "2px 0 14px", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>4 trades active</h2>
      <div style={{ display: "grid", gap: 1, background: "var(--border-hair)" }}>
        {trades.map(t => (
          <div key={t.sym} onClick={() => onPickTicker?.(t.sym)} style={{ background: "var(--ink-100)", padding: "10px 12px", display: "grid", gridTemplateColumns: "60px 1fr 80px 70px", gap: 10, alignItems: "center", cursor: "default" }}>
            <span className="t-mono" style={{ fontSize: 12.5, color: "var(--ink-1000)", fontWeight: 500 }}>{t.sym}</span>
            <span className="t-body-sm" style={{ color: "var(--fg-muted)", fontFamily: "var(--font-display)", fontStyle: "italic" }}>{t.qty} @ ${t.avg.toFixed(2)} · {t.age}</span>
            <span className="t-mono" style={{ fontSize: 12, color: t.pl >= 0 ? "var(--up-500)" : "var(--down-500)", textAlign: "right" }}>{t.pl >= 0 ? "+" : "−"}${Math.abs(t.pl).toFixed(0)}</span>
            <Delta value={t.plPct} dec={1} />
          </div>
        ))}
      </div>
    </div>
  );
}

function PBWatchlist({ onPickTicker }) {
  const list = [
    { sym: "ASML",  px: 712.40, pct: +1.4, status: "candidate" },
    { sym: "AVGO",  px: 178.20, pct: +0.8, status: "candidate" },
    { sym: "AMD",   px: 142.60, pct: -0.6, status: "watch" },
    { sym: "TSM",   px: 198.40, pct: +0.4, status: "watch" },
    { sym: "GOOGL", px: 184.20, pct: +0.2, status: "watch" },
  ];
  const tone = { candidate: "var(--up-500)", watch: "var(--fg-muted)" };
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>WATCHLIST · SCOPED</div>
          <h2 className="t-h3" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>What this playbook is watching</h2>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)" }}>5 tickers</span>
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 1, background: "var(--border-hair)" }}>
        {list.map(w => (
          <div key={w.sym} onClick={() => onPickTicker?.(w.sym)} style={{ background: "var(--ink-100)", padding: "10px 12px", display: "grid", gridTemplateColumns: "70px 1fr 80px 70px", gap: 10, alignItems: "center", cursor: "default" }}>
            <span className="t-mono" style={{ fontSize: 12.5, color: "var(--ink-1000)", fontWeight: 500 }}>{w.sym}</span>
            <span className="t-mono" style={{ fontSize: 9.5, color: tone[w.status], letterSpacing: "0.08em" }}>{w.status.toUpperCase()}</span>
            <span className="t-mono" style={{ fontSize: 12, color: "var(--fg)", textAlign: "right" }}>${w.px.toFixed(2)}</span>
            <Delta value={w.pct} dec={1} />
          </div>
        ))}
      </div>
    </div>
  );
}

function PBEditRules() {
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>RULES · EDIT</div>
          <h2 className="t-h3" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>Tune the playbook</h2>
        </div>
        <span style={{ padding: "3px 8px", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--brand)", border: "1px solid var(--border-strong)", borderRadius: 3, letterSpacing: "0.06em" }}>OPERATOR ONLY</span>
      </div>
      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {[
          { name: "Risk per name",       cur: "1.50%R", min: "0.5%", max: "2.5%" },
          { name: "Max concurrent slots", cur: "6",      min: "1",    max: "12" },
          { name: "Sector cap",          cur: "35%",    min: "20%",  max: "50%" },
          { name: "Trail stop · ATR ×",  cur: "2.0",    min: "1.0",  max: "4.0" },
          { name: "Time stop · days",    cur: "20",     min: "5",    max: "60" },
        ].map(r => (
          <div key={r.name} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 12, alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--border-hair)" }}>
            <span className="t-body-sm" style={{ color: "var(--ink-1000)" }}>{r.name}</span>
            <span className="t-mono" style={{ fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{r.cur}</span>
            <span className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>{r.min} ↔ {r.max}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12, fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>
        ↳ Last edited by you · 4d ago · routes through Admin → Strategy controls.
      </div>
    </div>
  );
}

if (typeof window !== "undefined") Object.assign(window, { StrategyPlaybook });


// Backtest workbench — strategy + universe + date range + cost model
// Run config left · equity curve / dd / trade log right · compare runs

const BacktestPage = ({ tweaks, onNav, onBack, stratName }) => {
  return (
    <div style={{ padding: "20px 24px 40px", maxWidth: 1640, margin: "0 auto" }}>
      <BTHeader onBack={onBack} onNav={onNav} stratName={stratName} />
      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16, marginBottom: 16 }}>
        <BTConfig />
        <BTRunOutput />
      </div>
      <BTCompareRuns />
      <BTTradeLog />
    </div>
  );
};

function BTHeader({ onBack, onNav, stratName }) {
  return (
    <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 0 14px", borderBottom: "1px solid var(--border-hair)", marginBottom: 18 }}>
      <div>
        <a onClick={() => (onBack ? onBack() : onNav?.("strategies"))} style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--fg-muted)", letterSpacing: "0.06em", cursor: "default" }}>← BACK</a>
        <div className="t-eyebrow-italic" style={{ marginTop: 8, color: "var(--brand)", letterSpacing: "0.2em" }}>WORKBENCH / BACKTEST</div>
        <h1 style={{ margin: "6px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 32, fontWeight: 400, letterSpacing: "-0.02em" }}>Test before you commit capital</h1>
        <div style={{ marginTop: 4, fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--fg-muted)", fontSize: 14 }}>Run a strategy across history. Compare runs side by side. Publish one as the strategy's current backtest.</div>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <span style={{ padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--fg)" }}>Save run</span>
        <span style={{ padding: "5px 10px", border: "1px solid var(--gold-500)", color: "var(--ink-1000)", background: "var(--gold-500)", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 500 }}>Run backtest →</span>
      </div>
    </header>
  );
}

function BTConfig() {
  const Field = ({ label, value, sub }) => (
    <div style={{ padding: "10px 0", borderBottom: "1px solid var(--border-hair)" }}>
      <div className="t-label" style={{ color: "var(--fg-hint)" }}>{label}</div>
      <div style={{ marginTop: 4, fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)" }}>{value}</div>
      {sub && <div className="t-body-sm" style={{ color: "var(--fg-muted)", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, marginTop: 2 }}>{sub}</div>}
    </div>
  );
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18, alignSelf: "start", position: "sticky", top: 12 }}>
      <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>RUN CONFIG</div>
      <Field label="STRATEGY"        value="Momentum & Quality"      sub="v3.2 · published Oct 12" />
      <Field label="UNIVERSE"        value="Russell 1000"            sub="filtered: price > $10, ADV > $20M" />
      <Field label="DATE RANGE"      value="Jan 2019 — Oct 2024"     sub="≈ 5y 10m · 1,470 trading days" />
      <Field label="COST MODEL"      value="IB tiered · 0.5bp slip"  sub="commissions, half-spread, market impact" />
      <Field label="STARTING CAPITAL" value="$100,000"               sub="reinvest profits" />
      <Field label="POSITION SIZING" value="1.5%R per name"          sub="ATR(14) × 2.0 stop" />
      <Field label="REBALANCE"       value="Daily at close"          sub="signal evaluated on close" />
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-strong)", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)", lineHeight: 1.5 }}>
        Last run: 2.4s · 412 trades · published as current.
      </div>
    </div>
  );
}

function BTRunOutput() {
  const eq = Array.from({ length: 70 }, (_, i) => 100 + i * 0.46 + Math.sin(i / 5) * 5 - (i > 35 && i < 45 ? 8 : 0));
  const dd = Array.from({ length: 70 }, (_, i) => Math.max(0, 12 - Math.abs(35 - i) * 0.4));
  const yMin = Math.min(...eq), yMax = Math.max(...eq);
  const eqPath = eq.map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (eq.length - 1)) * 100} ${100 - ((p - yMin) / (yMax - yMin)) * 100}`).join(" ");
  const ddMax = Math.max(...dd);
  const ddPath = dd.map((p, i) => `${i === 0 ? "M" : "L"} ${(i / (dd.length - 1)) * 100} ${(p / ddMax) * 100}`).join(" ");
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>OUTPUT · LAST RUN</div>
          <h2 className="t-h3" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>Run #284 · today 14:21</h2>
        </div>
        <span style={{ padding: "3px 10px", border: "1px solid var(--up-500)", color: "var(--up-500)", borderRadius: 999, fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em" }}>● PUBLISHED</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, background: "var(--border)", marginTop: 14, border: "1px solid var(--border)", borderRadius: 3 }}>
        {[
          { l: "CAGR",     v: "+18.4%", tone: "up" },
          { l: "SHARPE",   v: "1.51" },
          { l: "SORTINO",  v: "2.18" },
          { l: "CALMAR",   v: "1.48" },
          { l: "MAX DD",   v: "−12.4%", tone: "down" },
          { l: "WIN RATE", v: "58%" },
          { l: "TRADES",   v: "412" },
        ].map((m, i) => (
          <div key={i} style={{ background: "var(--ink-100)", padding: "10px 12px" }}>
            <div className="t-label" style={{ color: "var(--fg-hint)" }}>{m.l}</div>
            <div className="t-mono" style={{ marginTop: 4, fontSize: 16, color: m.tone === "up" ? "var(--up-500)" : m.tone === "down" ? "var(--down-500)" : "var(--ink-1000)", fontWeight: 500 }}>{m.v}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 18 }}>
        <div className="t-label" style={{ color: "var(--fg-hint)", marginBottom: 4 }}>EQUITY CURVE · 2019 → 2024</div>
        <div style={{ height: 200, position: "relative" }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
            <defs>
              <linearGradient id="btEqGrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--up-500)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--up-500)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${eqPath} L 100 100 L 0 100 Z`} fill="url(#btEqGrad)" />
            <path d={eqPath} stroke="var(--up-500)" strokeWidth="1.4" fill="none" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <div className="t-label" style={{ color: "var(--fg-hint)", marginBottom: 4 }}>DRAWDOWN · UNDERWATER</div>
        <div style={{ height: 80, position: "relative" }}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
            <defs>
              <linearGradient id="btDdGrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--down-500)" stopOpacity="0" />
                <stop offset="100%" stopColor="var(--down-500)" stopOpacity="0.4" />
              </linearGradient>
            </defs>
            <path d={`${ddPath} L 100 0 L 0 0 Z`} fill="url(#btDdGrad)" />
            <path d={ddPath} stroke="var(--down-500)" strokeWidth="1.2" fill="none" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
    </div>
  );
}

function BTCompareRuns() {
  const runs = [
    { id: "#284", label: "current · 1.5%R · 6 slots",  cagr: 18.4, sharpe: 1.51, dd: -12.4, trades: 412, status: "published" },
    { id: "#283", label: "1.0%R · 6 slots",            cagr: 14.2, sharpe: 1.46, dd: -8.8,  trades: 412, status: "saved" },
    { id: "#282", label: "1.5%R · 8 slots",            cagr: 19.8, sharpe: 1.42, dd: -16.1, trades: 528, status: "saved" },
    { id: "#281", label: "no sector cap",              cagr: 22.1, sharpe: 1.31, dd: -22.4, trades: 412, status: "saved" },
  ];
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>COMPARE · RUNS</div>
          <h2 className="t-h3" style={{ margin: "2px 0 0", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>Side-by-side · last 4</h2>
        </div>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-muted)", padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 3 }}>+ Add run</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 80px 80px 90px 80px 90px", gap: 1, background: "var(--border-hair)", border: "1px solid var(--border-hair)", borderRadius: 3 }}>
        {[["RUN", "LABEL", "CAGR", "SHARPE", "MAX DD", "TRADES", "STATUS"], ...runs.map(r => [r.id, r.label, `+${r.cagr}%`, r.sharpe.toFixed(2), `${r.dd}%`, r.trades, r.status])].map((row, ri) => (
          <React.Fragment key={ri}>
            {row.map((cell, ci) => (
              <div key={ci} style={{ background: ri === 0 ? "var(--bg-elev-1)" : "var(--ink-100)", padding: "9px 12px", fontFamily: ri === 0 ? "var(--font-mono)" : (ci === 1 ? "var(--font-display)" : "var(--font-mono)"), fontStyle: ri > 0 && ci === 1 ? "italic" : "normal", fontSize: ri === 0 ? 9.5 : 12, color: ri === 0 ? "var(--fg-hint)" : (ci === 4 ? "var(--down-500)" : ci === 2 ? "var(--up-500)" : "var(--ink-1000)"), letterSpacing: ri === 0 ? "0.08em" : "normal", textTransform: ri === 0 ? "uppercase" : "none", fontWeight: ri === 0 ? 400 : (ci === 0 || ci === 2 || ci === 3 || ci === 4 ? 500 : 400) }}>
                {ri > 0 && ci === 6 ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, color: cell === "published" ? "var(--up-500)" : "var(--fg-muted)" }}><StatusDot tone={cell === "published" ? "up" : "muted"} size={4} />{String(cell).toUpperCase()}</span> : cell}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function BTTradeLog() {
  const trades = [
    { date: "2024-08-12", sym: "NVDA", side: "long",  entry: 102.40, exit: 124.80, days: 14, r: 2.18, exit_reason: "trail stop" },
    { date: "2024-07-22", sym: "META", side: "long",  entry: 542.10, exit: 521.30, days: 8,  r: -0.84, exit_reason: "stop" },
    { date: "2024-07-08", sym: "MSFT", side: "long",  entry: 462.10, exit: 478.20, days: 11, r: 1.06, exit_reason: "trail stop" },
    { date: "2024-06-18", sym: "AVGO", side: "long",  entry: 154.20, exit: 178.40, days: 18, r: 2.42, exit_reason: "time stop" },
    { date: "2024-05-30", sym: "ASML", side: "long",  entry: 928.10, exit: 891.20, days: 6,  r: -0.96, exit_reason: "stop" },
  ];
  return (
    <div style={{ background: "var(--ink-100)", border: "1px solid var(--border)", borderRadius: 4, padding: 18 }}>
      <div className="t-eyebrow-italic" style={{ color: "var(--brand)", letterSpacing: "0.2em" }}>TRADE LOG · LAST RUN</div>
      <h2 className="t-h3" style={{ margin: "2px 0 14px", fontFamily: "var(--font-display)", fontStyle: "italic", color: "var(--ink-1000)", fontSize: 22, letterSpacing: "-0.015em", fontWeight: 400 }}>412 trades · sample</h2>
      <div style={{ display: "grid", gridTemplateColumns: "100px 70px 50px 80px 80px 60px 80px 1fr", gap: 1, background: "var(--border-hair)", border: "1px solid var(--border-hair)", borderRadius: 3 }}>
        {[["DATE", "SYM", "SIDE", "ENTRY", "EXIT", "DAYS", "R", "EXIT REASON"], ...trades.map(t => [t.date, t.sym, t.side, `$${t.entry.toFixed(2)}`, `$${t.exit.toFixed(2)}`, t.days, `${t.r > 0 ? "+" : ""}${t.r.toFixed(2)}R`, t.exit_reason])].map((row, ri) => (
          <React.Fragment key={ri}>
            {row.map((cell, ci) => (
              <div key={ci} style={{ background: ri === 0 ? "var(--bg-elev-1)" : "var(--ink-100)", padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: ri === 0 ? 9.5 : 11.5, color: ri === 0 ? "var(--fg-hint)" : (ci === 6 ? (String(cell).startsWith("+") ? "var(--up-500)" : "var(--down-500)") : "var(--ink-1000)"), letterSpacing: ri === 0 ? "0.08em" : "normal", textTransform: ri === 0 ? "uppercase" : "none" }}>
                {cell}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

if (typeof window !== "undefined") Object.assign(window, { BacktestPage });


// Admin Control Center — single command surface for the entire system.
// Layout: identity band → command bar (⌘⇧J) → sub-rail (sticky left) + scrolling sections.
// Sections: master map (tiles + arch graph + detail) · keys · layout composer ·
//   trade · pipeline · ai · risk · features · providers · deploy · audit tail.

const AdminPage = ({ tweaks, onNav }) => {
  const [controls, setControls] = useState(MOCK_CONTROLS);
  const [activeSec, setActiveSec] = useState("map");
  const [find, setFind] = useState("");
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmd, setCmd] = useState("");
  const [parsed, setParsed] = useState(null);
  const [selectedNode, setSelectedNode] = useState("pipe");
  const [danger, setDanger] = useState(null);
  const [sections, setSections] = useState(MOCK_DASHBOARD_SECTIONS);

  // ⌘⇧J opens command bar
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault(); setCmdOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setControlValue = (id, v) => {
    setControls(cs => cs.map(c => c.id === id ? { ...c, value: v, lastBy: "operator", lastAt: "just now" } : c));
  };

  const sections_ = [
    { id: "map", label: "Master map", count: null, dot: "watch" },
    { id: "keys", label: "Backend keys", count: 6, dot: "crit" },
    { id: "layout", label: "Dashboard layout", count: null },
    { id: "trade", label: "Trade", count: 5 },
    { id: "pipeline", label: "Pipeline", count: 5 },
    { id: "ai", label: "AI", count: 6 },
    { id: "risk", label: "Risk gates", count: 6 },
    { id: "features", label: "Feature flags", count: 5 },
    { id: "providers", label: "Provider rails", count: 5, dot: "crit" },
    { id: "deploy", label: "Deploy rail", count: 5 },
    { id: "audit", label: "Audit tail", count: null },
  ];

  // Filter helper for "Find control"
  const findFilter = (c) => !find || (c.name + " " + c.desc + " " + c.id).toLowerCase().includes(find.toLowerCase());
  const byCat = (cat) => controls.filter(c => c.category === cat).filter(findFilter);

  // Parse natural-language command (very simple mock)
  const parseCommand = (s) => {
    if (!s) return null;
    const ql = s.toLowerCase();
    let match = null;
    if (ql.includes("halt") && ql.includes("nvda")) match = { id: "halt-trades", action: "ON · scope NVDA", section: "trade" };
    else if (ql.includes("halt")) match = { id: "halt-trades", action: "ON · global", section: "trade" };
    else if (ql.includes("rotate") && ql.includes("anthropic")) match = { id: "key-anthropic", action: "rotate key", section: "keys" };
    else if (ql.includes("pause") && ql.includes("research")) match = { id: "ai-research", action: "OFF", section: "ai" };
    else if (ql.includes("pause") && ql.includes("pipeline")) match = { id: "pipeline-enrich", action: "OFF", section: "pipeline" };
    else if (ql.includes("deploy") && ql.includes("staging")) match = { id: "deploy-fe-stg", action: "dispatch", section: "deploy" };
    else {
      // fuzzy fallback
      const found = controls.find(c => (c.name + c.desc).toLowerCase().includes(ql));
      if (found) match = { id: found.id, action: "review", section: found.category.toLowerCase() };
    }
    return match;
  };

  return (
    <div data-screen-label="Admin · Control Center" style={{ height: "100%", display: "grid", gridTemplateRows: "auto 1fr", overflow: "hidden" }}>
      {/* Identity band + command bar */}
      <AdminTop cmdOpen={cmdOpen} setCmdOpen={setCmdOpen} cmd={cmd} setCmd={(v) => { setCmd(v); setParsed(parseCommand(v)); }} parsed={parsed}
        onConfirm={() => { if (parsed) { setControlValue(parsed.id, parsed.id.startsWith("halt") ? true : controls.find(c=>c.id===parsed.id)?.value); setActiveSec(parsed.section || "map"); setCmdOpen(false); setCmd(""); setParsed(null); } }} />

      {/* Body: sub-rail + scrolling content */}
      <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", overflow: "hidden", borderTop: "1px solid var(--border)" }}>
        <AdminSubRail items={sections_} active={activeSec} onPick={(id) => { setActiveSec(id); document.getElementById("admin-sec-" + id)?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }} find={find} setFind={setFind} />

        <div style={{ overflow: "auto", padding: "0 0 80px" }} onScroll={(e) => {
          // update active section based on scroll position
          const container = e.currentTarget;
          let cur = "map";
          for (const s of sections_) {
            const el = document.getElementById("admin-sec-" + s.id);
            if (el && el.offsetTop - container.scrollTop < 80) cur = s.id;
          }
          setActiveSec(cur);
        }}>
          <div id="admin-sec-map">
            <MasterMap selectedNode={selectedNode} setSelectedNode={setSelectedNode} />
          </div>

          <div id="admin-sec-keys">
            <AdminSection eyebrow="ADMIN · KEYS" title="Backend keys" sub="API keys are encrypted at rest. The UI never reads plaintext after submit.">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                {byCat("Keys").map(c => <KeyModule key={c.id} c={c} onSave={(v) => setControlValue(c.id, "••••••••••")} />)}
              </div>
            </AdminSection>
          </div>

          <div id="admin-sec-layout">
            <AdminSection eyebrow="ADMIN · LAYOUT" title="Dashboard layout composer" sub="Toggle and reorder sections globally — operator owns layout per user.">
              <LayoutComposer sections={sections} setSections={setSections} />
            </AdminSection>
          </div>

          <div id="admin-sec-trade">
            <AdminSection eyebrow="ADMIN · RUNTIME · TRADE" title="Trade controls" sub="Halt, scope, rate-limit. Every change audit-logged.">
              <ModuleGrid items={byCat("Trade")} onChange={setControlValue} onDanger={(c) => setDanger(c)} />
            </AdminSection>
          </div>

          <div id="admin-sec-pipeline">
            <AdminSection eyebrow="ADMIN · RUNTIME · PIPELINE" title="Pipeline · per stage" sub="Each stage independently pausable. Queue depth and last-run shown inline.">
              <ModuleGrid items={byCat("Pipeline")} onChange={setControlValue} />
            </AdminSection>
          </div>

          <div id="admin-sec-ai">
            <AdminSection eyebrow="ADMIN · RUNTIME · AI" title="AI agents · per archetype" sub="Pause archetype, cap spend, watch costs.">
              <ModuleGrid items={byCat("AI")} onChange={setControlValue} onDanger={(c) => setDanger(c)} />
            </AdminSection>
          </div>

          <div id="admin-sec-risk">
            <AdminSection eyebrow="ADMIN · RUNTIME · RISK" title="Risk gates" sub="Six independent gates. Any breach halts the offending strategy.">
              <ModuleGrid items={byCat("Risk")} onChange={setControlValue} />
            </AdminSection>
          </div>

          <div id="admin-sec-features">
            <AdminSection eyebrow="ADMIN · FLAGS" title="Feature flags" sub="Per-feature kill switch. Changes propagate within 30s.">
              <ModuleGrid items={byCat("Features")} onChange={setControlValue} />
            </AdminSection>
          </div>

          <div id="admin-sec-providers">
            <AdminSection eyebrow="ADMIN · PROVIDERS" title="Provider rails" sub="Per-provider enable/disable + retry. A disabled rail degrades dependent features.">
              <ModuleGrid items={byCat("Providers")} onChange={setControlValue} />
            </AdminSection>
          </div>

          <div id="admin-sec-deploy">
            <AdminSection eyebrow="ADMIN · DEPLOY" title="Deploy dispatch" sub="Per-env, per-service. Prod requires a tagged ref.">
              <ModuleGrid items={byCat("Deploy")} onChange={setControlValue} onDanger={(c) => setDanger(c)} />
            </AdminSection>
          </div>

          <div id="admin-sec-audit">
            <AdminSection eyebrow="ADMIN · AUDIT" title="Recent admin writes" sub={<span>Last 10 of <span className="t-mono">142,883</span>. <a style={{ color: "var(--brand)" }}>Open full log →</a></span>}>
              <AuditTail rows={MOCK_AUDIT_LOG} />
            </AdminSection>
          </div>
        </div>
      </div>

      {danger && <DangerConfirm open onCancel={() => setDanger(null)} onConfirm={() => { setControlValue(danger.id, !danger.value); setDanger(null); }}
        title={danger.name} body={danger.desc + " — this is a destructive action and will be audit-logged."} />}
    </div>
  );
};

// ─── Identity band + command bar ──────────────────────────────────────────────

function AdminTop({ cmdOpen, setCmdOpen, cmd, setCmd, parsed, onConfirm }) {
  return (
    <div style={{ background: "var(--ink-100)", padding: "20px 28px 16px", borderBottom: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginBottom: 14 }}>
        <div>
          <div className="t-label">ADMIN · CONTROL CENTER</div>
          <h1 style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 36, color: "var(--ink-1000)", letterSpacing: "-0.025em", lineHeight: 1.05, margin: "6px 0 4px" }}>Application control center</h1>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--fg-dim)", maxWidth: 640 }}>Inspect architecture, live health, state ownership, backend keys, dashboard layout, runtime controls, and deploy rails — every knob individually addressable.</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 11px 5px 9px", border: "1px solid rgba(224,120,86,0.45)", background: "rgba(224,120,86,0.08)", borderRadius: 999 }}>
            <StatusDot tone="down" size={6} glow />
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", color: "var(--down-500)" }}>NEEDS ATTENTION</span>
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)" }}>9 shown / 63 mapped · 1 critical · 2 watch</div>
        </div>
      </div>

      {/* Command bar */}
      <div style={{ background: "var(--bg-elev-1)", border: "1px solid var(--border-strong)", borderRadius: 6, overflow: "hidden" }}>
        <div onClick={() => setCmdOpen(true)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", cursor: "text" }}>
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--brand)" }}>α</span>
          <input value={cmd} onChange={(e) => setCmd(e.target.value)} onFocus={() => setCmdOpen(true)}
            placeholder="halt trades on NVDA · rotate Anthropic key · pause research agent · deploy staging…"
            style={{ flex: 1, background: "transparent", border: 0, color: "var(--ink-1000)", fontFamily: "var(--font-ui)", fontSize: 13, outline: "none" }} />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)", border: "1px solid var(--border)", padding: "1px 5px", borderRadius: 3 }}>⌘⇧J</span>
        </div>
        {cmdOpen && cmd && (
          <div style={{ borderTop: "1px solid var(--border)", padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(141,179,196,0.04)" }}>
            {parsed ? (
              <>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                  <span className="t-label" style={{ color: "var(--up-500)" }}>MATCH</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-1000)" }}>{parsed.id}</span>
                  <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-dim)" }}>→ {parsed.action}</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => setCmdOpen(false)} style={btnGhost}>Cancel</button>
                  <button onClick={onConfirm} style={btnPrimary}>Dry-run · review</button>
                </div>
              </>
            ) : (
              <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-muted)" }}>{'No match — try "halt", "rotate <provider>", "pause <stage>", "deploy <env>"'}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sub-rail ─────────────────────────────────────────────────────────────────

function AdminSubRail({ items, active, onPick, find, setFind }) {
  return (
    <div style={{ borderRight: "1px solid var(--border)", overflow: "auto", background: "var(--ink-050)" }}>
      <div style={{ padding: "16px 14px 10px" }}>
        <div className="t-label" style={{ marginBottom: 8 }}>FIND CONTROL</div>
        <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search modules…"
          style={{ width: "100%", boxSizing: "border-box", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 4, padding: "7px 10px", color: "var(--ink-1000)", fontFamily: "var(--font-ui)", fontSize: 12, outline: "none" }} />
      </div>
      <div style={{ padding: "0 8px" }}>
        {items.map(s => (
          <a key={s.id} onClick={() => onPick(s.id)}
            style={{ display: "grid", gridTemplateColumns: "auto 1fr auto auto", gap: 10, alignItems: "center",
              padding: "8px 10px", margin: "2px 0", borderRadius: 4, cursor: "default",
              background: active === s.id ? "var(--bg-elev-1)" : "transparent",
              borderLeft: active === s.id ? "2px solid var(--brand)" : "2px solid transparent",
            }}>
            <span style={{ width: 6, display: "flex", justifyContent: "center" }}>{s.dot && <StatusDot tone={s.dot === "crit" ? "down" : "warn"} size={5} />}</span>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, color: active === s.id ? "var(--ink-1000)" : "var(--fg)", fontWeight: active === s.id ? 500 : 400 }}>{s.label}</span>
            {s.count != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "var(--fg-hint)" }}>{s.count}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}

// ─── Master map ────────────────────────────────────────────────────────────────

function MasterMap({ selectedNode, setSelectedNode }) {
  return (
    <div>
      <AdminSection eyebrow="ADMIN · APPLICATION MIND" title="Master map" sub="Architecture, state ownership, runtime health, and admin write surfaces.">
        {/* Health tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 1, background: "var(--border)" }}>
          {MOCK_HEALTH_TILES.map(t => <HealthTile key={t.id} t={t} />)}
        </div>

        {/* Architecture explorer */}
        <div style={{ marginTop: 18, display: "grid", gridTemplateColumns: "1.6fr 1fr", border: "1px solid var(--border)", background: "var(--bg)" }}>
          <ArchGraph selected={selectedNode} onSelect={setSelectedNode} />
          <ArchDetail node={MOCK_ARCH_NODES.find(n => n.id === selectedNode) || MOCK_ARCH_NODES[3]} />
        </div>
      </AdminSection>
    </div>
  );
}

function HealthTile({ t }) {
  const tone = t.tone === "crit" ? "down" : t.tone === "watch" ? "brand" : "up";
  const bg = t.tone === "crit" ? "rgba(224,120,86,0.06)" : t.tone === "watch" ? "rgba(201,166,107,0.05)" : "var(--bg)";
  return (
    <div style={{ background: bg, padding: "14px 14px 16px", display: "flex", flexDirection: "column", gap: 6, position: "relative", minHeight: 110 }}>
      <div style={{ position: "absolute", top: 10, right: 10 }}><StatusDot tone={tone} size={6} glow={t.tone !== "ok"} /></div>
      <div className="t-label">{t.name}</div>
      <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", letterSpacing: "-0.02em", lineHeight: 1.05 }}>{t.value}</div>
      <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 11.5, color: "var(--fg-dim)", lineHeight: 1.3 }}>{t.caption}</div>
    </div>
  );
}

function ArchGraph({ selected, onSelect }) {
  const positions = {
    ui: { x: 80, y: 70 },     api: { x: 280, y: 70 },   auth: { x: 480, y: 70 },
    pipe: { x: 280, y: 200 }, agents: { x: 480, y: 200 }, broker: { x: 80, y: 330 },
    mkt: { x: 280, y: 330 },  fund: { x: 480, y: 330 }, anth: { x: 680, y: 200 },
    db: { x: 80, y: 200 },    cache: { x: 680, y: 70 }, audit: { x: 680, y: 330 },
  };
  const edges = [
    ["ui","api"],["api","auth"],["api","pipe"],["pipe","agents"],["agents","anth"],
    ["api","db"],["api","cache"],["pipe","db"],["pipe","mkt"],["pipe","fund"],
    ["agents","db"],["api","broker"],["api","audit"],
  ];
  return (
    <div style={{ background: "linear-gradient(to bottom, rgba(141,179,196,0.02), rgba(141,179,196,0.005))", position: "relative", minHeight: 440, overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(141,179,196,0.08) 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
      <div style={{ position: "absolute", top: 10, left: 12, right: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, zIndex: 2 }}>
        <input placeholder="Find component…" style={{ width: 200, background: "var(--bg-elev-1)", border: "1px solid var(--border)", padding: "5px 9px", borderRadius: 3, fontFamily: "var(--font-ui)", fontSize: 11, color: "var(--ink-1000)", outline: "none" }} />
        <div style={{ display: "flex", gap: 6 }}>
          {["All","Frontend","Backend","Data","AI","External"].map((f, i) => (
            <span key={f} className="t-label" style={{ padding: "3px 8px", border: "1px solid var(--border)", borderRadius: 3, background: i === 0 ? "var(--bg-elev-2)" : "var(--bg-elev-1)", color: i === 0 ? "var(--ink-1000)" : "var(--fg-muted)" }}>{f}</span>
          ))}
        </div>
        <div className="t-mono" style={{ fontSize: 10, color: "var(--fg-hint)" }}>Overview · Systems · Services · State</div>
      </div>
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
        {edges.map(([a, b], i) => {
          const pa = positions[a], pb = positions[b];
          if (!pa || !pb) return null;
          return <line key={i} x1={pa.x + 70} y1={pa.y + 22} x2={pb.x + 70} y2={pb.y + 22} stroke="rgba(141,179,196,0.18)" strokeWidth="1" />;
        })}
      </svg>
      {MOCK_ARCH_NODES.map(n => {
        const p = positions[n.id]; if (!p) return null;
        const isSel = selected === n.id;
        const tone = n.status === "crit" ? "down" : n.status === "watch" ? "brand" : "up";
        return (
          <div key={n.id} onClick={() => onSelect(n.id)}
            style={{ position: "absolute", left: p.x, top: p.y, width: 140,
              background: isSel ? "var(--bg-elev-2)" : "var(--bg-elev-1)",
              border: isSel ? "1.5px solid var(--brand)" : "1px solid var(--border-strong)",
              borderRadius: 4, padding: "8px 10px", cursor: "default",
              boxShadow: isSel ? "0 4px 14px rgba(0,0,0,0.4)" : "0 1px 0 rgba(0,0,0,0.2)",
              transition: "all 120ms" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 500, color: "var(--ink-1000)" }}>{n.name}</span>
              <StatusDot tone={tone} size={5} glow={n.status !== "ok"} />
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-hint)" }}>{n.caption}</div>
          </div>
        );
      })}
    </div>
  );
}

function ArchDetail({ node }) {
  return (
    <div style={{ borderLeft: "1px solid var(--border)", padding: 18, background: "var(--bg-elev-1)" }}>
      <div className="t-label" style={{ marginBottom: 4 }}>SELECTED COMPONENT</div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", margin: 0, letterSpacing: "-0.02em" }}>{node.name}</h2>
        <StatusDot tone={node.status === "crit" ? "down" : node.status === "watch" ? "brand" : "up"} size={6} />
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-dim)", marginTop: 4 }}>{node.caption}</div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
        <Pill text={node.group} />
        <Pill text="Live probes synced" tone="up" />
        <Pill text="Level 0" />
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
        {["Focus","Source ↗","View","Control"].map(b => <button key={b} style={btnGhost}>{b}</button>)}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--border)", marginTop: 16 }}>
        {[["Reads","8"],["Writes","2"],["Controls","5"],["State paths","12"]].map(([k, v]) => (
          <div key={k} style={{ background: "var(--bg)", padding: "10px 12px" }}>
            <div className="t-label">{k}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, color: "var(--ink-1000)", fontWeight: 300, marginTop: 4 }}>{v}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14, padding: "10px 12px", background: "rgba(201,166,107,0.06)", border: "1px solid rgba(201,166,107,0.4)", borderRadius: 4 }}>
        <div className="t-label" style={{ color: "var(--gold-500)", marginBottom: 4 }}>OPERATOR NOTES</div>
        <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg)", lineHeight: 1.4 }}>
          {node.id === "pipe" ? "Enrich queue grew during 12:38 Polygon outage. Backfilling — expect 18m to drain. No order impact." :
           node.id === "mkt" ? "Polygon key not set. Falling back to FMP last-trade for delayed quotes. Real-time L2 unavailable." :
           "All probes nominal. No operator action required."}
        </div>
      </div>
    </div>
  );
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function AdminSection({ eyebrow, title, sub, children }) {
  return (
    <section style={{ padding: "32px 28px 8px" }}>
      <div className="t-label">{eyebrow}</div>
      <h2 style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 26, color: "var(--ink-1000)", letterSpacing: "-0.02em", margin: "4px 0 6px" }}>{title}</h2>
      {sub && <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-dim)", marginBottom: 16, maxWidth: 640 }}>{sub}</div>}
      {children}
    </section>
  );
}

// ─── ControlModule grid (switch/number/dispatch) ──────────────────────────────

function ModuleGrid({ items, onChange, onDanger }) {
  if (!items.length) return <EmptyState title="No matching controls" body="Clear the search to see all modules in this category." />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
      {items.map(c => (
        <ControlModule key={c.id} name={c.name} desc={c.desc} scope={c.scope} lastBy={c.lastBy} lastAt={c.lastAt} critical={c.critical}>
          {c.control === "switch" && <SwitchControl value={c.value} onChange={(v) => c.dangerous ? onDanger?.(c) : onChange(c.id, v)} />}
          {c.control === "number" && <NumberControl value={c.value} unit={c.unit} onChange={(v) => onChange(c.id, v)} />}
          {c.control === "dispatch" && <DispatchControl value={c.value} dangerous={c.dangerous} onDispatch={() => c.dangerous ? onDanger?.(c) : onChange(c.id, c.value)} />}
        </ControlModule>
      ))}
    </div>
  );
}

function SwitchControl({ value, onChange }) {
  const on = !!value;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={() => onChange(!on)} style={{
        width: 38, height: 22, borderRadius: 11, border: "1px solid var(--border-strong)",
        background: on ? "var(--up-500)" : "var(--bg-elev-2)", position: "relative", cursor: "default", padding: 0,
      }}>
        <span style={{ position: "absolute", top: 2, left: on ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: on ? "#0a0a0a" : "var(--fg-muted)", transition: "all 140ms" }} />
      </button>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: on ? "var(--up-500)" : "var(--fg-muted)", fontWeight: 600, letterSpacing: "0.05em" }}>{on ? "ENABLED" : "DISABLED"}</span>
    </div>
  );
}

function NumberControl({ value, unit, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={{ width: 90, background: "var(--bg-elev-2)", border: "1px solid var(--border-strong)", padding: "5px 9px", borderRadius: 3, color: "var(--ink-1000)", fontFamily: "var(--font-mono)", fontSize: 13, outline: "none" }} />
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>{unit}</span>
    </div>
  );
}

function DispatchControl({ value, dangerous, onDispatch }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input value={value} readOnly style={{ width: 110, background: "var(--bg-elev-2)", border: "1px solid var(--border-strong)", padding: "5px 9px", borderRadius: 3, color: "var(--ink-1000)", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none" }} />
      <button onClick={onDispatch} style={dangerous ? btnDanger : btnPrimary}>Dispatch →</button>
    </div>
  );
}

function KeyModule({ c, onSave }) {
  const [val, setVal] = useState("");
  const set = !!c.value;
  return (
    <ControlModule name={c.name} desc={c.desc} scope="ENV-VAR" lastBy={c.lastBy} lastAt={c.lastAt} critical={c.critical}>
      <div style={{ display: "flex", gap: 6 }}>
        <input value={val} onChange={(e) => setVal(e.target.value)} type="password" placeholder={set ? "paste new value to rotate" : "paste new value"}
          style={{ flex: 1, background: "var(--bg-elev-2)", border: "1px solid var(--border-strong)", padding: "5px 9px", borderRadius: 3, color: "var(--ink-1000)", fontFamily: "var(--font-mono)", fontSize: 12, outline: "none" }} />
        <button onClick={() => { onSave(val); setVal(""); }} style={btnPrimary} disabled={!val}>Save</button>
      </div>
    </ControlModule>
  );
}

// ─── Layout composer ──────────────────────────────────────────────────────────

function LayoutComposer({ sections, setSections }) {
  const move = (i, dir) => {
    const j = i + dir; if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    setSections(next);
  };
  const toggle = (i) => setSections(s => s.map((sec, k) => k === i ? { ...sec, visible: !sec.visible } : sec));
  return (
    <div style={{ background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 5 }}>
      {sections.map((s, i) => (
        <div key={s.id} style={{ display: "grid", gridTemplateColumns: "auto auto 1fr auto auto auto", gap: 14, alignItems: "center", padding: "12px 16px", borderBottom: i < sections.length - 1 ? "1px solid var(--border-hair)" : "none" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--fg-hint)", cursor: "grab" }}>≡</span>
          <input type="checkbox" checked={s.visible} onChange={() => toggle(i)} />
          <div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)", fontWeight: 500 }}>{s.title}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)", marginTop: 2 }}>{s.name}</div>
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: s.visible ? "var(--up-500)" : "var(--fg-hint)", letterSpacing: "0.05em" }}>{s.visible ? "VISIBLE" : "HIDDEN"}</span>
          <button onClick={() => move(i, -1)} style={iconBtn}>↑</button>
          <button onClick={() => move(i, 1)} style={iconBtn}>↓</button>
        </div>
      ))}
    </div>
  );
}

// ─── Audit tail ───────────────────────────────────────────────────────────────

function AuditTail({ rows }) {
  return (
    <div style={{ background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 5, overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: "auto 110px 1fr 110px 1.4fr", padding: "8px 14px", background: "var(--ink-100)", borderBottom: "1px solid var(--border)" }}>
        {["TIME","ACTOR","ACTION","SCOPE","NOTE"].map(h => <span key={h} className="t-label">{h}</span>)}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 110px 1fr 110px 1.4fr", padding: "10px 14px", borderBottom: i < rows.length - 1 ? "1px solid var(--border-hair)" : "none", alignItems: "baseline", gap: 12 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>{r.ts}</span>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 12, color: r.actor === "operator" ? "var(--brand)" : "var(--fg-muted)", fontWeight: 500 }}>{r.actor}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-1000)" }}>{r.action}</span>
          <span className="t-label">{r.scope}</span>
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-dim)" }}>{r.note}</span>
        </div>
      ))}
    </div>
  );
}

// ─── small bits ────────────────────────────────────────────────────────────────

function Pill({ text, tone }) {
  const c = tone === "up" ? "var(--up-500)" : "var(--fg-muted)";
  return <span style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: c, padding: "3px 7px", border: `1px solid ${c}33`, background: `${c}10`, borderRadius: 999 }}>{text}</span>;
}

const btnPrimary = { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 500, padding: "5px 11px", background: "var(--brand)", color: "var(--brand-on)", border: "1px solid var(--brand)", borderRadius: 3, cursor: "default" };
const btnDanger = { fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 500, padding: "5px 11px", background: "var(--down-500)", color: "var(--down-on)", border: "1px solid var(--down-500)", borderRadius: 3, cursor: "default" };
const btnGhost = { fontFamily: "var(--font-ui)", fontSize: 11, padding: "5px 11px", background: "var(--bg-elev-2)", color: "var(--fg)", border: "1px solid var(--border)", borderRadius: 3, cursor: "default" };
const iconBtn = { width: 24, height: 24, background: "var(--bg-elev-2)", color: "var(--fg-muted)", border: "1px solid var(--border)", borderRadius: 3, cursor: "default", fontSize: 11 };

if (typeof window !== "undefined") Object.assign(window, { AdminPage });


// Admin · Users — applicants table + active users + per-user drawer.

const AdminUsersPage = ({ tweaks }) => {
  const [tab, setTab] = useState("applicants");
  const [filter, setFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [selectedApp, setSelectedApp] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [approveModal, setApproveModal] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);

  const apps = MOCK_APPLICANTS.filter(a =>
    (!filter || (a.name + a.email).toLowerCase().includes(filter.toLowerCase())) &&
    (riskFilter === "all" || a.risk === riskFilter)
  );
  const users = MOCK_ACTIVE_USERS.filter(u => !filter || (u.name + u.email).toLowerCase().includes(filter.toLowerCase()));

  return (
    <div data-screen-label="Admin · Users" style={{ height: "100%", display: "grid", gridTemplateRows: "auto auto 1fr", overflow: "hidden" }}>
      {/* Identity band */}
      <div style={{ background: "var(--ink-100)", padding: "20px 28px 14px", borderBottom: "1px solid var(--border)" }}>
        <div className="t-label">ADMIN · USERS</div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, marginTop: 4 }}>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 32, color: "var(--ink-1000)", letterSpacing: "-0.025em", lineHeight: 1.05, margin: "2px 0 4px" }}>People & access</h1>
            <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg-dim)", maxWidth: 580 }}>Approvals are deliberate. Every account has a default dashboard, scoped risk, and an audit trail.</div>
          </div>
          <div style={{ display: "flex", gap: 22 }}>
            <AdminUsersStat label="APPLICANTS" v={MOCK_APPLICANTS.length} sub="6 pending" />
            <AdminUsersStat label="ACTIVE" v={MOCK_ACTIVE_USERS.length} sub="2 watch · 1 dormant" />
            <AdminUsersStat label="LIVE EQUITY" v="$1.79M" sub="9 funded accounts" />
            <AdminUsersStat label="AI SPEND · 24h" v="$37.72" sub="cap $250" />
          </div>
        </div>
      </div>

      {/* Tab + filter row */}
      <div style={{ background: "var(--bg-elev-1)", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px" }}>
        <div style={{ display: "flex", gap: 0 }}>
          {[
            { id: "applicants", label: "Applicants", count: MOCK_APPLICANTS.length, dot: "warn" },
            { id: "active", label: "Active users", count: MOCK_ACTIVE_USERS.length },
            { id: "audit", label: "Access audit", count: null },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background: "transparent", border: 0, padding: "14px 18px", cursor: "default",
                color: tab === t.id ? "var(--ink-1000)" : "var(--fg-muted)",
                fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: tab === t.id ? 500 : 400,
                borderBottom: tab === t.id ? "2px solid var(--brand)" : "2px solid transparent" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {t.dot && <StatusDot tone="warn" size={5} />}
                {t.label}
                {t.count != null && <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)", marginLeft: 4 }}>{t.count}</span>}
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search…"
            style={{ background: "var(--bg-elev-2)", border: "1px solid var(--border)", padding: "5px 9px", borderRadius: 3, color: "var(--ink-1000)", fontFamily: "var(--font-ui)", fontSize: 12, outline: "none", width: 200 }} />
          {tab === "applicants" && (
            <select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}
              style={{ background: "var(--bg-elev-2)", border: "1px solid var(--border)", padding: "5px 9px", borderRadius: 3, color: "var(--ink-1000)", fontFamily: "var(--font-ui)", fontSize: 12, outline: "none" }}>
              <option value="all">All risk</option>
              <option value="low">Low</option>
              <option value="med">Medium</option>
              <option value="high">High</option>
            </select>
          )}
          <button style={btnGhost}>Export CSV</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ overflow: "auto" }}>
        {tab === "applicants" && <ApplicantsTable rows={apps} onPick={setSelectedApp} onApprove={setApproveModal} onReject={setRejectModal} />}
        {tab === "active" && <ActiveUsersTable rows={users} onPick={setSelectedUser} />}
        {tab === "audit" && <AccessAuditTable />}
      </div>

      {selectedApp && <ApplicantDrawer a={selectedApp} onClose={() => setSelectedApp(null)} onApprove={() => { setApproveModal(selectedApp); setSelectedApp(null); }} onReject={() => { setRejectModal(selectedApp); setSelectedApp(null); }} />}
      {selectedUser && <UserDrawer u={selectedUser} onClose={() => setSelectedUser(null)} />}
      {approveModal && <ApproveModal a={approveModal} onClose={() => setApproveModal(null)} />}
      {rejectModal && <RejectModal a={rejectModal} onClose={() => setRejectModal(null)} />}
    </div>
  );
};

function AdminUsersStat({ label, v, sub }) {
  return (
    <div>
      <div className="t-label">{label}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 22, fontWeight: 300, color: "var(--ink-1000)", lineHeight: 1, marginTop: 4 }}>{v}</div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--fg-hint)", marginTop: 4 }}>{sub}</div>
    </div>
  );
}

// ─── Applicants ────────────────────────────────────────────────────────────────

function ApplicantsTable({ rows, onPick, onApprove, onReject }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1.5fr 90px 100px 100px 1.6fr 220px", padding: "10px 28px", background: "var(--ink-100)", borderBottom: "1px solid var(--border)" }}>
        {["APPLICANT","EMAIL","APPLIED","COUNTRY","RISK","FLAGS / NOTE","ACTIONS"].map(h => <span key={h} className="t-label">{h}</span>)}
      </div>
      {rows.map((a, i) => (
        <div key={a.id} onClick={() => onPick(a)}
          style={{ display: "grid", gridTemplateColumns: "1.4fr 1.5fr 90px 100px 100px 1.6fr 220px", padding: "13px 28px", borderBottom: "1px solid var(--border-hair)",
            background: i % 2 === 0 ? "transparent" : "rgba(141,179,196,0.015)", alignItems: "center", gap: 12, cursor: "default" }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-elev-1)"}
          onMouseLeave={(e) => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(141,179,196,0.015)"}>
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 15, color: "var(--ink-1000)", letterSpacing: "-0.01em" }}>{a.name}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg)" }}>{a.email}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>{a.appliedAt}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg)" }}>{a.country}</span>
          <RiskPill r={a.risk} />
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: a.flags.length ? "var(--down-500)" : "var(--fg-dim)" }}>
            {a.flags.length ? a.flags.join(" · ") : a.reason}
          </span>
          <div style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => onPick(a)} style={btnGhost}>Review</button>
            <button onClick={() => onApprove(a)} style={btnPrimary} disabled={a.risk === "high"}>Approve</button>
            <button onClick={() => onReject(a)} style={btnGhost}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function RiskPill({ r }) {
  const cfg = r === "low" ? { c: "var(--up-500)", t: "LOW" } : r === "med" ? { c: "var(--gold-500)", t: "MED" } : { c: "var(--down-500)", t: "HIGH" };
  return <span style={{ fontFamily: "var(--font-ui)", fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: cfg.c, padding: "2px 8px", border: `1px solid ${cfg.c}55`, background: `${cfg.c}10`, borderRadius: 999 }}>{cfg.t}</span>;
}

function ApplicantDrawer({ a, onClose, onApprove, onReject }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 540, height: "100%", background: "var(--bg)", borderLeft: "1px solid var(--border-strong)", overflow: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", background: "var(--ink-100)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <div className="t-label">APPLICANT</div>
              <h2 style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 26, color: "var(--ink-1000)", letterSpacing: "-0.02em", margin: "4px 0 4px" }}>{a.name}</h2>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg)" }}>{a.email}</div>
            </div>
            <button onClick={onClose} style={iconBtn}>×</button>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <RiskPill r={a.risk} />
            <Pill text={a.country} />
            <Pill text={a.invited} />
            <Pill text={a.appliedAt} />
          </div>
        </div>

        <div style={{ padding: 24, flex: 1 }}>
          {a.flags.length > 0 && (
            <div style={{ background: "rgba(224,120,86,0.06)", border: "1px solid rgba(224,120,86,0.4)", borderRadius: 4, padding: "12px 14px", marginBottom: 18 }}>
              <div className="t-label" style={{ color: "var(--down-500)", marginBottom: 6 }}>RISK SIGNALS</div>
              {a.flags.map((f, i) => (
                <div key={i} style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)", marginBottom: 2 }}>· {f}</div>
              ))}
            </div>
          )}

          <div className="t-label" style={{ marginBottom: 8 }}>QUESTIONNAIRE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--border)", marginBottom: 18 }}>
            <AdminUsersField label="Years trading" v={a.questionnaire.years} />
            <AdminUsersField label="Capital range" v={a.questionnaire.capital} />
            <AdminUsersField label="Focus" v={a.questionnaire.focus} />
            <AdminUsersField label="Goals" v={a.questionnaire.goals} />
          </div>

          <div className="t-label" style={{ marginBottom: 8 }}>NOTES</div>
          <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, color: "var(--fg)", lineHeight: 1.5, padding: "10px 12px", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 4 }}>{a.reason || "No additional context provided."}</div>
        </div>

        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", background: "var(--ink-100)", display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button onClick={onReject} style={btnGhost}>Reject</button>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnGhost}>Request more info</button>
            <button onClick={onApprove} style={btnPrimary} disabled={a.risk === "high"}>Approve →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminUsersField({ label, v }) {
  return (
    <div style={{ background: "var(--bg)", padding: "10px 12px" }}>
      <div className="t-label">{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-1000)", marginTop: 4 }}>{v}</div>
    </div>
  );
}

function ApproveModal({ a, onClose }) {
  const [dashboard, setDashboard] = useState("retail-trader");
  const [risk, setRisk] = useState("conservative");
  const [agentPreset, setAgentPreset] = useState("balanced");
  const [paper, setPaper] = useState(true);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", justifyContent: "center", alignItems: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, background: "var(--bg)", border: "1px solid var(--border-strong)", borderRadius: 6, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
          <div className="t-label">APPROVE APPLICANT</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", margin: "4px 0 0", letterSpacing: "-0.02em" }}>{a.name} · {a.email}</h2>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <ApproveField label="Default dashboard">
            <select value={dashboard} onChange={(e) => setDashboard(e.target.value)} style={selectStyle}>
              <option value="retail-trader">Retail trader · stocks + options</option>
              <option value="quant-pm">Quant PM · multi-strategy</option>
              <option value="research">Research-only · no order rails</option>
              <option value="paper">Paper-account learning</option>
            </select>
          </ApproveField>
          <ApproveField label="Risk preset">
            <select value={risk} onChange={(e) => setRisk(e.target.value)} style={selectStyle}>
              <option value="conservative">Conservative · 5% max pos · 2% DD stop</option>
              <option value="balanced">Balanced · 10% max pos · 3% DD stop</option>
              <option value="aggressive">Aggressive · 15% max pos · 5% DD stop</option>
            </select>
          </ApproveField>
          <ApproveField label="AI agent preset">
            <select value={agentPreset} onChange={(e) => setAgentPreset(e.target.value)} style={selectStyle}>
              <option value="minimal">Minimal · 2 agents · $5/day cap</option>
              <option value="balanced">Balanced · 4 agents · $15/day cap</option>
              <option value="full">Full · 7 agents · $50/day cap</option>
            </select>
          </ApproveField>
          <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 4, cursor: "default" }}>
            <input type="checkbox" checked={paper} onChange={(e) => setPaper(e.target.checked)} />
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)" }}>Start in paper mode</span>
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12, color: "var(--fg-muted)", marginLeft: "auto" }}>recommended</span>
          </label>
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid var(--border)", background: "var(--ink-100)", display: "flex", justifyContent: "space-between", gap: 8 }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={onClose} style={btnPrimary}>Approve & send invite →</button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({ a, onClose }) {
  const [reason, setReason] = useState("not-fit");
  const [note, setNote] = useState("");
  const templates = {
    "not-fit": "Thank you for your interest. AlphaDesk is currently focused on a narrower group of operators and your profile isn't a fit at this time.",
    "incomplete": "Your application is missing key information. Please reapply with full questionnaire details.",
    "country": "We don't currently support accounts in your jurisdiction.",
    "risk": "Based on the information provided, we're unable to approve at this time.",
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 200, display: "flex", justifyContent: "center", alignItems: "center" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 560, background: "var(--bg)", border: "1px solid var(--border-strong)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
          <div className="t-label" style={{ color: "var(--down-500)" }}>REJECT APPLICATION</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 22, color: "var(--ink-1000)", margin: "4px 0 0", letterSpacing: "-0.02em" }}>{a.name}</h2>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
          <ApproveField label="Reason template">
            <select value={reason} onChange={(e) => setReason(e.target.value)} style={selectStyle}>
              <option value="not-fit">Not a fit at this time</option>
              <option value="incomplete">Incomplete application</option>
              <option value="country">Unsupported jurisdiction</option>
              <option value="risk">Risk signals</option>
            </select>
          </ApproveField>
          <ApproveField label="Message to applicant">
            <textarea value={note || templates[reason]} onChange={(e) => setNote(e.target.value)} rows={5}
              style={{ width: "100%", boxSizing: "border-box", background: "var(--bg-elev-2)", border: "1px solid var(--border-strong)", padding: "8px 10px", borderRadius: 3, color: "var(--ink-1000)", fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 13, lineHeight: 1.5, outline: "none", resize: "vertical" }} />
          </ApproveField>
        </div>
        <div style={{ padding: "14px 24px", borderTop: "1px solid var(--border)", background: "var(--ink-100)", display: "flex", justifyContent: "space-between" }}>
          <button onClick={onClose} style={btnGhost}>Cancel</button>
          <button onClick={onClose} style={btnDanger}>Reject & notify →</button>
        </div>
      </div>
    </div>
  );
}

function ApproveField({ label, children }) {
  return (
    <div>
      <div className="t-label" style={{ marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const selectStyle = { width: "100%", boxSizing: "border-box", background: "var(--bg-elev-2)", border: "1px solid var(--border-strong)", padding: "7px 10px", borderRadius: 3, color: "var(--ink-1000)", fontFamily: "var(--font-ui)", fontSize: 13, outline: "none" };

// ─── Active users ──────────────────────────────────────────────────────────────

function ActiveUsersTable({ rows, onPick }) {
  const fmt = (n) => "$" + (n / 1000).toFixed(1) + "k";
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1.5fr 80px 90px 110px 90px 80px 70px 80px 80px", padding: "10px 28px", background: "var(--ink-100)", borderBottom: "1px solid var(--border)" }}>
        {["NAME","EMAIL","ROLE","JOINED","LAST ACTIVE","MODE","EQUITY","POS","AGENTS","AI · 24h"].map(h => <span key={h} className="t-label">{h}</span>)}
      </div>
      {rows.map((u, i) => (
        <div key={u.id} onClick={() => onPick(u)}
          style={{ display: "grid", gridTemplateColumns: "1.3fr 1.5fr 80px 90px 110px 90px 80px 70px 80px 80px", padding: "12px 28px", borderBottom: "1px solid var(--border-hair)",
            background: i % 2 === 0 ? "transparent" : "rgba(141,179,196,0.015)", alignItems: "center", gap: 8, cursor: "default" }}
          onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-elev-1)"}
          onMouseLeave={(e) => e.currentTarget.style.background = i % 2 === 0 ? "transparent" : "rgba(141,179,196,0.015)"}>
          <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 14, color: "var(--ink-1000)", display: "inline-flex", alignItems: "center", gap: 8 }}>
            <StatusDot tone={u.status === "ok" ? "up" : u.status === "watch" ? "warn" : "down"} size={5} />{u.name}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg)" }}>{u.email}</span>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: 11, color: u.role === "operator" ? "var(--brand)" : "var(--fg-muted)", fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase" }}>{u.role}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>{u.joined}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)" }}>{u.lastActive}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: u.paper ? "var(--gold-500)" : "var(--up-500)", fontWeight: 600, letterSpacing: "0.05em" }}>{u.paper ? "PAPER" : "LIVE"}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-1000)" }}>{fmt(u.equity)}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg)" }}>{u.openPos}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg)" }}>{u.agentsOn}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg)" }}>${u.dailyAi.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

function UserDrawer({ u, onClose }) {
  const [tab, setTab] = useState("telemetry");
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100, display: "flex", justifyContent: "flex-end" }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 720, height: "100%", background: "var(--bg)", borderLeft: "1px solid var(--border-strong)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)", background: "var(--ink-100)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div>
              <div className="t-label">USER</div>
              <h2 style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 26, color: "var(--ink-1000)", letterSpacing: "-0.02em", margin: "4px 0 4px" }}>{u.name}</h2>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--fg)" }}>{u.email} · joined {u.joined}</div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <button style={btnGhost}>Impersonate (read-only)</button>
              <button onClick={onClose} style={iconBtn}>×</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <Pill text={u.role.toUpperCase()} tone={u.role === "operator" ? "up" : null} />
            <Pill text={u.paper ? "PAPER" : "LIVE"} />
            <Pill text={`Equity $${(u.equity / 1000).toFixed(1)}k`} />
            <Pill text={`${u.openPos} positions`} />
          </div>
        </div>

        <div style={{ background: "var(--bg-elev-1)", borderBottom: "1px solid var(--border)", display: "flex", padding: "0 24px" }}>
          {[
            { id: "telemetry", label: "Telemetry" },
            { id: "dashboard", label: "Dashboard" },
            { id: "limits", label: "Limits & risk" },
            { id: "agents", label: "Agents" },
            { id: "audit", label: "Audit" },
            { id: "sessions", label: "Sessions" },
            { id: "support", label: "Support" },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ background: "transparent", border: 0, padding: "12px 14px", cursor: "default",
                color: tab === t.id ? "var(--ink-1000)" : "var(--fg-muted)",
                fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: tab === t.id ? 500 : 400,
                borderBottom: tab === t.id ? "2px solid var(--brand)" : "2px solid transparent" }}>{t.label}</button>
          ))}
        </div>

        <div style={{ overflow: "auto", padding: 24, flex: 1 }}>
          {tab === "telemetry" && <UserTelemetry u={u} />}
          {tab === "dashboard" && <UserDashboardTab />}
          {tab === "limits" && <UserLimitsTab />}
          {tab === "agents" && <UserAgentsTab />}
          {tab === "audit" && <AuditTail rows={MOCK_AUDIT_LOG.slice(0, 6)} />}
          {tab === "sessions" && <UserSessionsTab />}
          {tab === "support" && <UserSupportTab />}
        </div>
      </div>
    </div>
  );
}

function UserTelemetry({ u }) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 1, background: "var(--border)", marginBottom: 18 }}>
        <AdminUsersField label="Equity" v={`$${(u.equity / 1000).toFixed(1)}k`} />
        <AdminUsersField label="Open positions" v={u.openPos} />
        <AdminUsersField label="Active agents" v={u.agentsOn} />
        <AdminUsersField label="AI · 24h" v={`$${u.dailyAi.toFixed(2)}`} />
        <AdminUsersField label="Sessions · 7d" v="42" />
        <AdminUsersField label="Trades · 7d" v="18" />
        <AdminUsersField label="Win rate · 30d" v="58.4%" />
        <AdminUsersField label="DD · MTD" v="−1.2%" />
      </div>
      <div className="t-label" style={{ marginBottom: 8 }}>SESSION ACTIVITY · LAST 7 DAYS</div>
      <div style={{ background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 4, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120 }}>
          {[42, 38, 55, 28, 62, 18, 70].map((h, i) => (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ width: "100%", height: h, background: "var(--brand)", opacity: 0.7 }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--fg-hint)" }}>{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UserDashboardTab() {
  return (
    <div>
      <StatusBanner tone="brand" title="Dashboard composition is scoped to this user" body="Operator overrides — the user sees their dashboard, you see what they see when impersonating." />
      <div style={{ marginTop: 14 }}>
        <LayoutComposer sections={MOCK_DASHBOARD_SECTIONS} setSections={() => {}} />
      </div>
    </div>
  );
}

function UserLimitsTab() {
  return (
    <div>
      <StatusBanner tone="warn" title="Limits override the user's own settings" body="A scoped change here is audit-logged and surfaced to the user with an inheritance hint." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 14 }}>
        {MOCK_CONTROLS.filter(c => c.category === "Risk").map(c => (
          <ControlModule key={c.id} name={c.name} desc={c.desc} scope="USER-SCOPED" lastBy={c.lastBy} lastAt={c.lastAt}>
            <NumberControl value={c.value} unit={c.unit} onChange={() => {}} />
          </ControlModule>
        ))}
      </div>
    </div>
  );
}

function UserAgentsTab() {
  return (
    <div>
      <div className="t-label" style={{ marginBottom: 8 }}>SCOPED AGENT ROSTER</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 1, background: "var(--border)", border: "1px solid var(--border)" }}>
        {MOCK_AGENTS.slice(0, 5).map(a => <AgentRow key={a.id} a={a} />)}
      </div>
    </div>
  );
}

function UserSessionsTab() {
  const sessions = [
    { ts: "now", device: "macOS · Chrome", ip: "73.18.42.1", loc: "San Francisco, US", current: true },
    { ts: "2h ago", device: "iOS · Safari", ip: "73.18.42.1", loc: "San Francisco, US", current: false },
    { ts: "yesterday", device: "macOS · Chrome", ip: "73.18.42.1", loc: "San Francisco, US", current: false },
    { ts: "3d ago", device: "macOS · Chrome", ip: "108.41.99.2", loc: "Seattle, US", current: false },
  ];
  return (
    <div>
      <div className="t-label" style={{ marginBottom: 8 }}>ACTIVE & RECENT SESSIONS</div>
      <div style={{ background: "var(--bg-elev-1)", border: "1px solid var(--border)", borderRadius: 4 }}>
        {sessions.map((s, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "auto 1fr 110px 1.2fr auto", gap: 14, alignItems: "center", padding: "12px 14px", borderBottom: i < sessions.length - 1 ? "1px solid var(--border-hair)" : "none" }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg-muted)", width: 80 }}>{s.ts}</span>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--ink-1000)" }}>{s.device}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg)" }}>{s.ip}</span>
            <span style={{ fontFamily: "var(--font-display)", fontStyle: "italic", fontSize: 12.5, color: "var(--fg-dim)" }}>{s.loc}</span>
            {s.current ? <Pill text="CURRENT" tone="up" /> : <button style={btnGhost}>Revoke</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

function UserSupportTab() {
  return <EmptyState title="No support threads" body="Tickets and direct messages with this user will appear here." />;
}

// ─── Access audit ──────────────────────────────────────────────────────────────

function AccessAuditTable() {
  const rows = [
    { ts: "14:42", actor: "operator", action: "approved · Aria Mehta", scope: "applicant", note: "Conservative · Paper · Balanced agents" },
    { ts: "13:15", actor: "operator", action: "rejected · Mia Roy", scope: "applicant", note: "Risk signals: disposable email, masked country" },
    { ts: "11:02", actor: "operator", action: "impersonated · Felix Roth", scope: "user", note: "10m read-only session" },
    { ts: "yesterday", actor: "operator", action: "limits scoped · Kira Volkov", scope: "user", note: "DD stop 3.0 → 2.0" },
    { ts: "2d ago", actor: "system", action: "session revoked · Tom Reyes", scope: "user", note: "Inactive 60+ days" },
  ];
  return <div style={{ padding: 24 }}><AuditTail rows={rows} /></div>;
}

if (typeof window !== "undefined") Object.assign(window, { AdminUsersPage });


// App entry — wires tweaks, page routing, and the chrome around all pages.

export type AlphaDeskDesignPage = "dashboard" | "research" | "positions" | "mobile" | "ticker" | "trade" | "strategies" | "watchlists" | "reports" | "settings" | "onboarding" | "marketing" | "auth" | "pipeline" | "analytics" | "alerts" | "risk" | "playbook" | "backtest" | "admin" | "admin-users";

const DESIGN_PAGE_ROUTES = {
  dashboard: "/",
  research: "/watchlists",
  watchlists: "/watchlists",
  ticker: "/symbols/NVDA",
  trade: "/trade",
  strategies: "/strategies",
  pipeline: "/pipeline",
  analytics: "/analytics",
  alerts: "/alerts",
  reports: "/reports",
  settings: "/settings",
  risk: "/risk",
  positions: "/positions/NVDA",
  playbook: "/strategies/momentum-quality/playbook",
  backtest: "/strategies/momentum-quality/backtest",
  admin: "/admin/control-center",
  "admin-users": "/admin/users",
  onboarding: "/onboarding",
  marketing: "/",
  auth: "/login",
};

const STRATEGY_NAME_TO_SLUG = {
  "Momentum & Quality": "momentum-quality",
  "Regime Adaptive": "regime-adaptive",
  PEAD: "earnings-options-play",
  "Mean Reversion": "mean-reversion",
  "Pairs · Sector": "pairs-trading",
  "AI Alpha": "trading-agents-research",
};

const STRATEGY_SLUG_TO_NAME = {
  "momentum-quality": "Momentum & Quality",
  "regime-adaptive": "Regime Adaptive",
  "earnings-options-play": "PEAD",
  "earnings-vol-premium": "PEAD",
  "mean-reversion": "Mean Reversion",
  "pairs-trading": "Pairs · Sector",
  "pairs-stat-arb": "Pairs · Sector",
  "trading-agents-research": "AI Alpha",
  "claude-alpha": "AI Alpha",
};

function designStrategySlug(name = "Momentum & Quality") {
  return STRATEGY_NAME_TO_SLUG[name] || String(name).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "momentum-quality";
}

export function designStrategyNameFromSlug(slug = "momentum-quality") {
  return STRATEGY_SLUG_TO_NAME[String(slug).toLowerCase()] || String(slug)
    .split("-")
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function designRouteFor(page: AlphaDeskDesignPage, opts: { ticker?: string; strat?: string } = {}) {
  const id = page === "research" ? "watchlists" : page;
  const ticker = String(opts.ticker || "NVDA").toUpperCase();
  const stratSlug = designStrategySlug(opts.strat || "Momentum & Quality");
  if (id === "ticker") return `/symbols/${encodeURIComponent(ticker)}`;
  if (id === "positions") return `/positions/${encodeURIComponent(ticker)}`;
  if (id === "trade") return `/trade?symbol=${encodeURIComponent(ticker)}`;
  if (id === "playbook") return `/strategies/${encodeURIComponent(stratSlug)}/playbook`;
  if (id === "backtest") return `/strategies/${encodeURIComponent(stratSlug)}/backtest`;
  return DESIGN_PAGE_ROUTES[id] || "/";
}

export function AlphaDeskDesignApp({ initialPage = "dashboard", initialSymbol = "NVDA", initialStrategy = "Momentum & Quality" }: { initialPage?: AlphaDeskDesignPage; initialSymbol?: string; initialStrategy?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [t, setTweak] = useTweaks({ ...TWEAK_DEFAULTS, page: initialPage });
  const [page, setPage] = useState(initialPage || "dashboard");
  const [sym, setSym] = useState(initialSymbol || "NVDA");
  const [stratName, setStratName] = useState(initialStrategy || "Momentum & Quality");
  const [cmdOpen, setCmdOpen] = useState(false);

  // Nav history — every forward navigation pushes the previous page so back-
  // links land on whatever the user actually came from. `isBackRef` suppresses
  // re-pushing when the user is moving backwards through the stack.
  const historyRef = useRef([]);
  const isBackRef = useRef(false);

  const navigate = React.useCallback((id, opts) => {
    const nextPage = id === "research" ? "watchlists" : id;
    if (!nextPage) return;
    const nextSymbol = opts?.ticker || sym;
    const nextStrategy = opts?.strat || stratName;
    const sameTicker = !opts?.ticker || String(opts.ticker).toUpperCase() === String(sym).toUpperCase();
    const sameStrategy = !opts?.strat || opts.strat === stratName;
    if (nextPage === page && sameTicker && sameStrategy) return;
    if (opts && typeof opts === "object") {
      if (opts.ticker) setSym(opts.ticker);
      if (opts.strat) setStratName(opts.strat);
    }
    const targetRoute = designRouteFor(nextPage, { ticker: nextSymbol, strat: nextStrategy });
    const currentRoute = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : pathname;
    if (targetRoute && targetRoute !== currentRoute) router.push(targetRoute);
    // resetHistory: caller wants this transition to be the new root of the
    // back-stack (e.g. landing in the app from auth/onboarding — back from
    // Dashboard shouldn't return you to login).
    if (opts && opts.resetHistory) {
      historyRef.current = [];
    } else if (!isBackRef.current) {
      historyRef.current.push(page);
      if (historyRef.current.length > 32) historyRef.current.shift();
    }
    isBackRef.current = false;
    setPage(nextPage);
  }, [page, pathname, router, stratName, sym]);

  const goBack = React.useCallback((fallback = "dashboard") => {
    isBackRef.current = true;
    const h = historyRef.current;
    const target = h.length ? h.pop() : fallback;
    const nextPage = target === "research" ? "watchlists" : target;
    const targetRoute = designRouteFor(nextPage, { ticker: sym, strat: stratName });
    const currentRoute = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : pathname;
    if (targetRoute && targetRoute !== currentRoute) router.push(targetRoute);
    setPage(nextPage);
  }, [pathname, router, stratName, sym]);

  // Persist current page through tweak so deep state survives reload
  useEffect(() => { setTweak("page", page); /* eslint-disable-next-line */ }, [page]);

  useEffect(() => {
    setPage(initialPage || "dashboard");
    setSym(initialSymbol || "NVDA");
    setStratName(initialStrategy || "Momentum & Quality");
  }, [initialPage, initialSymbol, initialStrategy]);

  // Apply accent color live
  useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty("--brand", t.accent);
    el.style.setProperty("--gold-500", t.accent);
  }, [t.accent]);

  // Density pass-through (CSS hook for future use)
  useEffect(() => {
    document.body.dataset.density = t.density;
  }, [t.density]);

  // Theme — token swap. Default dark; light remaps tokens.css to a warm-paper
  // palette via [data-theme="light"]. No component-level branching needed.
  useEffect(() => {
    document.documentElement.dataset.theme = t.theme || "dark";
  }, [t.theme]);

  const onNav = navigate;
  const onPickTicker = (s) => navigate("ticker", { ticker: s });

  // Keyboard shortcuts: ⌘D dashboard · ⌘R watchlists · ⌘J trade · ⌘K palette
  // Suppressed while typing in form fields.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === "d") { e.preventDefault(); navigate("dashboard"); }
      if (k === "r") { e.preventDefault(); navigate("watchlists"); }
      if (k === "j") { e.preventDefault(); navigate("trade"); }
      if (k === "[") { e.preventDefault(); goBack(); }
      if (k === "k") { e.preventDefault(); setCmdOpen(o => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, goBack]);

  let body = null;
  if (page === "dashboard")  body = <Dashboard      tweaks={t} onNav={onNav} onPickTicker={onPickTicker} />;
  else if (page === "research") body = <WatchlistsPage tweaks={t} onNav={onNav} />;
  else if (page === "positions") body = <PositionPage sym={sym} onPickTicker={onPickTicker} onTrade={() => navigate("trade")} onBack={() => goBack("dashboard")} />;
  else if (page === "mobile")    body = <MobilePage />;
  else if (page === "ticker") body = <TickerPage    tweaks={t} sym={sym} onTrade={() => navigate("trade")} onPickTicker={onPickTicker} onBack={() => goBack("watchlists")} />;
  else if (page === "trade") body = <TradePage      tweaks={t} sym={sym} onPickTicker={onPickTicker} />;
  else if (page === "strategies") body = <StrategiesPage tweaks={t} onNav={onNav} />;
  else if (page === "watchlists") body = <WatchlistsPage tweaks={t} onNav={onNav} />;
  else if (page === "reports")    body = <ReportsPage tweaks={t} onNav={onNav} onPickTicker={onPickTicker} />;
  else if (page === "settings")   body = <SettingsPage onNav={onNav} onBack={() => goBack("dashboard")} />;
  else if (page === "onboarding") body = <OnboardingPage onNav={onNav} />;
  else if (page === "marketing")  body = <MarketingPage onNav={onNav} />;
  else if (page === "auth")       body = <AuthPage onNav={onNav} />;
  else if (page === "pipeline")   body = <PipelinePage tweaks={t} />;
  else if (page === "analytics")  body = <AnalyticsPage tweaks={t} />;
  else if (page === "alerts")     body = <AlertsPage tweaks={t} />;
  else if (page === "risk")       body = <RiskPage tweaks={t} onNav={onNav} onPickTicker={onPickTicker} />;
  else if (page === "playbook")   body = <StrategyPlaybook tweaks={t} stratName={stratName} onNav={onNav} onBack={() => goBack("strategies")} onPickTicker={onPickTicker} onBacktest={() => navigate("backtest")} />;
  else if (page === "backtest")   body = <BacktestPage tweaks={t} onNav={onNav} onBack={() => goBack("strategies")} stratName={stratName} />;
  else if (page === "admin")      body = <AdminPage tweaks={t} onNav={onNav} />;
  else if (page === "admin-users") body = <AdminUsersPage tweaks={t} onBack={() => goBack("admin")} />;
  else body = <StubPage title={page} />;

  // Standalone full-screen experiences — no app chrome (top bar, status bar,
  // command palette would be jarring on the marketing site or login screen).
  const standalone = page === "marketing" || page === "auth" || page === "onboarding" || page === "mobile";

  return (
    <div data-screen-label={`AlphaDesk · ${page}`} style={{ display: "grid", gridTemplateRows: standalone ? "1fr" : "auto 1fr auto", height: "100vh", background: "var(--bg)" }}>
      {!standalone && <TopBar page={page} onNav={onNav} onSearch={onPickTicker} regime={MOCK_REGIME.state} theme={t.theme || "dark"} onTheme={v => setTweak("theme", v)} />}
      <main style={{ overflow: "hidden", position: "relative" }}>
        {body}
      </main>
      {!standalone && <StatusBar />}

      {!standalone && <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onNav={onNav} onPickTicker={onPickTicker} />}

      {/* tweaks panel — page picker bypasses history (debug control) */}
      <TweaksPanel title="Tweaks">
        <TweakSection title="Page">
          <TweakSelect label="Active page" value={page} options={[
            { value: "dashboard", label: "Dashboard" },
            { value: "watchlists", label: "Watchlists" },
            { value: "ticker", label: "Ticker · NVDA" },
            { value: "trade", label: "Trade terminal" },
            { value: "strategies", label: "Strategies" },
            { value: "pipeline", label: "Pipeline" },
            { value: "analytics", label: "Analytics" },
            { value: "alerts", label: "Alerts" },
            { value: "admin", label: "Admin · control center" },
            { value: "admin-users", label: "Admin · users" },
            { value: "playbook", label: "Strategy · playbook" },
            { value: "backtest", label: "Backtest workbench" },
            { value: "reports", label: "Reports & tax" },
            { value: "settings", label: "Settings" },
            { value: "risk", label: "Risk monitor" },
            { value: "positions", label: "Position · NVDA" },
            { value: "marketing", label: "Marketing site" },
            { value: "auth", label: "Auth / sign-in" },
            { value: "onboarding", label: "Onboarding" },
            { value: "mobile", label: "Mobile companion" },
          ]} onChange={setPage} />
        </TweakSection>

        <TweakSection title="Dashboard">
          <TweakRadio label="Layout" value={t.dashboardLayout}
            options={[{ value: "briefing", label: "Briefing" }, { value: "market", label: "Market" }, { value: "portfolio", label: "Book" }]}
            onChange={v => setTweak("dashboardLayout", v)} />
        </TweakSection>

        <TweakSection title="Ticker page">
          <TweakRadio label="Layout" value={t.tickerLayout}
            options={[{ value: "split", label: "Split" }, { value: "chart-first", label: "Chart" }, { value: "ai-first", label: "AI first" }]}
            onChange={v => setTweak("tickerLayout", v)} />
        </TweakSection>

        <TweakSection title="Trade terminal">
          <TweakRadio label="Order ticket" value={t.tradeLayout}
            options={[{ value: "right-rail", label: "Right rail" }, { value: "bottom", label: "Bottom" }]}
            onChange={v => setTweak("tradeLayout", v)} />
        </TweakSection>

        <TweakSection title="Look">
          <TweakRadio label="Theme" value={t.theme || "dark"}
            options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]}
            onChange={v => setTweak("theme", v)} />
          <TweakColor label="Accent" value={t.accent}
            options={["#c9a66b", "#a8d04d", "#8db3c4", "#e07856", "#d6b65a"]}
            onChange={v => setTweak("accent", v)} />
          <TweakRadio label="Density" value={t.density}
            options={[{ value: "balanced", label: "Balanced" }, { value: "dense", label: "Dense" }]}
            onChange={v => setTweak("density", v)} />
          <TweakToggle label="Show AI strips" value={t.showAI} onChange={v => setTweak("showAI", v)} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

export default AlphaDeskDesignApp;
