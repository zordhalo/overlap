import type { HTMLAttributes } from 'react';

/**
 * Mono uppercase meta label — section labels, timezone names, UTC offsets,
 * "12 min ago" style timestamps. Renders as a <span> by default; pass `as`
 * to get a <div> or <p> when the label needs to be its own block.
 */
export function Meta({
  as: Tag = 'span',
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: 'span' | 'div' | 'p' }) {
  return (
    <Tag className={`meta ${className}`} {...props}>
      {children}
    </Tag>
  );
}
