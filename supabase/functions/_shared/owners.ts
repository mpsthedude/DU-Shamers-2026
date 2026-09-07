export async function verifiedOwner(db:any,user:any,leagueId:string){
  if(!user?.id || !user.email || !user.email_confirmed_at) return {error:"verified_email_required"};
  // Identity comes exclusively from auth.getUser(), never the request or user_metadata.
  const {data,error}=await db.rpc("link_verified_owner",{p_actor:user.id,p_league:leagueId,p_email:user.email});
  if(error) return {error:error.message==="owner_assignment_conflict"?error.message:"owner_email_not_authorized"};
  return {membership:data};
}
