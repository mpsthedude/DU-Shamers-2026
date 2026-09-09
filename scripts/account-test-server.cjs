const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const assets=new Set(['push.js','push-sw.js','manifest.webmanifest','hub-icon.svg','hub-icon.png','ticket-rules.js','app.js','standings.js','editions.js','weekly-tracker.js','live.js','props.js','analyzer.js','account-password.js','auth.js','styles.css','props.css','member.css','league-theme.css']);
http.createServer((req,res)=>{
 res.setHeader('Cache-Control','no-store');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; connect-src 'self' https://xvnkwtiydyrksucgiphi.supabase.co wss://xvnkwtiydyrksucgiphi.supabase.co; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-src 'none'");
 if(req.method!=='GET'){res.writeHead(405);return res.end();}
 const name=new URL(req.url,'http://localhost').pathname.slice(1);
 if(!name || name==='index.html'){
  res.setHeader('Content-Type','text/html; charset=utf-8');
  return res.end(fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<body>','<body><aside style="padding:16px;background:#fff3cd;color:#29210b;border-bottom:3px solid #9a6700"><strong>REAL ACCOUNT TEST — connected to the production league.</strong><p>Use League Sign In with your invited account. Actions here affect real records. Paid integrations remain paused. Invitation and password-reset links open dushamers.com; after setup, return here to sign in.</p></aside>'));
 }
 if(!assets.has(name)){res.writeHead(404);return res.end();}
 res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.png')?'image/png':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.webmanifest')?'application/manifest+json':'text/javascript');res.end(fs.readFileSync(path.join(root,name)));
}).listen(4175,'127.0.0.1',()=>console.log('Real account test: http://127.0.0.1:4175/'));
