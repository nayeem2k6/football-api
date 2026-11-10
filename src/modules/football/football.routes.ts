import { Router } from "express";
import { z } from "zod";
import {
  getFixturesByDate,
  getLiveFixtures,
  getPlayer,
  getStandings,
  getTeam,
  getTeamsByLeague,
  getTeamSquad,
} from "./football.service";

export const footballRouter = Router();

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Expected a valid calendar date in YYYY-MM-DD format.");

footballRouter.get("/live", async (_request, response, next) => {
  try {
    response.status(200).json(await getLiveFixtures());
  } catch (error) {
    next(error);
  }
});

footballRouter.get("/fixtures", async (request, response, next) => {
  try {
    const { date } = z
      .object({ date: dateSchema })
      .parse({ date: request.query.date });
    response.status(200).json(await getFixturesByDate(date));
  } catch (error) {
    next(error);
  }
});

footballRouter.get("/leagues/:leagueId/standings", async (request, response, next) => {
  try {
    const parameters = z
      .object({
        leagueId: z.coerce.number().int().positive(),
        season: z.coerce.number().int().min(1900).max(2200),
      })
      .parse({
        leagueId: request.params.leagueId,
        season: request.query.season,
      });
    response
      .status(200)
      .json(await getStandings(parameters.leagueId, parameters.season));
  } catch (error) {
    next(error);
  }
});

footballRouter.get("/teams", async (request, response, next) => {
  try {
    const parameters = z
      .object({
        leagueId: z.coerce.number().int().positive(),
        season: z.coerce.number().int().min(1900).max(2200),
      })
      .parse(request.query);
    response
      .status(200)
      .json(await getTeamsByLeague(parameters.leagueId, parameters.season));
  } catch (error) {
    next(error);
  }
});

footballRouter.get("/teams/:teamId/squad", async (request, response, next) => {
  try {
    const { teamId } = z
      .object({ teamId: z.coerce.number().int().positive() })
      .parse(request.params);
    response.status(200).json(await getTeamSquad(teamId));
  } catch (error) {
    next(error);
  }
});

footballRouter.get("/teams/:teamId", async (request, response, next) => {
  try {
    const { teamId } = z
      .object({ teamId: z.coerce.number().int().positive() })
      .parse(request.params);
    response.status(200).json(await getTeam(teamId));
  } catch (error) {
    next(error);
  }
});

footballRouter.get("/players/:playerId", async (request, response, next) => {
  try {
    const parameters = z
      .object({
        playerId: z.coerce.number().int().positive(),
        season: z.coerce.number().int().min(1900).max(2200),
      })
      .parse({
        playerId: request.params.playerId,
        season: request.query.season,
      });
    response
      .status(200)
      .json(await getPlayer(parameters.playerId, parameters.season));
  } catch (error) {
    next(error);
  }
});
