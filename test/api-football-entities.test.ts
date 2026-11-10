import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("API-FOOTBALL team and player normalization", () => {
  it("normalizes provider responses and constructs supported resource requests", async () => {
    process.env.FOOTBALL_API_KEY ??= "unit-test-key";
    const { ApiFootballProvider } = await import(
      "../src/modules/football/api-football.provider"
    );
    const originalFetch = globalThis.fetch;
    const requests: URL[] = [];
    const team = {
      id: 33,
      name: "Arsenal",
      logo: "https://media.example.test/arsenal.png",
      country: "England",
      founded: 1886,
      national: false,
    };
    const venue = {
      id: 494,
      name: "Emirates Stadium",
      city: "London",
      capacity: 60704,
      surface: "grass",
    };
    const player = {
      id: 123,
      name: "Example Player",
      age: 24,
      number: 7,
      position: "Attacker",
      photo: "https://media.example.test/player.png",
    };

    globalThis.fetch = async (input) => {
      const url = new URL(input.toString());
      requests.push(url);
      let payload: unknown;
      if (url.pathname.endsWith("/players/squads")) {
        payload = {
          team,
          players: [player],
        };
      } else if (url.pathname.endsWith("/players")) {
        payload = {
          player: {
            ...player,
            nationality: "England",
            height: "180 cm",
            weight: "75 kg",
            birth: { date: "2002-01-01", place: "London", country: "England" },
          },
          statistics: [],
        };
      } else {
        payload = { team: { ...team, venue }, venue };
      }
      return new Response(
        JSON.stringify({ errors: [], response: [payload] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    try {
      const provider = new ApiFootballProvider();
      const teams = await provider.getTeamsByLeague(39, 2025);
      const teamProfile = await provider.getTeam(33);
      const squad = await provider.getTeamSquad(33);
      const playerProfile = await provider.getPlayer(123, 2025);

      assert.equal(teams[0]?.name, "Arsenal");
      assert.equal(teams[0]?.venue?.capacity, 60704);
      assert.equal(teamProfile?.venue?.capacity, 60704);
      assert.equal(squad?.players[0]?.position, "Attacker");
      assert.equal(playerProfile?.nationality, "England");
      assert.equal(playerProfile?.birth.place, "London");
      assert(requests.some((url) => url.pathname.endsWith("/teams") && url.searchParams.get("league") === "39"));
      assert(requests.some((url) => url.pathname.endsWith("/players/squads") && url.searchParams.get("team") === "33"));
      assert(requests.some((url) => url.pathname.endsWith("/players") && url.searchParams.get("season") === "2025"));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
