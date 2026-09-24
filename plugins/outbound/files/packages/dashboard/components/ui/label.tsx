import { forwardRef, type LabelHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const Label = forwardRef<
  HTMLLabelElement,
  LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => {
  return (
    <label
      ref={ref}
      className={cn("text-sm font-medium leading-none", className)}
      {...props}
    />
  );
});
Label.displayName = "Label";
