import { createCategorySchema, type CreateCategoryInput } from "@spencare/validation";
import {
  createCategory as createCategoryRow,
  updateCategory as updateCategoryRow,
  archiveCategory as archiveCategoryRow,
  reassignCategoryInTransactions,
  countTransactionsForCategory,
  type CategoryRow,
} from "@spencare/domain-infra";
import { err, ok, type AuthContext, type Command, type Result } from "../types.js";

export const createCategory: Command<CreateCategoryInput, CategoryRow> = {
  name: "createCategory",
  consequential: false,
  async execute(ctx: AuthContext, input: CreateCategoryInput): Promise<Result<CategoryRow>> {
    const parsed = createCategorySchema.safeParse(input);
    if (!parsed.success) {
      return err({
        code: "validation_error",
        message: parsed.error.issues[0]?.message ?? "Invalid category details.",
      });
    }
    try {
      const row = await createCategoryRow(ctx.supabase, ctx.userId, {
        name: parsed.data.name,
        icon: parsed.data.icon ?? null,
      });
      return ok(row);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return err({ code: "duplicate_name", message: "You already have a category with that name." });
      }
      return err({ code: "create_failed", message: "Couldn't create the category. Try again." });
    }
  },
};

export interface UpdateCategoryInput {
  categoryId: string;
  name?: string;
  icon?: string | null;
}

export const updateCategory: Command<UpdateCategoryInput, CategoryRow> = {
  name: "updateCategory",
  consequential: false,
  async execute(ctx: AuthContext, input: UpdateCategoryInput): Promise<Result<CategoryRow>> {
    if (!input.categoryId) {
      return err({ code: "validation_error", message: "Category ID is required." });
    }
    if (input.name !== undefined && (input.name.trim().length === 0 || input.name.length > 50)) {
      return err({ code: "validation_error", message: "Category name must be 1–50 characters." });
    }
    try {
      const row = await updateCategoryRow(ctx.supabase, ctx.userId, input.categoryId, {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.icon !== undefined && { icon: input.icon }),
      });
      return ok(row);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("unique") || msg.includes("duplicate")) {
        return err({ code: "duplicate_name", message: "You already have a category with that name." });
      }
      if (msg.includes("No rows") || msg.includes("PGRST116")) {
        return err({ code: "not_found", message: "Category not found or cannot be modified." });
      }
      return err({ code: "update_failed", message: "Couldn't update the category. Try again." });
    }
  },
};

export interface DeleteCategoryInput {
  categoryId: string;
  reassignToCategoryId: string;
}

export const deleteCategory: Command<DeleteCategoryInput, void> = {
  name: "deleteCategory",
  consequential: true,
  async execute(ctx: AuthContext, input: DeleteCategoryInput): Promise<Result<void>> {
    if (!input.categoryId) {
      return err({ code: "validation_error", message: "Category ID is required." });
    }
    if (!input.reassignToCategoryId) {
      return err({ code: "validation_error", message: "A replacement category is required before deleting." });
    }
    if (input.categoryId === input.reassignToCategoryId) {
      return err({ code: "validation_error", message: "Replacement category must differ from the one being deleted." });
    }
    try {
      // Reassign transactions first so no transaction is ever orphaned
      const count = await countTransactionsForCategory(ctx.supabase, ctx.userId, input.categoryId);
      if (count > 0) {
        await reassignCategoryInTransactions(ctx.supabase, ctx.userId, input.categoryId, input.reassignToCategoryId);
      }
      await archiveCategoryRow(ctx.supabase, ctx.userId, input.categoryId);
      return ok(undefined);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("No rows") || msg.includes("PGRST116")) {
        return err({ code: "not_found", message: "Category not found or is a system category." });
      }
      return err({ code: "delete_failed", message: "Couldn't delete the category. Try again." });
    }
  },
};
