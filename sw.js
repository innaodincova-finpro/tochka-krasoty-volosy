/* Точка красоты. Волосы — service worker.
   Задача одна: кабинет должен открываться без интернета. Данные он и так
   держит в памяти телефона, сеть нужна только чтобы отдать сам файл.

   Стратегия: сначала сеть, потом запас. Так мастер получает свежую версию,
   когда интернет есть, и рабочую — когда его нет. Обратный порядок
   («сначала запас») быстрее, но оставляет её со старой версией надолго.

   Три вещи, из-за которых это раньше работало не так, как задумано:

   1. Файл просили у телефона, а не у сервера. Браузер держит свою копию
      десять минут (столько велит GitHub Pages), и всё это время «сначала
      сеть» на самом деле означало «сначала вчерашняя копия». Мастер
      обновляла файлы и не видела изменений. Теперь страница запрашивается
      мимо этой копии.

   2. Ждали сеть без срока. Если интернет «есть», но не отвечает — чужой
      вайфай, платная точка, слабый сигнал, — кабинет не открывался вовсе,
      хотя рабочая копия лежала в запасе. Теперь ждём три секунды.

   3. В запас клали любой ответ с кодом 200. Точка вайфая с окном входа
      отдаёт свою страницу на любой адрес — и она ложилась в запас вместо
      кабинета. После одного захода в такое кафе кабинет переставал
      открываться без интернета. Теперь чужой ответ в запас не попадает. */

var CACHE = 'tochka-volosy-v26';
var FILES = [
  './',
  './index.html',
  './demo.html',
  './instrukciya.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png'
];

var NET_WAIT = 3000;              /* столько ждём сеть, прежде чем открыть из запаса */

self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(CACHE).then(function(c){
      /* по одному: если какого-то файла в репозитории нет, установка
         не должна падать целиком. cache:'reload' — чтобы в запас лёг файл
         с сервера, а не старая копия из памяти браузера */
      return Promise.all(FILES.map(function(f){
        return c.add(new Request(f, {cache: 'reload'})).catch(function(){});
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

/* Ответ засчитывается только если он пришёл с нашего адреса и без
   перенаправления. Страница «войдите в сеть» приходит с чужого адреса
   или после перенаправления — такую в запас не кладём. */
function trustworthy(req, res){
  if(!res || !res.ok || res.type === 'opaque' || res.type === 'opaqueredirect') return false;
  if(res.redirected) return false;
  if(res.url && new URL(res.url).origin !== self.location.origin) return false;
  return true;
}

self.addEventListener('fetch', function(e){
  var req = e.request;
  if(req.method !== 'GET') return;
  var url = new URL(req.url);
  if(url.origin !== self.location.origin) return;

  var navigating = (req.mode === 'navigate');

  /* Страницу берём мимо копии браузера — иначе обновление доходит до
     телефона только через десять минут. Картинки и манифест меняются
     редко, их спрашиваем обычным способом: это экономит мобильный трафик. */
  var ask = navigating ? fetch(req, {cache: 'no-store'}) : fetch(req);

  var withTimeout = new Promise(function(resolve, reject){
    var done = false;
    var timer = setTimeout(function(){ if(!done){ done = true; reject(new Error('долго')); } }, NET_WAIT);
    ask.then(function(res){
      if(done) return;
      done = true; clearTimeout(timer); resolve(res);
    }, function(err){
      if(done) return;
      done = true; clearTimeout(timer); reject(err);
    });
  });

  e.respondWith(
    withTimeout.then(function(res){
      if(trustworthy(req, res)){
        var copy = res.clone();
        caches.open(CACHE).then(function(c){ c.put(req, copy); });
      }
      return res;
    }).catch(function(){
      return caches.match(req).then(function(hit){
        if(hit) return hit;
        /* переход по адресу без интернета и без точного совпадения:
           отдаём кабинет */
        if(navigating) return caches.match('./index.html');
        return new Response('Нет сети', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
      });
    })
  );
});
