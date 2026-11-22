(() => {
  'use strict';
  const form = document.getElementById('todo-form');
  const title = document.getElementById('todo-title');
  const steps = document.getElementById('todo-steps');
  const http = window.DaynestHTTP;
  if (!form || !title || !steps || !http) return;

  const assist = document.createElement('section');
  assist.className = 'todo-ai';
  assist.setAttribute('aria-label', 'AI 拆解待办');
  assist.innerHTML = `<div class="todo-ai-heading"><button class="quiet" type="button" data-todo-ai-generate>✦ AI 拆解</button>
    <span>仅将待办标题发送给智谱</span></div>
    <p role="status" hidden></p>
    <div data-todo-ai-preview hidden>
      <fieldset><legend>选择要加入的建议</legend><div data-todo-ai-options></div></fieldset>
      <div class="todo-ai-actions"><button class="quiet" type="button" data-todo-ai-apply>加入步骤</button>
        <button class="text-button" type="button" data-todo-ai-dismiss>收起</button></div>
    </div>`;
  title.closest('label').after(assist);
  const generate = assist.querySelector('[data-todo-ai-generate]');
  const apply = assist.querySelector('[data-todo-ai-apply]');
  const dismiss = assist.querySelector('[data-todo-ai-dismiss]');
  const preview = assist.querySelector('[data-todo-ai-preview]');
  const options = assist.querySelector('[data-todo-ai-options]');
  const status = assist.querySelector('[role="status"]');
  let run;

  function announce(message = '') {
    status.textContent = message;
    status.hidden = !message;
  }
  function clear(message) {
    run?.controller.abort();
    run = undefined;
    generate.disabled = false;
    generate.textContent = '✦ AI 拆解';
    preview.hidden = true;
    options.replaceChildren();
    announce(message);
  }
  const current = job => run === job && http.current(job.context) && title.value.trim() === job.title;
  generate.addEventListener('click', async () => {
    clear();
    if (!title.value.trim()) {
      announce('先写一个待办标题。');
      title.focus();
      return;
    }
    let job;
    try {
      job = run = { title: title.value.trim(), context: http.capture(), controller: new AbortController() };
      form.closest('dialog')?.addEventListener('close', () => clear(), { once: true, signal: job.controller.signal });
      generate.disabled = true;
      generate.textContent = '正在拆解…';
      announce('正在生成建议，你可以继续填写待办。');
      const data = await http.json('/api/v1/todo-assist/steps', {
        method: 'POST', body: { title: job.title }, context: job.context,
        signal: job.controller.signal, timeoutMs: 68_000, maxBytes: 16_384
      });
      if (run !== job) return;
      if (!current(job)) { clear(); return; }
      const suggestions = data?.steps;
      if (!Array.isArray(suggestions) || suggestions.length < 1 || suggestions.length > 6 ||
          suggestions.some(step => typeof step !== 'string' || !step.trim() || [...step].length > 120 || /[\p{Cc}\u2028\u2029]/u.test(step))) {
        clear('服务返回的步骤格式不正确，请重试。');
        return;
      }
      for (const step of suggestions) {
        const row = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = true;
        box.value = step.trim();
        row.append(box, document.createTextNode(box.value));
        options.append(row);
      }
      preview.hidden = false;
      generate.disabled = false;
      generate.textContent = '重新拆解';
      announce(`已生成 ${suggestions.length} 条可选步骤。`);
    } catch (error) {
      if (job && run !== job) return;
      const message = error.status === 404 || error.status === 405 ? '当前服务版本需要更新后才能使用 AI 拆解。'
        : error.kind === 'timeout' ? '生成超时，可以稍后重试。' : error.message;
      clear(message || '生成失败，请稍后重试。');
    }
  });

  apply.addEventListener('click', () => {
    if (!run || !current(run)) { clear(); return; }
    const selected = [...options.querySelectorAll('input:checked')].map(box => box.value);
    if (!selected.length) { announce('请选择至少一个步骤。'); return; }
    const existing = steps.value.split('\n').map(step => step.trim()).filter(Boolean);
    const seen = new Set(existing.map(step => step.toLowerCase()));
    const additions = selected.filter(step => {
      const key = step.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!additions.length) { announce('选中的步骤已经在草稿中。'); return; }
    const trimmed = steps.value.trimEnd();
    const combined = trimmed ? trimmed + '\n' + additions.join('\n') : additions.join('\n');
    if (existing.length + additions.length > 30 || combined.length > steps.maxLength) {
      announce('草稿空间不足，请少选几项或整理现有步骤。');
      return;
    }
    steps.value = combined;
    steps.dispatchEvent(new Event('input', { bubbles: true }));
    clear(`已加入 ${additions.length} 个步骤。保存前可继续编辑。`);
    generate.focus({ preventScroll: true });
  });
  dismiss.addEventListener('click', () => { clear(); generate.focus(); });
  title.addEventListener('input', () => clear());
  form.addEventListener('reset', () => clear());
  document.addEventListener('daynest:account-leaving', () => clear());
  document.addEventListener('daynest:auth-expired', () => clear());
})();
