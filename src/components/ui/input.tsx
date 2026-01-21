import * as React from "react"

import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Set to false to disable auto-uppercase for text inputs */
  autoUppercase?: boolean
}

// Input types that should NOT be auto-uppercased
const noUppercaseTypes = ['password', 'email', 'date', 'datetime-local', 'time', 'month', 'week', 'number', 'range', 'color', 'file', 'hidden']

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onChange, autoUppercase = true, ...props }, ref) => {
    // Determine if this input should be uppercased
    const shouldUppercase = autoUppercase && !noUppercaseTypes.includes(type || 'text')

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (shouldUppercase) {
        // Convert value to uppercase
        e.target.value = e.target.value.toUpperCase()
      }
      // Call original onChange if provided
      onChange?.(e)
    }

    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          shouldUppercase && "uppercase",
          className
        )}
        ref={ref}
        onChange={handleChange}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
