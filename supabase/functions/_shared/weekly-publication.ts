import { draftEdition } from "./editions.ts";

// Scheduled recap uses saved, verified facts and local rules: no paid AI calls.
export async function publishScheduledEdition(db: any, season: string, week: number) {
  if (!Number.isInteger(week) || week < 1 || week > 18) return;
  const {data:existing,error:lookupError}=await db.from("weekly_editions").select("id")
    .eq("season_id",season).eq("week",week).eq("status","PUBLISHED").limit(1).maybeSingle();
  if(lookupError) throw new Error("edition_lookup_failed");
  if(existing) return; // Preserve a commissioner's published writing.
  const {data:snapshot,error:snapshotError}=await db.from("league_standings_snapshots").select("id")
    .eq("season_id",season).order("observed_at",{ascending:false}).limit(1).maybeSingle();
  if(snapshotError || !snapshot) throw new Error("edition_snapshot_unavailable");
  const {data:facts,error:factsError}=await db.rpc("weekly_edition_facts",{p_snapshot:snapshot.id,p_week:week});
  if(factsError) throw new Error("edition_facts_unavailable");
  const actor="54d35b79-ad66-483b-b5ce-c3c458ad791c";
  const entries=draftEdition(facts,week);
  const {data:draft,error:createError}=await db.rpc("manage_weekly_edition",{
    p_actor:actor,p_season:season,p_action:"CREATE",p_week:week,p_snapshot:snapshot.id,p_entries:entries});
  if(createError || !draft?.edition_id) throw new Error("edition_create_failed");
  // Read the saved version: CREATE may replay an existing draft.
  const {data:saved,error:savedError}=await db.from("weekly_editions").select("version,entries")
    .eq("id",draft.edition_id).single();
  if(savedError || !saved) throw new Error("edition_draft_unavailable");
  const {error:publishError}=await db.rpc("manage_weekly_edition",{
    p_actor:actor,p_season:season,p_action:"PUBLISH",p_edition:draft.edition_id,
    p_version:saved.version,p_entries:saved.entries});
  if(publishError) throw new Error("edition_publish_failed");
}
