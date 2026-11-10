const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
function configuredSDK(root){
 const properties=path.join(root,'android/local.properties');
 if(fs.existsSync(properties)){
  const value=fs.readFileSync(properties,'utf8').match(/^\s*sdk\.dir\s*=\s*(.+)\s*$/m)?.[1];
  if(value)return value.trim().replace(/\\([\\:= ])/g,'$1');
 }
 return process.env.ANDROID_SDK_ROOT||process.env.ANDROID_HOME||(process.platform==='win32'?path.join(process.env.LOCALAPPDATA||os.homedir(),'Android','Sdk'):'');
}
function inspect({root=path.resolve(__dirname,'..'),sdk,nodeVersion=process.versions.node,javaVersion}={}){
 sdk=sdk??configuredSDK(root);
 let javaProbeError=null;
 if(javaVersion===undefined){const executable=process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',process.platform==='win32'?'java.exe':'java'):'java';const result=spawnSync(executable,['-version'],{encoding:'utf8',timeout:10000,windowsHide:true});javaVersion=result.error?'':String(result.stdout||'')+String(result.stderr||'');if(result.error)javaProbeError=result.error.code==='EPERM'?'permission_denied':result.error.code==='ENOENT'?'not_found':'probe_failed';}
 const match=String(javaVersion).match(/(?:version\s+"?|openjdk\s+)(\d+)/),javaMajor=match?Number(match[1]):null;
 const variables=fs.readFileSync(path.join(root,'android/variables.gradle'),'utf8'),compile=Number(variables.match(/compileSdkVersion\s*=\s*(\d+)/)?.[1]);
 const check=(name,ok,help)=>({name,ok:!!ok,help});
 const tools=sdk&&fs.existsSync(path.join(sdk,'build-tools'))?fs.readdirSync(path.join(sdk,'build-tools')).filter(v=>/^\d+\./.test(v)):[];
 const checks=[check('Node.js 22+',Number(nodeVersion.split('.')[0])>=22,'使用 Node.js 22 或更高版本'),check('JDK 21+',javaMajor>=21,'安装并选择 JDK 21；无法运行 java 时也会报告未通过'),check('Android SDK '+compile,sdk&&fs.existsSync(path.join(sdk,'platforms','android-'+compile,'android.jar')),'在 SDK Manager 安装 platforms;android-'+compile),check('Android Build Tools',tools.some(v=>Number(v.split('.')[0])>=35),'安装工程所需的 Build Tools（流水线同时准备 35.0.0 与 36.0.0）'),check('Capacitor 依赖',fs.existsSync(path.join(root,'node_modules/@capacitor/cli/package.json')),'在 mobile/ 执行 pnpm install --frozen-lockfile'),check('Gradle wrapper',fs.existsSync(path.join(root,'android/gradle/wrapper/gradle-wrapper.jar')),'检查 Android 工程与 Gradle wrapper 文件')];
 return {schema_version:1,checked_at:new Date().toISOString(),ready:checks.every(c=>c.ok),compile_sdk:compile,node_major:Number(nodeVersion.split('.')[0]),java_major:javaMajor,java_probe_error:javaProbeError,checks,apk_built:false,device_verified:false};
}
module.exports={inspect};
if(require.main===module){const result=inspect();if(process.argv.includes('--json'))console.log(JSON.stringify(result,null,2));else{for(const c of result.checks)console.log(`${c.ok?'PASS':'BLOCKED'} ${c.name}${c.ok?'':' — '+c.help}`);console.log(result.ready?'基础条件通过；仍需实际 Gradle 构建和真机验收。':'尚不能生成 APK；检查不会安装 SDK 或修改系统环境。');}process.exitCode=result.ready?0:2;}
