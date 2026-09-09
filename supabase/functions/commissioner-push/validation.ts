export function validEndpoint(value: unknown): value is string {
  if(typeof value!=='string' || value.length>2048) return false;
  try { const u=new URL(value);return u.protocol==='https:' && !u.username && !u.password && !u.hash && !u.port &&
    ['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'].includes(u.hostname); } catch {return false;}
}
export function validKey(value: unknown, length: number): boolean {
  if(typeof value!=='string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {const decoded=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return decoded.length===length && (length!==65 || decoded.charCodeAt(0)===4);}catch{return false;}
}
