"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ToastKind = "default" | "danger";

export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {children}
      <ToastViewport />
    </ToastPrimitive.Provider>
  );
}

export function ToastViewport() {
  return (
    <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
  );
}

export function Toast({
  open,
  onOpenChange,
  title,
  description,
  kind = "default"
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  kind?: ToastKind;
}) {
  return (
    <ToastPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      className={cn(
        "glass rounded-2xl p-4 data-[state=open]:animate-in data-[state=closed]:animate-out",
        kind === "danger" && "ring-1 ring-red-500/30"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <ToastPrimitive.Title className="text-sm font-semibold">
            {title}
          </ToastPrimitive.Title>
          {description ? (
            <ToastPrimitive.Description className="mt-1 text-sm text-muted-foreground">
              {description}
            </ToastPrimitive.Description>
          ) : null}
        </div>
        <ToastPrimitive.Close asChild>
          <button
            className="rounded-lg p-1 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </ToastPrimitive.Close>
      </div>
    </ToastPrimitive.Root>
  );
}

