import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25)
});

export type Pagination = z.infer<typeof paginationSchema>;

export function paginationOffset(pagination: Pagination): number {
  return (pagination.page - 1) * pagination.limit;
}
