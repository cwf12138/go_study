(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.DaynestReadCacheCore=api;})(typeof window==='undefined'?globalThis:window,()=>{
  'use strict';
  const prefix='daynest.read-cache.v1:',MAX_BYTES=1024*1024,MAX_NOTE_BYTES=240*1024,MAX_NOTES=20;
  const bytes=value=>new TextEncoder().encode(value).length,id=value=>typeof value==='string'&&/^[\w-]{1,160}$/.test(value);
  function origin(value){const url=new URL(value);if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('离线资料的服务地址无效。');return url.origin;}
  // SHA-256 also works on a trusted LAN HTTP origin without SubtleCrypto.
  // The tag binds local snapshots to a previously verified login; it is not authentication.
  function hash(value){
    const data=new TextEncoder().encode(value),length=Math.ceil((data.length+9)/64)*64,buffer=new Uint8Array(length);buffer.set(data);buffer[data.length]=128;
    const view=new DataView(buffer.buffer);view.setUint32(length-4,data.length*8>>>0);view.setUint32(length-8,Math.floor(data.length*8/4294967296));
    const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
    const h=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],w=new Uint32Array(64),rot=(x,n)=>(x>>>n)|(x<<(32-n));
    for(let offset=0;offset<length;offset+=64){for(let i=0;i<16;i++)w[i]=view.getUint32(offset+i*4);for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=(w[i-16]+(rot(a,7)^rot(a,18)^(a>>>3))+w[i-7]+(rot(b,17)^rot(b,19)^(b>>>10)))>>>0;}
      let[a,b,c,d,e,f,g,z]=h;for(let i=0;i<64;i++){const t1=(z+(rot(e,6)^rot(e,11)^rot(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rot(a,2)^rot(a,13)^rot(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}[a,b,c,d,e,f,g,z].forEach((v,i)=>h[i]=(h[i]+v)>>>0);
    }return h.map(v=>v.toString(16).padStart(8,'0')).join('');
  }
  function version(value){const m=typeof value==='string'&&value.match(/^(.*:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/);if(!m||!Number.isFinite(Date.parse(m[1]+m[3])))throw Error('备忘录版本时间无效。');return BigInt(Date.parse(m[1]+m[3]))*1000000n+BigInt((m[2]||'').padEnd(9,'0'));}
  function note(value,user){
    if(!value||!id(value.id)||value.user_id!==user||typeof value.title!=='string'||value.title.length>320||typeof value.content!=='string'||value.content.length>200000||(value.tags!==null&&(!Array.isArray(value.tags)||value.tags.length>100||value.tags.some(t=>typeof t!=='string'||t.length>200)))||typeof value.archived!=='boolean'||value.deleted_at)throw Error('备忘录内容不适合加入离线阅读库。');
    version(value.updated_at);version(value.created_at);
    return{id:value.id,user_id:user,title:value.title,content:value.content,tags:[...(value.tags||[])],archived:value.archived,created_at:value.created_at,updated_at:value.updated_at};
  }
  function scope(server,user){if(!id(user))throw Error('请先核验当前账号。');return encodeURIComponent(JSON.stringify([origin(server),user]));}
  const identityKey=server=>prefix+'identity:'+encodeURIComponent(origin(server));
  function identify(storage,account,name,now=Date.now()){
    const server=origin(account.server);if(!id(account.userID)||typeof account.token!=='string'||!account.token||account.token.length>16000)throw Error('请先在线登录再开启离线保留。');
    const data={schema_version:1,server,userID:account.userID,name:String(name||'我的资料').slice(0,160),credentialTag:hash(account.token),verifiedAt:new Date(now).toISOString()};storage.setItem(identityKey(server),JSON.stringify(data));return data;
  }
  function resolve(storage,server,token){
    server=origin(server);if(typeof token!=='string'||!token||token.length>16000)return null;
    const raw=storage.getItem(identityKey(server));if(!raw)return null;if(raw.length>4096)throw Error('离线资料的账号索引损坏。');
    const data=JSON.parse(raw);if(data?.schema_version!==1||data.server!==server||!id(data.userID)||typeof data.name!=='string'||data.name.length>160||!Number.isFinite(Date.parse(data.verifiedAt)))throw Error('离线资料的账号索引损坏。');
    return data.credentialTag===hash(token)?data:null;
  }
  function create(storage,server,user,now=()=>Date.now()){
    server=origin(server);const key=prefix+'book:'+scope(server,user),empty=()=>({schema_version:1,server,userID:user,enabled:false,entries:[]});
    function read(){const raw=storage.getItem(key);if(!raw)return empty();if(bytes(raw)>MAX_BYTES)throw Error('本机阅读库超过容量限制，请清空后重新保留。');
      const data=JSON.parse(raw);if(data?.schema_version!==1||data.server!==server||data.userID!==user||typeof data.enabled!=='boolean'||!Array.isArray(data.entries)||data.entries.length>MAX_NOTES)throw Error('本机阅读库损坏；可明确清空后重新保留。');
      const seen=new Set();for(const item of data.entries){item.note=note(item.note,user);if(seen.has(item.note.id)||!Number.isFinite(Date.parse(item.readAt)))throw Error('本机阅读库索引损坏。');seen.add(item.note.id);}return data;
    }
    function write(data){const raw=JSON.stringify(data);if(bytes(raw)>MAX_BYTES)throw Error('本机阅读库已满。');storage.setItem(key,raw);}
    function setEnabled(enabled){const data=enabled?read():empty();data.enabled=!!enabled;write(data);return data;}
    function put(value){const data=read();if(!data.enabled)return{stored:false,reason:'disabled'};const safe=note(value,user);if(bytes(JSON.stringify(safe))>MAX_NOTE_BYTES)return{stored:false,reason:'too_large'};
      const old=data.entries.find(item=>item.note.id===safe.id);if(old&&version(old.note.updated_at)>version(safe.updated_at))return{stored:false,reason:'older'};
      if(old&&version(old.note.updated_at)===version(safe.updated_at)&&JSON.stringify(old.note)!==JSON.stringify(safe))return{stored:false,reason:'same_version_conflict'};
      const item={note:safe,readAt:new Date(now()).toISOString()},entries=[item,...data.entries.filter(entry=>entry.note.id!==safe.id)].sort((a,b)=>Date.parse(b.readAt)-Date.parse(a.readAt));data.entries=entries.slice(0,MAX_NOTES);
      let evicted=entries.length-data.entries.length;while(bytes(JSON.stringify(data))>MAX_BYTES&&data.entries.length>1){data.entries.pop();evicted++;}write(data);return{stored:true,evicted};
    }
    function remove(noteID){const data=read(),entries=data.entries.filter(item=>item.note.id!==noteID);if(entries.length===data.entries.length)return;data.entries=entries;write(data);}
    function forget(){storage.removeItem(key);const raw=storage.getItem(identityKey(server));if(raw){const data=JSON.parse(raw);if(data.userID===user)storage.removeItem(identityKey(server));}}
    return{read,put,remove,setEnabled,forget,key};
  }
  return{hash,version,note,origin,scope,identify,resolve,create,prefix,MAX_BYTES,MAX_NOTES,MAX_NOTE_BYTES,bytes};
});
