// ShopFlow service worker — la app abre SIN internet (mecánico móvil = señal mala).
// Estrategia: index.html va red-primero (siempre fresco online, cache offline);
// CDN y assets van cache-primero. Sube CACHE_V cuando cambie la estrategia.
var CACHE_V='shopflow-v12';

self.addEventListener('install',function(e){
  e.waitUntil(
    caches.open(CACHE_V)
      .then(function(c){return c.addAll(['./','./index.html','./manifest.json']);})
      .then(function(){return self.skipWaiting();})
  );
});

self.addEventListener('activate',function(e){
  e.waitUntil(
    caches.keys()
      .then(function(keys){return Promise.all(keys.filter(function(k){return k!==CACHE_V;}).map(function(k){return caches.delete(k);}));})
      .then(function(){return self.clients.claim();})
  );
});

self.addEventListener('fetch',function(e){
  var req=e.request;
  if(req.method!=='GET')return;
  var url=new URL(req.url);

  // API de GitHub (respaldo en la nube): SIEMPRE red directa, nunca caché.
  // Cachearlo dejaba el "sha" viejo y todo respaldo daba HTTP 409. NO tocar.
  if(url.hostname==='api.github.com'){e.respondWith(fetch(req));return;}

  // App shell: red primero (deploy de GitHub Pages llega al instante), cache si no hay señal
  if(url.origin===location.origin&&(req.mode==='navigate'||url.pathname.endsWith('/index.html')||url.pathname.endsWith('/'))){
    e.respondWith(
      fetch(req).then(function(r){
        var cp=r.clone();
        caches.open(CACHE_V).then(function(c){c.put('./index.html',cp);});
        return r;
      }).catch(function(){return caches.match('./index.html');})
    );
    return;
  }

  // Todo lo demás (jsPDF/ZXing CDN, iconos, fuentes): cache primero, red de respaldo
  e.respondWith(
    caches.match(req).then(function(hit){
      if(hit)return hit;
      return fetch(req).then(function(r){
        if(r&&(r.ok||r.type==='opaque')){
          var cp=r.clone();
          caches.open(CACHE_V).then(function(c){c.put(req,cp);});
        }
        return r;
      });
    })
  );
});
