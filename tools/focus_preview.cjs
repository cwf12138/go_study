// Local-only visual fixture. No real accounts, API requests, or snapshot writes.
// Run: node tools/focus_preview.cjs  ; open http://127.0.0.1:18081
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assets = path.join(__dirname, '../internal/httpapi/assets');
const init = String.raw`
  const preview = new URLSearchParams(location.search);
  document.documentElement.dataset.theme = preview.get('theme') === 'dark' ? 'dark' : 'light';
  state.user = { id: 'visual-fixture', name: '预览账号' }; state.token = ''; state.focus = null;
  state.currentView = 'focus'; state.dailyFocusGoalMinutes = 60;
  state.dashboard = { focus_minutes_today: 35, focus_minutes_week: 185 };
  state.tasks = [{id:'preview-task',title:'读完一章书，写下三个新的想法',status:'todo',priority:'medium',estimated_minutes:25},
    {id:'preview-task-2',title:'整理周末旅行计划',status:'todo',priority:'low',estimated_minutes:15}];
  persistFocus = () => {}; refresh = async () => {};
  let session = null;
  function sample(body = {}) { return { id:'preview-session',planned_minutes:body.planned_minutes || 25,
    task_id:body.task_id || '', break_enabled:!!body.break_enabled,break_minutes:5,
    phase:body.break_enabled?'focus_first':'focus',phase_remaining_seconds:(body.planned_minutes || 25)*60/(body.break_enabled?2:1),
    phase_started_at:new Date().toISOString(),started_at:new Date().toISOString(),status:'running' }; }
  api = async (url, options = {}) => {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (url.endsWith('/active')) return session;
    if (url === '/api/v1/focus-sessions') { session = sample(JSON.parse(options.body)); return session; }
    if (url.endsWith('/pause')) { session = {...session,status:'paused',phase_remaining_seconds:phaseRemainingSeconds(state.focus)}; return session; }
    if (url.endsWith('/resume')) { session = {...session,status:'running',phase_started_at:new Date().toISOString()}; return session; }
    if (url.endsWith('/finish')) { session=null; return {}; }
    if (url.endsWith('/advance')) { session={...session,phase:session.phase==='focus_first'?'break':'focus_second',phase_started_at:new Date().toISOString(),phase_remaining_seconds:session.phase==='focus_first'?300:session.planned_minutes*30};return session; }
    throw Error('独立视觉预览：只支持专注会话模拟操作');
  };
  $('#auth-view').classList.add('hidden'); $('#app-view').classList.remove('hidden');
  $$('.panel').forEach(p=>p.classList.toggle('active',p.id==='panel-focus'));
  $$('.nav-link').forEach(b=>b.classList.toggle('active',b.dataset.view==='focus'));
  $('#page-title').textContent='专注会话'; $('#page-kicker').textContent='FOCUS'; $('#user-name').textContent='视觉预览';
  $('#app-sync-status').textContent='模拟数据 · 不连接真实 API';
  $('#focus-task').innerHTML='<option value="">不关联任务</option><option value="preview-task">读完一章书，写下三个新的想法</option><option value="preview-task-2">整理周末旅行计划</option>';
  $('#focus-break-enabled').checked=true;
  const mode=preview.get('mode');
  if (mode==='running'||mode==='paused'||mode==='break') {
    session=sample({planned_minutes:25,break_enabled:true,task_id:'preview-task'});
    if(mode==='paused')session.status='paused';
    if(mode==='break'){session.phase='break';session.phase_remaining_seconds=300;}
    syncActiveFocus(session);
  }
  bindEvents(); renderFocus(); setInterval(updateFocusClock,250);
`;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1:18081');
  res.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/fixture.js') {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    return res.end(fs.readFileSync(path.join(assets, 'app.js'), 'utf8').replace('  bootstrap();', init));
  }
  if (url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.searchParams.get('mobile') === '1') {
      url.searchParams.delete('mobile');
      return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>专注 · 手机预览</title><body style="margin:0;background:#e9ece8;display:grid;place-items:center"><iframe title="390px 手机预览" style="width:390px;height:900px;border:0" src="/' + url.search + '"></iframe></body></html>');
    }
    let html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    html = html.replace('</body>', '<script src="/fixture.js"></script></body>').replace('<title>StudyFlow · 学习控制台</title>', '<title>专注空间 · 独立视觉预览</title>');
    return res.end(html);
  }
  const name = url.pathname.slice('/static/'.length);
  if (!url.pathname.startsWith('/static/') || !/^[a-zA-Z0-9-]+\.css$/.test(name)) { res.writeHead(404); return res.end(); }
  const file = path.join(assets, name);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.setHeader('Content-Type', 'text/css; charset=utf-8'); res.end(fs.readFileSync(file));
});
server.listen(18081, '127.0.0.1', () => console.log('Focus fixture: http://127.0.0.1:18081 (mode=paused|running|break, theme=dark, mobile=1)'));
