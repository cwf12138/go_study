(function (root, factory) {
  "use strict";
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  else {
    root.DaynestHTTPCore = core;
    root.DaynestHTTP = core.create({
      getContext() {
        const verified = root.DaynestAccount?.current?.();
        return {token:localStorage.getItem("studyflow.token") || "",server:root.DaynestMobile?.getConnectionInfo?.().server || root.location?.origin || "",userID:verified?.userID || "",session:verified?.sessionID ?? null};
      },
      onUnauthorized() { document.dispatchEvent(new CustomEvent("daynest:auth-expired")); },
    });
    const cancel = () => root.DaynestHTTP.cancelStale();
    document.addEventListener("daynest:account-ready", cancel);
    root.addEventListener("storage", e => { if (!e.key || e.key === "studyflow.token") cancel(); });
  }
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  class RequestError extends Error {
    constructor(message, {kind="http",status=0,code="",uncertain=false} = {}) {
      super(message); this.name="DaynestRequestError"; this.kind=kind; this.status=status; this.code=code; this.uncertain=uncertain;
    }
  }
  const same = (a,b) => !!a && !!b && a.token===b.token && a.server===b.server && a.userID===b.userID && a.session===b.session;
  function create(options) {
    const send=options.fetch || ((...args)=>fetch(...args)),schedule=options.setTimeout || ((...args)=>setTimeout(...args)),unschedule=options.clearTimeout || (id=>clearTimeout(id));
    const requests=new Set(); let expired=null;
    function capture() {
      try {
        const c=options.getContext();
        if (!c || typeof c.token!=="string" || typeof c.server!=="string") throw Error();
        return Object.freeze({token:c.token,server:c.server,userID:c.userID || "",session:c.session ?? null});
      } catch (_) { throw new RequestError("无法读取当前登录状态，请检查浏览器权限或重新打开页面。",{kind:"context"}); }
    }
    function current(context) { try { return same(context,capture()); } catch (_) { return false; } }
    function cancelStale() {
      for(const request of requests) if(!current(request.context)) request.controller.abort();
      if(expired&&!current(expired))expired=null;
    }
    function authExpired() { return !!expired && current(expired); }
    function reportUnauthorized(context=capture()) {
      if(!context.token||!current(context))return false;
      if(!same(expired,context)){expired=context;try{options.onUnauthorized?.();}catch(_){} }
      return true;
    }
    function validPath(path) {
      if(typeof path!=="string" || path.length>16000 || !path.startsWith("/api/v1/") || /[\\#\x00-\x20]/.test(path))return false;
      try {const decoded=decodeURIComponent(path.split("?")[0]);return decoded.startsWith("/api/v1/")&&!/[\\\x00-\x20]/.test(decoded)&&!/(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded);}catch(_){return false;}
    }
    function race(promise,signal) {
      if(signal.aborted)return Promise.reject(new Error("aborted"));
      let listener;const aborted=new Promise((_resolve,reject)=>{listener=()=>reject(new Error("aborted"));signal.addEventListener("abort",listener,{once:true});});
      return Promise.race([promise,aborted]).finally(()=>signal.removeEventListener("abort",listener));
    }
    async function json(path, input = {}) {
      const context=input.context || capture(),method=(input.method || "GET").toUpperCase(),write=!["GET","HEAD"].includes(method);
      if(!validPath(path)||!["GET","HEAD","POST","PUT","PATCH","DELETE"].includes(method))throw new RequestError("请求地址或方法不受支持。",{kind:"invalid_request"});
      if(!current(context))throw new RequestError("账号或服务已切换，已忽略旧请求。",{kind:"account_changed"});
      if(same(expired,context))throw new RequestError("登录已过期。未提交内容仍在，请保留或导出后重新登录。",{status:401,code:"unauthorized",kind:"auth"});
      const controller=new AbortController(),entry={context,controller};let timedOut=false,dispatched=false,timer;
      const timeout=input.timeoutMs ?? 25000,maxBytes=input.maxBytes ?? 32*1024*1024;
      if(!Number.isFinite(timeout)||timeout<1||timeout>300000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024)throw new RequestError("请求配置不正确。",{kind:"invalid_request"});
      const cancel=()=>controller.abort();
      requests.add(entry);
      if(input.signal?.aborted)controller.abort();else input.signal?.addEventListener("abort",cancel,{once:true});
      const check=()=>{
        if(!current(context))throw new RequestError("账号或服务已切换，已忽略旧请求结果。",{kind:"account_changed",uncertain:write&&dispatched});
        if(controller.signal.aborted)throw new RequestError(timedOut?"请求超时。保存类操作请先核对结果，避免重复新建。":"请求已取消。已发出的操作请先核对结果。",{kind:timedOut?"timeout":"cancelled",uncertain:write&&dispatched});
      };
      try {
        check();
        let headers,body;
        try {headers=new Headers(input.headers || {});if(context.token)headers.set("Authorization","Bearer "+context.token);else headers.delete("Authorization");body=typeof input.body==="string"?input.body:input.body===undefined?undefined:JSON.stringify(input.body);if(body!==undefined)headers.set("Content-Type","application/json");}
        catch(_){throw new RequestError("请求内容无法编码，请检查填写内容。",{kind:"invalid_request"});}
        timer=schedule(()=>{timedOut=true;controller.abort();},timeout);
        // Writes are never automatically retried, including after cancellation.
        check();dispatched=true;
        const response=await race(send(path,{method,headers,body,signal:controller.signal,cache:"no-store",credentials:"same-origin",redirect:"error"}),controller.signal);
        check();
        if(response.status===401){
          try{if(response.body?.cancel)Promise.resolve(response.body.cancel()).catch(()=>{});}catch(_){}
          reportUnauthorized(context);
          throw new RequestError("登录已过期。未提交内容仍在，请保留或导出后重新登录。",{status:401,code:"unauthorized",kind:"auth"});
        }
        let payload=null;
        if(response.status!==204) {
          try {
            const size=Number(response.headers?.get?.("Content-Length"));
            if(Number.isFinite(size)&&size>maxBytes)throw new RequestError("返回内容过大，请缩小范围后重试。",{kind:"too_large",status:response.status,uncertain:write});
            if(response.body?.getReader&&typeof TextDecoder!=="undefined") {
              const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text="";
              try {while(true){const part=await race(reader.read(),controller.signal);check();if(part.done)break;bytes+=part.value.byteLength;if(bytes>maxBytes)throw new RequestError("返回内容过大，请缩小范围后重试。",{kind:"too_large",status:response.status,uncertain:write});text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();payload=JSON.parse(text);}
              finally {try{if(controller.signal.aborted||bytes>maxBytes)Promise.resolve(reader.cancel()).catch(()=>{});}catch(_){}try{reader.releaseLock();}catch(_){} }
            } else if(typeof response.text==="function") {
              const text=await race(response.text(),controller.signal);check();if(text.length>maxBytes)throw new RequestError("返回内容过大，请缩小范围后重试。",{kind:"too_large",status:response.status,uncertain:write});payload=JSON.parse(text);
            } else payload=await race(response.json(),controller.signal);
          } catch(e) {
            check();
            if(e instanceof RequestError)throw e;
            if(response.ok)throw new RequestError("服务返回了无效数据，请重试并确认两端版本。",{kind:"invalid_response",status:response.status,uncertain:write});
          }
        }
        check();
        if(!response.ok) {
          const status=response.status,code=typeof payload?.error?.code==="string"?payload.error.code:"";
          let message=typeof payload?.error?.message==="string"?payload.error.message.slice(0,240):`请求失败（${status}）。`;
          if(status===409)message="请求与服务当前状态不一致，请保留本机内容并核对。";
          else if(status===429)message="请求较频繁或服务正在忙碌，请稍后再试。";
          throw new RequestError(message,{status,code,kind:"http",uncertain:write&&status>=500});
        }
        if(response.status===204)return null;
        if(!payload||typeof payload!=="object"||!Object.hasOwn(payload,"data"))throw new RequestError("服务返回格式不完整，请确认已重启当前版本的 Go 服务。",{kind:"invalid_response",status:response.status,uncertain:write});
        return input.envelope?payload:payload.data;
      } catch(e) {
        check();
        if(e instanceof RequestError)throw e;
        throw new RequestError("无法连接到服务，请确认电脑与 Go 服务在线。",{kind:"network",uncertain:write&&dispatched});
      } finally {if(timer!==undefined)unschedule(timer);input.signal?.removeEventListener("abort",cancel);requests.delete(entry);}
    }
    return {json,capture,current,cancelStale,authExpired,reportUnauthorized};
  }
  return {create,RequestError};
});
