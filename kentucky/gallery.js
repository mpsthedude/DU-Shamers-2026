/* Shared trip gallery. Public browsing and uploads; image limits are enforced server-side. */
(() => {
  'use strict';
  const base = 'https://xvnkwtiydyrksucgiphi.supabase.co';
  const key = 'sb_publishable_oTJVPjW_EdOokBZfTSJKaA_GuUwJjOF';
  const api = base + '/functions/v1/trip-photos';
  const $ = selector => document.querySelector(selector);
  const seeds = [
    {id:'first-round', url:'assets/trip-photo-1.jpg', thumb:'assets/trip-thumb-1.jpg', caption:'First round with the boys.', alt:'Three friends enjoying drinks at the bar'},
    {id:'bucees', url:'assets/trip-photo-2.jpg', thumb:'assets/trip-thumb-2.jpg', caption:'A mandatory Buc-ee’s stop.', alt:'The crew making a stop at Buc-ee’s'}
  ];
  let photos = [...seeds], selected = 0, busy = false;
  function show(index) {
    selected = (index + photos.length) % photos.length;
    const photo = photos[selected];
    $('#gallery-photo').src = photo.url;
    $('#gallery-photo').alt = photo.alt || photo.caption;
    $('#gallery-caption').textContent = photo.caption;
    $('#gallery-count').textContent = `${selected + 1} / ${photos.length}`;
    document.querySelectorAll('.gallery-thumbnail').forEach((button, i) => button.setAttribute('aria-pressed', String(i === selected)));
  }
  function render() {
    const fragment = document.createDocumentFragment();
    photos.forEach((photo, index) => {
      const button = document.createElement('button'); button.type='button'; button.className='gallery-thumbnail';
      button.setAttribute('aria-label', `Photo ${index+1}: ${photo.caption}`);
      const img=document.createElement('img'); img.src=photo.thumb || photo.url; img.alt=''; img.loading='lazy'; img.decoding='async';
      button.append(img); button.addEventListener('click',()=>show(index)); fragment.append(button);
    });
    $('.gallery-thumbnails').replaceChildren(fragment); show(selected);
  }
  $('.gallery-arrow.previous').addEventListener('click',()=>show(selected-1));
  $('.gallery-arrow.next').addEventListener('click',()=>show(selected+1));
  $('.gallery-stage').addEventListener('keydown', event => {
    if (event.key==='ArrowLeft' || event.key==='ArrowRight') {event.preventDefault();show(selected+(event.key==='ArrowLeft'?-1:1));}
  });
  let touchStart;
  $('.gallery-stage').addEventListener('touchstart', event => {touchStart=event.touches[0];},{passive:true});
  $('.gallery-stage').addEventListener('touchend', event => {
    if(!touchStart)return;
    const dx=event.changedTouches[0].clientX-touchStart.clientX,dy=event.changedTouches[0].clientY-touchStart.clientY;
    if(Math.abs(dx)>50 && Math.abs(dx)>Math.abs(dy))show(selected+(dx<0?1:-1)); touchStart=null;
  },{passive:true});
  let refreshing=false;
  async function refresh() {
    if(refreshing)return; refreshing=true; $('#gallery-refresh').disabled=true;
    const current=photos[selected].id;
    try {
      let offset=0, more=true, remote=[];
      while(more){
        const response=await fetch(`${api}?offset=${offset}`,{headers:{apikey:key},cache:'no-store'});
        if(!response.ok)throw new Error('New photos could not be loaded. You can still browse the photos already here.');
        const data=await response.json();remote.push(...data.photos);more=data.more;offset+=100;
      }
      photos=[...remote,...seeds];selected=Math.max(0,photos.findIndex(photo=>photo.id===current));render();$('#gallery-status').textContent='';
    } catch(error){$('#gallery-status').textContent=error.message;}
    finally {refreshing=false;$('#gallery-refresh').disabled=false;}
  }
  $('#gallery-refresh').addEventListener('click',refresh);
  const dialog=$('#upload-dialog');
  $('#add-photos').addEventListener('click',()=>dialog.showModal());
  $('#upload-close').addEventListener('click',()=>{if(!busy)dialog.close();});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  async function prepare(file) {
    if(file.size>30*1024*1024)throw new Error(`${file.name}: choose a photo under 30 MB.`);
    const url=URL.createObjectURL(file),img=new Image();
    try {
      img.src=url; await img.decode();
      const ratio=Math.min(1,1800/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.round(img.naturalWidth*ratio);canvas.height=Math.round(img.naturalHeight*ratio);
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.86));
      if(!blob || blob.size>6*1024*1024)throw new Error('Photo is too large.');return blob;
    } catch {throw new Error(`${file.name}: this photo could not be opened. Try a JPEG, PNG or WebP copy.`);}
    finally {URL.revokeObjectURL(url);}
  }
  $('#photo-upload').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const form=event.currentTarget, files=[...form.elements.photos.files];
    if(!files.length || files.length>10){$('#upload-status').textContent='Choose between 1 and 10 photos.';return;}
    busy=true;form.querySelectorAll('button,input').forEach(el=>el.disabled=true);$('#upload-close').disabled=true;
    let saved=0,failures=[];
    for(const file of files){
      $('#upload-status').textContent=`Uploading ${saved+failures.length+1} of ${files.length}… Keep this page open.`;
      try{
        const blob=await prepare(file);
        const response=await fetch(api,{method:'POST',headers:{apikey:key,'Content-Type':'image/jpeg'},body:blob});
        const result=await response.json();if(!response.ok)throw new Error(result.error || 'Upload failed.');
        photos.unshift(result.photo);selected=0;saved++;render();
      }catch(error){failures.push(`${file.name}: ${error.message}`);}
    }
    $('#upload-status').textContent=`${saved} photo${saved===1?'':'s'} added.${failures.length?' '+failures.join(' '):' Everyone can see them now.'}`;
    form.reset();busy=false;form.querySelectorAll('button,input').forEach(el=>el.disabled=false);$('#upload-close').disabled=false;
  });
  render(); refresh();
})();
