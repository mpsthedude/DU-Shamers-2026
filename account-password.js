const ACCOUNT_REDIRECT = 'https://mpsthedude.github.io/DU-Shamers-2026/?account=setup';
function validateAccountPassword(password,confirmation){
  if(typeof password!=='string' || password.length<8 || password.length>128)return 'Use a password between 8 and 128 characters.';
  if(password!==confirmation)return 'The new passwords do not match.';
  return null;
}
function accountStatus(body,message){const el=body.querySelector('#accountStatus');if(el)el.textContent=message;}
function renderAccountSignIn(body){
  const failedLink=incomingAuthError;
  body.innerHTML=`<div class="member-card"><strong>Welcome to DU Shamers</strong>
    <p>First visit? Open your league invitation to choose a password. Your verified email connects you to your ESPN team.</p>
    <form class="member-form" id="accountSignIn"><label>Email address<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <button type="submit">Sign in</button></form><p id="accountStatus" role="status">${failedLink?'This invitation or reset link has expired or is invalid. Request a fresh link.':''}</p>
    <button class="member-link-button" id="forgotAccountPassword">Forgot password?</button></div>`;
  body.querySelector('#forgotAccountPassword').addEventListener('click',()=>renderAccountRecovery(body));
  body.querySelector('#accountSignIn').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');if(button.disabled)return;
    button.disabled=true;accountActionBusy=true;accountStatus(body,'Signing in…');
    try{
      const {error}=await authClient.auth.signInWithPassword({email:form.elements.email.value.trim(),password:form.elements.password.value});
      form.elements.password.value='';
      if(error){accountStatus(body,'Unable to sign in. Check your email and password, or request a reset.');return;}
      accountActionBusy=false;await refreshMemberState();
    }catch{accountStatus(body,'Unable to connect. Please try again.');}
    finally{accountActionBusy=false;button.disabled=false;}
  });
}
function renderAccountRecovery(body){
  body.innerHTML=`<div class="member-card"><strong>Reset your password</strong><p>We’ll email a one-time link if an account exists for this address.</p>
    <form class="member-form" id="accountRecovery"><label>Email address<input name="email" type="email" autocomplete="email" required></label><button type="submit">Send reset link</button></form>
    <p id="accountStatus" role="status"></p><button class="member-link-button" id="backToAccountSignIn">Back to sign in</button></div>`;
  body.querySelector('#backToAccountSignIn').addEventListener('click',()=>renderAccountSignIn(body));
  body.querySelector('#accountRecovery').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');if(button.disabled)return;button.disabled=true;
    try{
      const {error}=await authClient.auth.resetPasswordForEmail(form.elements.email.value.trim(),{redirectTo:ACCOUNT_REDIRECT});
      accountStatus(body,error?'Unable to send right now. Please wait before trying again.':'If an account exists, a reset link has been sent. Check your inbox and spam folder.');
    }catch{accountStatus(body,'Unable to connect. Please try again.');}
    finally{button.disabled=false;}
  });
}
function renderAccountPassword(body,mode){
  const changing=mode==='change';
  body.innerHTML=`<div class="member-card"><strong>${changing?'Change password':mode==='setup'?'Choose your league password':'Set a new password'}</strong>
    <p>Use at least 8 characters. A unique passphrase works well. After saving, sign in with your new password.</p>
    <form class="member-form" id="accountPassword">
    ${changing?'<label>Current password<input name="current" type="password" autocomplete="current-password" required></label>':''}
    <label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
    <label>Confirm new password<input name="confirmation" type="password" autocomplete="new-password" minlength="8" maxlength="128" required></label>
    <button type="submit">Save password</button></form><p id="accountStatus" role="status"></p>
    ${changing?'<button class="member-link-button" id="cancelPasswordChange">Back to account</button>':''}</div>`;
  body.querySelector('#cancelPasswordChange')?.addEventListener('click',()=>{passwordMode=null;renderMemberModal();});
  body.querySelector('#accountPassword').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');if(button.disabled)return;
    const errorMessage=validateAccountPassword(form.elements.password.value,form.elements.confirmation.value);
    if(errorMessage){accountStatus(body,errorMessage);return;}
    button.disabled=true;accountActionBusy=true;
    try{
      const values={password:form.elements.password.value};
      if(changing)values.current_password=form.elements.current.value;
      const {error}=await authClient.auth.updateUser(values);
      if(error){accountStatus(body,'Password not changed. Check your current password, or request a fresh reset link if this session expired.');return;}
      form.reset();passwordMode=null;
      const {error:signOutError}=await authClient.auth.signOut({scope:'global'});
      if(signOutError){accountStatus(body,'Password changed. Please sign out and sign in again.');return;}
      accountActionBusy=false;await refreshMemberState();openMemberModal();showToast('Password saved. Sign in with your new password.');
    }catch{accountStatus(body,'The request could not be confirmed. Try signing in with your new password before requesting a reset.');}
    finally{accountActionBusy=false;button.disabled=false;}
  });
}
