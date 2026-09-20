import type { HTMLAttributes } from 'react';

/**
 * Mono uppercase meta label — section labels, timezone names, UTC offsets,
 * "12 min ago" style timestamps. Renders as a <span> by default; pass `as`
 * to get a <div> or <p> when the label needs to be its own block, or a
 * heading level when the label genuinely titles a section — rendering a
 * section title as a <div> would flatten the document outline for screen
 * readers, which is exactly the kind of structure they navigate by.
 */
export function Meta({
  as: Tag = 'span',
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: 'span' | 'div' | 'p' | 'h2' | 'h3' | 'h4' }) {
  return (
    <Tag className={`meta ${className}`} {...props}>
      {children}
    </Tag>
  );
}
