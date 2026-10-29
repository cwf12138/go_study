const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {inspect}=require('../mobile/scripts/preflight.cjs'),{metadata,digest}=require('../mobile/scripts/build-info.cjs'),{verify}=require('./verify-mobile.cjs');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'daynest-release-test-'));
try{
 const mobile=path.join(temp,'mobile'),sdk=path.join(temp,'sdk'),out=path.join(mobile,'www');fs.mkdirSync(path.join(mobile,'android/gradle/wrapper'),{recursive:true});fs.mkdirSync(path.join(mobile,'node_modules/@capacitor/cli'),{recursive:true});fs.mkdirSync(path.join(sdk,'platforms/android-36'),{recursive:true});fs.mkdirSync(path.join(sdk,'build-tools/36.0.0'),{recursive:true});fs.mkdirSync(path.join(out,'static'),{recursive:true});
 fs.writeFileSync(path.join(mobile,'android/variables.gradle'),'compileSdkVersion = 36');fs.writeFileSync(path.join(mobile,'android/gradle/wrapper/gradle-wrapper.jar'),'test');fs.writeFileSync(path.join(mobile,'node_modules/@capacitor/cli/package.json'),'{}');fs.writeFileSync(path.join(sdk,'platforms/android-36/android.jar'),'test');
 assert(inspect({root:mobile,sdk,nodeVersion:'24.0.0',javaVersion:'openjdk version "21.0.1"'}).ready);assert(!inspect({root:mobile,sdk,nodeVersion:'16.0.0',javaVersion:'java version "17.0.1"'}).ready);
 const config={server:{hostname:'localhost'},android:{allowMixedContent:false}},pkg={version:'0.1.0',daynestAndroidVersionCode:1};fs.writeFileSync(path.join(mobile,'capacitor.config.json'),JSON.stringify(config));fs.writeFileSync(path.join(mobile,'package.json'),JSON.stringify(pkg));fs.writeFileSync(path.join(out,'index.html'),'<script type="text/daynest-deferred" data-mobile-src="/static/app.js"></script>');fs.writeFileSync(path.join(out,'static/app.js'),'// public');fs.writeFileSync(path.join(out,'mobile-bridge.js'),'// bridge');fs.writeFileSync(path.join(out,'mobile.css'),'body{}');
 const meta=metadata(temp,out,pkg);fs.writeFileSync(path.join(out,'client-build.json'),JSON.stringify(meta));assert.equal(verify(temp).content_hash,digest(out));
 fs.writeFileSync(path.join(out,'static/app.js'),'// changed');assert.throws(()=>verify(temp),/资源已改变/);fs.writeFileSync(path.join(out,'client-build.json'),JSON.stringify(metadata(temp,out,pkg)));assert(verify(temp));
 fs.writeFileSync(path.join(out,'.env.private'),'secret');assert.throws(()=>verify(temp),/非公开文件/);
 const workflow=fs.readFileSync('.github/workflows/check.yml','utf8');assert(workflow.includes('contents: read'));assert(!workflow.includes('pull_request_target'));for(const marker of ['go vet ./...','go test -race ./...','node tools/check.cjs','node tools/verify-mobile.cjs','assembleDebug','apk.sha256'])assert(workflow.includes(marker));
 console.log('Release checks passed: preflight missing requirements, version/hash manifest, changed bundle and private file refusal, least-privilege CI and compile gates. No actual APK/device build.');
}finally{
 // Delete only the unique directory created by this test, after checking its parent.
 if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('daynest-release-test-'))throw Error('Unexpected test cleanup target');
 fs.rmSync(temp,{recursive:true,force:true});
}
