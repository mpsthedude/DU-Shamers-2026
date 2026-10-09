import { createClient } from "https://esm.sh/@supabase/supabase-js@2.115.0";

const bucket = "kentucky-trip-2026";
const maxBytes = 6 * 1024 * 1024;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) => Response.json(body, {status, headers: {...cors, "Cache-Control": "no-store"}});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, {headers: cors});
  if (!["GET", "POST"].includes(req.method)) return json({error: "Method not allowed"}, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {auth: {persistSession: false, autoRefreshToken: false}});
    if (req.method === "GET") {
      const offset = Number(new URL(req.url).searchParams.get("offset") || 0);
      if (!Number.isSafeInteger(offset) || offset < 0) return json({error: "Invalid page"}, 400);
      const {data, error} = await db.storage.from(bucket).list("photos", {limit: 100, offset, sortBy: {column: "name", order: "desc"}});
      if (error) return json({error: "Photos are temporarily unavailable. Please try again."}, 503);
      return json({photos: data.filter(item => item.id).map(item => ({id: item.name, url: db.storage.from(bucket).getPublicUrl(`photos/${item.name}`).data.publicUrl, caption: "From the trip"})), more: data.length === 100});
    }
    // Public viewing; every write verifies identity and current directory membership.
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return json({error: "Sign in with your DU Shamers account to add photos."}, 401);
    const {data: {user}, error: authError} = await db.auth.getUser(token);
    if (authError || !user?.email || !user.email_confirmed_at) return json({error: "Please sign in again to add photos."}, 401);
    const {data: league, error: leagueError} = await db.from("leagues").select("id").eq("name", "DU Shamers").single();
    if (leagueError) return json({error: "Member access is temporarily unavailable."}, 503);
    const {data: member, error: memberError} = await db.from("league_owner_directory").select("id").eq("league_id", league.id).eq("active", true).ilike("email", user.email.replace(/[\\%_]/g, "\\$&")).limit(1).maybeSingle();
    if (memberError) return json({error: "Member access is temporarily unavailable."}, 503);
    if (!member) return json({error: "Photo uploads are available to invited DU Shamers members."}, 403);
    if (req.headers.get("content-type")?.split(";")[0] !== "image/jpeg") return json({error: "Please choose a photo that can be converted to JPEG."}, 415);
    if (Number(req.headers.get("content-length")) > maxBytes) return json({error: "Photo must be under 6 MB."}, 413);
    const reader = req.body?.getReader();
    if (!reader) return json({error: "Choose a photo first."}, 400);
    const chunks: Uint8Array[] = []; let length = 0;
    while (true) { const {value, done} = await reader.read(); if (done) break; length += value.length; if (length > maxBytes) {await reader.cancel(); return json({error: "Photo must be under 6 MB."}, 413);} chunks.push(value); }
    const bytes = new Uint8Array(length); let pos = 0;
    for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.length; }
    if (length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) return json({error: "This file is not a valid JPEG photo."}, 415);
    const name = `${Date.now()}_${crypto.randomUUID()}.jpg`;
    const {error} = await db.storage.from(bucket).upload(`photos/${name}`, bytes, {contentType: "image/jpeg", upsert: false, cacheControl: "31536000"});
    if (error) return json({error: "The photo could not be saved. Please try again."}, 503);
    return json({photo: {id: name, url: db.storage.from(bucket).getPublicUrl(`photos/${name}`).data.publicUrl, caption: "From the trip"}}, 201);
  } catch { return json({error: "Something went wrong. Please try again."}, 500); }
});
