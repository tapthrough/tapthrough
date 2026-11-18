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
  color: var(--text);
  -webkit-font-smoothing: antialiased;
  /* Reviewers paste URLs and IDs; a long one must wrap, not widen the panel. */
  overflow-wrap: anywhere;
}
button, textarea, input { font: inherit; color: inherit; }
button { cursor: pointer; }
button:disabled { cursor: default; opacity: .55; }
:focus-visible { outline: 2px solid var(--tint); outline-offset: 2px; }
[hidden] { display: none !important; }

/* Light like the phone's panel, and dark when the reviewer's system is. */
.root {
  color-scheme: light dark;
  --surface: #ffffff;
  --text: #111114;
  --text-soft: #3c3c43;
  --text2: #6b6b73;
  --text3: #a3a3ab;
  --ring: #c4c4cb;
  --line: #e4e4e9;
  --line2: #cfcfd6;
  --fill: #f4f4f6;
  --fill-hover: #ebebef;
  --fill2: #efeff2;
  --input: #ffffff;
  --tint: #007aff;
  --tint-hover: #0a6fe0;
  --on-tint: #ffffff;
  --tint-fill: #e6f1ff;
  --note: #e8f1ff;
  --note-text: #0b3a75;
  --err: #ffe9e7;
  --err-text: #8a1c13;
  --pass: #2a9d4b;
  --pass-text: #1e8a3e;
  --on-pass: #ffffff;
  --pass-on: #dff5e6;
  --fail: #e5392f;
  --fail-text: #d12b20;
  --on-fail: #ffffff;
  --fail-on: #ffe5e2;
  --shadow: rgba(0, 0, 0, .18);
}
@media (prefers-color-scheme: dark) {
  .root {
    --surface: #1a1a1a;
    --text: #f5f5f5;
    --text-soft: #cfcfcf;
    --text2: #a3a3a3;
    --text3: #777777;
    --ring: #5a5a5a;
    --line: #303030;
    --line2: #484848;
    --fill: #202020;
    --fill-hover: #282828;
    --fill2: #2a2a2a;
    --input: #141414;
    --tint: #8ab4ff;
    --tint-hover: #a3c4ff;
    --on-tint: #0b1a33;
    --tint-fill: #232a36;
    --note: #26303f;
    --note-text: #dbe7ff;
    --err: #40211f;
    --err-text: #ffd9d5;
    --pass: #2f8a52;
    --pass-text: #7ddc9a;
    --on-pass: #06301a;
    --pass-on: #1f5c36;
    --fail: #c2493e;
    --fail-text: #ff8a80;
    --on-fail: #3b0a06;
    --fail-on: #7a2a23;
    --shadow: rgba(0, 0, 0, .45);
  }
}

.launcher {
  /* Bottom middle: clear of the corners, where apps keep their own chat and help buttons. */
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483000;
  display: inline-flex; align-items: center; gap: 8px;
  height: 44px; padding: 0 16px; border: 1px solid var(--line); border-radius: 22px;
  background: var(--surface); color: var(--text); font-weight: 600;
  box-shadow: 0 6px 24px var(--shadow);
}
.badge {
  min-width: 22px; height: 22px; padding: 0 7px; border-radius: 11px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px; font-weight: 700; background: var(--tint); color: var(--on-tint);
}
.badge.failed { background: var(--fail-text); color: var(--on-fail); }
.badge.done { background: var(--pass-text); color: var(--on-pass); }

/*
 * A small card that floats over the page where the Review button was, as tall
 * as what it shows. It never moves or resizes the app underneath.
 */
.panel {
  position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 2147483001;
  width: 400px; max-width: calc(100vw - 24px); max-height: min(560px, calc(100vh - 32px));
  display: flex; flex-direction: column; overflow: hidden;
  background: var(--surface); border: 1px solid var(--line); border-radius: 16px;
  box-shadow: 0 16px 48px var(--shadow);
}
@media (max-width: 520px) {
  .panel { left: 0; bottom: 0; transform: none; width: 100vw; max-width: 100vw; max-height: 85vh; border-width: 1px 0 0; border-radius: 16px 16px 0 0; }
}
.head { display: flex; align-items: flex-start; gap: 8px; padding: 14px 12px 14px 16px; border-bottom: 1px solid var(--line); }
.head h2 { margin: 0; font-size: 16px; font-weight: 650; }
.head h2:focus { outline: none; }
.sub { margin: 2px 0 0; color: var(--text2); font-size: 13px; }
.grow { flex: 1; min-width: 0; }
.icon { flex: none; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--text-soft); font-size: 22px; line-height: 1; }
.icon:hover { background: var(--fill2); }
.fill { flex: 1; min-height: 0; display: flex; flex-direction: column; margin: 0; }
.body { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; padding: 4px 16px 16px; }
.footer { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; padding: 12px 16px 16px; border-top: 1px solid var(--line); }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

.note { margin: 12px 0 0; padding: 10px 12px; border-radius: 10px; background: var(--note); color: var(--note-text); font-size: 13px; }
.note.error { background: var(--err); color: var(--err-text); display: flex; gap: 8px; align-items: flex-start; }
.note a { color: inherit; }
.lead { margin: 14px 0 0; font-size: 15px; }
.caption { margin: 10px 0 0; color: var(--text2); font-size: 12px; }
.action { margin: 16px 0 0; font-size: 17px; font-weight: 650; line-height: 1.35; }
.expect { margin: 8px 0 0; color: var(--text-soft); font-size: 15px; }
.route { margin: 0; color: var(--text-soft); font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
.link { padding: 0; border: 0; background: none; color: var(--tint); font-size: 13px; text-decoration: underline; }
.prev { display: block; margin-top: 18px; }
.attach { display: flex; gap: 14px; margin-top: 8px; }
.shot { display: flex; align-items: flex-end; gap: 12px; margin-top: 8px; }
.shot img { max-width: 140px; max-height: 96px; border: 1px solid var(--line2); border-radius: 6px; object-fit: cover; }

.rows { list-style: none; margin: 12px 0 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
.rowbtn {
  width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border: 1px solid var(--line); border-radius: 12px; background: var(--fill); color: inherit;
  text-align: left; text-decoration: none;
}
button.rowbtn:hover, a.rowbtn:hover { background: var(--fill-hover); }
.rowbtn.static { cursor: default; }
.rowtitle { display: block; font-weight: 600; }
.rowsub { display: block; margin-top: 1px; color: var(--text2); font-size: 12.5px; }
.chev { flex: none; color: var(--text3); font-size: 18px; }
.mark {
  flex: none; width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--ring);
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; line-height: 1;
}
.mark.pass { border-color: var(--pass); background: var(--pass); color: #fff; }
.mark.fail { border-color: var(--fail); background: var(--fail); color: #fff; }
.mark.partial { border-color: var(--tint); background: linear-gradient(90deg, var(--tint) 50%, transparent 50%); }
.mark.redo { border-color: var(--tint); color: var(--tint); font-size: 13px; }
.mark.large { width: 52px; height: 52px; font-size: 26px; }

.section { margin-top: 20px; }
.section h3 { margin: 0 0 8px; color: var(--text2); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.section .sub { margin-top: 6px; }
.numbered { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.numbered li { display: flex; gap: 10px; align-items: flex-start; }
.num {
  flex: none; width: 22px; height: 22px; border-radius: 50%; background: var(--line); color: var(--text-soft);
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700;
}
.numbered .rowtitle { font-weight: 500; }
.done { margin-top: 20px; display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.big { margin: 6px 0 0; font-size: 20px; font-weight: 700; }

.cta {
  width: 100%; min-height: 44px; padding: 8px 16px; border: 1px solid var(--tint); border-radius: 22px;
  background: var(--tint); color: var(--on-tint); font-weight: 650; font-size: 15px;
}
.cta:hover:not(:disabled) { background: var(--tint-hover); border-color: var(--tint-hover); }
.cta.plain { background: transparent; border-color: transparent; color: var(--tint); }
.cta.plain:hover:not(:disabled) { background: var(--tint-fill); border-color: transparent; }
.cta.gray { background: var(--fill2); border-color: var(--line2); color: var(--text); }
.cta.gray:hover:not(:disabled) { background: var(--line); border-color: var(--line2); }
.cta.gray.pass span { color: var(--pass-text); }
.cta.gray.fail span { color: var(--fail-text); }
.cta.gray.pass.on { background: var(--pass-on); border-color: var(--pass); }
.cta.gray.fail.on { background: var(--fail-on); border-color: var(--fail); }
.cta.gray.on span { color: inherit; }

textarea, input[type='text'] {
  width: 100%; margin-top: 8px; padding: 9px 10px; border: 1px solid var(--line2); border-radius: 9px;
  background: var(--input); resize: vertical;
}
textarea { min-height: 96px; }
label { display: block; margin-top: 18px; color: var(--text-soft); font-size: 13px; }
@media (prefers-reduced-motion: no-preference) {
  .panel { animation: tt-in .16s ease-out; }
  @keyframes tt-in { from { translate: 0 12px; opacity: 0; } to { translate: 0 0; opacity: 1; } }
}
`
