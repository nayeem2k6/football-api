export interface FootballTeam {
  id: number;
  name: string;
  logo: string | null;
}

export interface FootballTeamProfile extends FootballTeam {
  country: string | null;
  founded: number | null;
  national: boolean;
  venue: {
    name: string | null;
    city: string | null;
    capacity: number | null;
    surface: string | null;
  } | null;
}

export interface FootballPlayer {
  id: number;
  name: string;
  age: number | null;
  number: number | null;
  position: string | null;
  photo: string | null;
}

export interface FootballPlayerProfile extends FootballPlayer {
  nationality: string | null;
  height: string | null;
  weight: string | null;
  birth: {
    date: string | null;
    place: string | null;
    country: string | null;
  };
}

export interface FootballTeamSquad {
  team: FootballTeam;
  players: FootballPlayer[];
}

export interface FootballFixture {
  id: number;
  date: string;
  timestamp: number | null;
  status: {
    short: string;
    long: string;
    elapsed: number | null;
  };
  venue: {
    name: string | null;
    city: string | null;
  };
  league: {
    id: number;
    name: string;
    country: string | null;
    season: number;
    round: string | null;
  };
  teams: {
    home: FootballTeam;
    away: FootballTeam;
  };
  goals: {
    home: number | null;
    away: number | null;
  };
}

export interface StandingRow {
  rank: number;
  team: FootballTeam;
  points: number;
  goalsDiff: number;
  group: string | null;
  form: string | null;
  status: string | null;
  description: string | null;
  all: {
    played: number;
    win: number;
    draw: number;
    lose: number;
    goals: {
      for: number;
      against: number;
    };
  };
}

export interface FootballStanding {
  league: {
    id: number;
    name: string;
    country: string | null;
    season: number;
  };
  standings: StandingRow[][];
}
