"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Plus, Lock, Tag } from "lucide-react";
import type { CategoryRow } from "@spencare/domain-application";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CATEGORY_ICONS, getCategoryIcon } from "@/lib/category-icons";
import { createCategoryAction, updateCategoryAction, deleteCategoryAction } from "@/app/settings/actions";

function CategoryIconDisplay({ iconName }: { iconName: string | null }) {
  const Icon = getCategoryIcon(iconName);
  if (Icon) return <Icon className="size-4" aria-hidden="true" />;
  return <Tag className="size-4 text-muted-foreground" aria-hidden="true" />;
}

function IconPicker({ selected, onSelect }: { selected: string | null; onSelect: (name: string) => void }) {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {CATEGORY_ICONS.map(({ name, label, Icon }) => (
        <button
          key={name}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={selected === name}
          onClick={() => onSelect(name)}
          className={cn(
            "flex size-9 items-center justify-center rounded-md border transition-colors",
            "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected === name ? "border-primary bg-primary/10 text-primary" : "border-transparent text-muted-foreground",
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

function CategorySheet({
  open,
  onOpenChange,
  title,
  initialName,
  initialIcon,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialName: string;
  initialIcon: string | null;
  submitLabel: string;
  onSubmit: (name: string, icon: string | null) => Promise<string | null>;
}) {
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<string | null>(initialIcon);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setName(initialName);
      setIcon(initialIcon);
      setError(null);
    }
    onOpenChange(next);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const err = await onSubmit(name.trim(), icon);
      if (err) {
        setError(err);
      } else {
        onOpenChange(false);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full max-w-sm">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="cat-name">Name</Label>
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              placeholder="e.g. Subscriptions"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label>Icon</Label>
            <IconPicker selected={icon} onSelect={(n) => setIcon(n)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={isPending || name.trim().length === 0}>
            {isPending ? "Saving…" : submitLabel}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function DeleteCategoryDialog({
  category,
  reassignOptions,
  onClose,
  onDeleted,
}: {
  category: CategoryRow;
  reassignOptions: CategoryRow[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [reassignTo, setReassignTo] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const options = reassignOptions.filter((c) => c.id !== category.id);

  function handleConfirm() {
    if (!reassignTo) {
      setError("Select a category to move existing transactions to.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await deleteCategoryAction({ categoryId: category.id, reassignToCategoryId: reassignTo });
      if (!result.ok) {
        setError(result.error.message);
      } else {
        onDeleted();
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open: boolean) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{category.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            This category will be archived. Any transactions currently tagged with it will be moved to the category you
            choose below.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-2">
          <Label htmlFor="reassign-select">Move transactions to</Label>
          <Select value={reassignTo} onValueChange={setReassignTo}>
            <SelectTrigger id="reassign-select">
              <SelectValue placeholder="Choose a category…" />
            </SelectTrigger>
            <SelectContent>
              {options.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={isPending || !reassignTo}>
            {isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CategoryManager({ initialCategories }: { initialCategories: CategoryRow[] }) {
  const router = useRouter();
  const categories = initialCategories;

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [deleting, setDeleting] = useState<CategoryRow | null>(null);

  const systemCategories = categories.filter((c) => c.is_system);
  const customCategories = categories.filter((c) => !c.is_system);

  function handleMutated() {
    router.refresh();
  }

  async function handleCreate(name: string, icon: string | null): Promise<string | null> {
    const result = await createCategoryAction({ name, icon });
    if (!result.ok) return result.error.message;
    handleMutated();
    return null;
  }

  async function handleUpdate(name: string, icon: string | null): Promise<string | null> {
    if (!editing) return null;
    const result = await updateCategoryAction({ categoryId: editing.id, name, icon });
    if (!result.ok) return result.error.message;
    handleMutated();
    return null;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Categories</h1>
        <Button size="touch" onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 size-4" aria-hidden="true" />
          Add category
        </Button>
      </div>

      {/* Custom categories */}
      <section aria-labelledby="custom-heading">
        <h2 id="custom-heading" className="mb-3 text-sm font-medium text-muted-foreground">
          Custom
        </h2>
        {customCategories.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No custom categories yet. Add one to start organising your transactions your way.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <ul className="divide-y">
              {customCategories.map((cat) => (
                <li key={cat.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                    <CategoryIconDisplay iconName={cat.icon} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{cat.name}</span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Edit ${cat.name}`}
                      onClick={() => setEditing(cat)}
                    >
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${cat.name}`}
                      className="text-destructive hover:text-destructive"
                      onClick={() => setDeleting(cat)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      {/* System categories */}
      <section aria-labelledby="system-heading">
        <h2 id="system-heading" className="mb-3 text-sm font-medium text-muted-foreground">
          System
        </h2>
        <Card>
          <ul className="divide-y">
            {systemCategories.map((cat) => (
              <li key={cat.id} className="flex items-center gap-3 px-4 py-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <CategoryIconDisplay iconName={cat.icon} />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{cat.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  <Lock className="size-3" aria-hidden="true" />
                  System
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* Create sheet */}
      <CategorySheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New category"
        initialName=""
        initialIcon={null}
        submitLabel="Create"
        onSubmit={handleCreate}
      />

      {/* Edit sheet */}
      {editing && (
        <CategorySheet
          open={!!editing}
          onOpenChange={(open: boolean) => { if (!open) setEditing(null); }}
          title={`Edit "${editing.name}"`}
          initialName={editing.name}
          initialIcon={editing.icon}
          submitLabel="Save changes"
          onSubmit={handleUpdate}
        />
      )}

      {/* Delete dialog */}
      {deleting && (
        <DeleteCategoryDialog
          category={deleting}
          reassignOptions={categories}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            handleMutated();
          }}
        />
      )}
    </div>
  );
}
