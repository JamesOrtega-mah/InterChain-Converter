import { describe, it, expect, beforeEach } from "vitest";
import { principalCV, uintCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 4000;
const ERR_INVALID_AMOUNT = 4001;
const ERR_NO_ROUTE = 4002;
const ERR_SLIPPAGE = 4003;
const ERR_INVALID_PAIR = 4004;
const ERR_INVALID_FEE = 4005;
const ERR_PAIR_ALREADY_EXISTS = 4006;
const ERR_PAIR_NOT_FOUND = 4007;
const ERR_INVALID_TOKEN = 4008;
const ERR_INSUFFICIENT_LIQUIDITY = 4009;
const ERR_INVALID_PATH = 4010;
const ERR_MAX_PATH_LENGTH = 4011;
const ERR_FEE_TRANSFER_FAILED = 4012;
const ERR_SWAP_FAILED = 4013;
const ERR_INVALID_MIN_OUT = 4014;
const ERR_PAUSED = 4015;
const ERR_INVALID_ADMIN = 4016;
const ERR_INVALID_ORACLE = 4017;
const ERR_STALE_PRICE = 4018;
const ERR_INVALID_DECIMALS = 4019;
const ERR_MATH_OVERFLOW = 4020;

interface Pair {
  fee: number;
  active: boolean;
}

interface Route {
  path: string[];
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class SwapEngineMock {
  state: {
    admin: string;
    protocolFee: number;
    feeRecipient: string;
    paused: boolean;
    maxPathLength: number;
    oracleContract: string;
    liquidityThreshold: number;
    supportedTokens: Map<string, boolean>;
    pairs: Map<string, Pair>;
    routes: Map<string, Route>;
  } = {
    admin: "ST1ADMIN",
    protocolFee: 100,
    feeRecipient: "ST1ADMIN",
    paused: false,
    maxPathLength: 5,
    oracleContract: "SP000000000000000000002Q6VF78.price-oracle",
    liquidityThreshold: 1000000,
    supportedTokens: new Map(),
    pairs: new Map(),
    routes: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  transfers: Array<{ token: string; amount: number; from: string; to: string }> = [];
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      admin: "ST1ADMIN",
      protocolFee: 100,
      feeRecipient: "ST1ADMIN",
      paused: false,
      maxPathLength: 5,
      oracleContract: "SP000000000000000000002Q6VF78.price-oracle",
      liquidityThreshold: 1000000,
      supportedTokens: new Map(),
      pairs: new Map(),
      routes: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
    this.transfers = [];
    this.stxTransfers = [];
  }

  getPairKey(from: string, to: string): string {
    return `${from}-${to}`;
  }

  getRouteKey(from: string, to: string): string {
    return `${from}-${to}`;
  }

  getPair(from: string, to: string): Pair | undefined {
    return this.state.pairs.get(this.getPairKey(from, to));
  }

  getRoute(from: string, to: string): Route | undefined {
    return this.state.routes.get(this.getRouteKey(from, to));
  }

  isTokenSupported(token: string): boolean {
    return this.state.supportedTokens.get(token) ?? false;
  }

  getProtocolFee(): number {
    return this.state.protocolFee;
  }

  getFeeRecipient(): string {
    return this.state.feeRecipient;
  }

  isPaused(): boolean {
    return this.state.paused;
  }

  addToken(token: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    if (this.isTokenSupported(token)) return { ok: false, value: false };
    this.state.supportedTokens.set(token, true);
    return { ok: true, value: true };
  }

  addPair(from: string, to: string, fee: number): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    if (!this.isTokenSupported(from) || !this.isTokenSupported(to)) return { ok: false, value: false };
    if (fee > 500) return { ok: false, value: false };
    const key = this.getPairKey(from, to);
    if (this.state.pairs.has(key)) return { ok: false, value: false };
    this.state.pairs.set(key, { fee, active: true });
    return { ok: true, value: true };
  }

  setRoute(from: string, to: string, path: string[]): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    if (path.length < 2 || path.length > this.state.maxPathLength) return { ok: false, value: false };
    if (path[0] !== from || path[path.length - 1] !== to) return { ok: false, value: false };
    const key = this.getRouteKey(from, to);
    this.state.routes.set(key, { path });
    return { ok: true, value: true };
  }

  mockOraclePrice(from: string, to: string, rate: number, timestamp: number): void {}

  swap(fromToken: string, toToken: string, amount: number, minOut: number): Result<number> {
    if (this.state.paused) return { ok: false, value: ERR_PAUSED };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (minOut <= 0) return { ok: false, value: ERR_INVALID_MIN_OUT };
    if (!this.isTokenSupported(fromToken) || !this.isTokenSupported(toToken)) return { ok: false, value: ERR_INVALID_TOKEN };
    const route = this.getRoute(fromToken, toToken)?.path ?? [fromToken, toToken];
    let currentAmount = amount;
    let currentToken = fromToken;
    for (let i = 1; i < route.length; i++) {
      const nextToken = route[i];
      const pair = this.getPair(currentToken, nextToken);
      if (!pair) return { ok: false, value: ERR_INVALID_PAIR };
      const price = { rate: 2, timestamp: this.blockHeight };
      if (this.blockHeight - price.timestamp >= 10) return { ok: false, value: ERR_STALE_PRICE };
      const amountOut = currentAmount * price.rate;
      const fee = (amountOut * pair.fee) / 10000;
      const netOut = amountOut - fee;
      this.transfers.push({ token: currentToken, amount: currentAmount, from: this.caller, to: "contract" });
      this.transfers.push({ token: nextToken, amount: netOut, from: "contract", to: this.caller });
      this.stxTransfers.push({ amount: fee, from: this.caller, to: this.state.feeRecipient });
      currentAmount = netOut;
      currentToken = nextToken;
    }
    if (currentAmount < minOut) return { ok: false, value: ERR_SLIPPAGE };
    return { ok: true, value: currentAmount };
  }

  setProtocolFee(newFee: number): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    if (newFee > 500) return { ok: false, value: false };
    this.state.protocolFee = newFee;
    return { ok: true, value: true };
  }

  setFeeRecipient(newRecipient: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    this.state.feeRecipient = newRecipient;
    return { ok: true, value: true };
  }

  pause(): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpause(): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    this.state.paused = false;
    return { ok: true, value: true };
  }

  setAdmin(newAdmin: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  setOracle(newOracle: string): Result<boolean> {
    if (this.caller !== this.state.admin) return { ok: false, value: false };
    this.state.oracleContract = newOracle;
    return { ok: true, value: true };
  }
}

describe("SwapEngine", () => {
  let contract: SwapEngineMock;

  beforeEach(() => {
    contract = new SwapEngineMock();
    contract.reset();
  });

  it("adds a token successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.addToken("STTOKEN1");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.isTokenSupported("STTOKEN1")).toBe(true);
  });

  it("rejects add token by non-admin", () => {
    const result = contract.addToken("STTOKEN1");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("adds a pair successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.addToken("STTOKEN1");
    contract.addToken("STTOKEN2");
    const result = contract.addPair("STTOKEN1", "STTOKEN2", 50);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const pair = contract.getPair("STTOKEN1", "STTOKEN2");
    expect(pair?.fee).toBe(50);
    expect(pair?.active).toBe(true);
  });

  it("rejects add pair with invalid fee", () => {
    contract.caller = "ST1ADMIN";
    contract.addToken("STTOKEN1");
    contract.addToken("STTOKEN2");
    const result = contract.addPair("STTOKEN1", "STTOKEN2", 600);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets a route successfully", () => {
    contract.caller = "ST1ADMIN";
    const path = ["STTOKEN1", "STTOKEN2", "STTOKEN3"];
    const result = contract.setRoute("STTOKEN1", "STTOKEN3", path);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const route = contract.getRoute("STTOKEN1", "STTOKEN3");
    expect(route?.path).toEqual(path);
  });

  it("rejects invalid path in set route", () => {
    contract.caller = "ST1ADMIN";
    const path = ["STTOKEN1"];
    const result = contract.setRoute("STTOKEN1", "STTOKEN2", path);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("executes a simple swap successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.addToken("STTOKEN1");
    contract.addToken("STTOKEN2");
    contract.addPair("STTOKEN1", "STTOKEN2", 100);
    contract.caller = "ST1TEST";
    const result = contract.swap("STTOKEN1", "STTOKEN2", 1000, 1800);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1980);
  });

  it("rejects swap when paused", () => {
    contract.caller = "ST1ADMIN";
    contract.pause();
    const result = contract.swap("STTOKEN1", "STTOKEN2", 1000, 900);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects swap with slippage", () => {
    contract.caller = "ST1ADMIN";
    contract.addToken("STTOKEN1");
    contract.addToken("STTOKEN2");
    contract.addPair("STTOKEN1", "STTOKEN2", 100);
    contract.caller = "ST1TEST";
    const result = contract.swap("STTOKEN1", "STTOKEN2", 1000, 2000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_SLIPPAGE);
  });

  it("sets protocol fee successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setProtocolFee(200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getProtocolFee()).toBe(200);
  });

  it("sets fee recipient successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setFeeRecipient("STNEWRECIPIENT");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getFeeRecipient()).toBe("STNEWRECIPIENT");
  });

  it("pauses and unpauses successfully", () => {
    contract.caller = "ST1ADMIN";
    contract.pause();
    expect(contract.isPaused()).toBe(true);
    contract.unpause();
    expect(contract.isPaused()).toBe(false);
  });

  it("sets admin successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setAdmin("STNEWADMIN");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.admin).toBe("STNEWADMIN");
  });

  it("sets oracle successfully", () => {
    contract.caller = "ST1ADMIN";
    const result = contract.setOracle("STNEWORACLE");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.oracleContract).toBe("STNEWORACLE");
  });
});