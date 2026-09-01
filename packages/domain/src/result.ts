export type Ok<T> = Readonly<{ ok: true; value: T }>;
export type Err<E> = Readonly<{ ok: false; error: E }>;
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return Object.freeze({ ok: true, value });
}

export function err<E>(error: E): Err<E> {
  return Object.freeze({ error, ok: false });
}

export function map<T, U, E>(result: Result<T, E>, transform: (value: T) => U): Result<U, E> {
  return result.ok ? ok(transform(result.value)) : result;
}

export function mapError<T, E, F>(
  result: Result<T, E>,
  transform: (error: E) => F,
): Result<T, F> {
  return result.ok ? result : err(transform(result.error));
}

export function flatMap<T, U, E>(
  result: Result<T, E>,
  transform: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? transform(result.value) : result;
}

export function match<T, E, U>(
  result: Result<T, E>,
  branches: Readonly<{ ok: (value: T) => U; error: (error: E) => U }>,
): U {
  return result.ok ? branches.ok(result.value) : branches.error(result.error);
}
