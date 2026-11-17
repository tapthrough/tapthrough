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
.head { display: flex; align-items: flex-start; gap: 12px; padding: 16px; border-bottom: 1px solid #2c2c2c; }
.head h2 { margin: 0; font-size: 16px; font-weight: 650; }
.sub { margin: 2px 0 0; color: #a3a3a3; font-size: 13px; }
.grow { flex: 1; min-width: 0; }
.icon { width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: #d4d4d4; font-size: 20px; line-height: 1; }
.icon:hover { background: #2a2a2a; }
.body { flex: 1; overflow-x: hidden; overflow-y: auto; padding: 8px 16px 16px; }

.note { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: #26303f; color: #dbe7ff; font-size: 13px; }
.note.error { background: #40211f; color: #ffd9d5; display: flex; gap: 8px; align-items: flex-start; }
.note a { color: inherit; }

.scenario { margin-top: 20px; }
.scenario h3 { margin: 0; font-size: 14px; font-weight: 650; }
.route { color: #a3a3a3; font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.row { display: flex; align-items: center; gap: 8px; }
.link { padding: 0; border: 0; background: none; color: #8ab4ff; font-size: 13px; text-decoration: underline; }
.why { margin: 4px 0 0; color: #a3a3a3; font-size: 12px; }
.empty { margin-top: 16px; }
.attach { display: flex; gap: 14px; margin-top: 8px; }
.shot { display: flex; align-items: flex-end; gap: 12px; margin-top: 8px; }
.shot img { max-width: 140px; max-height: 96px; border: 1px solid #444; border-radius: 6px; object-fit: cover; }

.steps { list-style: none; margin: 10px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.step { padding: 12px; border: 1px solid #2f2f2f; border-radius: 12px; background: #202020; }
.step.pass { border-color: #2f5a3f; }
.step.fail { border-color: #6b302b; }
.step p { margin: 0; }
.expect { margin-top: 4px !important; color: #b5b5b5; font-size: 13px; }
.actions { display: flex; gap: 8px; margin-top: 10px; }
.btn { height: 34px; padding: 0 14px; border: 1px solid #444; border-radius: 9px; background: #2a2a2a; font-weight: 600; font-size: 13px; }
.btn:hover:not(:disabled) { background: #333; }
.btn.on.pass { background: #1f5c36; border-color: #2f8a52; }
.btn.on.fail { background: #7a2a23; border-color: #b0443a; }
.btn.primary { background: #8ab4ff; border-color: #8ab4ff; color: #0b1a33; }
.btn.primary:hover:not(:disabled) { background: #a3c4ff; }
.who { margin-top: 8px !important; color: #a3a3a3; font-size: 12px; }

textarea, input[type='text'] {
  width: 100%; margin-top: 8px; padding: 9px 10px; border: 1px solid #444; border-radius: 9px;
  background: #141414; resize: vertical;
}
textarea { min-height: 72px; }
label { display: block; margin-top: 12px; color: #c9c9c9; font-size: 13px; }
.foot { margin-top: 28px; padding-top: 16px; border-top: 1px solid #2c2c2c; }
.foot h3 { margin: 0; font-size: 14px; font-weight: 650; }
@media (prefers-reduced-motion: no-preference) {
  .panel { animation: tt-in .16s ease-out; }
  @keyframes tt-in { from { transform: translateX(16px); opacity: 0; } to { transform: none; opacity: 1; } }
}
`
