// Local-only rehearsal. Explicit asset allowlist; never serves .env or contacts a backend.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const assets = new Set(['app.js','standings.js','editions.js','weekly-tracker.js','live.js','props.js','analyzer.js','account-password.js','auth.js','styles.css','props.css','member.css','league-theme.css']);
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; form-action 'none'; frame-src 'none'; base-uri 'none'");
  res.setHeader('Cache-Control','no-store');
  if(req.method !== 'GET'){res.writeHead(405);return res.end();}
  if(pathname === '/' || pathname === '/index.html'){
    const html = fs.readFileSync(path.join(root,'index.html'),'utf8')
      .replace(/<script src="https:\/\/cdn.jsdelivr.net[^>]+><\/script>/,'<script src="practice.js" defer></script>')
      .replace('<title>', '<title>LOCAL PRACTICE · ');
    res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);
  }
  const name = pathname.slice(1);
  if(name==='recorded-analysis.json'){
    const file=path.join(root,'.local','analyzer-live-test.json');
    if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
    res.setHeader('Content-Type','application/json');return res.end(fs.readFileSync(file));
  }
  if(name !== 'practice.js' && !assets.has(name)){res.writeHead(404);return res.end();}
  res.setHeader('Content-Type', name.endsWith('.css')?'text/css':'text/javascript');
  res.end(fs.readFileSync(name === 'practice.js'?path.join(root,'tests','practice','fixture.js'):path.join(root,name)));
});
server.listen(Number(process.env.PRACTICE_PORT || 4174),'127.0.0.1',()=>console.log('Local practice: http://127.0.0.1:'+server.address().port));
