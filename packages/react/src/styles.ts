/**
 * The panel's styles, scoped by its shadow root: the app's CSS can't reach in
 * and none of this reaches out. Sizes are in px so the app's root font size
 * doesn't scale the panel.
 */
export const STYLES = `
:host { all: initial; }
* { box-sizing: border-box; }
.root {
  font: 14px/1.45 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  color: #f5f5f5;
  -webkit-font-smoothing: antialiased;
  /* Reviewers paste URLs and IDs; a long one must wrap, not widen the panel. */
  overflow-wrap: anywhere;
}
button, textarea, input { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .55; }
:focus-visible { outline: 2px solid #8ab4ff; outline-offset: 2px; }
[hidden] { display: none !important; }

.launcher {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 8px;
  height: 44px; padding: 0 16px; border: 1px solid #3a3a3a; border-radius: 22px;
  background: #1f1f1f; color: #fff; font-weight: 600;
  box-shadow: 0 6px 24px rgba(0, 0, 0, .35);
}
.badge {
  min-width: 22px; height: 22px; padding: 0 7px; border-radius: 11px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; background: #8ab4ff; color: #0b1a33;
}
.badge.failed { background: #ff8a80; color: #3b0a06; }
.badge.done { background: #7ddc9a; color: #06301a; }

.panel {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483001;
  width: 380px; max-width: 100vw; display: flex; flex-direction: column;
  background: #1a1a1a; border-left: 1px solid #333;
  box-shadow: -12px 0 40px rgba(0, 0, 0, .4);
}
@media (max-width: 520px) {
  .panel { top: auto; width: 100vw; max-height: 85vh; border-left: 0; border-top: 1px solid #333; border-radius: 16px 16px 0 0; }
}
.head { display: flex; align-items: flex-start; gap: 8px; padding: 14px 12px 14px 16px; border-bottom: 1px solid #2c2c2c; }
.head h2 { margin: 0; font-size: 16px; font-weight: 650; }
.head h2:focus { outline: none; }
.sub { margin: 2px 0 0; color: #a3a3a3; font-size: 13px; }
.grow { flex: 1; min-width: 0; }
.icon { flex: none; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: #d4d4d4; font-size: 22px; line-height: 1; }
.icon:hover { background: #2a2a2a; }
.fill { flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0; }
.body { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 4px 16px 16px; }
.footer { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 12px 16px 16px; border-top: 1px solid #2c2c2c; }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

.note { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: #26303f; color: #dbe7ff; font-size: 13px; }
.note.error { background: #40211f; color: #ffd9d5; display: flex; gap: 8px; align-items: flex-start; }
.note a { color: inherit; }
.lead { margin: 14px 0 0; font-size: 15px; }
.caption { margin: 10px 0 0; color: #a3a3a3; font-size: 12px; }
.action { margin: 16px 0 0; font-size: 17px; font-weight: 650; line-height: 1.35; }
.expect { margin: 8px 0 0; color: #c2c2c2; font-size: 15px; }
.route { margin: 0; color: #d4d4d4; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.link { padding: 0; border: 0; background: none; color: #8ab4ff; font-size: 13px; text-decoration: underline; }
.prev { display: block; margin-top: 18px; }
.attach { display: flex; gap: 14px; margin-top: 8px; }
.shot { display: flex; align-items: flex-end; gap: 12px; margin-top: 8px; }
.shot img { max-width: 140px; max-height: 96px; border: 1px solid #444; border-radius: 6px; object-fit: cover; }

.rows { list-style: none; margin: 12px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.rowbtn {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border: 1px solid #2f2f2f; border-radius: 12px; background: #202020; color: inherit;
  text-align: left; text-decoration: none;
}
button.rowbtn:hover, a.rowbtn:hover { background: #282828; }
.rowbtn.static { cursor: default; }
.rowtitle { display: block; font-weight: 600; }
.rowsub { display: block; margin-top: 1px; color: #a3a3a3; font-size: 12.5px; }
.chev { flex: none; color: #777; font-size: 18px; }
.mark {
  flex: none; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #5a5a5a;
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; line-height: 1;
}
.mark.pass { border-color: #2f8a52; background: #2f8a52; color: #fff; }
.mark.fail { border-color: #c2493e; background: #c2493e; color: #fff; }
.mark.partial { border-color: #8ab4ff; background: linear-gradient(90deg, #8ab4ff 50%, transparent 50%); }
.mark.redo { border-color: #8ab4ff; color: #8ab4ff; font-size: 13px; }
.mark.large { width: 52px; height: 52px; font-size: 26px; }

.section { margin-top: 20px; }
.section h3 { margin: 0 0 8px; color: #a3a3a3; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.section .sub { margin-top: 6px; }
.numbered { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.numbered li { display: flex; gap: 10px; align-items: flex-start; }
.num {
  flex: none; width: 22px; height: 22px; border-radius: 50%; background: #2c2c2c; color: #d4d4d4;
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;
}
.numbered .rowtitle { font-weight: 500; }
.done { margin-top: 20px; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.big { margin: 6px 0 0; font-size: 20px; font-weight: 700; }

.cta {
  width: 100%; min-height: 44px; padding: 8px 16px; border: 1px solid #8ab4ff; border-radius: 22px;
  background: #8ab4ff; color: #0b1a33; font-weight: 650; font-size: 15px;
}
.cta:hover:not(:disabled) { background: #a3c4ff; border-color: #a3c4ff; }
.cta.plain { background: transparent; border-color: transparent; color: #8ab4ff; }
.cta.plain:hover:not(:disabled) { background: #232a36; border-color: transparent; }
.cta.gray { background: #2a2a2a; border-color: #444; color: #f5f5f5; }
.cta.gray:hover:not(:disabled) { background: #333; border-color: #555; }
.cta.gray.pass span { color: #7ddc9a; }
.cta.gray.fail span { color: #ff8a80; }
.cta.gray.pass.on { background: #1f5c36; border-color: #2f8a52; }
.cta.gray.fail.on { background: #7a2a23; border-color: #b0443a; }
.cta.gray.on span { color: inherit; }

textarea, input[type='text'] {
  width: 100%; margin-top: 8px; padding: 9px 10px; border: 1px solid #444; border-radius: 9px;
  background: #141414; resize: vertical;
}
textarea { min-height: 96px; }
label { display: block; margin-top: 18px; color: #c9c9c9; font-size: 13px; }
@media (prefers-reduced-motion: no-preference) {
  .panel { animation: tt-in .16s ease-out; }
  @keyframes tt-in { from { transform: translateX(16px); opacity: 0; } to { transform: none; opacity: 1; } }
}
`
