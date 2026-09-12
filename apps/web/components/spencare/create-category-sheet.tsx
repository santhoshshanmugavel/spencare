"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { createCategorySchema, type CreateCategoryInput } from "@spencare/validation";
import type { CategoryRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FormField } from "@/components/spencare/form-field";
import { toastConfirmed, toastError } from "@/lib/toast";
import { CATEGORY_ICONS } from "@/lib/category-icons";
import { createCategoryAction } from "@/app/cash-flow/transactions/actions";
import { cn } from "@/lib/utils";

function IconPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (name: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = search
    ? CATEGORY_ICONS.filter(
        (i) =>
          i.label.toLowerCase().includes(search.toLowerCase()) ||
          i.name.toLowerCase().includes(search.toLowerCase()),
      )
    : CATEGORY_ICONS;

  return (
    <div className="space-y-2">
      <Input
        placeholder="Search icons…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search icons"
        className="h-8 text-sm"
      />
      <div
        className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto rounded-md border p-2"
        role="listbox"
        aria-label="Category icon picker"
      >
        {filtered.map(({ name, label, Icon }) => (
          <button
            key={name}
            type="button"
            role="option"
            aria-selected={value === name}
            aria-label={label}
            title={label}
            onClick={() => onChange(value === name ? null : name)}
            className={cn(
              "flex items-center justify-center rounded p-1.5 transition-colors",
              "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === name && "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-8 py-4 text-center text-xs text-muted-foreground">No icons found.</p>
        )}
      </div>
    </div>
  );
}

interface CreateCategorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (category: CategoryRow) => void;
}

export function CreateCategorySheet({ open, onOpenChange, onCreated }: CreateCategorySheetProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateCategoryInput>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: { name: "", icon: null },
  });

  const selectedIcon = watch("icon") ?? null;

  async function onSubmit(data: CreateCategoryInput) {
    const result = await createCategoryAction(data);
    if (!result.ok) {
      toastError(result.error.message);
      return;
    }
    toastConfirmed(`"${result.value.name}" category created.`);
    reset();
    onCreated(result.value);
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>New category</SheetTitle>
          <SheetDescription>Create a custom category for your transactions.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 px-4">
          <FormField id="cat-name" label="Category name" error={errors.name?.message}>
            <Input
              id="cat-name"
              placeholder="Eg: Subscriptions"
              autoFocus
              {...register("name")}
            />
          </FormField>
          <FormField id="cat-icon" label="Icon (optional)">
            <IconPicker value={selectedIcon} onChange={(v) => setValue("icon", v)} />
          </FormField>
          <Button type="submit" size="touch" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create category"}
          </Button>
        </form>
        <SheetFooter />
      </SheetContent>
    </Sheet>
  );
}
