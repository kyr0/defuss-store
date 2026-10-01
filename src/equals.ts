/** JSON.stringify comparison. Order-sensitive and unsuitable for non-JSON data. */
export const jsonEquals = <T>(a: T, b: T): boolean => JSON.stringify(a) === JSON.stringify(b);
