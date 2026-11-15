import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors relative before:absolute before:left-1/2 before:top-1/2 before:size-full before:min-h-11 before:min-w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0" +
" hover-elevate active-elevate-2",
  {
    variants: {
      variant: {
        default:
           // @replit: no hover, and add primary border
           "bg-primary text-primary-foreground border border-primary-border",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm border-destructive-border",
        outline:
          // @replit Shows the background color of whatever card / sidebar / accent background it is inside of.
          // Inherits the current text color. Uses shadow-xs. no shadow on active
          // No hover state
          " border [border-color:var(--button-outline)] shadow-xs active:shadow-none ",
        secondary:
          // @replit border, no hover, no shadow, secondary border.
          "border bg-secondary text-secondary-foreground border border-secondary-border ",
        // @replit no hover, transparent border
        ghost: "border border-transparent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        // @replit changed sizes
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /** Work in progress: the width stays, a spinner replaces the label, further clicks are ignored. */
  loading?: boolean
  /** Why the button cannot be pressed yet, e.g. "Name your workspace first". Shown under it. */
  disabledReason?: string
}

// The rules these follow are in CONSTITUTION.md at the repository root.
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabledReason, disabled, onClick, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    const reasonId = React.useId()
    const blocked = disabled || !!disabledReason
    const button = (
      <Comp
        className={cn(buttonVariants({ variant, size, className }), loading && "cursor-progress")}
        ref={ref}
        disabled={blocked}
        aria-busy={loading || undefined}
        aria-describedby={disabledReason ? reasonId : props["aria-describedby"]}
        onClick={loading ? (e: React.MouseEvent<HTMLButtonElement>) => e.preventDefault() : onClick}
        {...props}
      >
        {loading && !asChild ? (
          <>
            <span className="invisible contents">{children}</span>
            <span className="absolute inset-0 flex items-center justify-center" role="status" aria-label="Working">
              <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            </span>
          </>
        ) : children}
      </Comp>
    )
    if (!disabledReason) return button
    return (
      <span className="inline-flex flex-col items-start gap-1">
        {button}
        <span id={reasonId} className="text-xs text-muted-foreground">{disabledReason}</span>
      </span>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
