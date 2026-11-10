import { z } from "zod";
import { env, isFootballApiConfigured } from "../../config/env";
import { HttpError, ServiceUnavailableError } from "../../shared/http-error";
import type {
  FootballFixture,
  FootballPlayer,
  FootballPlayerProfile,
  FootballTeam,
  FootballTeamProfile,
  FootballTeamSquad,
  FootballStanding,
  StandingRow,
} from "./football.types";

const providerEnvelopeSchema = z.object({
  errors: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]),
  response: z.array(z.unknown()),
});

const nullableString = z.string().nullable();

function providerErrorMessage(errors: unknown[]): string | null {
  if (errors.length === 0) return null;
  return "The football data provider rejected the request.";
}

function normalizeTeam(input: unknown): FootballTeam {
  const team = z
    .object({
      id: z.number().int().positive(),
      name: z.string(),
      logo: nullableString.optional(),
    })
    .parse(input);
  return { id: team.id, name: team.name, logo: team.logo ?? null };
}

function normalizeTeamProfile(input: unknown): FootballTeamProfile {
  const parsed = z
    .object({
      team: z.object({
        id: z.number().int().positive(),
        name: z.string(),
        logo: nullableString.optional(),
        country: nullableString.optional(),
        founded: z.number().int().nullable().optional(),
        national: z.boolean().optional(),
      }),
      venue: z
        .object({
          name: nullableString.optional(),
          city: nullableString.optional(),
          capacity: z.number().int().nullable().optional(),
          surface: nullableString.optional(),
        })
        .nullable()
        .optional(),
    })
    .parse(input);
  return {
    id: parsed.team.id,
    name: parsed.team.name,
    logo: parsed.team.logo ?? null,
    country: parsed.team.country ?? null,
    founded: parsed.team.founded ?? null,
    national: parsed.team.national ?? false,
    venue: parsed.venue
      ? {
          name: parsed.venue.name ?? null,
          city: parsed.venue.city ?? null,
          capacity: parsed.venue.capacity ?? null,
          surface: parsed.venue.surface ?? null,
        }
      : null,
  };
}

function normalizeSquad(input: unknown): FootballTeamSquad {
  const parsed = z
    .object({
      team: z.unknown(),
      players: z.array(
        z.object({
          id: z.number().int().positive(),
          name: z.string(),
          age: z.number().int().nullable().optional(),
          number: z.number().int().nullable().optional(),
          position: nullableString.optional(),
          photo: nullableString.optional(),
        }),
      ),
    })
    .parse(input);
  return {
    team: normalizeTeam(parsed.team),
    players: parsed.players.map(
      (player): FootballPlayer => ({
        id: player.id,
        name: player.name,
        age: player.age ?? null,
        number: player.number ?? null,
        position: player.position ?? null,
        photo: player.photo ?? null,
      }),
    ),
  };
}

function normalizePlayerProfile(input: unknown): FootballPlayerProfile {
  const parsed = z
    .object({
      player: z.object({
        id: z.number().int().positive(),
        name: z.string(),
        age: z.number().int().nullable().optional(),
        nationality: nullableString.optional(),
        height: nullableString.optional(),
        weight: nullableString.optional(),
        photo: nullableString.optional(),
        birth: z
          .object({
            date: nullableString.optional(),
            place: nullableString.optional(),
            country: nullableString.optional(),
          })
          .optional(),
      }),
    })
    .parse(input);
  return {
    id: parsed.player.id,
    name: parsed.player.name,
    age: parsed.player.age ?? null,
    number: null,
    position: null,
    photo: parsed.player.photo ?? null,
    nationality: parsed.player.nationality ?? null,
    height: parsed.player.height ?? null,
    weight: parsed.player.weight ?? null,
    birth: {
      date: parsed.player.birth?.date ?? null,
      place: parsed.player.birth?.place ?? null,
      country: parsed.player.birth?.country ?? null,
    },
  };
}

function normalizeFixture(input: unknown): FootballFixture {
  const fixtureSchema = z.object({
    fixture: z.object({
      id: z.number().int().positive(),
      date: z.string().datetime({ offset: true }),
      timestamp: z.number().nullable().optional(),
      status: z.object({
        short: z.string(),
        long: z.string(),
        elapsed: z.number().nullable().optional(),
      }),
      venue: z
        .object({
          name: nullableString.optional(),
          city: nullableString.optional(),
        })
        .nullable(),
    }),
    league: z.object({
      id: z.number().int().positive(),
      name: z.string(),
      country: nullableString.optional(),
      season: z.number().int(),
      round: nullableString.optional(),
    }),
    teams: z.object({
      home: z.unknown(),
      away: z.unknown(),
    }),
    goals: z.object({
      home: z.number().nullable(),
      away: z.number().nullable(),
    }),
  });
  const fixture = fixtureSchema.parse(input);

  return {
    id: fixture.fixture.id,
    date: fixture.fixture.date,
    timestamp: fixture.fixture.timestamp ?? null,
    status: {
      short: fixture.fixture.status.short,
      long: fixture.fixture.status.long,
      elapsed: fixture.fixture.status.elapsed ?? null,
    },
    venue: {
      name: fixture.fixture.venue?.name ?? null,
      city: fixture.fixture.venue?.city ?? null,
    },
    league: {
      id: fixture.league.id,
      name: fixture.league.name,
      country: fixture.league.country ?? null,
      season: fixture.league.season,
      round: fixture.league.round ?? null,
    },
    teams: {
      home: normalizeTeam(fixture.teams.home),
      away: normalizeTeam(fixture.teams.away),
    },
    goals: fixture.goals,
  };
}

function normalizeStandings(input: unknown): FootballStanding[] {
  const leagueSchema = z.object({
    id: z.number().int().positive(),
    name: z.string(),
    country: nullableString.optional(),
    season: z.number().int(),
    standings: z.array(
      z.array(
        z.object({
          rank: z.number().int().positive(),
          team: z.unknown(),
          points: z.number().int(),
          goalsDiff: z.number().int(),
          group: nullableString.optional(),
          form: nullableString.optional(),
          status: nullableString.optional(),
          description: nullableString.optional(),
          all: z.object({
            played: z.number().int(),
            win: z.number().int(),
            draw: z.number().int(),
            lose: z.number().int(),
            goals: z.object({
              for: z.number().int(),
              against: z.number().int(),
            }),
          }),
        }),
      ),
    ),
  });

  return z
    .array(z.object({ league: leagueSchema }))
    .parse(input)
    .map(({ league }) => ({
      league: {
        id: league.id,
        name: league.name,
        country: league.country ?? null,
        season: league.season,
      },
      standings: league.standings.map((group) =>
        group.map(
          (row): StandingRow => ({
            rank: row.rank,
            team: normalizeTeam(row.team),
            points: row.points,
            goalsDiff: row.goalsDiff,
            group: row.group ?? null,
            form: row.form ?? null,
            status: row.status ?? null,
            description: row.description ?? null,
            all: row.all,
          }),
        ),
      ),
    }));
}

export class ApiFootballProvider {
  async getLiveFixtures(): Promise<FootballFixture[]> {
    const response = await this.request("/fixtures", { live: "all" });
    return response.map(normalizeFixture);
  }

  async getFixturesByDate(date: string): Promise<FootballFixture[]> {
    const response = await this.request("/fixtures", { date });
    return response.map(normalizeFixture);
  }

  async getStandings(leagueId: number, season: number): Promise<FootballStanding[]> {
    const response = await this.request("/standings", {
      league: String(leagueId),
      season: String(season),
    });
    return normalizeStandings(response);
  }

  async getTeamsByLeague(
    leagueId: number,
    season: number,
  ): Promise<FootballTeamProfile[]> {
    const response = await this.request("/teams", {
      league: String(leagueId),
      season: String(season),
    });
    return response.map(normalizeTeamProfile);
  }

  async getTeam(teamId: number): Promise<FootballTeamProfile | null> {
    const response = await this.request("/teams", { id: String(teamId) });
    return response.length > 0 ? normalizeTeamProfile(response[0]) : null;
  }

  async getTeamSquad(teamId: number): Promise<FootballTeamSquad | null> {
    const response = await this.request("/players/squads", { team: String(teamId) });
    return response.length > 0 ? normalizeSquad(response[0]) : null;
  }

  async getPlayer(playerId: number, season: number): Promise<FootballPlayerProfile | null> {
    const response = await this.request("/players", {
      id: String(playerId),
      season: String(season),
    });
    return response.length > 0 ? normalizePlayerProfile(response[0]) : null;
  }

  private async request(
    path: string,
    parameters: Record<string, string>,
  ): Promise<unknown[]> {
    if (!isFootballApiConfigured || !env.FOOTBALL_API_KEY) {
      throw new ServiceUnavailableError(
        "Football data is unavailable because the provider is not configured.",
      );
    }

    const url = new URL(path, `${env.FOOTBALL_API_BASE_URL.replace(/\/+$/, "")}/`);
    for (const [key, value] of Object.entries(parameters)) {
      url.searchParams.set(key, value);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { "x-apisports-key": env.FOOTBALL_API_KEY },
        signal: AbortSignal.timeout(8_000),
      });
    } catch (error) {
      console.error("API-FOOTBALL request failed", error);
      throw new HttpError(
        502,
        "FOOTBALL_PROVIDER_UNAVAILABLE",
        "The football data provider could not be reached.",
      );
    }

    if (response.status === 429) {
      throw new HttpError(
        503,
        "FOOTBALL_PROVIDER_RATE_LIMITED",
        "The football data provider rate limit was reached.",
      );
    }
    if (!response.ok) {
      console.error("API-FOOTBALL returned HTTP status", response.status);
      throw new HttpError(
        502,
        "FOOTBALL_PROVIDER_ERROR",
        "The football data provider returned an error.",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (error) {
      console.error("API-FOOTBALL returned invalid JSON", error);
      throw new HttpError(
        502,
        "FOOTBALL_PROVIDER_INVALID_RESPONSE",
        "The football data provider returned an invalid response.",
      );
    }

    const envelope = providerEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      console.error("API-FOOTBALL response did not match the expected envelope");
      throw new HttpError(
        502,
        "FOOTBALL_PROVIDER_INVALID_RESPONSE",
        "The football data provider returned an invalid response.",
      );
    }

    const errors = Array.isArray(envelope.data.errors)
      ? envelope.data.errors
      : Object.values(envelope.data.errors);
    const providerError = providerErrorMessage(errors);
    if (providerError) {
      console.error("API-FOOTBALL reported a provider error", errors);
      throw new HttpError(502, "FOOTBALL_PROVIDER_ERROR", providerError);
    }

    return envelope.data.response;
  }
}
