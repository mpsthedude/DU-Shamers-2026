// Retired public probe. Real futures are entered manually by the commissioner.
Deno.serve(async (req: Request) => {
  const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type",
    "Access-Control-Allow-Methods":"GET, OPTIONS","Cache-Control":"no-store"};
  if(req.method==="OPTIONS") return new Response("ok",{headers});
  return Response.json({error:"manual_futures_only"},{status:410,headers});
});
