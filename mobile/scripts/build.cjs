const fs = require('node:fs'), path = require('node:path');
if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Android 构建需要 Node.js 22+；不会修改电脑上的 Go 环境。');
const root = path.resolve(__dirname, '..'), assets = path.resolve(root, '../internal/httpapi/assets'), out = path.join(root, 'www');
// Only this generated directory is cleaned; refuse links or an unexpected target.
if(path.dirname(out)!==root||path.relative(root,out)!=='www')throw Error('生成目录越界');
if(fs.existsSync(out)){if(fs.lstatSync(out).isSymbolicLink()||!fs.realpathSync(out).startsWith(fs.realpathSync(root)+path.sep))throw Error('生成目录必须位于 mobile/ 内且不能是链接');fs.rmSync(out,{recursive:true,force:true});}
fs.mkdirSync(path.join(out, 'static'), { recursive: true });
// Public frontend assets only; never package data/, .env or signing credentials.
fs.cpSync(assets, path.join(out, 'static'), { recursive: true, filter: source => {if(fs.lstatSync(source).isSymbolicLink())throw Error('公开资源不能包含符号链接');return !/[/\\](?:\.env[^/\\]*|data|node_modules|\.git|\.local)(?:[/\\]|$)/.test(source)&&!/[.](?:jks|keystore|pem|key)$/i.test(source);} });
let html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
html = html.replace('本界面直接连接当前 Go 服务，不依赖 Node、npm 或前端构建工具。', '登录你的账号，随时继续日程、待办与记录。');
html = html.replace(/type="email"/g, 'type="email" inputmode="email" autocapitalize="none" autocorrect="off" spellcheck="false"');
html = html.replace('<head>', '<head>\n    <script src="/mobile-bridge.js"></script>');
html = html.replace('</head>', '    <link rel="stylesheet" href="/mobile.css">\n  </head>');
html = html.replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover');
html = html.replace(/<script src="([^"]+)" defer><\/script>/g, '<script type="text/daynest-deferred" data-mobile-src="$1"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(root, 'src/mobile.css'), path.join(out, 'mobile.css'));
require('esbuild').buildSync({ entryPoints: [path.join(root, 'src/native-entry.js')], outfile: path.join(out, 'mobile-bridge.js'), bundle: true, format: 'iife', target: 'es2022', platform: 'browser', sourcemap: false, legalComments: 'eof' });
const meta=require('./build-info.cjs').metadata(path.dirname(root),out,JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')));
fs.writeFileSync(path.join(out,'client-build.json'),JSON.stringify(meta,null,2)+'\n');
console.log('Android web bundle ready: mobile/www (no user data included).');
