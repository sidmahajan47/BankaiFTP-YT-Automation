# React/shadcn Migration Notes

This repository currently serves a static HTML dashboard from `dashboard.py`.
It does not have a React, TypeScript, Tailwind CSS, or shadcn project structure yet:

- no `package.json`
- no `tsconfig.json`
- no `tailwind.config.*`
- no `components.json`
- no `/components/ui` directory

The current dashboard background was implemented directly in `driveftp.html`
as CSS, because there is no React build pipeline for `framer-motion`.

## Recommended Setup

Create a React application with TypeScript, Tailwind CSS, and shadcn:

```bash
npm create vite@latest dashboard-react -- --template react-ts
cd dashboard-react
npm install
npm install -D tailwindcss @tailwindcss/vite
npx shadcn@latest init
npm install framer-motion lucide-react
```

For a Next.js-based shadcn app:

```bash
npx create-next-app@latest dashboard-react --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd dashboard-react
npx shadcn@latest init
npm install framer-motion lucide-react
```

## Component And Style Paths

Use the default shadcn component path:

```text
components/ui
```

This path matters because most shadcn examples and imports assume:

```tsx
import { ComponentName } from "@/components/ui/component-name";
```

If the app uses a `src` directory, the equivalent path is usually:

```text
src/components/ui
```

In that case, confirm the `@/*` alias points to `src/*` in `tsconfig.json`.

Global styles are normally stored in one of these paths, depending on framework:

```text
app/globals.css
src/index.css
src/App.css
```

## Gradient Dots Component

Create:

```text
components/ui/gradient-dots.tsx
```

Then paste:

```tsx
'use client';

import React from 'react';
import { motion } from 'framer-motion';

type GradientDotsProps = React.ComponentProps<typeof motion.div> & {
  dotSize?: number;
  spacing?: number;
  duration?: number;
  colorCycleDuration?: number;
  backgroundColor?: string;
};

export function GradientDots({
  dotSize = 8,
  spacing = 10,
  duration = 30,
  colorCycleDuration = 6,
  backgroundColor = 'var(--background)',
  className,
  ...props
}: GradientDotsProps) {
  const hexSpacing = spacing * 1.732;

  return (
    <motion.div
      className={`absolute inset-0 ${className}`}
      style={{
        backgroundColor,
        backgroundImage: `
          radial-gradient(circle at 50% 50%, transparent 1.5px, ${backgroundColor} 0 ${dotSize}px, transparent ${dotSize}px),
          radial-gradient(circle at 50% 50%, transparent 1.5px, ${backgroundColor} 0 ${dotSize}px, transparent ${dotSize}px),
          radial-gradient(circle at 50% 50%, #f00, transparent 60%),
          radial-gradient(circle at 50% 50%, #ff0, transparent 60%),
          radial-gradient(circle at 50% 50%, #0f0, transparent 60%),
          radial-gradient(ellipse at 50% 50%, #00f, transparent 60%)
        `,
        backgroundSize: `
          ${spacing}px ${hexSpacing}px,
          ${spacing}px ${hexSpacing}px,
          200% 200%,
          200% 200%,
          200% 200%,
          200% ${hexSpacing}px
        `,
        backgroundPosition: `
          0px 0px, ${spacing / 2}px ${hexSpacing / 2}px,
          0% 0%,
          0% 0%,
          0% 0px
        `,
      }}
      animate={{
        backgroundPosition: [
          `0px 0px, ${spacing / 2}px ${hexSpacing / 2}px, 800% 400%, 1000% -400%, -1200% -600%, 400% ${hexSpacing}px`,
          `0px 0px, ${spacing / 2}px ${hexSpacing / 2}px, 0% 0%, 0% 0%, 0% 0%, 0% 0%`,
        ],
        filter: ['hue-rotate(0deg)', 'hue-rotate(360deg)'],
      }}
      transition={{
        backgroundPosition: {
          duration,
          ease: 'linear',
          repeat: Number.POSITIVE_INFINITY,
        },
        filter: {
          duration: colorCycleDuration,
          ease: 'linear',
          repeat: Number.POSITIVE_INFINITY,
        },
      }}
      {...props}
    />
  );
}
```

Use it behind the dashboard shell:

```tsx
import { GradientDots } from "@/components/ui/gradient-dots";

export default function Dashboard() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <GradientDots duration={20} />
      <section className="relative z-10">
        {/* dashboard content */}
      </section>
    </main>
  );
}
```

No extra context providers or hooks are required. The component only accepts
visual props and can be used as a full-page absolute background.
