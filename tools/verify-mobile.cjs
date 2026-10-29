const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{files,digest}=require('../mobile/scripts/build-info.cjs');
function verify(root=path.resolve(__dirname,'..')){
 const mobile=path.join(root,'mobile'),out=path.join(mobile,'www'),config=JSON.parse(fs.readFileSync(path.join(mobile,'capacitor.config.json'),'utf8')),pkg=JSON.parse(fs.readFileSync(path.join(mobile,'package.json'),'utf8'));
 assert(!config.server.url&&!config.server.allowNavigation,'不能发布指向远程网页的安装包');assert.equal(config.android.allowMixedContent,false);
 const names=files(out);for(const name of names)assert(!/(^|\/)(?:data|node_modules|\.git|\.local|\.env[^/]*)(\/|$)|\.(?:jks|keystore|pem|key)$/i.test(name),'发布目录包含非公开文件');
 const meta=JSON.parse(fs.readFileSync(path.join(out,'client-build.json'),'utf8'));assert.equal(meta.application,'daynest');assert.equal(meta.client,'android');assert.equal(meta.version,pkg.version);assert.equal(meta.version_code,pkg.daynestAndroidVersionCode);assert(/^(unknown|[a-fA-F0-9]{40,64})$/.test(meta.commit));assert(meta.dirty===null||typeof meta.dirty==='boolean');assert(Number.isFinite(Date.parse(meta.built_at)));assert.equal(meta.content_hash,digest(out),'资源已改变，需重新构建');
 const html=fs.readFileSync(path.join(out,'index.html'),'utf8');assert(!/<script src="\/static\//.test(html),'功能脚本必须在连接检查后加载');
 for(const match of html.matchAll(/(?:data-mobile-src|href)="(\/static\/[^"?#]+)[^"]*"/g))assert(fs.existsSync(path.join(out,match[1])),'缺少页面资源 '+match[1]);
 for(const name of ['mobile-bridge.js','mobile.css'])assert(fs.existsSync(path.join(out,name)));
 return {application:'daynest',version:meta.version,commit:meta.commit,dirty:meta.dirty,resource_files:names.length,content_hash:meta.content_hash,apk_built:false,device_verified:false};
}
module.exports={verify};
if(require.main===module){try{console.log(JSON.stringify(verify(),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
