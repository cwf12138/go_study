(() => {
  'use strict';
  // Presentation only. Never delay saving a reminder or change its deadline.
  const active = new Map(), disclosures = new Map();
  const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const ease = 'cubic-bezier(.22,1,.36,1)';
  function cancel(node) { active.get(node)?.end(false); }
  function play(node, frames, duration, done = () => {}) {
    cancel(node);
    if (!node || preference?.matches || document.hidden || typeof node.animate !== 'function') { done(true); return; }
    let animation;
    try { animation = node.animate(frames,{duration,easing:ease,fill:'both'}); }
    catch { done(true); return; }
    if (!animation.finished?.then) { animation.cancel(); done(true); return; }
    const record = { end(success) {
      if (active.get(node) !== record) return;
      active.delete(node); animation.cancel(); done(success);
    } };
    active.set(node,record);
    // cancel() rejects finished; handle both paths, including account cleanup.
    animation.finished.then(() => record.end(true), () => record.end(false));
  }
  function sampled(node) {
    const s = window.getComputedStyle?.(node);
    return {opacity:s?.opacity || '1',transform:s?.transform || 'none'};
  }
  function dialog(node, show, onClosed = () => {}) {
    const wasOpen = node.open, from = sampled(node);
    if (!show && (!wasOpen || node.dataset.motion === 'closing')) return;
    cancel(node);
    if (show && !wasOpen) node.showModal();
    node.dataset.motion = show ? 'opening' : 'closing';
    const hidden = {opacity:0,transform:'translateY(16px) scale(.978)'};
    play(node,[wasOpen ? from : hidden,show ? {opacity:1,transform:'none'} : hidden],show ? 280 : 170,success => {
      delete node.dataset.motion;
      if (success && !show) { node.close(); onClosed(); }
    });
  }
  function reveal(node, show, immediate = false, done = () => {}) {
    if (immediate) { cancel(node); node.hidden = !show; node.inert = !show; done(); return; }
    const record = active.get(node);
    if (record?.target === show) return;
    if (!record && node.hidden === !show) { done(); return; }
    const from = sampled(node), wasHidden = node.hidden;
    cancel(node);
    node.hidden = false; node.inert = !show;
    const hidden = {opacity:0,transform:'translateY(10px) scale(.985)'};
    play(node,[wasHidden ? hidden : from,show ? {opacity:1,transform:'none'} : hidden],show ? 260 : 160,success => {
      if (success) { node.hidden = !show; node.inert = !show; done(); }
    });
    if (active.has(node)) active.get(node).target = show;
  }
  function disclosure(details) {
    const summary = details.querySelector('summary'), body = details.querySelector('.gr-disclosure-body');
    if (!summary || !body) return;
    summary.setAttribute('aria-expanded',String(details.open));
    details.addEventListener('toggle',() => {
      if (disclosures.has(details)) return;
      summary.setAttribute('aria-expanded',String(details.open)); body.inert = !details.open;
    });
    summary.addEventListener('click',event => {
      event.preventDefault();
      const target = !(disclosures.get(details)?.target ?? details.open);
      const height = details.open ? body.getBoundingClientRect().height : 0;
      cancel(body); details.open = true;
      summary.setAttribute('aria-expanded',String(target));
      body.inert = !target;
      if (!target && body.contains(document.activeElement)) summary.focus();
      const state = {target}; disclosures.set(details,state);
      body.style.overflow = 'hidden';
      play(body,[{height:`${height}px`,opacity:height ? 1 : 0},{height:`${target ? body.scrollHeight : 0}px`,opacity:target ? 1 : 0}],target ? 250 : 190,success => {
        body.style.overflow = '';
        if (disclosures.get(details) === state) {
          disclosures.delete(details);
          if (success) details.open = target;
        }
      });
    });
  }
  function pulse(node, kind = 'settle') {
    if (!node) return;
    const frames = kind === 'confirm' ? [{transform:'scale(1)'},{transform:'scale(1.07)',offset:.4},{transform:'scale(1)'}] :
      [{opacity:.65,transform:'translateY(3px)'},{opacity:1,transform:'none'}];
    play(node,frames,kind === 'confirm' ? 320 : 220);
  }
  function remove(node,done) {
    const height = node.getBoundingClientRect().height;
    play(node,[{height:`${height}px`,opacity:1,overflow:'hidden'},
      {height:'0px',opacity:0,paddingTop:'0px',paddingBottom:'0px',overflow:'hidden'}],190,success=>{ if (success) done(); });
  }
  function reset() {
    const pending = [...disclosures];
    for (const record of [...active.values()]) record.end(false);
    for (const [details,state] of pending) { details.open = state.target; }
    disclosures.clear();
  }
  function finish() { for (const record of [...active.values()]) record.end(true); }
  preference?.addEventListener?.('change',() => { if (preference.matches) finish(); });
  document.addEventListener('visibilitychange',() => { if (document.hidden) finish(); });
  window.DaynestReminderMotion = {dialog,reveal,disclosure,pulse,remove,reset,cancel};
})();
