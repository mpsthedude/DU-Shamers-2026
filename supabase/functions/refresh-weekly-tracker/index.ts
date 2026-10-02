// Live game tracking was retired at the commissioner's request. No provider calls.
Deno.serve(()=>Response.json({error:'live_ticket_updates_disabled'},{status:410}));
