import { isDatabaseConnected } from "../../database/connection";
import { FootballCacheModel } from "../../database/models/football-cache.model";
import { isFootballApiConfigured } from "../../config/env";
import { ServiceUnavailableError } from "../../shared/http-error";
import { ApiFootballProvider } from "./api-football.provider";

const provider = new ApiFootballProvider();

interface CachePolicy {
  freshForMs: number;
  staleForMs: number;
}

interface FootballResponse<T> {
  data: T;
  meta: {
    source: "api-football";
    freshness: "fresh" | "stale";
    fetchedAt: string;
  };
}

interface CacheEntry {
  payload: unknown;
  fetchedAt: Date;
  freshUntil: Date;
  staleUntil: Date;
}

const cachePolicies = {
  live: { freshForMs: 15_000, staleForMs: 120_000 },
  fixtures: { freshForMs: 300_000, staleForMs: 3_600_000 },
  standings: { freshForMs: 21_600_000, staleForMs: 86_400_000 },
  entities: { freshForMs: 21_600_000, staleForMs: 86_400_000 },
} satisfies Record<string, CachePolicy>;

async function findCache(cacheKey: string): Promise<CacheEntry | null> {
  if (!isDatabaseConnected()) return null;
  try {
    const entry = await FootballCacheModel.findOne({ cacheKey }).lean();
    return entry
      ? {
          payload: entry.payload,
          fetchedAt: entry.fetchedAt,
          freshUntil: entry.freshUntil,
          staleUntil: entry.staleUntil,
        }
      : null;
  } catch (error) {
    console.error("Failed to read football data cache", error);
    return null;
  }
}

async function saveCache(
  cacheKey: string,
  payload: unknown,
  policy: CachePolicy,
): Promise<void> {
  if (!isDatabaseConnected()) return;

  const now = new Date();
  await FootballCacheModel.findOneAndUpdate(
    { cacheKey },
    {
      $set: {
        payload,
        fetchedAt: now,
        freshUntil: new Date(now.getTime() + policy.freshForMs),
        staleUntil: new Date(now.getTime() + policy.staleForMs),
        deleteAt: new Date(now.getTime() + policy.staleForMs + 86_400_000),
      },
      $setOnInsert: { cacheKey },
    },
    { upsert: true, runValidators: true },
  );
}

async function loadFootballData<T>(
  cacheKey: string,
  policy: CachePolicy,
  fetchData: () => Promise<T>,
): Promise<FootballResponse<T>> {
  const cached = await findCache(cacheKey);
  const now = new Date();
  if (cached && cached.freshUntil > now) {
    return {
      data: cached.payload as T,
      meta: {
        source: "api-football",
        freshness: "fresh",
        fetchedAt: cached.fetchedAt.toISOString(),
      },
    };
  }

  try {
    if (!isFootballApiConfigured) {
      throw new ServiceUnavailableError(
        "Football data is unavailable because the provider is not configured.",
      );
    }
    const data = await fetchData();
    try {
      await saveCache(cacheKey, data, policy);
    } catch (error) {
      console.error("Failed to persist football data cache", error);
    }
    return {
      data,
      meta: {
        source: "api-football",
        freshness: "fresh",
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    if (cached && cached.staleUntil > now) {
      console.error("Serving explicitly marked stale football data", error);
      return {
        data: cached.payload as T,
        meta: {
          source: "api-football",
          freshness: "stale",
          fetchedAt: cached.fetchedAt.toISOString(),
        },
      };
    }
    throw error;
  }
}

export function getLiveFixtures() {
  return loadFootballData("live:all", cachePolicies.live, () =>
    provider.getLiveFixtures(),
  );
}

export function getFixturesByDate(date: string) {
  return loadFootballData(`fixtures:${date}`, cachePolicies.fixtures, () =>
    provider.getFixturesByDate(date),
  );
}

export function getStandings(leagueId: number, season: number) {
  return loadFootballData(
    `standings:${leagueId}:${season}`,
    cachePolicies.standings,
    () => provider.getStandings(leagueId, season),
  );
}

export function getTeamsByLeague(leagueId: number, season: number) {
  return loadFootballData(
    `teams:league:${leagueId}:${season}`,
    cachePolicies.entities,
    () => provider.getTeamsByLeague(leagueId, season),
  );
}

export function getTeam(teamId: number) {
  return loadFootballData(
    `team:${teamId}`,
    cachePolicies.entities,
    () => provider.getTeam(teamId),
  );
}

export function getTeamSquad(teamId: number) {
  return loadFootballData(
    `team:${teamId}:squad`,
    cachePolicies.entities,
    () => provider.getTeamSquad(teamId),
  );
}

export function getPlayer(playerId: number, season: number) {
  return loadFootballData(
    `player:${playerId}:${season}`,
    cachePolicies.entities,
    () => provider.getPlayer(playerId, season),
  );
}
