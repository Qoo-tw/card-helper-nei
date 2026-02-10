// Simple service worker for offline
const CACHE = "card-helper-gf-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./data/rules.json",
  "./data/merchantmap.json",
  "./data/categorymap.json"
];

self.addEventListener("install", (e)=>{
  e.waitUntil(
    caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
  );
});

self.addEventListener("activate", (e)=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.map(k=>k===CACHE?null:caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", (e)=>{
  const req = e.request;
  e.respondWith(
    caches.match(req).then(hit=>{
      if(hit) return hit;
      return fetch(req).then(res=>{
        // cache same-origin GET
        try{
          const url = new URL(req.url);
          if(req.method==="GET" && url.origin===location.origin){
            const copy = res.clone();
            caches.open(CACHE).then(c=>c.put(req, copy));
          }
        }catch(_){}
        return res;
      }).catch(()=>caches.match("./index.html"));
    })
  );
});
