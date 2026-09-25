(() => {
  "use strict";
  // Kept independent of any feature page so retiring a page cannot remove search.
  const dialog = document.getElementById("command-dialog");
  const input = document.getElementById("command-input");
  const results = document.getElementById("command-results");
  const trigger = document.getElementById("command-trigger");
  if (!dialog || !input || !results || !trigger) return;
  let items = [], selected = 0, opener = null;
  const navigate = view => document.querySelector(`.nav-link[data-view="${view}"]`)?.click();
  function catalog(query) {
    const pages = [...document.querySelectorAll(".nav-link[data-view]")].map(button => ({
      title: button.textContent.trim(), hint: "打开页面", run: () => button.click(),
    }));
    const actions = [
      { title: "新建备忘录", hint: "随时记录想法", run: () => { navigate("memos"); document.getElementById("memo-new")?.click(); } },
      { title: "添加待办", hint: "写下下一件小事", run: () => { navigate("todo"); document.getElementById("todo-title")?.focus(); } },
      { title: "开始专注", hint: "留一段自己的时间", run: () => { navigate("focus"); document.getElementById("focus-minutes")?.focus(); } },
    ];
    const matches = [...actions, ...pages].filter(item => `${item.title} ${item.hint}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    if (query) matches.push({ title: `搜索备忘录：${query}`, hint: "搜索标题和正文", run: () => {
      navigate("memos");
      document.dispatchEvent(new CustomEvent("daynest:search-memos", { detail: { query } }));
    } });
    return matches;
  }
  function render() {
    items = catalog(input.value.trim()); selected = 0;
    results.replaceChildren();
    items.forEach((item, index) => {
      const button = document.createElement("button"); button.type = "button"; button.className = "command-item";
      const title = document.createElement("strong"), hint = document.createElement("small");
      title.textContent = item.title; hint.textContent = item.hint;
      button.append(title, hint); button.addEventListener("click", () => execute(index)); results.append(button);
    });
    highlight();
  }
  function highlight() {
    [...results.children].forEach((button, index) => button.classList.toggle("active", index === selected));
    results.children[selected]?.scrollIntoView({ block: "nearest" });
  }
  function execute(index) {
    if (!localStorage.getItem("studyflow.token")) { dialog.close(); return; }
    const action = items[index]; if (!action) return;
    dialog.close(); action.run();
  }
  function open() {
    if (!localStorage.getItem("studyflow.token") || dialog.open) return;
    opener = document.activeElement; input.value = "";
    dialog.showModal(); render(); input.focus();
  }
  dialog.setAttribute("aria-label", "快捷导航与搜索");
  input.setAttribute("aria-label", "查找页面、操作或备忘录");
  trigger.addEventListener("click", open);
  input.addEventListener("input", render);
  input.addEventListener("keydown", event => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length; highlight();
    } else if (event.key === "Enter") { event.preventDefault(); execute(selected); }
  });
  document.addEventListener("keydown", event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); open(); }
  });
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => { if (document.activeElement === document.body || dialog.contains(document.activeElement)) opener?.focus(); });
  document.getElementById("logout")?.addEventListener("click", () => { dialog.close(); input.value = ""; results.replaceChildren(); items = []; });
})();
