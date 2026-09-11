import { describe, expect, it } from "vitest";
import { cents, dollars, human, isPositiveDecimal, shortAddress, trimZeros } from "../src/lib/format.js";

describe("cents", () => {
  it("renders a unit price as cents with two decimals", () => {
    expect(cents("0.505")).toBe("50.50¢");
    expect(cents("1")).toBe("100.00¢");
  });
  it("shows a dash instead of a confident zero when there is no value", () => {
    expect(cents(null)).toBe("—");
    expect(cents(undefined)).toBe("—");
  });
});

describe("dollars", () => {
  it("keeps tiny real savings visible instead of rounding them to zero", () => {
    expect(dollars("0.000003")).toBe("$0.000003");
  });
  it("uses two decimals for ordinary amounts and a dash for missing ones", () => {
    expect(dollars("5.6")).toBe("$5.60");
    expect(dollars("0")).toBe("$0.00");
    expect(dollars(null)).toBe("—");
    expect(dollars("not a number")).toBe("—");
  });
});

describe("human", () => {
  it("scales raw on-chain integers by the market decimals", () => {
    expect(human(1_000_000n, 6)).toBe("1");
    expect(human("505000", 6)).toBe("0.505");
  });
  it("passes already-decimal strings through untouched", () => {
    expect(human("0.001", 6)).toBe("0.001");
  });
});

describe("input validation", () => {
  it("accepts positive decimals only", () => {
    expect(isPositiveDecimal("0.001")).toBe(true);
    expect(isPositiveDecimal("100000")).toBe(true);
    expect(isPositiveDecimal("0")).toBe(false);
    expect(isPositiveDecimal("-1")).toBe(false);
    expect(isPositiveDecimal("abc")).toBe(false);
  });
});

describe("display helpers", () => {
  it("shortens addresses and hashes for tables", () => {
    expect(shortAddress("0x69eb1bAA26BffCD0fA9089aa2187F6Ca3e2A54f6")).toBe("0x69eb…54f6");
    expect(shortAddress(null)).toBe("—");
  });
  it("trims trailing zeros from remaining quantities", () => {
    expect(trimZeros(0.5)).toBe("0.5");
    expect(trimZeros(0)).toBe("0");
    expect(trimZeros(2)).toBe("2");
  });
});
