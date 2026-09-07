// Reads local credentials but writes only the sanitized league snapshot, never cookies or owners.
const fs=require('node:fs');
const path=require('node:path');
const {parseEnv}=require('node:util');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
(async()=>{
  const env=parseEnv(fs.readFileSync(path.join(root,'.env'),'utf8'));
  const {fetchStandings}=await import(pathToFileURL(path.join(root,'supabase/functions/_shared/standings.ts')).href);
  const payload=await fetchStandings(env.ESPN_S2,env.ESPN_SWID||env.SWID);
  const observed_at=new Date().toISOString();
  fs.mkdirSync(path.join(root,'.local'),{recursive:true});
  fs.writeFileSync(path.join(root,'.local/standings.json'),JSON.stringify({observed_at,payload}));
  console.log(`Sanitized ESPN snapshot: ${payload.teams.length} teams, ${payload.completed_weeks.length} completed weeks.`);
})().catch(()=>{console.error('ESPN snapshot failed; no credential values printed.');process.exitCode=1;});
