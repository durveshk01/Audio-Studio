export const errorMessage = (error: unknown, fallback = "The operation could not be completed."): string => error instanceof Error ? error.message : fallback;
export const isCancelled = (error: unknown): boolean => error instanceof Error && (error.name === "AbortError" || /cancelled|canceled/i.test(error.message));
