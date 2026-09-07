Deno.serve(async (_req: Request) => {
  const espnS2 = Deno.env.get("ESPN_S2") || "";
  const espnSwid = Deno.env.get("ESPN_SWID") || "";
  const sgoKey = Deno.env.get("SPORTSGAMEODDS_API_KEY") || "";

  const result: Record<string, unknown> = {
    secrets: {
      ESPN_S2: Boolean(espnS2),
      ESPN_SWID: Boolean(espnSwid),
      SPORTSGAMEODDS_API_KEY: Boolean(sgoKey),
    },
    espn: { configured: Boolean(espnS2 && espnSwid) },
    sportsgameodds: { configured: Boolean(sgoKey) },
  };

  if (espnS2 && espnSwid) {
    try {
      const espnUrl = new URL("https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leagues/290466");
      espnUrl.searchParams.append("view", "mSettings");
      espnUrl.searchParams.append("view", "mTeam");
      espnUrl.searchParams.append("view", "mMatchupScore");
      const response = await fetch(espnUrl, {
        headers: {
          "Accept": "application/json",
          "User-Agent": "du-shamers-league-bank/1.0",
          "Cookie": `espn_s2=${espnS2}; SWID=${espnSwid}`,
        },
      });
      let leagueName: string | null = null;
      let teamCount: number | null = null;
      if (response.ok) {
        const payload = await response.json();
        leagueName = payload?.settings?.name || payload?.name || null;
        teamCount = Array.isArray(payload?.teams) ? payload.teams.length : null;
      }
      result.espn = { configured: true, accepted: response.ok, status: response.status, leagueName, teamCount };
    } catch (e) {
      result.espn = { configured: true, accepted: false, error: e instanceof Error ? e.name : "request_error" };
    }
  }

  if (sgoKey) {
    try {
      const response = await fetch("https://api.sportsgameodds.com/v2/account/usage", {
        headers: { "x-api-key": sgoKey, "Accept": "application/json" },
      });
      result.sportsgameodds = { configured: true, accepted: response.ok, status: response.status };
    } catch (e) {
      result.sportsgameodds = { configured: true, accepted: false, error: e instanceof Error ? e.name : "request_error" };
    }
  }

  return new Response(JSON.stringify(result), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
});

