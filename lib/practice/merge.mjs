// The owner's merge of one PR (clerk merge, clerk#166): whether it may go ahead. Pure.
// pr: a REST pull (`repos/<o>/<r>/pulls/<n>`); sha: the head the owner reviewed. -> null, or the reason it may not.
export function mergeRefusal(pr, sha) {
  if (pr.merged_at) return 'it is already merged';
  if (pr.state !== 'open') return `it is ${pr.state}`;
  if (pr.draft) return 'it is a draft';
  if (pr.head?.sha !== sha) return `its head is now ${String(pr.head?.sha).slice(0, 7)}, not ${sha.slice(0, 7)}: review the new commit first`;
  // unknown: GitHub has not computed it yet (reading the PR starts that); retry in a moment
  if (pr.mergeable_state !== 'clean') return `GitHub says it is ${pr.mergeable_state}: only a clean PR merges (green, up to date, no conflicts)`;
  return null;
}
