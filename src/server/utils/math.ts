import { Decimal } from "@prisma/client/runtime/library";

export function roundHalfUp(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function toDecimal(value: number, decimals = 2): Decimal {
  return new Decimal(roundHalfUp(value, decimals).toFixed(decimals));
}

export function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value == null) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  return value.toNumber();
}
