import type { z } from "zod";

// Zod 4's `.optional()` doesn't copy the inner description onto the wrapper, so
// tool parameter descriptions would disappear for optional fields. Re-apply it.
export function toOptional(schema: z.ZodType): z.ZodType {
  const opt = schema.optional();
  return schema.description ? opt.describe(schema.description) : opt;
}
