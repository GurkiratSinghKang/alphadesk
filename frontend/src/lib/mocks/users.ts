/**
 * MOCK_APPLICANTS + MOCK_ACTIVE_USERS — fixture for Admin → Users
 * (per v2-plan §1.6h).
 *
 * The applicants table feeds the approval flow + DangerConfirm
 * "type IMPERSONATE-{name}" + bulk actions. The active users table
 * shows live tenant telemetry (equity, agent runs, daily AI spend,
 * risk score, status pill).
 */

export type ApplicantStatus = "pending" | "approved" | "rejected" | "hold";
export type ApplicantRiskTier = "low" | "med" | "high";

export interface Applicant {
  id: string;
  name: string;
  email: string;
  domain: string;
  appliedAt: string;
  country: string;
  /** Optional invitation referrer. */
  invitedBy?: string;
  /** Free-text application memo from the apply form. */
  reason: string;
  /** Auto-flagged risk tier from B.5 risk_signals service. */
  risk: ApplicantRiskTier;
  /** Auto-flagged signal codes (e.g. ["disposable_email", "vpn_signup"]). */
  flags: string[];
  /** Onboarding questionnaire snapshot — preserved across approval. */
  questionnaire: {
    capitalBand: "<25k" | "25k-100k" | "100k-500k" | "500k-2M" | ">2M";
    riskTolerance: "low" | "med" | "high";
    timeHorizon: "intraday" | "swing" | "position";
    assetPref: string[];
    strategyInterest: string[];
  };
  status: ApplicantStatus;
}

export type UserPlan = "free" | "starter" | "pro" | "operator";
export type UserStatus = "active" | "flagged" | "suspended";

export interface ActiveUser {
  id: string;
  name: string;
  email: string;
  plan: UserPlan;
  joined: string;
  lastSeen: string;
  /** "paper" | "live" — which mode the user is currently using. */
  mode: "paper" | "live";
  equity: number;
  openPositions: number;
  dailyPnl: number;
  agentRuns24h: number;
  apiCalls24h: number;
  cost24h: number;
  /** 0..100 rolled-up risk score (drawdown breaches, leverage, halts). */
  riskScore: number;
  status: UserStatus;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const MOCK_APPLICANTS: Applicant[] = [
  {
    id: "appl-aria",
    name: "Aria Mehta",
    email: "aria.mehta@horizonquant.io",
    domain: "horizonquant.io",
    appliedAt: ago(2 * HOUR),
    country: "United Kingdom",
    invitedBy: "linkedin",
    reason:
      "10y systematic equity at Horizon. Looking for an LLM-augmented research desk for personal portfolio (~$280k).",
    risk: "low",
    flags: [],
    questionnaire: {
      capitalBand: "100k-500k",
      riskTolerance: "med",
      timeHorizon: "swing",
      assetPref: ["us-equity", "etf"],
      strategyInterest: ["momentum-quality", "pead"],
    },
    status: "pending",
  },
  {
    id: "appl-henry",
    name: "Henry Ng",
    email: "henry@protonmail.com",
    domain: "protonmail.com",
    appliedAt: ago(8 * HOUR),
    country: "Singapore",
    reason: "Curious about the AI risk-agent. Will start in paper.",
    risk: "med",
    flags: ["disposable_email"],
    questionnaire: {
      capitalBand: "<25k",
      riskTolerance: "low",
      timeHorizon: "swing",
      assetPref: ["us-equity"],
      strategyInterest: ["momentum-quality"],
    },
    status: "pending",
  },
  {
    id: "appl-mia",
    name: "Mia Roy",
    email: "mia.roy@stanford.edu",
    domain: "stanford.edu",
    appliedAt: ago(20 * HOUR),
    country: "United States",
    reason:
      "Stanford GSB student writing a case on agent-augmented retail trading platforms. Would love operator-level read access if any.",
    risk: "low",
    flags: [],
    questionnaire: {
      capitalBand: "<25k",
      riskTolerance: "low",
      timeHorizon: "position",
      assetPref: ["us-equity", "etf"],
      strategyInterest: ["pead"],
    },
    status: "pending",
  },
  {
    id: "appl-ben",
    name: "Ben Cole",
    email: "ben_cole_2026@yopmail.com",
    domain: "yopmail.com",
    appliedAt: ago(28 * HOUR),
    country: "Vanuatu",
    reason: "test account",
    risk: "high",
    flags: ["disposable_email", "vpn_signup", "throwaway_phone"],
    questionnaire: {
      capitalBand: "<25k",
      riskTolerance: "high",
      timeHorizon: "intraday",
      assetPref: ["us-equity"],
      strategyInterest: [],
    },
    status: "pending",
  },
  {
    id: "appl-jana",
    name: "Jana Kim",
    email: "jana@kimcapital.kr",
    domain: "kimcapital.kr",
    appliedAt: ago(36 * HOUR),
    country: "South Korea",
    invitedBy: "operator",
    reason:
      "Family office allocator. Want paper-only first; live access only after a quarter of trail data.",
    risk: "low",
    flags: [],
    questionnaire: {
      capitalBand: ">2M",
      riskTolerance: "low",
      timeHorizon: "position",
      assetPref: ["us-equity", "etf", "options"],
      strategyInterest: ["momentum-quality", "earnings-options-play"],
    },
    status: "hold",
  },
  {
    id: "appl-octavio",
    name: "Octavio Ríos",
    email: "octavio@rios.mx",
    domain: "rios.mx",
    appliedAt: ago(2 * DAY),
    country: "Mexico",
    reason:
      "Independent options trader. 7y Schwab + Tastytrade. Want the earnings-options playbook with backtest.",
    risk: "low",
    flags: [],
    questionnaire: {
      capitalBand: "100k-500k",
      riskTolerance: "high",
      timeHorizon: "swing",
      assetPref: ["options"],
      strategyInterest: ["earnings-options-play"],
    },
    status: "pending",
  },
];

export const MOCK_ACTIVE_USERS: ActiveUser[] = [
  {
    id: "user-alex",
    name: "Alex Chen",
    email: "alex@alphadesk.io",
    plan: "operator",
    joined: ago(180 * DAY),
    lastSeen: ago(2 * 60 * 1000),
    mode: "paper",
    equity: 1_790_240,
    openPositions: 14,
    dailyPnl: 12_412,
    agentRuns24h: 412,
    apiCalls24h: 1804,
    cost24h: 14.2,
    riskScore: 18,
    status: "active",
  },
  {
    id: "user-sasha",
    name: "Sasha Park",
    email: "sasha@parkresearch.co",
    plan: "pro",
    joined: ago(120 * DAY),
    lastSeen: ago(20 * 60 * 1000),
    mode: "live",
    equity: 412_300,
    openPositions: 8,
    dailyPnl: 1_238,
    agentRuns24h: 84,
    apiCalls24h: 412,
    cost24h: 3.18,
    riskScore: 32,
    status: "active",
  },
  {
    id: "user-evren",
    name: "Evren Yıldız",
    email: "evren@istanbulalpha.tr",
    plan: "pro",
    joined: ago(80 * DAY),
    lastSeen: ago(4 * HOUR),
    mode: "live",
    equity: 188_400,
    openPositions: 5,
    dailyPnl: -612,
    agentRuns24h: 24,
    apiCalls24h: 188,
    cost24h: 1.42,
    riskScore: 41,
    status: "flagged",
  },
  {
    id: "user-priya",
    name: "Priya Iyer",
    email: "priya@iyer.partners",
    plan: "starter",
    joined: ago(45 * DAY),
    lastSeen: ago(8 * HOUR),
    mode: "paper",
    equity: 80_120,
    openPositions: 3,
    dailyPnl: 240,
    agentRuns24h: 18,
    apiCalls24h: 96,
    cost24h: 0.62,
    riskScore: 22,
    status: "active",
  },
  {
    id: "user-luca",
    name: "Luca Rossi",
    email: "luca@rossi.it",
    plan: "starter",
    joined: ago(28 * DAY),
    lastSeen: ago(12 * HOUR),
    mode: "paper",
    equity: 42_000,
    openPositions: 2,
    dailyPnl: -120,
    agentRuns24h: 12,
    apiCalls24h: 60,
    cost24h: 0.38,
    riskScore: 15,
    status: "active",
  },
  {
    id: "user-naomi",
    name: "Naomi Adebayo",
    email: "naomi@lagosalpha.ng",
    plan: "free",
    joined: ago(14 * DAY),
    lastSeen: ago(2 * DAY),
    mode: "paper",
    equity: 0,
    openPositions: 0,
    dailyPnl: 0,
    agentRuns24h: 0,
    apiCalls24h: 4,
    cost24h: 0.02,
    riskScore: 8,
    status: "active",
  },
  {
    id: "user-felix",
    name: "Felix Hartmann",
    email: "felix@hartmann.de",
    plan: "free",
    joined: ago(3 * DAY),
    lastSeen: ago(3 * DAY),
    mode: "paper",
    equity: 0,
    openPositions: 0,
    dailyPnl: 0,
    agentRuns24h: 0,
    apiCalls24h: 0,
    cost24h: 0,
    riskScore: 0,
    status: "active",
  },
  {
    id: "user-kai",
    name: "Kai Nakamura",
    email: "kai@nakamura.jp",
    plan: "pro",
    joined: ago(60 * DAY),
    lastSeen: ago(6 * HOUR),
    mode: "live",
    equity: 612_000,
    openPositions: 12,
    dailyPnl: 4_200,
    agentRuns24h: 144,
    apiCalls24h: 612,
    cost24h: 4.8,
    riskScore: 28,
    status: "active",
  },
  {
    id: "user-rashida",
    name: "Rashida Khan",
    email: "rashida@khansolutions.pk",
    plan: "starter",
    joined: ago(7 * DAY),
    lastSeen: ago(7 * DAY),
    mode: "paper",
    equity: 12_000,
    openPositions: 1,
    dailyPnl: -42,
    agentRuns24h: 6,
    apiCalls24h: 24,
    cost24h: 0.18,
    riskScore: 12,
    status: "suspended",
  },
];
