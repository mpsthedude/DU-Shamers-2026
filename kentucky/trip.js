'use strict';
// Check-in is 5 p.m. Eastern (UTC-4) on October 8, independent of viewer timezone.
const tripStart=Date.parse('2026-10-08T17:00:00-04:00');
const tripEnd=Date.parse('2026-10-12T00:00:00-04:00');
function updateCountdown(){
  const now=Date.now();
  const seconds=Math.max(0,Math.floor((tripStart-now)/1000));
  const values={days:Math.floor(seconds/86400),hours:Math.floor(seconds/3600)%24,minutes:Math.floor(seconds/60)%60,seconds:seconds%60};
  for(const [unit,value] of Object.entries(values))document.querySelector('#count-'+unit).textContent=String(value).padStart(2,'0');
  document.querySelector('#countdown-title').textContent=now>=tripEnd?'UNTIL NEXT TIME, BROTHERS':now>=tripStart?'THE DU BOYS ARE ON THE LOOSE':'THE BOYS ARE BACK IN';
  document.querySelector('.countdown-units').hidden=now>=tripStart;
}
updateCountdown();
setInterval(updateCountdown,1000);
// Keep the Friday agenda in one place as the group's remaining details settle.
const stops = [
  {time:'10:00 AM',kind:'DISTILLERY 01',name:'Buffalo Trace',status:'CONFIRMED',text:'Start in Frankfort with a tour at Buffalo Trace. Its working distillery brings the history and science of bourbon together, from production to the oak barrels that shape the whiskey.',url:'https://www.buffalotracedistillery.com/visit-us/distillery-tours/',map:'Buffalo Trace Distillery Frankfort Kentucky'},
  {time:'LUNCH · TBD',kind:'FUEL FOR THE TRAIL',name:'The Stave',status:'TENTATIVE',pending:true,text:'A lunch stop in Millville between distillery visits. Noon was requested in place of the original 12:45 p.m. reservation; the final time is still pending.',url:'https://www.thestavekentucky.com/',map:'The Stave restaurant Millville Kentucky'},
  {time:'2:00 PM',kind:'DISTILLERY 02',name:'Castle & Key',status:'CONFIRMED',text:'Bourbon with a castle in the background. Set on the restored Old Taylor Distillery site, founded in 1887, Castle & Key pairs historic architecture and gardens with bourbon, rye, gin and vodka. Tour duration is still to come.',url:'https://castleandkey.com/pages/our-history',map:'Castle and Key Distillery Kentucky'},
  {time:'AFTERNOON',kind:'DISTILLERY 03 · TIME TBD',name:'Woodford Reserve',status:'CONFIRMED',text:'Our next stop is Woodford Reserve’s historic distillery in Kentucky horse country. A chance to explore the craftsmanship behind its bourbons and whiskeys. Visit time and the specific experience are still being finalized.',url:'https://www.woodfordreserve.com/our-distillery/tours-and-tastings/',map:'Woodford Reserve Distillery Kentucky'},
  {time:'IF IT FITS',kind:'A LITTLE HORSE COUNTRY',name:'Horse farm stop',status:'POSSIBLE STOP',pending:true,text:'A possible farm visit on the way back toward Lexington. Farm, timing and arrangements are still open; this is not a booked stop.'}
];
const host=document.querySelector('#friday-stops');
for(const stop of stops){
  const article=document.createElement('article');article.className='stop';
  const time=document.createElement('div');time.className='stop-time';time.textContent=stop.time;
  const body=document.createElement('div');const label=document.createElement('p');label.className='eyebrow small';label.textContent=stop.kind;
  const title=document.createElement('h3');title.textContent=stop.name;const text=document.createElement('p');text.textContent=stop.text;
  const links=document.createElement('div');links.className='links';
  for(const [name,url] of [['Official website ↗',stop.url],['Directions ↗',stop.map&&'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(stop.map)]]){if(!url)continue;const a=document.createElement('a');a.href=url;a.textContent=name;a.target='_blank';a.rel='noopener noreferrer';links.append(a);}
  body.append(label,title,text,links);const badge=document.createElement('span');badge.className='badge'+(stop.pending?' pending':'');badge.textContent=stop.status;article.append(time,body,badge);host.append(article);
}
const navLinks=[...document.querySelectorAll('.day-nav a')];
const viewer=document.querySelector('#art-viewer');
if(viewer && typeof viewer.showModal==='function'){
  const viewerImage=viewer.querySelector('img');
  const caption=viewer.querySelector('.viewer-caption');
  for(const img of document.querySelectorAll('img[src^="assets/"][src$=".png"], img[src^="assets/"][src*=".png?"]')){
    const button=document.createElement('button');
    button.type='button';button.className='art-expand';button.setAttribute('aria-label','Enlarge: '+img.alt);
    img.replaceWith(button);button.append(img);
    button.addEventListener('click',()=>{viewerImage.src=img.currentSrc;viewerImage.alt=img.alt;caption.textContent=img.alt;viewer.showModal();});
  }
  viewer.querySelector('.viewer-close').addEventListener('click',()=>viewer.close());
  viewer.addEventListener('click',event=>{if(event.target===viewer){const r=viewer.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)viewer.close();}});
}
if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;navLinks.forEach(a=>{const active=a.hash==='#'+entry.target.id;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});}},{rootMargin:'-10% 0px -65% 0px'});navLinks.forEach(a=>observer.observe(document.querySelector(a.hash)));}
