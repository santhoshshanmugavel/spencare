import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(80, "Name is too long."),
  icon: z.string().trim().max(50).nullable().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
