/**
 * Loading placeholder that reserves roughly the height of the content it stands in
 * for, so the three-pane layout doesn't jump when data pops in. role=status makes
 * the loading state audible to screen readers; the pulse animation only runs when
 * the user allows motion (see styles.css).
 */
export function SkeletonLines({ lines = 4, label }: { lines?: number; label: string }) {
  return (
    <div className="skeleton-group" role="status" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton-line" aria-hidden="true" />
      ))}
    </div>
  )
}
