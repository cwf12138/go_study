const fs = require('node:fs'), path = require('node:path');
if (Number(process.versions.node.split('.')[0]) < 22) throw Error('Android 构建需要 Node.js 22+；不会修改电脑上的 Go 环境。');
const root = path.resolve(__dirname, '..'), assets = path.resolve(root, '../internal/httpapi/assets'), out = path.join(root, 'www');
fs.mkdirSync(path.join(out, 'static'), { recursive: true });
// Public frontend assets only; never package data/, .env or signing credentials.
fs.cpSync(assets, path.join(out, 'static'), { recursive: true, filter: source => !/[/\\](?:\.env|data|node_modules)(?:[/\\]|$)/.test(source) });
let html = fs.readFileSync(path.join(assets, 'index.html'), 'utf8');
html = html.replace('<head>', '<head>\n    <script src="/mobile-bridge.js"></script>');
html = html.replace('</head>', '    <link rel="stylesheet" href="/mobile.css">\n  </head>');
html = html.replace('width=device-width, initial-scale=1', 'width=device-width, initial-scale=1, viewport-fit=cover');
html = html.replace(/<script src="([^"]+)" defer><\/script>/g, '<script type="text/daynest-deferred" data-mobile-src="$1"></script>');
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(path.join(root, 'src/mobile.css'), path.join(out, 'mobile.css'));
require('esbuild').buildSync({ entryPoints: [path.join(root, 'src/native-entry.js')], outfile: path.join(out, 'mobile-bridge.js'), bundle: true, format: 'iife', target: 'es2022', platform: 'browser', sourcemap: false, legalComments: 'eof' });
console.log('Android web bundle ready: mobile/www (no user data included).');
