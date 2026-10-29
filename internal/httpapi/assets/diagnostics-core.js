(() => {
  'use strict';
  const zero=value=>typeof value==='string'&&value.startsWith('0001-01-01T00:00:00');
  const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
  const states=['unobserved','write_failed','awaiting_first_write','overdue','recent_write'];
  const validBuild=value=>value&&typeof value.version==='string'&&/^[\w.+-]{1,80}$/.test(value.version)&&typeof value.commit==='string'&&/^(unknown|[a-fA-F0-9]{7,64})$/.test(value.commit)&&(value.dirty===null||typeof value.dirty==='boolean')&&(!value.built_at||validTime(value.built_at));
  function valid(value){
    const p=value?.persistence,o=p?.observation,r=value?.runtime,b=value?.backup;
    return value?.application==='daynest'&&validTime(value.server_time)&&validBuild(value.build)&&value.mobile_protocol===1&&r&&['go','os','arch'].every(k=>typeof r[k]==='string'&&/^[A-Za-z0-9._+-]{1,60}$/.test(r[k]))&&Number.isSafeInteger(r.uptime_seconds)&&r.uptime_seconds>=0&&typeof value.security?.development_key==='boolean'&&value.security.ai_requires_loopback===true&&p?.mode==='periodic_json'&&typeof p.observed==='boolean'&&states.includes(p.state)&&Number.isFinite(p.interval_seconds)&&p.interval_seconds>0&&p.response_means_immediate_disk_write===false&&o&&['last_attempt_at','last_success_at','last_failure_at','loaded_at','loaded_snapshot_at'].every(k=>validTime(o[k]))&&['not_attempted','success','failure'].includes(o.last_result)&&typeof o.in_progress==='boolean'&&typeof o.recovered_from_backup==='boolean'&&Number.isSafeInteger(o.last_duration_ms)&&o.last_duration_ms>=0&&Number.isSafeInteger(o.consecutive_failures)&&o.consecutive_failures>=0&&b?.json_includes_transfer_files===false&&b.json_includes_transfer_metadata===false&&b.complete_backup_requires_stopped_service===true&&b.restore_verified===false;
  }
  function client(value){
    if(value?.application!=='daynest'||value.client!=='android'||!validBuild(value)||!Number.isInteger(value.version_code)||value.version_code<1)return null;
    return {kind:'android',version:value.version,version_code:value.version_code,commit:value.commit,dirty:value.dirty,built_at:value.built_at||'',...(/^[a-f0-9]{64}$/.test(value.content_hash||'')?{content_hash:value.content_hash}:{})};
  }
  function build(value){return {version:value.version,commit:value.commit,dirty:value.dirty,built_at:value.built_at||''};}
  function report(value,clientInfo,fresh){
    if(!valid(value))throw Error('没有可导出的有效诊断');
    const p=value.persistence,o=p.observation;
    const safeClient=clientInfo?.kind==='android'?(client(clientInfoToBuild(clientInfo))||{kind:'android',build_metadata_available:false}):{kind:'web',build_metadata_available:false};
    // An explicit allowlist prevents unknown server fields from entering exports.
    return {schema_version:1,application:'daynest',exported_at:new Date().toISOString(),captured_at:value.server_time,last_check_succeeded:!!fresh,
      server:{build:build(value.build),mobile_protocol:1,runtime:{go:value.runtime.go,os:value.runtime.os,arch:value.runtime.arch,uptime_seconds:value.runtime.uptime_seconds}},
      client:safeClient,
      security:{development_key:value.security.development_key,ai_requires_loopback:true},
      persistence:{mode:'periodic_json',state:p.state,observed:p.observed,interval_seconds:p.interval_seconds,response_means_immediate_disk_write:false,observation:{last_attempt_at:o.last_attempt_at,last_success_at:o.last_success_at,last_failure_at:o.last_failure_at,loaded_at:o.loaded_at,loaded_snapshot_at:o.loaded_snapshot_at,recovered_from_backup:o.recovered_from_backup,in_progress:o.in_progress,last_result:o.last_result,last_duration_ms:o.last_duration_ms,consecutive_failures:o.consecutive_failures}},
      backup:{json_includes_transfer_files:false,json_includes_transfer_metadata:false,complete_backup_requires_stopped_service:true,restore_verified:false}};
  }
  function clientInfoToBuild(value){return {application:'daynest',client:'android',version:value.version,version_code:value.version_code,commit:value.commit,dirty:value.dirty,built_at:value.built_at,content_hash:value.content_hash};}
  const time=value=>!value||zero(value)?'尚无确认记录':new Date(value).toLocaleString('zh-CN',{hour12:false});
  function summary(value){
    const status=value.persistence.state;
    return status==='write_failed'?['写盘失败','最近一次快照失败，请先保留当前输入并检查服务端日志。','error']:status==='overdue'?['较久未确认','最近确认写盘已超过检查阈值，请检查服务状态。','caution']:status==='awaiting_first_write'?['等待首次写盘','本次服务尚未确认常规快照写入；启动时载入或恢复的文件单独显示。','caution']:status==='recent_write'?['近期已确认','近期确认过快照写入；之后的修改仍可能等待下一次快照。','good']:['未观测','当前仓储未提供快照观测，不能判断写盘状态。','neutral'];
  }
  window.DaynestDiagnostics={valid,validBuild,client,report,time,summary};
})();
