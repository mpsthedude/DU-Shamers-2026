// Notifications only: deliberately no fetch handler or cached account/API responses.
self.addEventListener('push', event => {
  let data={};try{data=event.data?.json() || {};}catch{}
  event.waitUntil(self.registration.showNotification('DU Shamers', {
    body: typeof data.body==='string' ? data.body.slice(0,200) : 'A ticket needs commissioner review.',
    tag: typeof data.tag==='string' ? data.tag : 'commissioner-ticket',
    icon:'/hub-icon.png', data:{url:'/#commissioner'}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL('/#commissioner',self.location.origin).href;
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows) if(new URL(client.url).origin===self.location.origin){await client.navigate(url);return client.focus();}
    return self.clients.openWindow(url);
  })());
});
