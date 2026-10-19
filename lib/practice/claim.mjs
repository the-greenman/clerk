// Checks before a claim: pure. Same rules for a human and an agent (clerk#21, owner decision f799b6bc).
import { answersOf } from './grounding.mjs';

// Does this PR/branch refer to the issue? Shared with queue's held logic.
// ponytail: "#n" in title/body or a head branch starting "n-"; a PR in another repo citing repo#n is missed.
export const refersTo = (repo, n, p) => p.repo === repo &&
  (new RegExp(`#${n}\\b`).test(`${p.title ?? ''} ${p.body ?? ''}`) || Boolean(p.head?.ref?.startsWith(`${n}-`)));

// issue {repo, number, state, labels[], assignees[], body, timeline?}; timeline: the issue's REST timeline events, oldest first (for an open claim comment); prs: open PRs [{repo, number, title, body, head:{ref}}]; branches: remote branch names of the issue's repo;
// groups: loadGroups(); central: loadCentralGroup() (work in no chartered group's label falls to it; a labelled issue never does); affirmed: Set of problem_id ('SP-nn') affirmed in the programme; actor: id string; ownerActor: settings.ownerActor.
// -> {ok, reasons[], group, todo[]}. The owner holds builder/reviewer seats by convention (no seat record for humans yet).
export function checkClaim({ issue, prs = [], branches = [], groups = [], central, affirmed = new Set(), actor, seat, ownerActor }) {
  const reasons = [], labels = (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
  const ref = `${issue.repo}#${issue.number}`, no = (r) => reasons.push(r);
  if (issue.state?.toLowerCase() !== 'open') no(`${ref} is not open`);
  const pr = prs.find((p) => refersTo(issue.repo, issue.number, p));
  if (pr) no(`an open PR already references it (${pr.repo}#${pr.number})`);
  const br = branches.find((b) => b.startsWith(`${issue.number}-`));
  if (br) no(`a remote branch already references it (${br})`);
  const who = (issue.assignees ?? []).map((a) => a.login);
  if (who.length) no(`already assigned (${who.join(', ')})`);
  if (labels.includes('status: in progress')) no('already claimed (label "status: in progress")');
  else { const c = openClaim(issue.timeline); if (c) no(`already claimed (open claim comment by ${claimActorOf(c)})`); }
  // Jurisdiction: a chartered group's label keeps the issue with that group. Only an issue with no wg: label is the central group's.
  const wg = labels.filter((l) => l.startsWith('wg:'));
  let group = groups.find((g) => labels.includes(g.label));
  if (!group && !wg.length) group = central;
  if (!group) no(wg.length ? `${wg.join(', ')} is not a chartered working group (${groups.map((g) => g.label).join(', ') || 'none chartered'})` : 'it carries no working group label and no central group was given');
  const a = answersOf(issue.body);
  if (a.none !== undefined && !a.problems.length) no(`it answers no affirmed problem ("No affirmed problem yet: ${a.none}")`);
  else if (!a.problems.length) no('its body has no "Answers: SP-nn" line');
  else if (!a.problems.some((p) => affirmed.has(p))) no(`${a.problems.join(', ')} is not affirmed in the programme`);
  if (group) {
    const holds = group.members.some((m) => m.actor === actor && m.role === seat) ||
      (actor === ownerActor && (seat === 'builder' || seat === 'reviewer') && (group.central || group.members.some((m) => m.role === seat)));
    if (!holds) no(`${actor} does not hold the ${seat} seat in ${group.title}`);
  }
  return { ok: !reasons.length, reasons, group, todo: ['the epic owned by the group is not checked (no epic-group relation yet, group label is the binding)'] };
}

// The claim comment is the claim's record: "Claimed by <actor> ..." is its machine-readable marker (hand-written claims use it too).
export const claimComment = (actor, seat, group, branch) => `Claimed by ${actor} as ${seat} of ${group} (clerk claim). Branch: ${branch}.`;
const CLAIM_RE = /^Claimed by (\S+?)[.,:;)]*(?:\s|$)/m;
// The actor a claim comment names ("Claimed by orchestrator session" -> "orchestrator"), or null if it is no claim comment.
export const claimActorOf = (body) => CLAIM_RE.exec(body ?? '')?.[1] ?? null;
// Only the owner's own claim assigns the owner's GitHub account; an agent claim runs under that account and must not.
export const claimAssigns = (actor, ownerActor) => Boolean(ownerActor) && actor === ownerActor;
// The latest claim comment still open: no `status: in progress` unlabel after it (stale-claims and a released claim both remove the label). -> body or null.
export function openClaim(timeline = []) {
  let open = null;
  for (const e of timeline ?? []) {
    if (e.event === 'commented' && claimActorOf(e.body)) open = e.body;
    else if (e.event === 'unlabeled' && e.label?.name === 'status: in progress') open = null;
  }
  return open;
}
