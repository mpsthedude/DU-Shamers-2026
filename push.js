// Installed iPhone web apps receive Web Push; no SMS service or phone number is used.
let commissionerPushBusy=false;
async function renderCommissionerPush(){
  const panel=document.querySelector('#commissioner');
  if(!panel || panel.classList.contains('hidden') || commissionerPushBusy)return;
  let box=document.querySelector('#commissionerPush');
  if(!box){box=document.createElement('section');box.id='commissionerPush';box.className='account-card';box.innerHTML='<h3>Commissioner alerts</h3><p>Get a phone notification when a weekly ticket is submitted. Tap it to review the picks.</p><p id="pushStatus" role="status" aria-live="polite"></p><div class="button-row"><button id="pushEnable" class="primary-button" type="button" disabled>Enable alerts on this device</button> <button id="pushTest" class="secondary-button" type="button" disabled>Send test alert</button> <button id="pushDisable" class="secondary-button" type="button" disabled>Disable alerts on this device</button></div>';panel.insertBefore(box,document.querySelector('#commissionerQueue'));}
  commissionerPushBusy=true;
  const status=box.querySelector('#pushStatus'),enable=box.querySelector('#pushEnable'),test=box.querySelector('#pushTest'),disable=box.querySelector('#pushDisable');
  const note=text=>{status.textContent=text;};
  const iphone=/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  if(iphone && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches){note('On iPhone (iOS 16.4 or later), open dushamers.com in Safari, tap Share → Add to Home Screen. Open that app, sign in, then enable alerts here.');commissionerPushBusy=false;return;}
  if(!isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)){note('Push alerts require a supported browser and HTTPS. On iPhone, use the Home Screen app on iOS 16.4 or later.');commissionerPushBusy=false;return;}
  async function api(body){const r=await fetch(`${LIVE_API_ROOT}/commissioner-push`,{method:body?'POST':'GET',headers:{...authHeaders(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw new Error(({test_cooldown:'Please wait one minute before sending another test.',device_limit:'Five devices are already enabled. Disable one before adding another.',commissioner_not_authorized:'Sign in with your commissioner account.',sign_in_required:'Please sign in again.'})[data.error] || 'Unable to update alerts. Please refresh and try again.');return data;}
  try {
    note('Checking notification settings…');
    const [keys]=await Promise.all([api(),navigator.serviceWorker.register('/push-sw.js',{scope:'/'})]);
    const registration=await navigator.serviceWorker.ready;
    let subscription=await registration.pushManager.getSubscription();
    async function refresh(){
      const state=subscription?await api({action:'status',endpoint:subscription.endpoint}):{enabled:false};
      const granted=Notification.permission==='granted';
      enable.disabled=state.enabled && granted;test.disabled=!state.enabled || !granted;disable.disabled=!subscription;
      note(state.enabled && granted?'Alerts enabled on this device. New submissions are checked every minute.':Notification.permission==='denied'?'Notifications are blocked. Allow them in your device notification settings, then reopen this app.':'Alerts are off on this device. Enable them, then send a test.');
      if(state.last?.state==='FAILED')note('The last alert failed. Disable and re-enable alerts, then send a test.');
    }
    await refresh();
    enable.onclick=async()=>{
      // Permission must be requested directly from the tap, before network requests.
      const permission=Notification.requestPermission();enable.disabled=true;
      try {
        if(await permission!=='granted'){note('Permission was not granted. Allow notifications in your device settings to enable alerts.');return;}
        const raw=atob(keys.publicKey.replace(/-/g,'+').replace(/_/g,'/'));
        subscription=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:Uint8Array.from(raw,c=>c.charCodeAt(0))});
        await api({action:'enable',subscription:subscription.toJSON()});await refresh();
      }catch(error){note(error.message || 'Could not enable alerts.');enable.disabled=false;}
      finally{if(Notification.permission!=='granted')enable.disabled=false;}
    };
    test.onclick=async()=>{test.disabled=true;try{await api({action:'test',endpoint:subscription.endpoint});note('Test queued. A notification should arrive shortly. If it does not, check notification settings and Focus mode.');}catch(error){note(error.message);}finally{test.disabled=false;}};
    disable.onclick=async()=>{disable.disabled=true;try{await api({action:'disable',endpoint:subscription.endpoint});await subscription.unsubscribe();subscription=null;await refresh();}catch(error){note(error.message);disable.disabled=false;}};
  }catch(error){note(error.message || 'Notification settings could not be loaded.');}
  finally{commissionerPushBusy=false;}
}
renderCommissionerPush();
