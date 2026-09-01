import { generateUuidV7, isUuidV7, type UuidV7 } from "./uuid";

export type CorrelationId = UuidV7 & { readonly __correlationBrand: "CorrelationId" };

export type CorrelationResolution = Readonly<{
  id: CorrelationId;
  acceptedIncoming: boolean;
}>;

export function isCorrelationId(value: unknown): value is CorrelationId {
  return isUuidV7(value);
}

export function resolveCorrelationId(
  candidate: unknown,
  create: () => UuidV7 = generateUuidV7,
): CorrelationResolution {
  if (isCorrelationId(candidate)) return { acceptedIncoming: true, id: candidate };
  return { acceptedIncoming: false, id: create() as CorrelationId };
}
