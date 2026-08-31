/* Точка красоты. Волосы — service worker.
   Задача одна: кабинет должен открываться без интернета. Данные он и так
   держит в памяти телефона, сеть нужна только чтобы отдать сам файл.

   Стратегия: сначала сеть, потом кэш. Так мастер получает свежую версию,
   когда интернет есть, и рабочую — когда его нет. Обратный порядок
   («сначала кэш») быстрее, но оставляет её со старой версией надолго. */

var CACHE = 'tochka-volosy-v17';
var FILES = [
  './',
  './index.html',
  './instrukciya.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png'
];

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      /* по одному: если какого-то файла в репозитории нет, установка
         не должна падать целиком */
      return Promise.all(FILES.map(function(f){
        return c.add ? c.add(f).catch(function(){}) : c.put(f, new Response('')).catch(function(){});
      }));
    }).then(function(){ return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ return k === CACHE ? null : caches.delete(k); }));
    }).then(function(){ return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function(res){
      if(res && res.ok){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(hit){
        if(hit) return hit;
        /* переход по адресу без интернета и без точного совпадения:
           отдаём кабинет */
        if(req.mode === 'navigate') return caches.match('./index.html');
        return new Response('Нет сети', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
      });
    })
  );
});
