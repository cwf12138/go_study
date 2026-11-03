'use strict';
// Public reader shell only. No tokens, API responses, documents or app routes.
const CACHE='daynest-read-shell-v1-20261103',ASSETS=['/offline/','/static/read-cache-core.js?v=20261103-1','/static/offline-reader.js?v=20261103-1','/static/offline-reader.css?v=20261103-1'];
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);try{await cache.addAll(ASSETS);}catch(error){await caches.delete(CACHE);throw error;}await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('daynest-read-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim();})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||!ASSETS.includes(url.pathname+url.search))return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE),cached=await cache.match(event.request);if(url.pathname!=='/offline/'&&cached)return cached;
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2500);try{const response=await fetch(event.request,{signal:controller.signal,cache:'no-store'});if(response.status>=500&&cached)return cached;return response;}catch(error){if(cached)return cached;throw error;}finally{clearTimeout(timer);}})());
});
