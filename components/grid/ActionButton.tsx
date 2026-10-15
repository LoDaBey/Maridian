"use client";

import { motion, type HTMLMotionProps } from "framer-motion";

export function ActionButton({ className, type = "button", disabled, ...props }: HTMLMotionProps<"button">) {
  return (
    <motion.button
      {...props}
      type={type}
      disabled={disabled}
      layout
      whileHover={disabled ? undefined : { scale: 1.05 }}
      whileTap={disabled ? undefined : { scale: 0.95 }}
      transition={{ type: "spring", stiffness: 420, damping: 28 }}
      className={className}
    />
  );
}
