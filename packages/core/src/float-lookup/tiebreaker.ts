// §6.3 tiebreaker chain — candidate-set narrowing.
//
// Each check narrows the candidate set. Once a check has exactly one
// satisfier, it is selected. If multiple satisfy, the set is narrowed
// and the next check runs on the narrowed set. Zero satisfiers leaves
// the set unchanged (pinned-decision #5). Check 3 ("arbitrary") is
// `narrowed[0]` — deterministic per pinned-decision #4.
export function selectByTiebreaker<T>(
  candidates: T[],
  startsAtSelectedSpan: (candidate: T) => boolean,
  endsAtSelectedSpan: (candidate: T) => boolean,
): T {
  if (candidates.length === 0) {
    throw new Error('selectByTiebreaker requires at least one candidate');
  }

  let narrowed = candidates;

  const startAligned = narrowed.filter(startsAtSelectedSpan);
  if (startAligned.length === 1) {
    return startAligned[0]!;
  }
  if (startAligned.length > 1) {
    narrowed = startAligned;
  }

  const endAligned = narrowed.filter(endsAtSelectedSpan);
  if (endAligned.length === 1) {
    return endAligned[0]!;
  }
  if (endAligned.length > 1) {
    narrowed = endAligned;
  }

  return narrowed[0]!;
}
