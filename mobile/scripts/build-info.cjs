const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
function files(root){
 const found=[];function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name);if(item.isSymbolicLink())throw Error('发布目录不能包含符号链接');if(item.isDirectory())walk(file);else if(item.isFile())found.push(path.relative(root,file).split(path.sep).join('/'));}}walk(root);return found.sort();
}
function digest(root){const hash=crypto.createHash('sha256');for(const name of files(root).filter(f=>f!=='client-build.json'))hash.update(name+'\0').update(fs.readFileSync(path.join(root,name)));return hash.digest('hex');}
function metadata(root,out,pkg){
 let commit='unknown',dirty=null;
 try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',timeout:3000,windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();dirty=!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8',timeout:3000,windowsHide:true,stdio:['ignore','pipe','ignore']}).trim();}catch(_){}
 if(!/^[a-fA-F0-9]{40,64}$/.test(commit))commit='unknown';
 if(!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version)||!Number.isSafeInteger(pkg.daynestAndroidVersionCode)||pkg.daynestAndroidVersionCode<1)throw Error('Android 版本元数据无效');
 return {application:'daynest',client:'android',version:pkg.version,version_code:pkg.daynestAndroidVersionCode,commit,dirty,built_at:new Date().toISOString(),content_hash:digest(out)};
}
module.exports={files,digest,metadata};
